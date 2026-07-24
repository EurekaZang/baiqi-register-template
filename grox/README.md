# Grox

Windows desktop coding agent: **Electron** shell + **FastAPI** agent sidecar
(Claude Agent SDK) + **React** UI (Codex-style layout, 8090 chat blue–white).

| Doc | Path |
|-----|------|
| Design | `docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-07-24-grox-windows-desktop.md` |
| MVP acceptance | `docs/ACCEPTANCE.md` |

Default LLM gateway: `https://kaggleyes.top/grokapi` (override in onboarding /
settings). Loopback API token defaults to `grox-local-token` in dev.

## Quickstart (Linux/macOS dev)

Requires **Node ≥ 20** (Vite 8) and Python 3.11+.

```bash
cd grox
npm install

cd agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

npm run dev
```

Then open **http://127.0.0.1:5173/**.

1. Onboarding: paste Base URL + API key → saves via `PUT /api/runtime-config`
2. New thread → pick workspace folder → send a message (SSE stream)
3. Tool cards show Bash/Read/etc.; Stop calls `POST /api/sessions/{id}/stop`

`npm run dev` runs `scripts/dev.mjs`:

| Process | Default |
|---------|---------|
| Agent | `agent/.venv` + `run_dev.py` → `127.0.0.1:17890` |
| UI | Vite workspace `grox-ui` → `http://127.0.0.1:5173` (proxies `/api` → 17890) |

Env defaults (overridable):

| Variable | Default |
|----------|---------|
| `GROX_DATA_DIR` | `grox/.dev-data` |
| `GROX_CHAT_TOKEN` | `grox-local-token` |
| `GROX_CHAT_PORT` | `17890` |

Ctrl+C stops both processes.

### Optional: Electron shell against Vite

```bash
npm run build -w electron
# terminal A: npm run dev   (or agent only)
GROX_DEV_URL=http://127.0.0.1:5173 npx electron electron
```

With `GROX_DEV_URL` set, Electron loads Vite and expects the agent on port
`17890`. Leave the agent to Electron’s sidecar supervisor, or attach to an
already-running `npm run dev`.

### Workspace package names

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

**Ship builds must run on Windows 11** (or GitHub `windows-latest`). Wine is not
the supported release path.

Pipeline (`npm run build:win` → `scripts/build-win.mjs`):

1. `npm run build -w grox-ui` → `ui/dist`
2. Copy `ui/dist` → `agent/static` (sidecar serves the SPA when packaged)
3. **Expect** prebuilt PyInstaller onedir at `agent/dist/agent-sidecar/`
4. `npm run build -w electron` → `electron/dist`
5. `electron-builder --win` (`electron-builder.yml`) → `release/Grox-Setup-*.exe`

### Sidecar (Windows-native for ship)

```bat
cd grox\agent
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller build_sidecar.spec --noconfirm
cd ..
npm run build:win
```

Produces `agent/dist/agent-sidecar/` (onedir + `agent-sidecar.exe`). A Linux
PyInstaller smoke build is fine for CI health only — **do not ship** a Linux
`claude` binary inside a Windows installer.

Config: `electron-builder.yml` (`appId: app.grox.desktop`, NSIS non-oneClick,
extraResources sidecar → `resources/sidecar`). Placeholder icon:
`resources/icon.png`. Code signing is phase 2.

## Layout

```text
grox/
  agent/           FastAPI + claude-agent-sdk (+ PyInstaller spec)
  electron/        Electron main / preload / sidecar supervisor
  ui/              React SPA (Codex layout, 8090 blue–white)
  scripts/         dev.mjs, build-win.mjs
  electron-builder.yml
  docs/ACCEPTANCE.md
```
