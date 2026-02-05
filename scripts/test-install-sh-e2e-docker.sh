#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${SURPRISEBOT_INSTALL_E2E_IMAGE:-surprisebot-install-e2e:local}"
INSTALL_URL="${SURPRISEBOT_INSTALL_URL:-https://surprisebot.bot/install.sh}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
SURPRISEBOT_E2E_MODELS="${SURPRISEBOT_E2E_MODELS:-}"

echo "==> Build image: $IMAGE_NAME"
docker build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker/install-sh-e2e"

echo "==> Run E2E installer test"
docker run --rm -t \
  -e SURPRISEBOT_INSTALL_URL="$INSTALL_URL" \
  -e SURPRISEBOT_E2E_MODELS="$SURPRISEBOT_E2E_MODELS" \
  -e SURPRISEBOT_INSTALL_E2E_PREVIOUS="${SURPRISEBOT_INSTALL_E2E_PREVIOUS:-}" \
  -e SURPRISEBOT_INSTALL_E2E_SKIP_PREVIOUS="${SURPRISEBOT_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ANTHROPIC_API_TOKEN="$ANTHROPIC_API_TOKEN" \
  "$IMAGE_NAME"
