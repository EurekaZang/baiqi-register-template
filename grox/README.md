# Grox

Windows desktop agent (Electron + FastAPI sidecar). See
`docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md`.

## Dev setup

```bash
cd grox && npm install
cd agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd .. && npm run dev
```

`npm run dev` runs `scripts/dev.mjs`, which starts:

1. **Agent sidecar** — `agent/.venv` + `run_dev.py` on `127.0.0.1:17890`
2. **Vite UI** — workspace `grox-ui` on `http://127.0.0.1:5173` (proxies `/api` → 17890)

Defaults (overridable via env):

| Variable | Default |
|----------|---------|
| `GROX_DATA_DIR` | `grox/.dev-data` |
| `GROX_CHAT_TOKEN` | `grox-local-token` |
| `GROX_CHAT_PORT` | `17890` |

Ctrl+C stops both processes.

### Optional: Electron shell against Vite

```bash
npm run build -w electron
GROX_DEV_URL=http://127.0.0.1:5173 npx electron electron
```

With `GROX_DEV_URL` set, Electron loads the Vite UI and expects the agent on
port `17890` (same as `npm run dev`). You can leave the agent to Electron’s
sidecar supervisor, or keep `npm run dev` running and attach.

### Workspace names

| Path | package.json `name` | npm `-w` |
|------|---------------------|----------|
| `ui/` | `grox-ui` | `-w grox-ui` |
| `electron/` | `grox-electron` | `-w electron` or `-w grox-electron` |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Agent + Vite |
| `npm run build:ui` | Build SPA (`-w grox-ui`) |
| `npm run build:electron` | Compile Electron main/preload |
| `npm run build:win` | Windows package (Task 9+) |
| `npm run test:agent` | pytest in agent venv |
