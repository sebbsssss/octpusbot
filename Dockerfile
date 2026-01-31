# Octpus - Minimal Docker Image
#
# Build:
#   docker build -t octpus .
#
# Run:
#   docker run -it -e ANTHROPIC_API_KEY=sk-... octpus
#
# With persistent config:
#   docker run -it -v ~/.octpus:/root/.octpus -e ANTHROPIC_API_KEY=sk-... octpus

FROM oven/bun:1.1-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
COPY packages/types/package.json ./packages/types/
COPY packages/autonomy/package.json ./packages/autonomy/
COPY apps/cli/package.json ./apps/cli/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build standalone binary
RUN bun build bin/octpus.ts --compile --outfile /octpus

# ============================================================================
# Production image - minimal
# ============================================================================
FROM debian:bookworm-slim

# Install minimal runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binary
COPY --from=builder /octpus /usr/local/bin/octpus

# Create non-root user
RUN useradd -m -s /bin/bash octpus
USER octpus
WORKDIR /home/octpus

# Config volume
VOLUME /home/octpus/.octpus

# Default command
ENTRYPOINT ["octpus"]
CMD []
