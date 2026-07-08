#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -x .venv/bin/gunicorn ]]; then
  echo "Dexter is not installed yet. Run: ./install.sh"
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

HOST="${DEXTER_HOST:-127.0.0.1}"
PORT="${DEXTER_PORT:-5050}"

exec .venv/bin/gunicorn \
  --bind "${HOST}:${PORT}" \
  --worker-class gthread \
  --workers 1 \
  --threads 8 \
  --timeout 600 \
  --access-logfile - \
  --error-logfile - \
  app:app
