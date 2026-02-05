#!/usr/bin/env bash
set -euo pipefail

# Surprisebot installer (recommended)
# - Installs Node 22+ if missing (brew on macOS, NodeSource on Linux)
# - Installs Surprisebot via npm (default) or git checkout
# - Runs `surprisebot init --quickstart` unless --no-onboard

VERSION="2026.2"

log() { printf "%s\n" "$*"; }
warn() { printf "WARN: %s\n" "$*"; }
err() { printf "ERROR: %s\n" "$*" 1>&2; }

usage() {
  cat <<'USAGE'
Surprisebot installer

Usage:
  curl -fsSL https://surprisebot.bot/install.sh | bash
  curl -fsSL https://surprisebot.bot/install.sh | bash -s -- [options]

Options:
  --install-method npm|git   Install method (default: npm)
  --git-dir <path>           Git checkout path (default: ~/surprisebot)
  --no-git-update            Skip git pull when using an existing checkout
  --no-onboard               Skip `surprisebot init --quickstart`
  --minimal                  Run `surprisebot init --minimal` instead of quickstart
  --no-prompt                Disable prompts (non-interactive)
  --dry-run                  Print actions without making changes
  --help                     Show help

Env:
  SURPRISEBOT_INSTALL_METHOD=git|npm
  SURPRISEBOT_GIT_DIR=...
  SURPRISEBOT_GIT_UPDATE=0|1
  SURPRISEBOT_NO_PROMPT=1
  SURPRISEBOT_DRY_RUN=1
  SURPRISEBOT_NO_ONBOARD=1
  SURPRISEBOT_INIT_ARGS="--quickstart" (extra init args)
  SHARP_IGNORE_GLOBAL_LIBVIPS=0|1 (default: 1)
USAGE
}

is_tty() { [ -t 0 ] && [ -t 1 ]; }

DRY_RUN="${SURPRISEBOT_DRY_RUN:-0}"
NO_PROMPT="${SURPRISEBOT_NO_PROMPT:-0}"
NO_ONBOARD="${SURPRISEBOT_NO_ONBOARD:-0}"
INSTALL_METHOD="${SURPRISEBOT_INSTALL_METHOD:-}" # npm|git
GIT_DIR="${SURPRISEBOT_GIT_DIR:-$HOME/surprisebot}"
GIT_UPDATE="${SURPRISEBOT_GIT_UPDATE:-1}"
INIT_ARGS="${SURPRISEBOT_INIT_ARGS:-}"

MINIMAL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --install-method)
      INSTALL_METHOD="$2"; shift 2;;
    --git-dir)
      GIT_DIR="$2"; shift 2;;
    --no-git-update)
      GIT_UPDATE=0; shift;;
    --no-onboard)
      NO_ONBOARD=1; shift;;
    --minimal)
      MINIMAL=1; shift;;
    --no-prompt)
      NO_PROMPT=1; shift;;
    --dry-run)
      DRY_RUN=1; shift;;
    --help|-h)
      usage; exit 0;;
    *)
      err "Unknown option: $1"; usage; exit 1;;
  esac
done

run() {
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] $*"; return 0;
  fi
  eval "$@"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_git() {
  if need_cmd git; then return 0; fi
  warn "git not found. Attempting to install..."
  if [ "$(uname -s)" = "Darwin" ]; then
    if need_cmd brew; then run "brew install git"; return 0; fi
    err "Homebrew not found. Install Homebrew or git manually."; exit 1
  fi
  if need_cmd apt-get; then
    if need_cmd sudo; then run "sudo apt-get update"; run "sudo apt-get install -y git"; return 0; fi
    err "apt-get available but sudo missing. Install git manually."; exit 1
  fi
  err "Unable to install git automatically."; exit 1
}

node_version_ok() {
  if ! need_cmd node; then return 1; fi
  local v
  v=$(node -v | sed 's/^v//')
  local major
  major=$(echo "$v" | cut -d. -f1)
  if [ "$major" -lt 22 ]; then return 1; fi
  return 0
}

ensure_node() {
  if node_version_ok; then return 0; fi
  warn "Node.js 22+ required. Installing..."
  local os
  os=$(uname -s)
  if [ "$os" = "Darwin" ]; then
    if need_cmd brew; then
      run "brew install node@22"
      run "brew link --overwrite --force node@22" || true
      return 0
    fi
    err "Homebrew not found. Install Node 22+ manually."; exit 1
  fi
  if need_cmd apt-get; then
    if ! need_cmd sudo; then
      err "apt-get available but sudo missing. Install Node 22+ manually."; exit 1
    fi
    run "sudo apt-get update"
    run "sudo apt-get install -y ca-certificates curl gnupg"
    run "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    run "sudo apt-get install -y nodejs"
    return 0
  fi
  err "Unsupported platform. Install Node 22+ manually."; exit 1
}

