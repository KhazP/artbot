#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$ROOT_DIR/playwright/.auth"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup/capture-auth-state.sh <profile-id>
  scripts/setup/capture-auth-state.sh all

Supported profile IDs:
  artsy-auth
  mutualart-auth
  sanatfiyat-license
  askart-license

Notes:
  - This opens a Playwright browser window for manual login.
  - After you complete login, close the codegen window to save storage state.
EOF
}

resolve_url() {
  case "$1" in
    artsy-auth) echo "https://www.artsy.net" ;;
    mutualart-auth) echo "https://www.mutualart.com" ;;
    sanatfiyat-license) echo "https://www.sanatfiyat.com" ;;
    askart-license) echo "https://www.askart.com" ;;
    *)
      return 1
      ;;
  esac
}

capture_one() {
  local profile_id="$1"
  local url
  url="$(resolve_url "$profile_id")"
  local state_file="$STATE_DIR/$profile_id.json"

  mkdir -p "$STATE_DIR"
  echo "Capturing auth state for '$profile_id' -> $state_file"
  echo "Target URL: $url"
  pnpm exec playwright codegen "$url" --save-storage="$state_file"
  echo "Saved: $state_file"
}

if [[ "${1:-}" == "" ]]; then
  usage
  exit 1
fi

if [[ "$1" == "all" ]]; then
  capture_one "artsy-auth"
  capture_one "mutualart-auth"
  capture_one "sanatfiyat-license"
  capture_one "askart-license"
  exit 0
fi

if ! resolve_url "$1" >/dev/null 2>&1; then
  echo "Unknown profile id: $1" >&2
  echo >&2
  usage >&2
  exit 1
fi

capture_one "$1"
