# Design: Grox — Windows Desktop Agent (Codex-style)

**Date:** 2026-07-24  
**Status:** Approved  
**Product name:** **Grox**  
**Goal:** Ship a Windows `.exe` desktop app that runs a Grok 4.5 coding agent with a Codex-like layout and the **8090 chat blue–white** color system.  
**Implementation plan:** `docs/superpowers/plans/2026-07-24-grox-windows-desktop.md`  
**Code:** `grox/` · **Acceptance:** `grox/docs/ACCEPTANCE.md`

## 1. Problem

We already have a working web stack:

- Frontend: React 19 + Vite Chat UI (`dashboard/chat/frontend`)
- Backend: FastAPI + Claude Agent SDK (`dashboard/chat/backend`), default model `grok-4.5`
- Model gateway: local model_router / public `https://kaggleyes.top/grokapi`

Users want a **native-feeling Windows app** (double-click exe), not “open browser to LAN URL”. Interaction/layout target is **OpenAI Codex desktop** (`codex app`): thread list, workspace-scoped agent, visible tool execution — not a full IDE. **Color system** matches existing **8090 chat blue–white** (sky brand on light panels), not Codex dark zinc.

## 2. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| MVP shape | **A** — lightweight chat agent client |
| Visual target | **Codex desktop layout** + **8090 chat blue–white palette** |
| Implementation path | **方案 1** — Electron shell + refactor existing chat stack |
| Product name | **Grox** |
| Desktop shell | **Electron + electron-builder** |
| Agent runtime | **Python FastAPI + claude-agent-sdk** (PyInstaller sidecar) |
| Default model API | Public grokcli-2api (`https://kaggleyes.top/grokapi`) + API key |

### Out of scope (MVP)

- Image generation mode
- Full Tasks board / multi-subagent workbench UI (keep tool cards only)
- Full IDE file tree + multi-tab terminal
- Auto-update CDN (phase 2: electron-updater)
- macOS/Linux installers (architecture should not block later)

## 3. Goals & non-goals

### Goals

1. One-click Windows launch: `Grox.exe` / installer starts UI + agent backend.
2. Codex-like layout (structure only): narrow thread sidebar, transcript, tool cards, bottom composer, workspace chip — painted with 8090 chat blue–white tokens.
3. Reuse proven agent loop (SSE, tools, cwd, session store) with minimal protocol churn.
4. Simple settings: Base URL, API Key, default model (theme fixed to 8090 blue–white in MVP).
5. Offline-capable shell (UI works once sidecar is up; LLM needs network).

### Non-goals

- Replacing `8090/chat` dashboard product.
- Re-implementing Claude Agent SDK in Node.
- Perfect pixel clone of Codex (inspiration, not trademarked assets).

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Grox.exe  (Electron main)                                  │
│   • window chrome, tray, open-folder dialogs                │
│   • spawn/monitor agent-sidecar.exe                         │
│   • inject GROX_API_PORT into renderer                      │
└───────────────┬───────────────────────────┬─────────────────┘
                │ localhost HTTP/SSE        │ child process
                ▼                           ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ Renderer (React SPA)     │   │ agent-sidecar.exe            │
│ Grox UI (Codex layout,   │   │ PyInstaller + FastAPI        │
│ 8090 blue–white theme)   │   │                              │
│ · threads sidebar        │   │ · Claude Agent SDK           │
│ · transcript + tools     │   │ · sessions under APPDATA     │
│ · composer + cwd chip    │   │ · ANTHROPIC_BASE_URL → LLM   │
└──────────────────────────┘   └──────────────┬───────────────┘
                                              │ HTTPS
                                              ▼
                               grokcli-2api / model_router
                               (default: kaggleyes.top/grokapi)
```

### Process model

1. Electron main starts.
2. Pick free loopback port `P` (or fixed `17890` with fallback).
3. Spawn `resources/sidecar/agent-sidecar.exe --host 127.0.0.1 --port P`.
4. Wait for `GET http://127.0.0.1:P/api/health` (timeout ~30s, show splash error).
5. Load renderer: prefer `http://127.0.0.1:P/` if backend serves SPA; or `file://` dist + `window.grox.apiBase`.
6. On quit: SIGTERM/kill sidecar tree.

