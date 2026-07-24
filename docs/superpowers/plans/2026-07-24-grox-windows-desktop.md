# Grox Windows Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship **Grox**, a Windows `.exe` desktop app (Codex-style **layout**, **8090 chat blue–white** colors) that runs the existing Grok 4.5 Claude Agent SDK stack via an Electron shell + Python FastAPI sidecar.

**Architecture:** Electron main process spawns a loopback-only FastAPI sidecar (PyInstaller onedir). React SPA is served by the sidecar (one origin). LLM traffic goes to user-configured Base URL (default `https://kaggleyes.top/grokapi`) with Bearer API key. Code is extracted from `dashboard/chat/{frontend,backend}` into `grox/` without breaking the web chat product.

**Tech Stack:** Electron 33+, electron-builder, React 19, Vite, TypeScript, Tailwind 4, FastAPI, uvicorn, claude-agent-sdk, PyInstaller, pytest

**Spec:** `docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md` (Approved)

## Global Constraints

- Product name is **Grox** only (no Codex/OpenAI branding or assets).
- Sidecar must bind **127.0.0.1 only**.
- MVP: no image generation, no full Tasks panel, no IDE file tree.
- Default model id: `grok-4.5`.
- Default LLM base: `https://kaggleyes.top/grokapi`.
- Desktop auth: auto local token via Electron preload; no login screen.
- Prefer **copy + adapt** from `dashboard/chat`; do not import across products at runtime.
- Repo path for app: `grox/` under this repository root (`baiqi-register-template/grox`).
- Windows is the ship target; Linux/macOS may run in dev only.

## File map (create)

```text
grox/
  package.json
  electron-builder.yml
  electron/
    package.json
    tsconfig.json
    src/main.ts
    src/preload.ts
    src/sidecar.ts
    src/config-store.ts
  ui/                          # adapted from dashboard/chat/frontend
    package.json
    vite.config.ts
    index.html
    src/...
    src/styles/grox-theme.css  # optional aliases; colors = 8090 blue–white
  agent/                       # adapted from dashboard/chat/backend
    requirements.txt
    pyproject.toml             # optional
    app/
      __init__.py
      main.py
      config.py
      auth.py
      sessions.py
      models_api.py
      agent_bridge.py
      attachments.py
      sse.py
      tasks.py                 # keep helpers used by agent_bridge; no Tasks UI
    tests/
    build_sidecar.spec
    run_dev.py
  scripts/
    dev.mjs
    build-win.mjs
    copy-chat-sources.sh
  resources/
    icon.png                   # placeholder OK for MVP
  README.md
```

---

### Task 1: Scaffold `grox/` monorepo + copy sources

**Files:**
- Create: `grox/package.json`
- Create: `grox/README.md`
- Create: `grox/scripts/copy-chat-sources.sh`
- Create: `grox/agent/**` (copied)
- Create: `grox/ui/**` (copied)

**Interfaces:**
- Produces: source trees under `grox/agent` and `grox/ui` ready for edit

- [ ] **Step 1: Create directories and root package.json**

```json
{
  "name": "grox",
  "version": "0.1.0",
  "private": true,
  "description": "Grox — Windows desktop coding agent (Codex-style)",
  "workspaces": ["electron", "ui"],
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "build:ui": "npm run build -w ui",
    "build:electron": "npm run build -w electron",
    "build:win": "node scripts/build-win.mjs",
    "test:agent": "cd agent && .venv/bin/pytest -q"
  }
}
```

- [ ] **Step 2: Copy chat backend/frontend into grox**

```bash
cd /home/eureka/baiqi-register-template
mkdir -p grox/scripts grox/resources grox/electron/src
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude 'node_modules' --exclude 'dist' --exclude 'data' \
  dashboard/chat/backend/ grox/agent/
rsync -a --exclude 'node_modules' --exclude 'dist' \
  dashboard/chat/frontend/ grox/ui/
```

- [ ] **Step 3: Write `grox/scripts/copy-chat-sources.sh` for re-sync (document only; not for routine)**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# intentional one-way bootstrap helper; after fork, edit only grox/
```

- [ ] **Step 4: Write minimal README**

```markdown
# Grox

