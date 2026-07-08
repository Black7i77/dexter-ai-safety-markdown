#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed."
  exit 1
fi

PORT="${DEXTER_PORT:-5050}"

echo "Creating a TEMPORARY public test address for Dexter."
echo "Keep Dexter running in another terminal with ./run-production.sh"
echo "Press Ctrl+C here to close the temporary tunnel."
exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
