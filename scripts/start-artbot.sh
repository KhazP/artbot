#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_URL="${API_BASE_URL:-http://localhost:4000}"
LOG_DIR="$ROOT_DIR/.artbot-logs"
mkdir -p "$LOG_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
API_LOG="$LOG_DIR/api-$STAMP.log"
WORKER_LOG="$LOG_DIR/worker-$STAMP.log"

API_PID=""
WORKER_PID=""

cleanup() {
  local code=$?
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup INT TERM EXIT

if [[ ! -f "$ROOT_DIR/apps/api/dist/server.js" || ! -f "$ROOT_DIR/apps/worker/dist/index.js" ]]; then
  echo "Building workspaces (first run / missing dist)..."
  pnpm build >/dev/null
fi

echo "Starting ArtBot API..."
pnpm --filter @artbot/api start >"$API_LOG" 2>&1 &
API_PID=$!

echo "Starting ArtBot worker..."
pnpm --filter @artbot/worker start >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!

echo "Waiting for API health at $API_URL/health ..."
for _ in {1..60}; do
  if curl -fsS "$API_URL/health" >/dev/null 2>&1; then
    echo "API is up."
    break
  fi
  sleep 0.5
done

if ! curl -fsS "$API_URL/health" >/dev/null 2>&1; then
  echo "API did not become healthy."
  echo "API log: $API_LOG"
  echo "Worker log: $WORKER_LOG"
  exit 1
fi

echo "Backend logs:"
echo "  API:    $API_LOG"
echo "  Worker: $WORKER_LOG"
echo "Launching CLI..."

API_BASE_URL="$API_URL" pnpm --filter artbot dev
