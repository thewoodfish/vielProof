# VeilProof Verifier Service - Railway Deployment
# This Dockerfile builds a container with Noir (nargo) and Barretenberg (bb)
# for zero-knowledge proof generation and verification

FROM node:20-slim

# Install system dependencies including C++ runtime for bb
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    wget \
    libc++1 \
    libc++abi1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Nargo (Noir compiler) - download pre-built binary
RUN NARGO_VERSION="v0.36.0" && \
    curl -L "https://github.com/noir-lang/noir/releases/download/${NARGO_VERSION}/nargo-x86_64-unknown-linux-gnu.tar.gz" -o nargo.tar.gz && \
    tar -xzf nargo.tar.gz && \
    mv nargo /usr/local/bin/ && \
    chmod +x /usr/local/bin/nargo && \
    rm nargo.tar.gz && \
    nargo --version

# Install Barretenberg (bb) - Use version compatible with nargo v0.36.0
# Trying v0.62.0 (from same time period as nargo v0.36.0)
RUN curl -L "https://github.com/AztecProtocol/aztec-packages/releases/download/aztec-packages-v0.62.0/barretenberg-x86_64-linux-gnu.tar.gz" -o bb.tar.gz && \
    tar -xzf bb.tar.gz && \
    chmod +x bb && \
    mv bb /usr/local/bin/ && \
    if [ -d lib ]; then mv lib/* /usr/local/lib/; fi && \
    ldconfig && \
    rm -rf bb.tar.gz lib && \
    bb --version && \
    echo "bb installed successfully"

# Copy verifier service and Noir circuit
COPY verifier_service/ ./verifier_service/
COPY noir/ ./noir/
COPY package.json ./

# Set environment variables for verifier service
ENV NARGO_BIN=/usr/local/bin/nargo
ENV BB_BIN=/usr/local/bin/bb
ENV HOME=/app

# Create necessary directories
RUN mkdir -p noir/vote_proof/target && \
    chmod -R 755 verifier_service

# Expose port (Railway will override with PORT env var)
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT:-8787}/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start the verifier service
CMD ["node", "verifier_service/index.js"]