Windows desktop agent (Electron + FastAPI sidecar). See
`docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add grox
git commit -m "chore(grox): scaffold monorepo and copy chat sources"
```

---

### Task 2: Trim agent backend for desktop (no image, root_path empty)

**Files:**
- Modify: `grox/agent/app/config.py`
- Modify: `grox/agent/app/main.py`
- Modify: `grox/agent/requirements.txt`
- Create: `grox/agent/tests/test_health_desktop.py`
- Create: `grox/agent/run_dev.py`

**Interfaces:**
- Produces: `Settings` fields `anthropic_base_url`, `anthropic_api_key`, `chat_token`, `sessions_dir`, `frontend_dist`, `chat_default_model`, `chat_host`, `chat_port`
- Produces: `GET /api/health` → `{status, service: "grox-agent", auth_required: bool}`
- Produces: no `/api/sessions/{id}/images` routes

- [ ] **Step 1: Rewrite `config.py` for desktop paths**

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

AGENT_ROOT = Path(__file__).resolve().parents[1]


def default_data_dir() -> Path:
    # Linux/macOS dev; on Windows Electron will set GROX_DATA_DIR
    return Path.home() / ".local" / "share" / "Grox"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GROX_", env_file=str(AGENT_ROOT / ".env"), extra="ignore")

    chat_host: str = "127.0.0.1"
    chat_port: int = 17890
    chat_token: str = "grox-local-token"
    chat_default_model: str = "grok-4.5"
    chat_permission_mode: str = "bypassPermissions"
    chat_root_path: str = ""  # desktop: no /chat prefix
    # LLM gateway (public grokcli-2api or local router)
    anthropic_base_url: str = "https://kaggleyes.top/grokapi"
    anthropic_api_key: str = ""
    chat_model_router_url: str = "https://kaggleyes.top/grokapi"
    data_dir: Path = default_data_dir()
    sessions_dir: Path | None = None
    frontend_dist: Path = AGENT_ROOT / "static"
    models_cache_ttl_sec: float = 45.0

    def model_post_init(self, __context: object) -> None:
        if self.sessions_dir is None:
            object.__setattr__(self, "sessions_dir", self.data_dir / "sessions")


settings = Settings()
```

- [ ] **Step 2: Slim `main.py` — drop image router, fix title/health**

Remove `image_gen` import and router. Health:

```python
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "grox-agent",
        "default_model": settings.chat_default_model,
        "base_url": settings.anthropic_base_url,
    }
```

Keep SPA serving from `settings.frontend_dist` (same pattern as chat `main.py`).

- [ ] **Step 3: Ensure agent uses API key for upstream**

In `agent_bridge.py` / wherever SDK options set env, set before client create:

```python
os.environ["ANTHROPIC_BASE_URL"] = settings.anthropic_base_url.rstrip("/")
if settings.anthropic_api_key:
    os.environ["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
```

(Search existing bridge for `ANTHROPIC_BASE_URL` and extend.)

- [ ] **Step 4: Write health test**

```python
# grox/agent/tests/test_health_desktop.py
from fastapi.testclient import TestClient
from app.main import app

def test_health_service_name():
    c = TestClient(app)
    r = c.get("/api/health")
    assert r.status_code == 200
    assert r.json()["service"] == "grox-agent"
```

- [ ] **Step 5: Create venv and run tests**

```bash
cd grox/agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt pytest httpx
# drop image-only tests if they import missing modules
rm -f tests/test_image_gen.py
.venv/bin/pytest tests/test_health_desktop.py tests/test_sessions.py -q
```

Expected: PASS (fix any path assumptions for sessions_dir via env `GROX_DATA_DIR=/tmp/grox-test`).

- [ ] **Step 6: `run_dev.py`**

```python
import uvicorn
from app.config import settings

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.chat_host, port=settings.chat_port, reload=True)
```

- [ ] **Step 7: Commit**

```bash
git add grox/agent
git commit -m "feat(grox): desktop agent config and health without image routes"
```

---

### Task 3: UI base path + API client for desktop (no /chat prefix)

**Files:**
- Modify: `grox/ui/vite.config.ts`
- Modify: `grox/ui/src/api.ts`
- Modify: `grox/ui/index.html` (title Grox)
- Modify: `grox/ui/package.json` name → `grox-ui`

**Interfaces:**
- Produces: `apiBase()` → `/api` when `BASE_URL` is `/`
- Produces: token still via `Authorization: Bearer` (Electron injects)

- [ ] **Step 1: Set Vite base to `/`**

```ts
// vite.config.ts — key fields
export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:17890',
    },
  },
})
```

- [ ] **Step 2: Fix `apiBase()`**

```ts
export function apiBase(): string {
  const w = window as unknown as { grox?: { apiBase?: string } }
  if (w.grox?.apiBase) return w.grox.apiBase.replace(/\/?$/, '') + '/api'
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/?$/, '/')}api`
}
```

