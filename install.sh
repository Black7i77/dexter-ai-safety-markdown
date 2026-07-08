#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required."
  exit 1
fi

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

chmod +x run.sh run-production.sh cloudflare-quick-test.sh public-beta-check.sh upgrade-from-current.sh

echo
echo "Dexter AI installed successfully."
echo "Run it with: ./run.sh"
