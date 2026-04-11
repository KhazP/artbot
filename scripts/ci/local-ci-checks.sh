#!/usr/bin/env sh
set -eu

mode="${1:-quick}"

if [ "${SKIP_CI_HOOKS:-0}" = "1" ]; then
  echo "[hooks] SKIP_CI_HOOKS=1; skipping ${mode} checks."
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[hooks] pnpm is required for local CI checks."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

case "$mode" in
  quick)
    echo "[hooks] Running quick checks: typecheck"
    pnpm typecheck
    ;;
  full)
    echo "[hooks] Running full checks: shared-types build + typecheck + test + build + verify:install"
    pnpm --filter @artbot/shared-types build
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm --filter artbot verify:install
    ;;
  *)
    echo "[hooks] Unknown mode '${mode}'. Use 'quick' or 'full'."
    exit 2
    ;;
esac