- [ ] **Step 3: Title**

```html
<title>Grox</title>
```

- [ ] **Step 4: Dev smoke**

```bash
# terminal 1
cd grox/agent && GROX_DATA_DIR=/tmp/grox-dev GROX_ANTHROPIC_API_KEY=dummy .venv/bin/python run_dev.py
# terminal 2
cd grox/ui && npm install && npm run dev
# curl
curl -sS http://127.0.0.1:17890/api/health
```

Expected: health JSON with `service: grox-agent`.

- [ ] **Step 5: Commit**

```bash
git add grox/ui
git commit -m "feat(grox): UI base path and API client for desktop root"
```

---

### Task 4: Codex-style shell layout + 8090 chat blue–white theme (visual MVP)

**Files:**
- Modify: `grox/ui/src/index.css` / `App.css` (keep chat palette; do not switch to dark zinc)
- Modify: `grox/ui/src/App.tsx`
- Modify: `grox/ui/src/components/Sidebar.tsx`
- Modify: `grox/ui/src/components/ChatView.tsx`
- Modify: `grox/ui/src/components/Composer.tsx`
- Create: `grox/ui/src/components/Onboarding.tsx`
- Create: `grox/ui/src/components/SettingsModal.tsx`
- Create: `grox/ui/src/styles/grox-theme.css` (optional aliases; source tokens stay in App.css)

**Interfaces:**
- Produces: **light blue–white** theme from 8090 chat (`--brand: #0ea5e9`, `--bg: #f7f8fa`, white panels); ~240px sidebar; hide Image mode, Tasks panel, Artifacts panel
- Produces: Onboarding when `localStorage.grox_onboarded !== '1'` OR missing API key in settings
- Does **not** produce a dark-zinc Codex skin

- [ ] **Step 1: Confirm / document theme tokens (copy from chat App.css)**

Keep (or restore if overwritten) the 8090 chat light tokens. Canonical values:

```css
/* grox/ui/src/App.css :root — must match dashboard/chat */
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --panel: #ffffff;
  --bg-sidebar: #ffffff;
  --border: #e5e7eb;
  --border-strong: #cbd5e1;
  --text: #0f172a;
  --text-secondary: #334155;
  --text-muted: #64748b;
  --brand: #0ea5e9;
  --brand-hover: #0284c7;
  --brand-soft: #f0f9ff;
  --user-bg: #f8fafc;
  --tool-bg: #f8fafc;
  --sidebar-w: 240px; /* Grox density; chat uses 300px */
}
```

Optional thin alias file `styles/grox-theme.css`:

```css
:root {
  --grox-bg: var(--bg);
  --grox-panel: var(--panel);
  --grox-border: var(--border);
  --grox-text: var(--text);
  --grox-muted: var(--text-muted);
  --grox-accent: var(--brand);
  --grox-accent-hover: var(--brand-hover);
  --grox-sidebar-w: var(--sidebar-w);
}
body {
  background-color: var(--bg);
  color: var(--text);
  margin: 0;
}
```

Do **not** set default `body` to `#0c0c0e` / zinc dark.

- [ ] **Step 2: App shell**

