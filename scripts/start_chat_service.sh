#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Optional local env for CHAT_TOKEN / ANTHROPIC_BASE_URL
if [[ -f "$ROOT/dashboard/chat/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/dashboard/chat/.env"
  set +a
fi

export CHAT_TOKEN="${CHAT_TOKEN:?set CHAT_TOKEN (or put it in dashboard/chat/.env)}"
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-http://127.0.0.1:8088}"
export CHAT_HOST="${CHAT_HOST:-127.0.0.1}"
export CHAT_PORT="${CHAT_PORT:-8091}"

UVICORN="$ROOT/dashboard/chat/backend/.venv/bin/uvicorn"
if [[ ! -x "$UVICORN" ]]; then
  echo "missing $UVICORN — create venv and install requirements first:" >&2
  echo "  python3 -m venv dashboard/chat/backend/.venv" >&2
  echo "  dashboard/chat/backend/.venv/bin/pip install -r dashboard/chat/backend/requirements.txt" >&2
  exit 1
fi

exec "$UVICORN" app.main:app \
  --app-dir "$ROOT/dashboard/chat/backend" \
  --host "$CHAT_HOST" \
  --port "$CHAT_PORT"
