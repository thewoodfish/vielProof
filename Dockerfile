# VeilProof Verifier Service - Railway Deployment
# This Dockerfile builds a container with Noir (nargo) and Barretenberg (bb)
# for zero-knowledge proof generation and verification

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Set HOME for nargo/bb cache directories
ENV HOME=/app/.home
ENV PATH="${HOME}/.nargo/bin:${HOME}/.bb:${PATH}"

# Install Nargo (Noir compiler)
RUN curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && \
    bash -c "source ${HOME}/.bashrc && ${HOME}/.nargo/bin/noirup" && \
    mkdir -p ${HOME}/.nargo/bin && \
    chmod +x ${HOME}/.nargo/bin/nargo || true

# Install Barretenberg (ZK proof system)
RUN curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash && \
    bash -c "source ${HOME}/.bashrc && ${HOME}/.bb/bbup" && \
    mkdir -p ${HOME}/.bb && \
    chmod +x ${HOME}/.bb/bb || true

# Copy verifier service and Noir circuit
COPY verifier_service/ ./verifier_service/
COPY noir/ ./noir/
COPY package.json ./

# Create necessary directories
RUN mkdir -p ${HOME}/.home && \
    mkdir -p noir/vote_proof/target && \
    chmod -R 755 verifier_service

# Expose port (Railway will override with PORT env var)
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT:-8787}/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start the verifier service
CMD ["node", "verifier_service/index.js"]