- Remove `Login` gate when desktop; auto `setToken('grox-local-token')` for dev.
- Layout: `flex h-screen`; white sidebar + `#f7f8fa` main; primary actions use `--brand`.
- Active thread / focus rings: sky blue, not gray accent.

- [ ] **Step 3: Hide non-MVP UI**

In `ChatView.tsx` / `Composer.tsx`:

- Remove or hard-hide Image mode toggle.
- Do not render `TasksPanel` / `ArtifactsPanel` in default layout (comment import OK).

- [ ] **Step 4: Onboarding component**

Fields: Base URL (default `https://kaggleyes.top/grokapi`), API Key, Continue button.  
Style with white card on `--bg`, primary button `--brand`.  
On submit: `PUT /api/runtime-config` (Task 5) or interim `localStorage` until Task 5 lands.

```ts
localStorage.setItem('grox_base_url', baseUrl)
localStorage.setItem('grox_api_key', apiKey)
localStorage.setItem('grox_onboarded', '1')
```

- [ ] **Step 5: Settings gear**

Modal reusing same fields + “Open data folder” (`window.grox?.openDataDir?.()`).  
No theme dark/light toggle in MVP.

- [ ] **Step 6: Visual check**

`npm run dev -w ui` — **light** sidebar, sky-blue primary, wordmark “Grox”, placeholder “Message Grox…”.  
Reject if UI is dark zinc.

- [ ] **Step 7: Commit**

```bash
git add grox/ui
git commit -m "feat(grox): Codex layout with 8090 chat blue-white theme"
```

---

### Task 5: Runtime config API (Base URL + API key → agent process)

**Files:**
- Create: `grox/agent/app/runtime_config.py`
- Modify: `grox/agent/app/main.py`
- Modify: `grox/agent/app/agent_bridge.py` (read live settings)
- Create: `grox/agent/tests/test_runtime_config.py`

**Interfaces:**
- Produces:
  - `GET /api/runtime-config` → `{ base_url, api_key_set: bool, default_model }`
  - `PUT /api/runtime-config` body `{ base_url?: str, api_key?: str, default_model?: str }`
- Mutates in-memory `settings` + persists under `data_dir/runtime.json` (never log raw key)

- [ ] **Step 1: Implement store**

```python
# runtime_config.py
from __future__ import annotations
import json
from pathlib import Path
from typing import Any
from .config import settings

def _path() -> Path:
    p = settings.data_dir
    p.mkdir(parents=True, exist_ok=True)
    return p / "runtime.json"

def load() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))

def apply_and_save(patch: dict[str, Any]) -> dict[str, Any]:
    data = load()
    if "base_url" in patch and patch["base_url"]:
        data["base_url"] = str(patch["base_url"]).rstrip("/")
        settings.anthropic_base_url = data["base_url"]
        settings.chat_model_router_url = data["base_url"]
    if "api_key" in patch and patch["api_key"] is not None:
        data["api_key"] = str(patch["api_key"])
        settings.anthropic_api_key = data["api_key"]
    if "default_model" in patch and patch["default_model"]:
        data["default_model"] = str(patch["default_model"])
        settings.chat_default_model = data["default_model"]
    _path().write_text(json.dumps(data, indent=2), encoding="utf-8")
    return public_view()

def public_view() -> dict[str, Any]:
    data = load()
    key = data.get("api_key") or settings.anthropic_api_key
    return {
        "base_url": data.get("base_url") or settings.anthropic_base_url,
        "api_key_set": bool(key),
        "default_model": data.get("default_model") or settings.chat_default_model,
    }

def bootstrap_from_disk() -> None:
    data = load()
    if data.get("base_url"):
        settings.anthropic_base_url = data["base_url"]
        settings.chat_model_router_url = data["base_url"]
    if data.get("api_key"):
        settings.anthropic_api_key = data["api_key"]
    if data.get("default_model"):
        settings.chat_default_model = data["default_model"]
```

Call `bootstrap_from_disk()` at import of `main.py`.

- [ ] **Step 2: Routes** (require_token same as other APIs)

```python
@router.get("/api/runtime-config")
def get_cfg(): ...
@router.put("/api/runtime-config")
def put_cfg(body: RuntimeConfigIn): ...
```

