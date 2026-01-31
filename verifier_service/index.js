#!/usr/bin/env node
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PORT = process.env.VERIFIER_PORT || 8787;
const REPO_ROOT = path.resolve(__dirname, "..");
const BB_BIN = process.env.BB_BIN || path.join(os.homedir(), ".bb", "bb");
const VK_PATH = process.env.VK_PATH || path.join(REPO_ROOT, "noir", "vote_proof", "target", "proof", "vk");
const VK_HASH_PATH = process.env.VK_HASH_PATH || path.join(REPO_ROOT, "noir", "vote_proof", "target", "proof", "vk_hash");
const HOME_DIR = path.join(REPO_ROOT, ".home");
const NARGO_BIN = process.env.NARGO_BIN || path.join(os.homedir(), ".nargo", "bin", "nargo");
const NOIR_DIR = path.join(REPO_ROOT, "noir", "vote_proof");
const NOIR_TARGET_DIR = path.join(NOIR_DIR, "target");
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",");

const PRIV_KEY_PEM = `-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA2e4dw8pWVZ1KCUJLkFS5i6tyXCP/WyPQ28nQtO1iKU\n-----END PRIVATE KEY-----`;
const ATTESTATION_PUBKEY_HEX = "16935cb51421e64f44b2ace14ba2e6901de00d92cb1ee3ca69473d7502abdb8d";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function u64Le(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function computeMessageHash({
  expectedProgramId,
  expectedProposalId,
  vkHash,
  proofBytes,
  publicInputsCanonical,
}) {
  const prefix = Buffer.from("VEILPROOF_V1", "utf8");
  const programIdLe = u64Le(expectedProgramId);
  const proposalIdLe = u64Le(expectedProposalId);
  const proofHash = sha256(proofBytes);
  const publicInputsHash = sha256(Buffer.from(publicInputsCanonical, "utf8"));
  const message = Buffer.concat([
    prefix,
    programIdLe,
    proposalIdLe,
    vkHash,
    proofHash,
    publicInputsHash,
  ]);
  return {
    messageHash: sha256(message),
    proofHash,
    publicInputsHash,
  };
}

function runBbVerify({ proofPath, publicInputsPath }) {
  const result = spawnSync(
    BB_BIN,
    [
      "verify",
      "-k",
      VK_PATH,
      "-p",
      proofPath,
      "-i",
      publicInputsPath,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        HOME: HOME_DIR,
      },
    },
  );
  return result.status === 0;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function respondJson(res, status, body, origin) {
  const payload = JSON.stringify(body, null, 2);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  };

  // Add CORS headers
  if (origin && (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }

  res.writeHead(status, headers);
  res.end(payload);
}

function generateProof({ proposalId, programId, voteChoice }) {
  // Write Prover.toml
  const proverPath = path.join(NOIR_DIR, "Prover.toml");
  const proverContent = [
    `program_id = ${programId}`,
    `proposal_id = ${proposalId}`,
    `vote_choice = ${voteChoice}`,
    `expected_program_id = ${programId}`,
    `expected_proposal_id = ${proposalId}`,
    "",
  ].join("\n");
  fs.writeFileSync(proverPath, proverContent);

  const env = {
    ...process.env,
    HOME: HOME_DIR,
  };

  // Compile Noir circuit
  let result = spawnSync(NARGO_BIN, ["compile"], {
    cwd: NOIR_DIR,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Nargo compile failed");
  }

  // Execute witness generation
  result = spawnSync(NARGO_BIN, ["execute", "witness"], {
    cwd: NOIR_DIR,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Nargo execute failed");
  }

  // Generate proof with Barretenberg
  const proofOutDir = path.join(NOIR_TARGET_DIR, "proof");
  fs.mkdirSync(proofOutDir, { recursive: true });

  result = spawnSync(
    BB_BIN,
    [
      "prove",
      "-b",
      path.join(NOIR_TARGET_DIR, "vote_proof.json"),
      "-w",
      path.join(NOIR_TARGET_DIR, "witness.gz"),
      "-o",
      proofOutDir,
      "--write_vk",
    ],
    {
      cwd: NOIR_DIR,
      env,
      stdio: "inherit",
    }
  );
  if (result.status !== 0) {
    throw new Error("Barretenberg prove failed");
  }

  // Read proof artifacts
  const proofBytes = fs.readFileSync(path.join(proofOutDir, "proof"));
  const publicInputs = fs.readFileSync(path.join(proofOutDir, "public_inputs"));
  const vkHash = fs.readFileSync(path.join(proofOutDir, "vk_hash"));

  return {
    publicInputs: {
      expected_program_id: programId.toString(),
      expected_proposal_id: proposalId.toString(),
      raw: publicInputs.toString("base64"),
    },
    proof: proofBytes.toString("base64"),
    vkHash: vkHash.toString("hex"),
    meta: {
      mock: false,
      note: "Generated with Noir (nargo) + Barretenberg (bb).",
    },
  };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    respondJson(res, 200, {}, origin);
    return;
  }

  // Route: /generate-proof
  if (req.method === "POST" && req.url === "/generate-proof") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      respondJson(res, 400, { error: "Invalid JSON" }, origin);
      return;
    }

    const { proposal_id: proposalId, program_id: programId } = body || {};

    if (proposalId == null || programId == null) {
      respondJson(res, 400, { error: "Missing proposal_id or program_id" }, origin);
      return;
    }

    // Check if required binaries exist
    if (!fs.existsSync(NARGO_BIN)) {
      respondJson(res, 500, { error: "nargo binary not found" }, origin);
      return;
    }
    if (!fs.existsSync(BB_BIN)) {
      respondJson(res, 500, { error: "bb binary not found" }, origin);
      return;
    }

    try {
      const proofJson = generateProof({
        proposalId,
        programId,
        voteChoice: 1, // Always YES for now
      });
      respondJson(res, 200, { ok: true, proof: proofJson }, origin);
    } catch (err) {
      console.error("Proof generation failed:", err);
      respondJson(res, 500, { error: "Proof generation failed: " + err.message }, origin);
    }
    return;
  }

  // Route: /verify
  if (req.method === "POST" && req.url === "/verify") {

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    respondJson(res, 400, { error: "Invalid JSON" }, origin);
    return;
  }

  const {
    proof_bytes_base64: proofBytesBase64,
    public_inputs_json: publicInputsJson,
    vk_hash_hex: vkHashHex,
    expected_program_id: expectedProgramId,
    expected_proposal_id: expectedProposalId,
  } = body || {};

  if (!proofBytesBase64 || !publicInputsJson || !vkHashHex || expectedProgramId == null || expectedProposalId == null) {
    respondJson(res, 400, { error: "Missing required fields" }, origin);
    return;
  }

  if (!fs.existsSync(BB_BIN)) {
    respondJson(res, 500, { error: "bb binary not found" }, origin);
    return;
  }
  if (!fs.existsSync(VK_PATH) || !fs.existsSync(VK_HASH_PATH)) {
    respondJson(res, 500, { error: "vk or vk_hash not found" }, origin);
    return;
  }

  const proofBytes = Buffer.from(proofBytesBase64, "base64");
  const publicInputsRawBase64 = publicInputsJson.raw;
  if (!publicInputsRawBase64) {
    respondJson(res, 400, { error: "public_inputs_json.raw is required" }, origin);
    return;
  }

  const vkHashFile = fs.readFileSync(VK_HASH_PATH);
  const vkHashFileHex = vkHashFile.toString("hex");
  if (vkHashFileHex !== vkHashHex) {
    respondJson(res, 400, { error: "vk_hash mismatch" }, origin);
    return;
  }

  if (
    publicInputsJson.expected_program_id != null &&
    String(publicInputsJson.expected_program_id) !== String(expectedProgramId)
  ) {
    respondJson(res, 400, { error: "expected_program_id mismatch" }, origin);
    return;
  }
  if (
    publicInputsJson.expected_proposal_id != null &&
    String(publicInputsJson.expected_proposal_id) !== String(expectedProposalId)
  ) {
    respondJson(res, 400, { error: "expected_proposal_id mismatch" }, origin);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "veilproof-"));
  const proofPath = path.join(tmpDir, "proof");
  const publicInputsPath = path.join(tmpDir, "public_inputs");
  fs.writeFileSync(proofPath, proofBytes);
  fs.writeFileSync(publicInputsPath, Buffer.from(publicInputsRawBase64, "base64"));

  const verified = runBbVerify({ proofPath, publicInputsPath });
  if (!verified) {
    respondJson(res, 400, { error: "Proof verification failed" }, origin);
    return;
  }

  const publicInputsCanonical = canonicalizeJson(publicInputsJson);
  const { messageHash, proofHash, publicInputsHash } = computeMessageHash({
    expectedProgramId,
    expectedProposalId,
    vkHash: Buffer.from(vkHashHex, "hex"),
    proofBytes,
    publicInputsCanonical,
  });

  const signature = crypto.sign(null, messageHash, PRIV_KEY_PEM);

  respondJson(res, 200, {
    ok: true,
    attestation: {
      scheme: "ed25519",
      signer_pubkey_hex: ATTESTATION_PUBKEY_HEX,
      message_hash_hex: messageHash.toString("hex"),
      expected_program_id: String(expectedProgramId),
      expected_proposal_id: String(expectedProposalId),
      vk_hash_hex: vkHashHex,
      proof_hash_hex: proofHash.toString("hex"),
      public_inputs_hash_hex: publicInputsHash.toString("hex"),
    },
    signature_base64: signature.toString("base64"),
  }, origin);
    return;
  }

  // Route not found
  respondJson(res, 404, { error: "Not Found" }, origin);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`VeilProof verifier service listening on http://127.0.0.1:${PORT}`);
});
