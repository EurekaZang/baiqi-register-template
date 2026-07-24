#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# intentional one-way bootstrap helper; after fork, edit only grox/

rsync -a --exclude '.venv' --exclude '__pycache__' --exclude 'node_modules' --exclude 'dist' --exclude 'data' \
  "$ROOT/dashboard/chat/backend/" "$ROOT/grox/agent/"
rsync -a --exclude 'node_modules' --exclude 'dist' \
  "$ROOT/dashboard/chat/frontend/" "$ROOT/grox/ui/"

echo "Re-synced chat sources into grox/agent and grox/ui"
echo "After fork, prefer editing only grox/ — do not treat this as routine."