**Recommendation:** Backend continues to serve SPA `dist/` (same as current chat service). Electron loads `http://127.0.0.1:P/` so one origin for API + assets (no CORS pain).

### Auth model (desktop)

Web chat uses `CHAT_TOKEN` login. Desktop simplifies:

- **No login screen** for local token by default.
- Sidecar binds **loopback only**.
- Optional local token still generated for defense-in-depth; Electron injects it via preload (`Authorization` header).
- User-facing secrets: **LLM API Key** + Base URL stored in Electron `safeStorage` or `%APPDATA%/Grox/config.json` (mode restricted).

## 5. Repository layout

New top-level app (extract, do not tightly couple to dashboard runtime):

```text
grox/                          # new monorepo root (or under baiqi-register-template/grox)
  package.json                 # electron + workspace scripts
  electron/
    main.ts
    preload.ts
    sidecar.ts                 # spawn/health/kill
  ui/                          # forked+restyled from dashboard/chat/frontend
    package.json
    src/
      components/              # Sidebar, Transcript, Composer, ToolCard, Settings
      styles/grox-theme.css      # 8090 chat blue–white tokens
  agent/                       # forked+trimmed from dashboard/chat/backend
    app/
      main.py
      agent_bridge.py          # keep SSE protocol
      sessions.py
      models_api.py
      config.py
    requirements.txt
    build_sidecar.spec         # PyInstaller
  scripts/
    dev.mjs                    # electron + vite + uvicorn
    build-win.mjs              # build ui → sidecar → electron-builder
  resources/
    icon.ico
  docs/                        # link to this design
```

**Source strategy:** Copy/adapt from `dashboard/chat/{frontend,backend}` into `grox/`; keep dashboard chat working independently. Shared protocol docs only — avoid hard monorepo coupling in MVP.

## 6. UI design (Codex layout + 8090 chat colors)

### Layout (structure = Codex-like; paint = 8090 chat)

```
┌────────────┬──────────────────────────────────────────────┐
│ Grox       │  {workspace} ▾     grok-4.5 ▾      ⚙        │
│ [+ New]    │──────────────────────────────────────────────│
│            │                                              │
│ Today      │   user message                               │
│  thread A  │                                              │
│  thread B  │   assistant markdown…                        │
│            │   ┌ tool: Bash ────────────── ● running ─┐   │
│ Yesterday  │   │ pytest -q                            │   │
│  …         │   └──────────────────────────────────────┘   │
│            │                                              │
│            │──────────────────────────────────────────────│
│            │  📁 D:\proj\foo          [Stop]              │
│            │  ┌────────────────────────────────────────┐  │
│            │  │ Message Grox…                          │  │
│            │  └────────────────────────────────────────┘  │
└────────────┴──────────────────────────────────────────────┘
```

### Visual language — **8090 chat blue–white (source of truth)**

Reuse tokens from `dashboard/chat/frontend/src/App.css` + light `:root` in `index.css`.  
**Default theme is light blue–white** (not Codex dark zinc). Optional dark mode is out of MVP unless already free.

| Role | Token | Value |
|------|--------|--------|
| Page bg | `--bg` | `#f7f8fa` (+ subtle slate dot grid as in chat) |
| Panel / sidebar | `--panel` / `--bg-sidebar` | `#ffffff` |
| Border | `--border` | `#e5e7eb` |
| Border strong | `--border-strong` | `#cbd5e1` |
| Text | `--text` | `#0f172a` |
| Text secondary | `--text-secondary` | `#334155` |
| Text muted | `--text-muted` | `#64748b` |
| Brand (primary) | `--brand` | `#0ea5e9` (sky-500) |
| Brand hover | `--brand-hover` | `#0284c7` |
| Brand soft | `--brand-soft` | `#f0f9ff` |
| User bubble / tool | `--user-bg` / `--tool-bg` | `#f8fafc` |
| OK / warn / danger | `--ok` / `--warn` / `--danger` | `#16a34a` / `#d97706` / `#dc2626` |
| Radius | `--app-radius` | `12px` |
| Sidebar width (Grox) | `--sidebar-w` | `240px` (Codex density; chat uses 300px — prefer 240 for desktop agent) |
| Fonts | same as chat | Plus Jakarta Sans + Noto Sans SC; JetBrains Mono for code |

