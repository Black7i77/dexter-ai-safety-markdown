#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -x .venv/bin/python ]]; then
  echo "Dexter is not installed yet. Run: ./install.sh"
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Warning: the ollama command was not found. Dexter can still start, but AI chat will be offline."
fi

exec .venv/bin/python app.py