- [ ] **Step 3: Test**

```python
def test_put_runtime_config(tmp_path, monkeypatch):
    monkeypatch.setenv("GROX_DATA_DIR", str(tmp_path))
    # re-import or construct app with fresh settings if needed
    ...
    assert r.json()["api_key_set"] is True
```

- [ ] **Step 4: Wire UI onboarding to PUT**

Onboarding Continue → `PUT /api/runtime-config` then enter main shell.

- [ ] **Step 5: Commit**

```bash
git add grox/agent grox/ui
git commit -m "feat(grox): runtime config API for LLM base URL and API key"
```

---

### Task 6: Electron main + preload + sidecar supervisor

**Files:**
- Create: `grox/electron/package.json`
- Create: `grox/electron/tsconfig.json`
- Create: `grox/electron/src/main.ts`
- Create: `grox/electron/src/preload.ts`
- Create: `grox/electron/src/sidecar.ts`
- Create: `grox/electron/src/config-store.ts`

**Interfaces:**
- Produces: `window.grox = { apiBase, token, selectFolder(), openDataDir(), getVersion() }`
- Produces: sidecar spawn with env `GROX_CHAT_PORT`, `GROX_CHAT_TOKEN`, `GROX_DATA_DIR`, `GROX_ANTHROPIC_*`

- [ ] **Step 1: electron/package.json**

```json
{
  "name": "grox-electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "electron ."
  },
  "devDependencies": {
    "electron": "^33.2.0",
    "typescript": "~5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: `sidecar.ts`**

```ts
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import http from 'node:http'
import { app } from 'electron'

export type SidecarHandle = { proc: ChildProcessWithoutNullStreams; port: number; token: string }

export async function startSidecar(opts: {
  port: number
  token: string
  dataDir: string
  baseUrl?: string
  apiKey?: string
}): Promise<SidecarHandle> {
  const isDev = !app.isPackaged
  const sidecarBin = isDev
    ? null // dev: assume external uvicorn OR path to python run_dev
    : path.join(process.resourcesPath, 'sidecar', 'agent-sidecar')

  // packaged:
  const proc = spawn(sidecarBin!, ['--host', '127.0.0.1', '--port', String(opts.port)], {
    env: {
      ...process.env,
      GROX_CHAT_HOST: '127.0.0.1',
      GROX_CHAT_PORT: String(opts.port),
      GROX_CHAT_TOKEN: opts.token,
      GROX_DATA_DIR: opts.dataDir,
      GROX_ANTHROPIC_BASE_URL: opts.baseUrl || 'https://kaggleyes.top/grokapi',
      GROX_ANTHROPIC_API_KEY: opts.apiKey || '',
    },
    stdio: 'pipe',
  })
  await waitHealth(opts.port, 30_000)
  return { proc, port: opts.port, token: opts.token }
}

function waitHealth(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) resolve()
        else retry()
      }).on('error', retry)
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error('sidecar health timeout'))
      else setTimeout(tick, 200)
    }
    tick()
  })
}
```

Dev mode: `main.ts` should **not** spawn PyInstaller; set `GROX_DEV_URL=http://127.0.0.1:5173` and require agent via `run_dev.py` already running, OR spawn `python run_dev.py`.

- [ ] **Step 3: `preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('grox', {
  apiBase: () => ipcRenderer.invoke('grox:apiBase'),
  token: () => ipcRenderer.invoke('grox:token'),
  selectFolder: () => ipcRenderer.invoke('grox:selectFolder') as Promise<string | null>,
  openDataDir: () => ipcRenderer.invoke('grox:openDataDir'),
  getVersion: () => ipcRenderer.invoke('grox:getVersion'),
})
```

- [ ] **Step 4: `main.ts`**

- `app.whenReady` → ensure data dir under `app.getPath('userData')`
- generate token `crypto.randomBytes(24).toString('hex')` store in memory
- free port (try 17890)
- start sidecar (packaged) or attach dev
- `BrowserWindow` with `preload`, load `http://127.0.0.1:${port}/`
- IPC handlers for folder dialog (`dialog.showOpenDialog({ properties:['openDirectory'] })`)
- `before-quit` kill sidecar

