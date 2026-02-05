#!/usr/bin/env bash
set -euo pipefail

cd /repo

export SURPRISEBOT_STATE_DIR="/tmp/surprisebot-test"
export SURPRISEBOT_CONFIG_PATH="${SURPRISEBOT_STATE_DIR}/surprisebot.json"

echo "==> Seed state"
mkdir -p "${SURPRISEBOT_STATE_DIR}/credentials"
mkdir -p "${SURPRISEBOT_STATE_DIR}/agents/main/sessions"
echo '{}' >"${SURPRISEBOT_CONFIG_PATH}"
echo 'creds' >"${SURPRISEBOT_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${SURPRISEBOT_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm surprisebot reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${SURPRISEBOT_CONFIG_PATH}"
test ! -d "${SURPRISEBOT_STATE_DIR}/credentials"
test ! -d "${SURPRISEBOT_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${SURPRISEBOT_STATE_DIR}/credentials"
echo '{}' >"${SURPRISEBOT_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm surprisebot uninstall --state --yes --non-interactive

test ! -d "${SURPRISEBOT_STATE_DIR}"

echo "OK"
