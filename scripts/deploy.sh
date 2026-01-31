#!/usr/bin/env bash
set -e

echo "🚀 VeilProof Deployment Script"
echo "================================"
echo ""

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found. Please install it first:"
    echo "   sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Cargo not found. Please install Rust first:"
    echo "   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Get the repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Set network to devnet
NETWORK="${SOLANA_NETWORK:-devnet}"
echo "📡 Network: $NETWORK"

# Configure Solana CLI for devnet
solana config set --url "https://api.$NETWORK.solana.com"

# Check wallet balance
BALANCE=$(solana balance 2>/dev/null | awk '{print $1}')
echo "💰 Wallet balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo "⚠️  Low balance! You need at least 2 SOL for deployment."
    echo "   Run: solana airdrop 2 --url devnet"
    echo ""
    read -p "Do you want to request an airdrop now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        solana airdrop 2 --url devnet
        sleep 2
    else
        exit 1
    fi
fi

echo ""
echo "🔨 Building Solana programs..."
echo ""

# Build vote_program
echo "Building vote_program..."
cd "$REPO_ROOT/programs/vote_program"
cargo build-sbf

# Build verifier_program
echo ""
echo "Building verifier_program..."
cd "$REPO_ROOT/programs/verifier_program"
cargo build-sbf

cd "$REPO_ROOT"

echo ""
echo "📤 Deploying programs to $NETWORK..."
echo ""

# Deploy vote_program
echo "Deploying vote_program..."
VOTE_PROGRAM_SO="$REPO_ROOT/target/deploy/vote_program.so"
if [ ! -f "$VOTE_PROGRAM_SO" ]; then
    echo "❌ vote_program.so not found at $VOTE_PROGRAM_SO"
    exit 1
fi

VOTE_DEPLOY_OUTPUT=$(solana program deploy "$VOTE_PROGRAM_SO" --url $NETWORK 2>&1)
VOTE_PROGRAM_ID=$(echo "$VOTE_DEPLOY_OUTPUT" | grep -oE '[A-Za-z0-9]{32,}' | head -1)

if [ -z "$VOTE_PROGRAM_ID" ]; then
    echo "❌ Failed to extract vote program ID"
    echo "$VOTE_DEPLOY_OUTPUT"
    exit 1
fi

echo "✅ vote_program deployed: $VOTE_PROGRAM_ID"

# Deploy verifier_program
echo ""
echo "Deploying verifier_program..."
VERIFIER_PROGRAM_SO="$REPO_ROOT/target/deploy/verifier_program.so"
if [ ! -f "$VERIFIER_PROGRAM_SO" ]; then
    echo "❌ verifier_program.so not found at $VERIFIER_PROGRAM_SO"
    exit 1
fi

VERIFIER_DEPLOY_OUTPUT=$(solana program deploy "$VERIFIER_PROGRAM_SO" --url $NETWORK 2>&1)
VERIFIER_PROGRAM_ID=$(echo "$VERIFIER_DEPLOY_OUTPUT" | grep -oE '[A-Za-z0-9]{32,}' | head -1)

if [ -z "$VERIFIER_PROGRAM_ID" ]; then
    echo "❌ Failed to extract verifier program ID"
    echo "$VERIFIER_DEPLOY_OUTPUT"
    exit 1
fi

echo "✅ verifier_program deployed: $VERIFIER_PROGRAM_ID"

# Save to .env file
echo ""
echo "💾 Saving program IDs to .env..."

cat > "$REPO_ROOT/.env" <<EOF
# Solana Network Configuration
SOLANA_NETWORK=$NETWORK
SOLANA_RPC_URL=https://api.$NETWORK.solana.com

# Deployed Program IDs
VOTE_PROGRAM_ID=$VOTE_PROGRAM_ID
VERIFIER_PROGRAM_ID=$VERIFIER_PROGRAM_ID

# Verifier Service
VERIFIER_SERVICE_URL=http://127.0.0.1:8787
VERIFIER_PORT=8787

# Attestation signer pubkey (from verifier_service/index.js)
ATTESTATION_PUBKEY=16935cb51421e64f44b2ace14ba2e6901de00d92cb1ee3ca69473d7502abdb8d
EOF

echo "✅ Configuration saved to .env"

# Also create UI-specific env files
echo ""
echo "💾 Creating UI environment files..."

cat > "$REPO_ROOT/ui/web/.env.development" <<EOF
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_NETWORK=devnet
VITE_VOTE_PROGRAM_ID=$VOTE_PROGRAM_ID
VITE_VERIFIER_PROGRAM_ID=$VERIFIER_PROGRAM_ID
VITE_VERIFIER_SERVICE_URL=http://127.0.0.1:8787
EOF

cat > "$REPO_ROOT/ui/web/.env.production" <<EOF
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_NETWORK=devnet
VITE_VOTE_PROGRAM_ID=$VOTE_PROGRAM_ID
VITE_VERIFIER_PROGRAM_ID=$VERIFIER_PROGRAM_ID
VITE_VERIFIER_SERVICE_URL=http://127.0.0.1:8787
EOF

echo "✅ UI environment files created"

echo ""
echo "=========================================="
echo "🎉 Deployment Complete!"
echo "=========================================="
echo ""
echo "Program IDs:"
echo "  vote_program:     $VOTE_PROGRAM_ID"
echo "  verifier_program: $VERIFIER_PROGRAM_ID"
echo ""
echo "Next steps:"
echo "  1. Verify deployment:"
echo "     solana program show $VOTE_PROGRAM_ID --url $NETWORK"
echo "     solana program show $VERIFIER_PROGRAM_ID --url $NETWORK"
echo ""
echo "  2. Start the verifier service:"
echo "     cd verifier_service && node index.js"
echo ""
echo "  3. Start the UI:"
echo "     cd ui/web && npm run dev"
echo ""
