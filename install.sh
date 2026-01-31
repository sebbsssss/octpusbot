#!/bin/bash
set -e

# Octpus Installer
# Usage: curl -fsSL https://octpus.dev/install.sh | bash

VERSION="${OCTPUS_VERSION:-latest}"
INSTALL_DIR="${OCTPUS_INSTALL_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}🐙 Octpus Installer${NC}"
echo -e "${DIM}8 arms. Infinite reach.${NC}"
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo -e "${RED}Unsupported architecture: $ARCH${NC}"; exit 1 ;;
esac

case "$OS" in
  darwin|linux) ;;
  *) echo -e "${RED}Unsupported OS: $OS${NC}"; exit 1 ;;
esac

BINARY="octpus-${OS}-${ARCH}"
echo -e "${DIM}Platform: ${OS}/${ARCH}${NC}"

# Check for existing installation methods
if command -v brew &> /dev/null; then
  echo ""
  echo -e "${YELLOW}Homebrew detected.${NC} You can also install via:"
  echo -e "  ${CYAN}brew install sebbsssss/octpus/octpus${NC}"
  echo ""
fi

if command -v npm &> /dev/null; then
  echo -e "${YELLOW}npm detected.${NC} You can also install via:"
  echo -e "  ${CYAN}npx octpus${NC}  ${DIM}(run without install)${NC}"
  echo -e "  ${CYAN}npm install -g octpus${NC}"
  echo ""
fi

# Download binary
echo -e "${DIM}Downloading...${NC}"

mkdir -p "$INSTALL_DIR"

if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/sebbsssss/octpusbot/releases/latest/download/${BINARY}.tar.gz"
else
  DOWNLOAD_URL="https://github.com/sebbsssss/octpusbot/releases/download/v${VERSION}/${BINARY}.tar.gz"
fi

# Try to download, fall back to building from source
if curl -fsSL "$DOWNLOAD_URL" -o /tmp/octpus.tar.gz 2>/dev/null; then
  tar -xzf /tmp/octpus.tar.gz -C "$INSTALL_DIR"
  rm /tmp/octpus.tar.gz
  chmod +x "$INSTALL_DIR/octpus"
  echo -e "  ${GREEN}✓${NC} Downloaded binary"
else
  echo -e "${YELLOW}Binary not found, building from source...${NC}"

  # Check for bun
  if ! command -v bun &> /dev/null; then
    echo -e "${DIM}Installing bun...${NC}"
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi

  # Clone and build
  TEMP_DIR=$(mktemp -d)
  git clone --quiet --depth 1 https://github.com/sebbsssss/octpusbot.git "$TEMP_DIR"
  cd "$TEMP_DIR"
  bun install --silent
  bun build bin/octpus.ts --compile --outfile "$INSTALL_DIR/octpus"
  cd - > /dev/null
  rm -rf "$TEMP_DIR"
  echo -e "  ${GREEN}✓${NC} Built from source"
fi

# Verify installation
if [ -x "$INSTALL_DIR/octpus" ]; then
  echo -e "  ${GREEN}✓${NC} Installed to $INSTALL_DIR/octpus"
else
  echo -e "${RED}Installation failed${NC}"
  exit 1
fi

# Check PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo -e "${YELLOW}Add to your PATH:${NC}"
  echo ""
  echo -e "  ${CYAN}export PATH=\"$INSTALL_DIR:\$PATH\"${NC}"
  echo ""
  echo -e "${DIM}Add this line to ~/.bashrc, ~/.zshrc, or ~/.profile${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo -e "Run ${CYAN}octpus${NC} to get started."
echo ""