- [ ] **Step 5: UI uses `window.grox`**

On boot in `api.ts`:

```ts
export async function initDesktopAuth(): Promise<void> {
  const g = (window as any).grox
  if (!g?.token) return
  const token = await g.token()
  if (token) setToken(token)
}
```

Call from `main.tsx` before render.

Cwd picker: if `window.grox?.selectFolder`, use it instead of free-text path when possible.

- [ ] **Step 6: Commit**

```bash
git add grox/electron grox/ui
git commit -m "feat(grox): Electron shell with sidecar supervisor and preload bridge"
```

---

### Task 7: Dev orchestration script

**Files:**
- Create: `grox/scripts/dev.mjs`

**Interfaces:**
- Produces: one command starts agent + vite; documents electron:dev separately

- [ ] **Step 1: Write `dev.mjs`**

```js
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentPy = path.join(root, 'agent', '.venv', 'bin', 'python')
const env = {
  ...process.env,
  GROX_DATA_DIR: process.env.GROX_DATA_DIR || path.join(root, '.dev-data'),
  GROX_CHAT_TOKEN: process.env.GROX_CHAT_TOKEN || 'grox-local-token',
  GROX_CHAT_PORT: '17890',
}

const agent = spawn(agentPy, ['run_dev.py'], { cwd: path.join(root, 'agent'), env, stdio: 'inherit' })
const ui = spawn('npm', ['run', 'dev', '-w', 'ui'], { cwd: root, env, stdio: 'inherit' })

const kill = () => { agent.kill('SIGTERM'); ui.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', kill)
process.on('SIGTERM', kill)
```

- [ ] **Step 2: Document in README**

```bash
cd grox && npm install
cd agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd .. && npm run dev
# optional: npm run build -w electron && GROX_DEV_URL=http://127.0.0.1:5173 npx electron electron
```

- [ ] **Step 3: Commit**

```bash
git add grox/scripts/dev.mjs grox/README.md
git commit -m "chore(grox): add dev orchestration script"
```

---

### Task 8: CLI entry for sidecar + PyInstaller spec

**Files:**
- Create: `grox/agent/sidecar_main.py`
- Create: `grox/agent/build_sidecar.spec`
- Modify: `grox/agent/requirements.txt` (add `pyinstaller` as optional note)

**Interfaces:**
- Produces: `agent-sidecar` executable args `--host` `--port`
- Produces: onedir under `grox/agent/dist/agent-sidecar/`

- [ ] **Step 1: `sidecar_main.py`**

```python
import argparse
import uvicorn
from app.config import settings
from app.runtime_config import bootstrap_from_disk

def main() -> None:
    p = argparse.ArgumentParser(prog="agent-sidecar")
    p.add_argument("--host", default=settings.chat_host)
    p.add_argument("--port", type=int, default=settings.chat_port)
    args = p.parse_args()
    bootstrap_from_disk()
    uvicorn.run("app.main:app", host=args.host, port=args.port, log_level="info")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Minimal spec**

```python
# build_sidecar.spec — PyInstaller
a = Analysis(['sidecar_main.py'], pathex=['.'], hiddenimports=[
    'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
    'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan', 'uvicorn.lifespan.on',
    'claude_agent_sdk',
], ...)
# onedir recommended
```

- [ ] **Step 3: Build on Linux first (smoke)**

```bash
cd grox/agent
.venv/bin/pip install pyinstaller
.venv/bin/pyinstaller build_sidecar.spec
./dist/agent-sidecar/agent-sidecar --host 127.0.0.1 --port 17999 &
sleep 2
curl -sS http://127.0.0.1:17999/api/health
kill %1
```

Expected: health 200. (Full Claude binary packaging may need extra `datas=` — fix until health works.)

- [ ] **Step 4: Commit**

```bash
git add grox/agent/sidecar_main.py grox/agent/build_sidecar.spec
git commit -m "feat(grox): sidecar CLI entry and PyInstaller spec"
```

---

### Task 9: electron-builder Windows packaging glue

**Files:**
- Create: `grox/electron-builder.yml`
- Create: `grox/scripts/build-win.mjs`
- Create: `grox/resources/icon.png` (simple placeholder)

**Interfaces:**
- Produces: script that builds UI → copies to `agent/static` → (expects sidecar prebuilt) → electron-builder

- [ ] **Step 1: `electron-builder.yml`**

```yaml
appId: app.grox.desktop
productName: Grox
directories:
  output: release
