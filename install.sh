#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}   ____       __"
echo "  / __ \____/ /_____  __  _______"
echo " / / / / __/ __/ __ \/ / / / ___/"
echo "/ /_/ / /_/ /_/ /_/ / /_/ (__  )"
echo "\____/\__/\__/ .___/\__,_/____/"
echo -e "            /_/${NC}"
echo ""
echo -e "${BOLD}8 arms. Infinite reach.${NC}"
echo ""

INSTALL_DIR="${OCTPUS_INSTALL_DIR:-$HOME/.octpus}"
BIN_DIR="${OCTPUS_BIN_DIR:-$HOME/.local/bin}"

# Check for required tools
check_dep() {
  if ! command -v "$1" &> /dev/null; then
    return 1
  fi
  return 0
}

# Install bun if not present
install_bun() {
  echo -e "${YELLOW}Installing bun...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
}

# Check dependencies
echo -e "${DIM}Checking dependencies...${NC}"

if ! check_dep git; then
  echo -e "${RED}Error: git is required but not installed.${NC}"
  echo "Please install git first: https://git-scm.com/downloads"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} git"

if ! check_dep bun; then
  echo -e "  ${YELLOW}○${NC} bun (not found)"
  install_bun
fi
echo -e "  ${GREEN}✓${NC} bun"

echo ""

# Clone or update repo
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${DIM}Updating existing installation...${NC}"
  cd "$INSTALL_DIR"
  git pull --quiet
else
  echo -e "${DIM}Cloning octpus...${NC}"
  git clone --quiet https://github.com/sebbsssss/octpusbot.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo -e "  ${GREEN}✓${NC} Repository cloned to $INSTALL_DIR"

# Install dependencies
echo -e "${DIM}Installing dependencies...${NC}"
bun install --silent

echo -e "  ${GREEN}✓${NC} Dependencies installed"

# Build
echo -e "${DIM}Building...${NC}"
bun run build --silent 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} Build complete"

# Create bin directory
mkdir -p "$BIN_DIR"

# Create launcher script
cat > "$BIN_DIR/octpus" << 'LAUNCHER'
#!/bin/bash
OCTPUS_DIR="${OCTPUS_INSTALL_DIR:-$HOME/.octpus}"
cd "$OCTPUS_DIR" && exec bun run apps/cli/src/index.ts "$@"
LAUNCHER

chmod +x "$BIN_DIR/octpus"

echo -e "  ${GREEN}✓${NC} CLI installed to $BIN_DIR/octpus"

# Check if bin dir is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo -e "${YELLOW}Add this to your shell profile (.bashrc, .zshrc, etc.):${NC}"
  echo ""
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
  echo ""
fi

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo -e "Run ${CYAN}octpus${NC} to start the onboarding wizard."
echo ""
