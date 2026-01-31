#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function requireBinary(name, fallbackPath) {
  if (process.env[name]) return process.env[name];
  if (fs.existsSync(fallbackPath)) return fallbackPath;
  return null;
}

function run(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const proposalId = BigInt(getArg("--proposal", "1"));
const programId = BigInt(getArg("--program", "7"));
const voteChoice = BigInt(getArg("--choice", "1"));

if (voteChoice !== 1n) {
  console.error("This demo only supports YES votes (choice == 1).");
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "..");
const noirDir = path.join(repoRoot, "noir", "vote_proof");
const noirTargetDir = path.join(noirDir, "target");
const proverPath = path.join(noirDir, "Prover.toml");
const localHome = path.join(repoRoot, ".home");
const userHome = os.homedir();

fs.mkdirSync(localHome, { recursive: true });
fs.mkdirSync(noirTargetDir, { recursive: true });

const nargoPath = requireBinary("NARGO_BIN", path.join(userHome, ".nargo", "bin", "nargo"));
const bbPath = requireBinary("BB_BIN", path.join(userHome, ".bb", "bb"));

if (!nargoPath || !bbPath) {
  console.error("Missing Noir tools. Ensure nargo and bb are installed.");
  console.error("Set NARGO_BIN and BB_BIN if they are in non-standard locations.");
  process.exit(1);
}

const env = {
  ...process.env,
  HOME: localHome,
};

fs.writeFileSync(
  proverPath,
  [
    `program_id = ${programId}`,
    `proposal_id = ${proposalId}`,
    `vote_choice = ${voteChoice}`,
    `expected_program_id = ${programId}`,
    `expected_proposal_id = ${proposalId}`,
    "",
  ].join("\n"),
);

run(nargoPath, ["compile"], noirDir, env);
run(nargoPath, ["execute", "witness"], noirDir, env);

const proofOutDir = path.join(noirTargetDir, "proof");
fs.mkdirSync(proofOutDir, { recursive: true });

run(
  bbPath,
  [
    "prove",
    "-b",
    path.join(noirTargetDir, "vote_proof.json"),
    "-w",
    path.join(noirTargetDir, "witness.gz"),
    "-o",
    proofOutDir,
    "--write_vk",
  ],
  noirDir,
  env,
);

const proofBytes = fs.readFileSync(path.join(proofOutDir, "proof"));
const publicInputs = fs.readFileSync(path.join(proofOutDir, "public_inputs"));
const vkHash = fs.readFileSync(path.join(proofOutDir, "vk_hash"));

const outputDir = path.join(__dirname, "out");
fs.mkdirSync(outputDir, { recursive: true });

const proofJson = {
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

const outPath = path.join(outputDir, "proof.json");
fs.writeFileSync(outPath, JSON.stringify(proofJson, null, 2));

console.log("Proof generated:", outPath);
