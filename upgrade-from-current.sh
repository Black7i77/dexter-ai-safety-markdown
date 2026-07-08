#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  echo "Keeping the .env already in this folder."
else
  candidates=(
    "${OLD_DEXTER_DIR:-}"
    "$HOME/Downloads/dexter-ai-project-export"
    "$HOME/Downloads/dexter-ai-public-beta"
    "$HOME/Downloads/dexter-ai-web"
  )
  copied=false
  for old_dir in "${candidates[@]}"; do
    [[ -n "$old_dir" ]] || continue
    if [[ "$old_dir" != "$PWD" && -f "$old_dir/.env" ]]; then
      cp "$old_dir/.env" .env
      echo "Copied your existing Dexter settings from: $old_dir/.env"
      copied=true
      break
    fi
  done
  if [[ "$copied" == false ]]; then
    cp .env.example .env
    echo "Created a new .env from .env.example."
  fi
fi

# Preserve export settings for older installs.
grep -q '^MAX_EXPORT_FILES=' .env || printf '\nMAX_EXPORT_FILES=40\n' >> .env
grep -q '^MAX_EXPORT_CHARS=' .env || printf 'MAX_EXPORT_CHARS=500000\n' >> .env

./install.sh

echo
echo "Dexter Safety + Markdown upgrade installed successfully."
echo "Start it with: ./run-production.sh"
echo "Fixes included: rendered Markdown, permanent secret-code safety rules, safer ransomware guidance, and paywall refusal guidance."
