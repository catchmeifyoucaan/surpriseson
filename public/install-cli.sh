#!/usr/bin/env bash
set -euo pipefail

# Surprisebot CLI installer (non-root friendly)
# Installs Node runtime into a prefix and installs surprisebot there.

log() { printf "%s\n" "$*"; }
err() { printf "ERROR: %s\n" "$*" 1>&2; }

PREFIX="${SURPRISEBOT_PREFIX:-$HOME/.surprisebot}"
NO_ONBOARD="${SURPRISEBOT_NO_ONBOARD:-0}"
MINIMAL=0
DRY_RUN="${SURPRISEBOT_DRY_RUN:-0}"

usage() {
  cat <<'USAGE'
Surprisebot CLI installer (prefix + bundled Node)

Usage:
  curl -fsSL https://surprisebot.bot/install-cli.sh | bash
  curl -fsSL https://surprisebot.bot/install-cli.sh | bash -s -- [options]

Options:
  --prefix <path>     Install prefix (default: ~/.surprisebot)
  --no-onboard        Skip `surprisebot init --quickstart`
  --minimal           Run `surprisebot init --minimal`
  --dry-run           Print actions only
  --help              Show help

Env:
  SURPRISEBOT_PREFIX=...
  SURPRISEBOT_NO_ONBOARD=1
  SURPRISEBOT_DRY_RUN=1
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2;;
    --no-onboard) NO_ONBOARD=1; shift;;
    --minimal) MINIMAL=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    --help|-h) usage; exit 0;;
    *) err "Unknown option: $1"; usage; exit 1;;
  esac
done

run() {
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] $*"; return 0;
  fi
  eval "$@"
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

arch() {
  local a
  a=$(uname -m)
  case "$a" in
    x86_64) echo "x64";;
    aarch64|arm64) echo "arm64";;
    *) echo "$a";;
  esac
}

platform() {
  case "$(uname -s)" in
    Darwin) echo "darwin";;
    Linux) echo "linux";;
    *) echo "unsupported";;
  esac
}

install_node() {
  local os archv url
  os=$(platform)
  archv=$(arch)
  if [ "$os" = "unsupported" ]; then err "Unsupported platform"; exit 1; fi
  local version="v22.22.0"
  url="https://nodejs.org/dist/${version}/node-${version}-${os}-${archv}.tar.xz"
  run "mkdir -p '$PREFIX'"
  run "mkdir -p '$PREFIX/bin'"
  run "curl -fsSL '$url' -o /tmp/node.tar.xz"
  run "tar -xJf /tmp/node.tar.xz -C /tmp"
  run "cp -R /tmp/node-${version}-${os}-${archv}/* '$PREFIX/'"
}

install_surprisebot() {
  export PATH="$PREFIX/bin:$PATH"
  export NPM_CONFIG_PREFIX="$PREFIX"
  export SHARP_IGNORE_GLOBAL_LIBVIPS="${SHARP_IGNORE_GLOBAL_LIBVIPS:-1}"
  run "npm install -g surprisebot@latest"
  if ! echo "$PATH" | grep -q "$PREFIX/bin"; then
    echo "export PATH=\"$PREFIX/bin:\$PATH\"" >> "$HOME/.bashrc" || true
    echo "export PATH=\"$PREFIX/bin:\$PATH\"" >> "$HOME/.zshrc" || true
  fi
}

post_install() {
  if [ "$NO_ONBOARD" = "1" ]; then return 0; fi
  local args
  if [ "$MINIMAL" = "1" ]; then
    args="--minimal"
  else
    args="--quickstart"
  fi
  run "surprisebot init $args"
}

main() {
  if ! need_cmd curl || ! need_cmd tar; then
    err "curl and tar are required"; exit 1
  fi
  install_node
  install_surprisebot
  post_install
  log "Surprisebot CLI install complete at $PREFIX"
}

main "$@"
