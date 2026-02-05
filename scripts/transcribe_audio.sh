#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: transcribe_audio.sh <audio-path>" >&2
  exit 2
fi

INPUT_PATH="$1"
WHISPER_BIN="${WHISPER_BIN:-/opt/surprisebot/whispercpp/build/bin/whisper-cli}"
WHISPER_MODEL="${WHISPER_MODEL_PATH:-/opt/surprisebot/whispercpp/models/ggml-tiny.en.bin}"
WHISPER_LANGUAGE="${WHISPER_LANGUAGE:-}"
WHISPER_THREADS="${WHISPER_THREADS:-2}"

if [[ ! -x "$WHISPER_BIN" ]]; then
  echo "Whisper binary not found: $WHISPER_BIN" >&2
  exit 3
fi
if [[ ! -f "$WHISPER_MODEL" ]]; then
  echo "Whisper model not found: $WHISPER_MODEL" >&2
  exit 4
fi
if [[ ! -f "$INPUT_PATH" ]]; then
  echo "Audio file not found: $INPUT_PATH" >&2
  exit 5
fi

LANG_ARGS=()
if [[ -n "$WHISPER_LANGUAGE" ]]; then
  LANG_ARGS=(-l "$WHISPER_LANGUAGE")
fi

TMP_BASE=$(mktemp -t surprisebot-whisper-XXXX)
"$WHISPER_BIN" \
  -m "$WHISPER_MODEL" \
  -f "$INPUT_PATH" \
  -t "$WHISPER_THREADS" \
  -nt -np -otxt -of "$TMP_BASE" \
  "${LANG_ARGS[@]}" \
  >/dev/null 2>&1 || {
    echo "Whisper failed to transcribe" >&2
    rm -f "${TMP_BASE}.txt"
    exit 6
  }

cat "${TMP_BASE}.txt"
rm -f "${TMP_BASE}.txt"
