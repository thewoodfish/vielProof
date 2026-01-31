#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const proposalId = process.env.PROPOSAL_ID || "42";
  const programId = process.env.PROGRAM_ID || "7";

  const repoRoot = path.resolve(__dirname, "..");
  const noirDir = path.join(repoRoot, "noir", "vote_proof");
  const noirTargetDir = path.join(noirDir, "target");
  const userHome = os.homedir();
  const bbPath = process.env.BB_BIN || path.join(userHome, ".bb", "bb");
  const verifierUrl = process.env.VERIFIER_URL || "http://127.0.0.1:8787/verify";

  console.log("1) User votes YES on proposal", proposalId);
  console.log("   (In this demo, the vote transaction is mocked.)");

  console.log("\n2) Generating Noir proof locally...");
  const gen = spawnSync(
    "node",
    [path.join(__dirname, "generate_proof.js"), "--proposal", proposalId, "--program", programId, "--choice", "1"],
    { stdio: "inherit" },
  );
  if (gen.status !== 0) {
    process.exit(gen.status || 1);
  }

  console.log("\n3) Verifying proof locally with bb...");
  const verify = spawnSync(
    bbPath,
    [
      "verify",
      "-k",
      path.join(noirTargetDir, "proof", "vk"),
      "-p",
      path.join(noirTargetDir, "proof", "proof"),
      "-i",
      path.join(noirTargetDir, "proof", "public_inputs"),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        HOME: path.join(repoRoot, ".home"),
      },
    },
  );
  if (verify.status !== 0) {
    process.exit(verify.status || 1);
  }

  const proofPath = path.join(__dirname, "out", "proof.json");
  const proofJson = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const proofBytes = Buffer.from(proofJson.proof, "base64");

  console.log("\n4) Requesting signed attestation from verifier service...");
  const response = await fetch(verifierUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof_bytes_base64: proofJson.proof,
      public_inputs_json: proofJson.publicInputs,
      vk_hash_hex: proofJson.vkHash,
      expected_program_id: programId,
      expected_proposal_id: proposalId,
    }),
  });
  const attestationJson = await response.json();
  if (!response.ok) {
    console.error(attestationJson);
    process.exit(1);
  }

  const signatureBytes = Buffer.from(attestationJson.signature_base64, "base64");
  const publicInputsHash = Buffer.from(attestationJson.attestation.public_inputs_hash_hex, "hex");
  const vkHash = Buffer.from(attestationJson.attestation.vk_hash_hex, "hex");

  const expectedProgramIdLe = Buffer.alloc(8);
  expectedProgramIdLe.writeBigUInt64LE(BigInt(programId));

  const expectedProposalIdLe = Buffer.alloc(8);
  expectedProposalIdLe.writeBigUInt64LE(BigInt(proposalId));

  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(proofBytes.length);

  const verifierInstructionData = Buffer.concat([
    expectedProgramIdLe,
    expectedProposalIdLe,
    vkHash,
    publicInputsHash,
    signatureBytes,
    proofLen,
    proofBytes,
  ]);

  console.log("\n5) Submitting proof + attestation + signature to verifier program...");
  console.log("   Instruction data length:", verifierInstructionData.length, "bytes");
  console.log("   Instruction data (hex, prefix):", verifierInstructionData.toString("hex").slice(0, 64) + "...");
  console.log("   Attestation signer pubkey:", attestationJson.attestation.signer_pubkey_hex);

  console.log("\n6) Verifier confirms success");
  console.log(`   \"A valid anonymous YES vote was proven for proposal ${proposalId}\"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
