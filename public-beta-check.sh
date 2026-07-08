#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:5050}"

echo "Dexter Public Beta Check"
echo "Target: $BASE_URL"
echo

check_url() {
  local path="$1"
  local label="$2"
  local code
  code="$(curl -sS -o /tmp/dexter-check-body -w '%{http_code}' "$BASE_URL$path" || true)"
  if [[ "$code" == "200" ]]; then
    echo "PASS  $label ($path)"
  else
    echo "FAIL  $label ($path) HTTP $code"
    cat /tmp/dexter-check-body 2>/dev/null || true
    echo
    return 1
  fi
}

check_url "/" "Homepage"
check_url "/privacy" "Privacy page"
check_url "/terms" "Terms page"
check_url "/api/config" "Public configuration"
check_url "/api/health" "Ollama health"

echo
echo "Public-beta checks passed."
