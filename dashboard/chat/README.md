# 8090 Chat Agent

ChatGPT-like UI at **`http://<host>:8090/chat`**, reverse-proxied by the Grok Pipeline Dashboard to a loopback FastAPI service on **`127.0.0.1:8091`**.

Default agent model: **`grok-4.5`**. Permission mode: **`bypassPermissions`** (Claude Agent SDK).

### Composer Image mode

Toggle **Chat | Image** in the composer. Image mode calls grok2api (not the Agent SDK):

- `POST /api/sessions/{id}/images` → `http://127.0.0.1:8000/v1/images/generations`
- Model: **`grok-imagine-image-lite`** (configurable)
- Assistant message content: markdown `![image](cdn-url)` (upstream URL; CDN may 403 without cookies)

Requires **grok2api** on `:8000` in addition to model_router / chat-service / dashboard.

## Architecture

```text
 Browser / LAN client
        │
        ▼
 ┌──────────────────────────────────────────┐
 │ Dashboard :8090  (DASHBOARD_HOST)        │
 │  /              Grok pipeline UI         │
 │  /api/*         dashboard APIs           │
 │  /chat/*  ──proxy, strip /chat──┐        │
 └─────────────────────────────────┼────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │ Chat service             │
                    │ 127.0.0.1:8091 only       │
                    │  SPA  /  /assets/*       │
                    │  API  /api/*             │
                    │  Agent SSE (SDK)         │
                    └────────────┬─────────────┘
                                 │ ANTHROPIC_BASE_URL
                                 ▼
                    ┌──────────────────────────┐
                    │ model_router :8088       │
                    │ (Claude Code gateway)    │
                    └──────────────────────────┘
```

| Layer | Bind | Public path |
|-------|------|-------------|
| Dashboard (`dashboard/server.py`) | `DASHBOARD_HOST:8090` (default `127.0.0.1`) | `/`, `/api/*`, **`/chat/*` (proxy)** |
| Chat service (uvicorn) | **`127.0.0.1:8091` only** | `/`, `/api/*`, `/assets/*` |
| model_router | `127.0.0.1:8088` | LLM upstream for Agent SDK |

The dashboard proxy **strips** the `/chat` prefix when forwarding:

- `/chat/api/sessions` → `http://127.0.0.1:8091/api/sessions`
- `/chat/` → `http://127.0.0.1:8091/`
- `/chat/assets/x` → `http://127.0.0.1:8091/assets/x`

`Authorization` and `Cookie` are preserved. SSE agent streams are proxied without response buffering (long timeout, default 3600s).

FastAPI `root_path=/chat` is only for OpenAPI/public URL generation; routes themselves do **not** include `/chat`. Frontend Vite `base: '/chat/'` so assets load under `/chat/assets/...`.

## Start order (required)

1. **model_router** on `:8088` (Claude Code / Sub2API gateway)  
2. **chat-service** on `127.0.0.1:8091`  
3. **dashboard** on `:8090` (proxies `/chat`)

```bash
# 1) model_router — already used by Claude Code. Prefer systemd:
systemctl --user start model-router
# or: /home/eureka/sub2api-deploy/scripts/start_model_router.sh
# NEVER pkill / kill model_router or anything on port 8088 when debugging chat.

# 2) Backend venv (once)
python3 -m venv dashboard/chat/backend/.venv
dashboard/chat/backend/.venv/bin/pip install -r dashboard/chat/backend/requirements.txt

# 3) Config
cp dashboard/chat/.env.example dashboard/chat/.env
# edit CHAT_TOKEN=... (required; treat as shell-equivalent secret)

# 4) Frontend build (once / after UI changes)
cd dashboard/chat/frontend && npm install && npm run build && cd -

# 5) Chat service (loopback only)
scripts/start_chat_service.sh
# or: CHAT_TOKEN=your-secret scripts/start_chat_service.sh

# 6) Dashboard (separate terminal)
python dashboard/server.py
# open http://127.0.0.1:8090/  → header "Chat" link
# or   http://127.0.0.1:8090/chat/
```

### Do not kill model_router

Chat and Claude Code both depend on **port 8088**. When debugging chat failures:

- Do **not** `pkill` / `kill` `model_router`, `start_model_router`, or the process on **8088**
- Do **not** broad `pkill -f python` patterns that might hit the router
- If 8088 is down, start it with `systemctl --user start model-router` (or the safe start script). Restart only when the user explicitly asks, via that same path.

## Environment variables

