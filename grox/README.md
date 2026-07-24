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
| `npm run build:win` | Windows package (`scripts/build-win.mjs`) |
| `npm run test:agent` | pytest in agent venv |

## Packaging (Windows NSIS)

Pipeline (`npm run build:win` → `scripts/build-win.mjs`):

1. `npm run build -w grox-ui` → `ui/dist`
2. Copy `ui/dist` → `agent/static` (sidecar serves the SPA in packaged mode)
3. **Expect** prebuilt PyInstaller onedir at `agent/dist/agent-sidecar/`
4. `npm run build -w electron` → `electron/dist`
5. `electron-builder --win` using `electron-builder.yml` → `release/Grox-Setup-*.exe`

### Sidecar (must be Windows-native for ship)

```bat
cd grox\agent
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller build_sidecar.spec --noconfirm
```

Produces `agent/dist/agent-sidecar/` (onedir + `agent-sidecar.exe`). A Linux
PyInstaller smoke build is useful for CI health checks only — **do not ship** a
Linux `claude` binary inside a Windows installer.

### Final NSIS host requirement

**Build the ship installer on real Windows 11** (or GitHub `windows-latest`).
Wine/`--win` from Linux is optional for experimentation and is **not** the
supported release path. Code signing is phase 2.

Config: `electron-builder.yml` (`appId: app.grox.desktop`, NSIS non-oneClick,
extraResources sidecar → `resources/sidecar`). Placeholder icon:
`resources/icon.png`.
