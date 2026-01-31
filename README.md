# VeilProof

VeilProof is a hackathon-grade end-to-end prototype that demonstrates **Private Proof-of-Action on Solana** using a Noir circuit. A user can prove they voted **YES** on a proposal without revealing their wallet, transaction signature, vote amount, or any other metadata.

## What this demo shows
- A minimal Solana **vote program** accepts a vote instruction.
- A **Noir circuit** proves (in zero-knowledge) that:
  - the vote came from the expected voting program
  - the proposal ID matches the public value
  - the vote choice was **YES**
- A **verifier service** verifies the proof off-chain and signs an attestation.
- A **verifier program** checks the attestation signature on-chain and records:
  - “A valid anonymous YES vote was proven for proposal X”

## Privacy property (in one sentence)
The verifier learns **only** that a valid YES vote was proven for proposal X — **not** who voted, which transaction, or how much.

## Repository structure
```
veilproof/
├── programs/
│   ├── vote_program/
│   └── verifier_program/
├── noir/
│   └── vote_proof/
├── scripts/
│   ├── generate_proof.js
│   └── demo.js
├── verifier_service/
│   └── index.js
├── README.md
```

## 60-second demo flow
1) User votes YES (mocked for clarity)
2) User generates Noir proof locally
3) Proof is verified locally with `bb`
4) Verifier service signs an attestation
5) User submits proof + attestation to verifier program
6) Verifier confirms success

Run the demo:
```
node verifier_service/index.js
```
Then in a second terminal:
```
node scripts/demo.js
```

## Prerequisites (real proof generation)
Install Noir and Barretenberg (bb):
```
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
~/.nargo/bin/noirup
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash
~/.bb/bbup
```
If your binaries are in non-standard locations, set:
```
export NARGO_BIN=/path/to/nargo
export BB_BIN=/path/to/bb
```

## How the proof works
The Noir circuit lives at `noir/vote_proof/src/main.nr` and enforces:
- `program_id == expected_program_id`
- `proposal_id == expected_proposal_id`
- `vote_choice == 1`

Private inputs:
- `program_id`
- `proposal_id`
- `vote_choice`

Public inputs:
- `expected_program_id`
- `expected_proposal_id`

## Attestation format (canonical message)
The verifier service signs the following message:
```
SHA256(
  "VEILPROOF_V1" ||
  expected_program_id ||
  expected_proposal_id (u64 LE) ||
  vk_hash ||
  SHA256(proof_bytes) ||
  SHA256(public_inputs_json_canonical)
)
```

## Notes on the verifier
Proof generation and verification are **real** (Noir + Barretenberg). On-chain verification is a **signed attestation** (ed25519) checked via Solana's native ed25519 program using the instruction sysvar. Full on-chain zk verification is future work.

## Complete Deployment Guide

### Prerequisites

1. **Solana CLI** (for deploying programs)
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   solana --version
   ```

2. **Noir and Barretenberg** (for ZK proofs)
   ```bash
   curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
   ~/.nargo/bin/noirup
   curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash
   ~/.bb/bbup
   ```

3. **Rust** (for building Solana programs)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

4. **Node.js** (v18 or higher)
   ```bash
   node --version  # Should be >= 18
   ```

### Step 1: Deploy Solana Programs to Devnet

```bash
# Make sure you have devnet SOL (get from faucet if needed)
solana config set --url devnet
solana balance
# If balance is low:
solana airdrop 2