| Variable | Default | Where | Description |
|----------|---------|-------|-------------|
| `CHAT_HOST` | `127.0.0.1` | chat-service | Bind address. Keep loopback. |
| `CHAT_PORT` | `8091` | chat-service | Listen port. |
| `CHAT_TOKEN` | `change-me` | chat-service | Shared secret for login cookie + `Authorization: Bearer`. **Required** in production. |
| `CHAT_DEFAULT_MODEL` | `grok-4.5` | chat-service | Default model id in `/api/models` and new sessions. |
| `CHAT_PERMISSION_MODE` | `bypassPermissions` | chat-service | Claude Agent SDK `PermissionMode` (full auto / no prompts). |
| `CHAT_ROOT_PATH` | `/chat` | chat-service | FastAPI `root_path` (public URL prefix). |
| `CHAT_MODEL_ROUTER_URL` | `http://127.0.0.1:8088` | chat-service | Used to list models (`GET /v1/models`). |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:8088` | chat-service + agent env | LLM gateway for Agent SDK. |
| `MODELS_CACHE_TTL_SEC` | `45.0` | chat-service | In-memory models cache TTL. |
| `CHAT_GROK2API_URL` | `http://127.0.0.1:8000` | chat-service | Upstream for Composer **Image** mode. |
| `CHAT_IMAGE_MODEL` | `grok-imagine-image-lite` | chat-service | OpenAI-images model id on grok2api. |
| `CHAT_GROK2API_API_KEY` | _(empty)_ | chat-service | Optional Bearer for grok2api. |
| `CHAT_IMAGE_TIMEOUT_SEC` | `120` | chat-service | Image generation HTTP timeout. |
| `CHAT_IMAGE_N` | `1` | chat-service | Default images per request (1–4). |
| `CHAT_UPSTREAM` | `http://127.0.0.1:8091` | dashboard | Proxy target for `/chat/*`. |
| `CHAT_PROXY_TIMEOUT` | `3600` | dashboard | Upstream timeout seconds (SSE-friendly). |
| `DASHBOARD_HOST` | `127.0.0.1` | dashboard | Set `0.0.0.0` for LAN UI access. |
| `DASHBOARD_PORT` | `8090` | dashboard | Dashboard listen port. |

Copy from example only (never commit real secrets):

```bash
cp dashboard/chat/.env.example dashboard/chat/.env
# dashboard/chat/.env is gitignored
```

## Auth

- Set a strong `CHAT_TOKEN` in `dashboard/chat/.env`.
- Login UI posts to `/chat/api/auth/login`; cookie is HttpOnly, Path=`/chat`.
- Protected APIs also accept `Authorization: Bearer <token>` (sessions, models, agent SSE, stop).
- SSE uses **fetch stream + Bearer**, not `EventSource` (cannot set Authorization headers).
- `/api/health` is intentionally unauthenticated for liveness checks.

## Security

**Treat `CHAT_TOKEN` as shell-equivalent access.** With default `CHAT_PERMISSION_MODE=bypassPermissions`, the agent can run tools (read/write files, shell, etc.) under the chat-service OS user without interactive approval. Anyone who has the token can drive that agent through the API.

Hardening checklist:

| Control | Recommendation |
|---------|----------------|
| Token | Long random secret; never commit `.env`; rotate if leaked |
| Chat bind | Keep `CHAT_HOST=127.0.0.1` — **do not** listen on `0.0.0.0:8091` |
| Dashboard LAN | If `DASHBOARD_HOST=0.0.0.0`, firewall 8090 to trusted hosts only |
| Permission mode | `bypassPermissions` is intentional for MVP; do not expose publicly |
| model_router | Leave 8088 on loopback; never kill it when debugging chat |
| MVP non-goals | No multi-user accounts, file tree UI, terminal UI, or git UI |

## LAN access

Dashboard default bind is loopback. To reach the UI from other machines on the LAN:

```bash
DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=8090 python dashboard/server.py
# then http://<lan-ip>:8090/chat/
```

Keep the chat-service on `127.0.0.1:8091` (not exposed). Only the dashboard should proxy it.

## Agent behavior (lock-ins)

1. **Permission mode:** `bypassPermissions` (SDK `PermissionMode`), not `acceptEdits`.
2. **Default model:** `grok-4.5` (selector still lists models from model_router).
3. **Proxy path rewrite:** strip `/chat` prefix toward 8091.
4. **Frontend base:** `base: '/chat/'`.
5. **Auth for SSE:** fetch stream + Bearer (not EventSource).
6. **Cwd:** absolute existing directory required; invalid cwd → 400.
7. **Stop:** `POST /api/sessions/{id}/stop` interrupts the active SDK client.

## Smoke checks

```bash
# Liveness
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/chat/
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/chat/api/health

# Auth required for models
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/chat/api/models   # expect 401
curl -sS -H "Authorization: Bearer $CHAT_TOKEN" http://127.0.0.1:8090/chat/api/models
# → default should be "grok-4.5"

# Chat service must not be on 0.0.0.0
ss -ltnp | grep 8091   # expect 127.0.0.1:8091 only
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| SPA 404 / blank | Rebuild frontend; proxy strip `/chat`; catch-all serves `index.html` |
| Models empty / 503 | model_router up on 8088; `CHAT_MODEL_ROUTER_URL` |
| Agent hang / no stream | Proxy timeout; do not buffer SSE; confirm 8088 healthy without killing it |
| 401 on API | `CHAT_TOKEN` mismatch; Bearer or login cookie Path=`/chat` |
| Invalid cwd | Must be absolute path to an existing directory |
| Chat offline page | Start `scripts/start_chat_service.sh` before using `/chat` |
