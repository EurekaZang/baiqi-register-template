#!/usr/bin/env bash
# Publish a built Grox Windows installer to Aliyun openresty downloads.
#
# Prerequisites:
#   - You already produced: grox/release/Grox-Setup-*.exe  (build on Windows)
#   - sshpass + ssh access to 47.100.227.205 as root
#
# Usage:
#   export SSHPASS='your-root-password'   # or use SSH key and drop sshpass
#   ./scripts/publish-to-aliyun.sh [path/to/Grox-Setup-x.y.z.exe]
#
# Optional env:
#   GROX_VPS_HOST=47.100.227.205
#   GROX_VPS_USER=root
#   GROX_BIND_IFACE=enp6s0          # local NIC to bypass TUN if needed
#   GROX_PUBLIC_BASE=https://kaggleyes.top/downloads/grox
#   GROX_VERSION=0.1.0              # override version in latest.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${GROX_VPS_HOST:-47.100.227.205}"
USER="${GROX_VPS_USER:-root}"
PUBLIC_BASE="${GROX_PUBLIC_BASE:-https://kaggleyes.top/downloads/grox}"
REMOTE_DIR="/opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox"

EXE="${1:-}"
if [[ -z "$EXE" ]]; then
  # newest setup in release/
  EXE="$(ls -1t "$ROOT"/release/Grox-Setup-*.exe 2>/dev/null | head -1 || true)"
fi
if [[ -z "$EXE" || ! -f "$EXE" ]]; then
  echo "ERROR: installer not found. Build on Windows first:" >&2
  echo "  npm run build:ui && copy static && pyinstaller && npm run build:win" >&2
  echo "Then: $0 path/to/Grox-Setup-x.y.z.exe" >&2
  exit 1
fi

BASENAME="$(basename "$EXE")"
# version from filename Grox-Setup-0.1.0.exe
VER="${GROX_VERSION:-}"
if [[ -z "$VER" && "$BASENAME" =~ Grox-Setup-([0-9]+\.[0-9]+\.[0-9]+)\.exe ]]; then
  VER="${BASH_REMATCH[1]}"
fi
VER="${VER:-0.1.0}"

SHA="$(sha256sum "$EXE" | awk '{print $1}')"
SIZE="$(wc -c <"$EXE" | tr -d ' ')"
PUBLISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Publishing $BASENAME"
echo "  version : $VER"
echo "  sha256  : $SHA"
echo "  size    : $SIZE bytes"
echo "  remote  : ${USER}@${HOST}:${REMOTE_DIR}/"

SSH_OPTS=(-o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new)
if [[ -n "${GROX_BIND_IFACE:-}" ]]; then
  # map iface to source IP if needed — prefer -b with env GROX_BIND_IP
  :
fi
if [[ -n "${GROX_BIND_IP:-}" ]]; then
  SSH_OPTS+=(-b "$GROX_BIND_IP")
elif ip -br a 2>/dev/null | grep -q 'enp6s0'; then
  # common lab NIC
  SSH_OPTS+=(-b 10.32.0.190)
fi

run_ssh() {
  if command -v sshpass >/dev/null 2>&1 && [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "$@"
  else
    ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "$@"
  fi
}
run_scp() {
  if command -v sshpass >/dev/null 2>&1 && [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e scp "${SSH_OPTS[@]}" "$@"
  else
    scp "${SSH_OPTS[@]}" "$@"
  fi
}

run_ssh "mkdir -p '$REMOTE_DIR'"
run_scp "$EXE" "${USER}@${HOST}:${REMOTE_DIR}/${BASENAME}"

# write latest.json remotely
run_ssh "cat > '${REMOTE_DIR}/latest.json' <<EOF
{
  \"name\": \"Grox\",
  \"version\": \"${VER}\",
  \"published_at\": \"${PUBLISHED}\",
  \"installer\": {
    \"filename\": \"${BASENAME}\",
    \"url\": \"${PUBLIC_BASE}/${BASENAME}\",
    \"sha256\": \"${SHA}\",
    \"size_bytes\": ${SIZE}
  },
  \"notes\": \"Published via publish-to-aliyun.sh\",
  \"default_base_url\": \"https://kaggleyes.top/grokapi\",
  \"min_windows\": \"10\"
}
EOF"

# keep a copy named by version for history (optional hardlink/copy)
run_ssh "ln -sfn '${BASENAME}' '${REMOTE_DIR}/Grox-Setup-latest.exe' || cp -f '${REMOTE_DIR}/${BASENAME}' '${REMOTE_DIR}/Grox-Setup-latest.exe'"

echo
echo "Done. Users can install with:"
echo "  https://kaggleyes.top/downloads/grox/"
echo "  irm https://kaggleyes.top/downloads/grox/install.ps1 | iex"
echo
echo "Verify:"
echo "  curl -I ${PUBLIC_BASE}/${BASENAME}"