shadcn/Tailwind layer (if kept) must align primary with sky brand:

- `--primary: oklch(0.65 0.15 235)` (already “Sky brand” in chat `index.css`)
- Light background `oklch(0.985 0.004 247)` — keep; do **not** ship dark zinc default.

| Direction | Rule |
|-----------|------|
| Density | Compact sidebar (~240px); generous transcript padding |
| Type | UI sans; mono for paths, commands, tool I/O |
| Accent | **Sky blue `#0ea5e9`** for primary buttons, active thread, focus rings |
| Motion | Minimal; streaming caret / tool spinner only |
| Brand | Wordmark **Grox** only — no Codex/OpenAI marks |
| Theme default | **Light blue–white**; settings may omit dark toggle in MVP |

### MVP screens

1. **Onboarding (first run):** Base URL (prefill public grokapi), API Key, optional default model, “Continue”.
2. **Main:** threads + transcript + composer.
3. **Settings:** API, model default, open data folder, about/version (no dark-theme toggle in MVP).
4. **Empty state:** “Select a folder and ask Grox to work.”

### Components to keep / drop from current chat

| Keep (adapt) | Drop / hide in MVP |
|--------------|--------------------|
| Sidebar sessions | Image mode toggle |
| MessageList + markdown | Artifacts side panel (optional later) |
| ToolCard + streaming tools | Heavy TasksPanel |
| Composer + stop | Mobile-first sheets (desktop first) |
| CwdPicker (via Electron dialog) | Dashboard token Login page |
| ModelSelect | SubAgent deep cards (collapse to tool only) |

## 7. Backend API (MVP surface)

Preserve existing shapes where possible so UI port is small:

| Endpoint | Notes |
|----------|-------|
| `GET /api/health` | Sidecar readiness |
| `GET/POST /api/sessions` | List/create |
| `GET/PATCH/DELETE /api/sessions/{id}` | Detail / rename / delete |
| `POST /api/sessions/{id}/messages` (SSE) | Agent turn |
| `POST /api/sessions/{id}/stop` | Interrupt |
| `GET /api/models` | From upstream `/v1/models` or static fallback |
| `POST /api/settings` / `GET /api/settings` | Optional; may live only in Electron |

Agent env:

- `ANTHROPIC_BASE_URL` = user Base URL (e.g. `https://kaggleyes.top/grokapi`)
- `ANTHROPIC_API_KEY` / `GROX_API_KEY` = user key (Bearer)
- Default model `grok-4.5`
- Permission mode: `bypassPermissions` (Codex-like autonomous coding agent on local workspace)

### Workspace / cwd

- Each session has `cwd` (Windows path).
- Electron folder picker → `patchSession({ cwd })` before first message if empty.
- Agent SDK runs tools relative to that cwd.

### Data directories

| Path | Content |
|------|---------|
| `%APPDATA%/Grox/config.json` | Base URL, key ref, theme, window bounds |
| `%APPDATA%/Grox/sessions/` | Session JSON (same idea as chat data) |
| `%APPDATA%/Grox/logs/` | sidecar + electron logs |

## 8. Packaging (Windows)

### Artifacts

1. **Installer:** `Grox-Setup-x.y.z.exe` (NSIS via electron-builder)
2. **Portable (optional):** `Grox-Portable-x.y.z.zip` directory with `Grox.exe`

### Build pipeline

```text
1. npm run build -w ui          → ui/dist
2. copy ui/dist → agent/static
3. pyinstaller agent/build_sidecar.spec  → dist/agent-sidecar/
4. electron-builder --win       → embeds resources/sidecar + app
```

