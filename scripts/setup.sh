#!/usr/bin/env bash
# =============================================================================
# Jam — First-time setup
# =============================================================================
# Run this after cloning:   ./scripts/setup.sh
# It ensures the right Node version, enables Yarn 4, and installs everything.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}→${NC} $1"; }

REQUIRED_NODE_MAJOR=20

# --- Node version check ---
step "Checking Node.js version..."

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node >= $REQUIRED_NODE_MAJOR via nvm, fnm, or https://nodejs.org"
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  warn "Node $NODE_MAJOR detected, but >= $REQUIRED_NODE_MAJOR is required."

  # Try to auto-switch with nvm
  if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
    [ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
    step "Switching Node via nvm..."
    nvm install "$REQUIRED_NODE_MAJOR" || fail "nvm install failed"
    nvm use "$REQUIRED_NODE_MAJOR"
    info "Now using Node $(node -v)"
  elif command -v fnm &>/dev/null; then
    step "Switching Node via fnm..."
    fnm install "$REQUIRED_NODE_MAJOR" || fail "fnm install failed"
    fnm use "$REQUIRED_NODE_MAJOR"
    info "Now using Node $(node -v)"
  else
    fail "Please install Node >= $REQUIRED_NODE_MAJOR and try again.
         Install nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
         Then:         nvm install $REQUIRED_NODE_MAJOR && ./scripts/setup.sh"
  fi
else
  info "Node $(node -v)"
fi

# --- Corepack (activates Yarn 4 from packageManager field) ---
step "Enabling Corepack (for Yarn 4)..."

if ! command -v corepack &>/dev/null; then
  fail "Corepack not found. It ships with Node >= 16. Try: npm install -g corepack"
fi

corepack enable 2>/dev/null || {
  warn "corepack enable failed (may need sudo on some systems)"
  sudo corepack enable || fail "Could not enable corepack"
}

# Verify Yarn version
YARN_VERSION=$(yarn --version 2>/dev/null || echo "0")
if [[ "$YARN_VERSION" == 1.* ]] || [[ "$YARN_VERSION" == "0" ]]; then
  fail "Yarn 4 not activated. Got: $YARN_VERSION
       Try: corepack prepare yarn@4.12.0 --activate"
fi
info "Yarn $YARN_VERSION"

# --- Install dependencies ---
step "Installing dependencies..."
yarn install
info "Dependencies installed"

# --- Verify setup ---
step "Verifying setup..."

# Check node-pty spawn-helper (the postinstall should handle this)
if [ "$(uname)" != "Windows_NT" ]; then
  SPAWN_HELPER="node_modules/node-pty/prebuilds/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/spawn-helper"
  if [ -f "$SPAWN_HELPER" ]; then
    info "node-pty spawn-helper OK"
  else
    warn "node-pty spawn-helper not found (may need rebuild for your platform)"
  fi
fi

# Quick typecheck
step "Running typecheck..."
yarn typecheck && info "Typecheck passed" || warn "Typecheck had issues (non-blocking)"

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "  Start developing:  yarn dev"
echo "  Run typecheck:     yarn typecheck"
echo "  Build desktop:     yarn workspace @jam/desktop electron:build"
echo ""