files:
  - electron/dist/**
  - electron/package.json
extraResources:
  - from: agent/dist/agent-sidecar
    to: sidecar
win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: Grox-Setup-${version}.${ext}
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 2: `build-win.mjs`**

```js
// 1) npm run build -w ui
// 2) rimraf agent/static && cp -r ui/dist agent/static
// 3) note: run pyinstaller on Windows CI/host for real .exe
// 4) npm run build -w electron
// 5) npx electron-builder --win --config electron-builder.yml
```

- [ ] **Step 3: README packaging section**

Document that **final NSIS must be built on Windows** (or wine-optional; prefer real Win11).

- [ ] **Step 4: Commit**

```bash
git add grox/electron-builder.yml grox/scripts/build-win.mjs grox/resources grox/README.md
git commit -m "feat(grox): electron-builder config and Windows build script"
```

---

### Task 10: E2E acceptance checklist (manual) + fix pass

**Files:**
- Create: `grox/docs/ACCEPTANCE.md`

**Interfaces:**
- Produces: checklist matching design §13 success criteria

- [ ] **Step 1: Write ACCEPTANCE.md**

```markdown
# Grox MVP acceptance

1. [ ] `npm run dev` — UI loads, health ok
2. [ ] Onboarding saves key — PUT runtime-config
3. [ ] New thread + select folder + message streams
4. [ ] Tool cards appear for Bash/Read
5. [ ] Stop button interrupts
6. [ ] Restart agent — sessions listed from data dir
7. [ ] Packaged: Grox.exe starts sidecar, no Python preinstalled (Windows)
```

- [ ] **Step 2: Run Linux/dev items 1–6 against public grokapi with real key**

Use key from `~/.config/grokcli-2api/public-api-key` if testing against public endpoint.

- [ ] **Step 3: File bugs as follow-up commits; do not expand MVP scope**

- [ ] **Step 4: Commit**

```bash
git add grox/docs/ACCEPTANCE.md
git commit -m "docs(grox): MVP acceptance checklist"
```

---

### Task 11: Mark design implemented notes + handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md` (add Implementation link)
- Modify: `grox/README.md` (quickstart final)

- [ ] **Step 1: Link plan from design**

Add under header:

```markdown
**Implementation plan:** `docs/superpowers/plans/2026-07-24-grox-windows-desktop.md`
```

- [ ] **Step 2: Final commit**

```bash
git add docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md grox/README.md
git commit -m "docs(grox): link implementation plan and finalize README"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Electron + React + FastAPI sidecar | 1, 6, 8, 9 |
| Codex layout + 8090 blue–white colors | 4 |
| Extract from dashboard/chat | 1, 2, 3 |
| Runtime Base URL + API key | 5 |
| Loopback-only + auto token | 6 |
| No image/tasks IDE MVP | 2, 4 |
| Windows installer | 9 |
| Success criteria | 10 |
| Product name Grox | all |

## Placeholder / consistency scan

- No TBD steps; Windows-native final build acknowledged as host requirement in Task 9.
- Settings field names: `GROX_` env prefix throughout Tasks 2/5/6/8.
- Default port `17890` consistent.
- Token default dev `grox-local-token`; packaged random via Electron.

## Risk note for implementers

1. **claude-agent-sdk on Windows** may ship a native binary — verify PyInstaller `datas` early on a real Windows machine (Task 8/9).
2. **Cloudflare** may 403 browserless clients to `kaggleyes.top/grokapi`; allow custom Base URL (Task 5).
3. Do **not** kill `model_router` on the Linux host while testing other products.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-24-grox-windows-desktop.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with checkpoints  

Which approach?