### PyInstaller notes

- Prefer **onedir** sidecar (more reliable than onefile for native deps).
- Hidden imports: `claude_agent_sdk`, uvicorn, anyio, httpx, …
- Bundle SDK’s bundled Claude binary if required by package (verify at implement time).
- Test on clean Windows 10/11 VM without Python installed.

### electron-builder sketch

```yaml
appId: top.kaggleyes.grox
productName: Grox
files: ["electron/dist/**", "package.json"]
extraResources:
  - from: dist/agent-sidecar
    to: sidecar
win:
  target: [nsis]
  icon: resources/icon.ico
```

## 9. Development workflow

```bash
# Terminal A — agent
cd grox/agent && uvicorn app.main:app --host 127.0.0.1 --port 17890 --reload

# Terminal B — UI
cd grox/ui && npm run dev   # vite proxy /api → 17890

# Terminal C — Electron (optional early)
cd grox && npm run electron:dev
```

CI (later): lint UI, pytest agent, smoke “sidecar boots + /api/health”.

## 10. Security

| Risk | Mitigation |
|------|------------|
| Local RCE via agent tools | Loopback-only API; user-selected cwd; clear “full access to folder” copy |
| API key theft | OS user profile ACL; optional Electron safeStorage; never log key |
| Supply chain | Pin deps; code-sign installer when cert available |
| Prompt injection | Same class as Claude Code; document risk; no elevation beyond user |

MVP does **not** implement Codex-level sandboxing; permission mode is bypass for coding productivity. Phase 2 may add confirm-on-destructive-tool.

## 11. Migration / coexistence

- `dashboard/chat` remains the **web** agent for 8090.
- Grox is a **desktop product** with forked code.
- Protocol compatibility preferred so bugfixes can cherry-pick both ways for a while.

## 12. Phased delivery

### Phase 0 — Scaffold (1–2 d)

- Create `grox/` skeleton, Electron hello + sidecar health spawn.
- Windows build script produces runnable shell (even with stub UI).

### Phase 1 — MVP agent chat (core)

- Port backend sessions + agent_bridge (no image router).
- Port UI; restyle to Codex layout; settings + onboarding.
- End-to-end: select folder → chat → tool cards → stream stop.

### Phase 2 — Polish

- Tray, window state, better errors, logs viewer, code signing.
- electron-updater; optional portable zip.

### Phase 3 — Stretch

- Confirm-mode permissions; multi-window workspaces; richer diff UI.

## 13. Success criteria (MVP)

1. Double-click `Grox.exe` on clean Win11 → window opens without installing Python/Node.
2. Configure API key once → list models → new thread → stream reply from `grok-4.5`.
3. Select workspace folder → agent can read/list files via tools; tool cards visible.
4. Restart app → sessions still listed.
5. UI recognizably Codex-like in **layout** (sidebar threads, tool cards, workspace chip) and 8090 chat **blue–white** in color — no Codex/OpenAI trademarks.

## 14. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Agent SDK Windows packaging | High | Early PyInstaller spike on real Windows |
| Sidecar startup slow | Medium | Splash + progress; keep sidecar warm |
| Public grokapi CF challenge | Medium | Document Bypass rule; allow custom Base URL |
| Bundle size (Electron+Python) | Low | Accept ~200MB+ for MVP; Tauri later if needed |

## 15. Open questions (non-blocking)

1. Code signing certificate available?
2. Default Base URL hardcode public grokapi or empty-with-placeholder?
3. Chinese UI first, English first, or bilingual?

## 16. Approval

Please confirm:

- [ ] Architecture (Electron + FastAPI sidecar + React)
- [ ] MVP scope (Codex-style chat; no image/tasks IDE)
- [ ] Repo path `grox/` extract-from-chat
- [ ] Product name **Grox**

After approval → write implementation plan (`docs/superpowers/plans/2026-07-24-grox-windows-desktop.md`) with executable tasks, then implement.
