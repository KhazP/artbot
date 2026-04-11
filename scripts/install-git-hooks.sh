#!/usr/bin/env sh
set -eu

if ! command -v git >/dev/null 2>&1; then
  echo "[hooks] git is not installed; skipping hook installation."
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[hooks] not in a git repository; skipping hook installation."
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks

chmod +x \
  scripts/local-ci-checks.sh \
  .githooks/pre-commit \
  .githooks/pre-push \
  .githooks/pre-merge-commit

echo "[hooks] installed at .githooks (core.hooksPath set)."