# Deploy both programs
./scripts/deploy.sh
```

This script will:
- Build vote_program and verifier_program
- Deploy them to Solana devnet
- Save program IDs to `.env` and `ui/web/.env.development`

Program IDs will be displayed at the end. Example:
```
vote_program:     HGuDPsJJpuFWoGDVsdyWK3XrXmh9MPZeMP21qvk1fsGV
verifier_program: FiHcaN4epv9zP2HnRgK1uFfRCNsFMrNDzdkZB4MSXLan
```

### Step 2: Start the Verifier Service

In a new terminal:
```bash
./scripts/start-verifier.sh
```

The service will listen on http://127.0.0.1:8787 with two endpoints:
- `POST /generate-proof` - Generate ZK proof from vote data
- `POST /verify` - Verify proof and sign attestation

### Step 3: Start the UI

In another terminal:
```bash
cd ui/web
npm install  # First time only
npm run dev
```

The UI will be available at http://localhost:5173

### Step 4: Test End-to-End

#### Using the UI:

1. Open http://localhost:5173
2. **For Demo Mode (no wallet needed)**:
   - Toggle "Demo Mode" ON
   - Click through the 3 steps to see simulated flow

3. **For Real Mode (with Solana wallet)**:
   - Install Phantom or Solflare wallet
   - Switch wallet to Devnet
   - Get devnet SOL: https://faucet.solana.com
   - Click "Connect Wallet" button
   - Toggle "Demo Mode" OFF
   - Click "Cast YES Vote" → approve wallet transaction
   - Click "Generate Zero-Knowledge Proof" → wait ~5 seconds
   - Click "Submit Proof for Verification" → approve wallet transaction
   - Check devnet explorer for both transactions

#### Using the CLI Demo:

```bash
node scripts/demo.js
```

This runs the same flow programmatically.

### Verification

Check your deployed programs:
```bash
solana program show YOUR_VOTE_PROGRAM_ID --url devnet
solana program show YOUR_VERIFIER_PROGRAM_ID --url devnet
```

View transactions on Solana Explorer:
- https://explorer.solana.com/?cluster=devnet

## Building the Solana programs (manual)
From the repo root:
```
cd programs/vote_program && cargo build-sbf
cd ../verifier_program && cargo build-sbf
```

## Generate a proof artifact
```
node scripts/generate_proof.js --proposal 42 --program 7 --choice 1
```

This writes `scripts/out/proof.json`, which the demo uses to create the verifier instruction data.

---

If the output makes it obvious that the verifier **only knows a YES vote was proven**, then VeilProof succeeds.

## Railway Deployment

Deploy the verifier service to Railway for public access.

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository connected to Railway
- Docker installed locally (for testing)

### Quick Start

1. **Test Dockerfile locally**:
   ```bash
   docker build -t veilproof-verifier .
   docker run -p 8787:8787 veilproof-verifier
   curl http://localhost:8787/health
   ```

2. **Deploy to Railway**:
   - Go to Railway dashboard
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your VeilProof repository
   - Railway will auto-detect the Dockerfile
   - Wait for build (~5-10 minutes)

3. **Configure environment variables** in Railway dashboard:
   - `PORT` (auto-injected by Railway)
   - `SOLANA_RPC_URL` (optional, defaults to https://api.devnet.solana.com)
   - `ALLOWED_ORIGINS` (optional, set to your frontend domain or "*" for testing)

4. **Verify deployment**:
   ```bash
   curl https://your-railway-url.railway.app/health
   ```

### Testing the deployed service

Generate a proof:
```bash
curl -X POST https://your-railway-url.railway.app/generate-proof \
  -H "Content-Type: application/json" \
  -d '{
    "proposal_id": "42",
    "program_id": "7",
    "vote_choice": 1
  }'
```

Verify a proof:
```bash
curl -X POST https://your-railway-url.railway.app/verify \
  -H "Content-Type: application/json" \
  -d '{
    "proof_bytes_base64": "<proof_from_generate>",
    "public_inputs_json": {"expected_program_id":"7","expected_proposal_id":"42","raw":"..."},
    "vk_hash_hex": "<vk_hash_from_generate>",
    "expected_program_id": "7",
    "expected_proposal_id": "42"
  }'
```

### Update frontend to use Railway service

After deploying, update your frontend environment:
```bash
# In ui/web/.env.development or .env.production
VITE_VERIFIER_SERVICE_URL=https://your-railway-url.railway.app
```

### Build times and performance

- **First build**: ~5-10 minutes (downloads nargo, barretenberg)
- **Subsequent builds**: ~2-3 minutes (cached layers)
- **Cold start**: ~2-3 seconds
- **Proof generation**: ~2-5 seconds (first request), ~1-3 seconds (cached)
- **Proof verification**: ~100-500ms

### Troubleshooting

**Build timeout**: If Railway times out during build, the nargo/bb installation might be taking too long. Check Railway logs and consider upgrading to a larger instance.

**Out of memory**: Proof generation requires at least 512MB RAM. Upgrade to Railway's Pro plan if you see OOM errors.

**CORS errors**: Set `ALLOWED_ORIGINS` environment variable to include your frontend domain:
```
ALLOWED_ORIGINS=https://your-frontend.vercel.app,http://localhost:5173
```

### Monitoring

Railway provides automatic:
- Health checks (via `/health` endpoint)
- Logs (view in Railway dashboard)
- Metrics (CPU, memory, network)
- Alerts (configure in settings)

---

## UI Demo (1900s retro)
Run the frontend:
```
cd ui/web
npm install
npm run dev
```
Demo Mode is ON by default. Toggle it off in the UI to switch to Real Mode (calls will throw "Not implemented").
