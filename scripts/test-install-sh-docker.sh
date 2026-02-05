#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_IMAGE="${SURPRISEBOT_INSTALL_SMOKE_IMAGE:-surprisebot-install-smoke:local}"
NONROOT_IMAGE="${SURPRISEBOT_INSTALL_NONROOT_IMAGE:-surprisebot-install-nonroot:local}"
INSTALL_URL="${SURPRISEBOT_INSTALL_URL:-https://surprisebot.bot/install.sh}"
CLI_INSTALL_URL="${SURPRISEBOT_INSTALL_CLI_URL:-https://surprisebot.bot/install-cli.sh}"

echo "==> Build smoke image (upgrade, root): $SMOKE_IMAGE"
docker build \
  -t "$SMOKE_IMAGE" \
  -f "$ROOT_DIR/scripts/docker/install-sh-smoke/Dockerfile" \
  "$ROOT_DIR/scripts/docker/install-sh-smoke"

echo "==> Run installer smoke test (root): $INSTALL_URL"
docker run --rm -t \
  -e SURPRISEBOT_INSTALL_URL="$INSTALL_URL" \
  -e SURPRISEBOT_INSTALL_SMOKE_PREVIOUS="${SURPRISEBOT_INSTALL_SMOKE_PREVIOUS:-}" \
  -e SURPRISEBOT_INSTALL_SMOKE_SKIP_PREVIOUS="${SURPRISEBOT_INSTALL_SMOKE_SKIP_PREVIOUS:-0}" \
  -e SURPRISEBOT_NO_ONBOARD=1 \
  -e DEBIAN_FRONTEND=noninteractive \
  "$SMOKE_IMAGE"

echo "==> Build non-root image: $NONROOT_IMAGE"
docker build \
  -t "$NONROOT_IMAGE" \
  -f "$ROOT_DIR/scripts/docker/install-sh-nonroot/Dockerfile" \
  "$ROOT_DIR/scripts/docker/install-sh-nonroot"

echo "==> Run installer non-root test: $INSTALL_URL"
docker run --rm -t \
  -e SURPRISEBOT_INSTALL_URL="$INSTALL_URL" \
  -e SURPRISEBOT_NO_ONBOARD=1 \
  -e DEBIAN_FRONTEND=noninteractive \
  "$NONROOT_IMAGE"

if [[ "${SURPRISEBOT_INSTALL_SMOKE_SKIP_CLI:-0}" == "1" ]]; then
  echo "==> Skip CLI installer smoke (SURPRISEBOT_INSTALL_SMOKE_SKIP_CLI=1)"
  exit 0
fi

echo "==> Run CLI installer non-root test (same image)"
docker run --rm -t \
  --entrypoint /bin/bash \
  -e SURPRISEBOT_INSTALL_URL="$INSTALL_URL" \
  -e SURPRISEBOT_INSTALL_CLI_URL="$CLI_INSTALL_URL" \
  -e SURPRISEBOT_NO_ONBOARD=1 \
  -e DEBIAN_FRONTEND=noninteractive \
  "$NONROOT_IMAGE" -lc "curl -fsSL \"$CLI_INSTALL_URL\" | bash -s -- --set-npm-prefix --no-onboard"