fix_npm_prefix() {
  local prefix
  prefix=$(npm config get prefix 2>/dev/null || true)
  if [ -z "$prefix" ]; then return 0; fi
  if [ -w "$prefix" ]; then return 0; fi
  warn "npm global prefix not writable ($prefix). Switching to ~/.npm-global"
  run "npm config set prefix '$HOME/.npm-global'"
  if ! echo "$PATH" | grep -q "$HOME/.npm-global/bin"; then
    echo "export PATH=\"$HOME/.npm-global/bin:\$PATH\"" >> "$HOME/.bashrc" || true
    echo "export PATH=\"$HOME/.npm-global/bin:\$PATH\"" >> "$HOME/.zshrc" || true
    export PATH="$HOME/.npm-global/bin:$PATH"
  fi
}

in_repo_checkout() {
  [ -f "package.json" ] && [ -f "pnpm-workspace.yaml" ]
}

pick_install_method() {
  if [ -n "$INSTALL_METHOD" ]; then
    echo "$INSTALL_METHOD"; return 0
  fi
  if in_repo_checkout; then
    if [ "$NO_PROMPT" = "1" ] || ! is_tty; then
      err "Inside a Surprisebot checkout. Set --install-method git|npm (or SURPRISEBOT_INSTALL_METHOD)."; exit 2
    fi
    log "Detected Surprisebot checkout."
    log "Use this checkout? (git) or install globally (npm)"
    printf "[git/npm] (git): "
    read -r ans
    ans=${ans:-git}
    echo "$ans"; return 0
  fi
  echo "npm"
}

install_via_npm() {
  ensure_node
  fix_npm_prefix
  export SHARP_IGNORE_GLOBAL_LIBVIPS="${SHARP_IGNORE_GLOBAL_LIBVIPS:-1}"
  run "npm install -g surprisebot@latest"
}

install_via_git() {
  ensure_git
  ensure_node
  if [ -d "$GIT_DIR/.git" ]; then
    if [ "$GIT_UPDATE" = "1" ]; then
      run "git -C '$GIT_DIR' pull --rebase"
    fi
  else
    run "git clone https://github.com/surprisebot/surprisebot '$GIT_DIR'"
  fi
  if ! need_cmd corepack; then
    warn "corepack missing; pnpm may not be available."
  fi
  run "corepack enable" || true
  run "corepack prepare pnpm@10.23.0 --activate" || true
  run "cd '$GIT_DIR' && pnpm install"
  run "cd '$GIT_DIR' && pnpm build"
  # wrapper
  local bin
  if [ "$(id -u)" -eq 0 ]; then
    bin="/usr/local/bin"
  else
    bin="$HOME/.local/bin"
    run "mkdir -p '$bin'"
  fi
  local target="$bin/surprisebot"
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] write wrapper $target"
  else
    cat > "$target" <<WRAP
#!/usr/bin/env bash
exec node "$GIT_DIR/dist/entry.js" "\$@"
WRAP
    chmod +x "$target"
  fi
  if ! echo "$PATH" | grep -q "$bin"; then
    echo "export PATH=\"$bin:\$PATH\"" >> "$HOME/.bashrc" || true
    echo "export PATH=\"$bin:\$PATH\"" >> "$HOME/.zshrc" || true
    export PATH="$bin:$PATH"
  fi
}

post_install() {
  if need_cmd surprisebot; then
    run "surprisebot doctor --non-interactive" || true
  fi
  if [ "$NO_ONBOARD" = "1" ]; then
    log "Onboarding skipped (--no-onboard)."; return 0
  fi
  local init_args
  if [ "$MINIMAL" = "1" ]; then
    init_args="--minimal"
  else
    init_args="--quickstart"
  fi
  if [ -n "$INIT_ARGS" ]; then
    init_args="$init_args $INIT_ARGS"
  fi
  run "surprisebot init $init_args"
}

main() {
  if [ "$DRY_RUN" = "1" ]; then
    log "Running in dry-run mode."
  fi
  local method
  method=$(pick_install_method)
  if [ "$method" = "npm" ]; then
    install_via_npm
  elif [ "$method" = "git" ]; then
    install_via_git
  else
    err "Unknown install method: $method"; exit 1
  fi
  post_install
  log "Surprisebot install complete."
}

main "$@"
