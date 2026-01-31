#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load environment variables
if [ -f "$REPO_ROOT/.env" ]; then
  export $(cat "$REPO_ROOT/.env" | grep -v '^#' | xargs)
fi

cd "$REPO_ROOT/verifier_service"

echo "🔧 Starting VeilProof Verifier Service"
echo "======================================"
echo ""
echo "Configuration:"
echo "  Port: ${VERIFIER_PORT:-8787}"
echo "  Solana RPC: ${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
echo "  Noir directory: $REPO_ROOT/noir/vote_proof"
echo ""
echo "Endpoints:"
echo "  POST /generate-proof - Generate ZK proof from vote data"
echo "  POST /verify         - Verify proof and sign attestation"
echo ""
echo "Press Ctrl+C to stop..."
echo ""

node index.js
