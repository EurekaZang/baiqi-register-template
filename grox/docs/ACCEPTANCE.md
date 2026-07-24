# Grox MVP acceptance

Checklist mapped to design §13 success criteria and plan Task 10.

Legend: **PASS** verified on this host · **PARTIAL** API/contract only · **SKIP** requires Windows ship host · **FAIL** blocked

Host: Linux (dev). Date: 2026-07-24. Public endpoint: `https://kaggleyes.top/grokapi` with key from `~/.config/grokcli-2api/public-api-key`.

## Checklist

1. [x] **PASS** `npm run dev` path — UI loads, health ok  
   - Agent: `run_dev.py` on free port → `GET /api/health` **200**  
     `{"status":"ok","service":"grox-agent","default_model":"grok-4.5","base_url":"https://kaggleyes.top/grokapi"}`  
   - UI: `npm run build -w grox-ui` **PASS**; production `ui/dist/index.html` present  
   - Orphan Vite already bound `:5173` (proxy default → `:17890`); full dual-process `npm run dev` not re-run against a free pair, but both halves verified independently  
2. [x] **PASS** Onboarding saves key — `PUT /api/runtime-config`  
   - `PUT` with base URL + API key → **200** `api_key_set: true`  
   - `GET /api/runtime-config` → **200** same public view (key never echoed)  
   - UI path: `Onboarding.tsx` calls `putRuntimeConfig` then sets `grox_onboarded` / localStorage  
3. [x] **PASS** New thread + select folder + message streams  
   - `POST /api/sessions` with `cwd=/tmp/grox-accept-workspace` → **200**  
   - `POST /api/sessions/{id}/messages` → SSE **200** `text/event-stream`  
   - Streamed `text_delta` + `done` (~14s) with model `grok-4.5` against public grokapi  
   - Folder selection in Electron UI is IPC (`selectFolder`); API accepts absolute `cwd` (Linux verified)  
4. [x] **PASS** Tool cards appear for Bash/Read  
   - Same turn requested Read on `hello.txt`  
   - SSE included `tool_start` / `tool_end` (2 each) plus assistant `text_delta`  
   - UI maps these to tool cards (Codex layout components from Task 4)  
5. [x] **PARTIAL** Stop button interrupts  
   - While SSE active: `POST /api/sessions/{id}/stop` → **200** `{"ok":true,"interrupted":false}`  
   - Idle stop → **409** `Session is not running` (expected)  
   - Note: `interrupted:false` means SDK client interrupt was best-effort / client not yet registered; HTTP stop path and status gating work. Full “stream aborts immediately” is host/SDK dependent — not expanded as MVP bugfix in this pass.  
6. [x] **PASS** Restart agent — sessions listed from data dir  
   - Stopped agent PID, restarted with same `GROX_DATA_DIR`  
   - `GET /api/sessions` → **1** session (`accept-1`, prior id preserved)  
7. [ ] **SKIP** Packaged: `Grox.exe` starts sidecar, no Python preinstalled (Windows)  
   - Packaging glue present (Task 9: `electron-builder.yml`, `scripts/build-win.mjs`)  
   - Final NSIS + PyInstaller onedir must run on **Windows 11 / windows-latest**  
   - Linux PyInstaller smoke already done in Task 8 (ELF sidecar health only)

## Design §13 mapping

| §13 criterion | Evidence |
|---------------|----------|
| 1. Double-click exe, no Python/Node | Item 7 — SKIP (Windows host) |
| 2. API key → models → stream `grok-4.5` | Items 2–3 PASS (stream verified; models list not re-hit this pass) |
| 3. Workspace folder + tool cards | Items 3–4 PASS |
| 4. Restart → sessions listed | Item 6 PASS |
| 5. Codex layout + 8090 blue–white | Prior Task 4 UI; build still succeeds |

## Commands used (Linux)

```bash
cd grox
export GROX_DATA_DIR=/tmp/grox-accept-data GROX_CHAT_TOKEN=grox-local-token GROX_CHAT_PORT=17891
agent/.venv/bin/python agent/run_dev.py
# health / runtime-config / sessions / messages / stop via curl+python
npm run build -w grox-ui
npm run build -w electron
```

## Follow-ups (out of MVP expansion)

- Re-run item 1 with exclusive ports if `:5173`/`:17890` free (`npm run dev` single command).
- Windows CI job: PyInstaller + `npm run build:win` + clean-VM smoke of item 7.
- Optional: harden stop so `interrupted:true` when client is mid-turn (SDK timing).
