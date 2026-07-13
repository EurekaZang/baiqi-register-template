# 8090 Chat Agent

ChatGPT-like UI at **`http://<host>:8090/chat`**, reverse-proxied by the Grok Pipeline Dashboard to a loopback FastAPI service on **`127.0.0.1:8091`**.

## Architecture

| Layer | Bind | Public path |
|-------|------|-------------|
| Dashboard (`dashboard/server.py`) | `DASHBOARD_HOST:8090` (default `127.0.0.1`) | `/`, `/api/*`, **`/chat/*` (proxy)** |
| Chat service (uvicorn) | `127.0.0.1:8091` only | `/`, `/api/*`, `/assets/*` |

The dashboard proxy **strips** the `/chat` prefix when forwarding:

- `/chat/api/sessions` → `http://127.0.0.1:8091/api/sessions`
- `/chat/` → `http://127.0.0.1:8091/`
- `/chat/assets/x` → `http://127.0.0.1:8091/assets/x`

`Authorization` and `Cookie` are preserved. SSE agent streams are proxied without response buffering (long timeout, default 3600s).

FastAPI `root_path=/chat` is only for OpenAPI/public URL generation; routes themselves do **not** include `/chat`.

## Quick start

```bash
# 1) Backend venv (once)
python3 -m venv dashboard/chat/backend/.venv
dashboard/chat/backend/.venv/bin/pip install -r dashboard/chat/backend/requirements.txt

# 2) Config
cp dashboard/chat/.env.example dashboard/chat/.env
# edit CHAT_TOKEN=... (required)

# 3) Frontend build (once / after UI changes)
cd dashboard/chat/frontend && npm install && npm run build && cd -

# 4) Chat service (loopback)
CHAT_TOKEN=your-secret scripts/start_chat_service.sh
# or relies on dashboard/chat/.env

# 5) Dashboard (separate terminal)
python dashboard/server.py
# open http://127.0.0.1:8090/  → header "Chat" link
# or   http://127.0.0.1:8090/chat/
```

Model traffic goes to **model_router** (`ANTHROPIC_BASE_URL`, default `http://127.0.0.1:8088`). Do not kill that process; Claude Code / this chat both depend on it.

## LAN access

Dashboard default bind is loopback. To reach the UI from other machines on the LAN:

```bash
DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=8090 python dashboard/server.py
# then http://<lan-ip>:8090/chat/
```

Keep the chat-service on `127.0.0.1:8091` (not exposed). Override only via env if needed:

- `CHAT_UPSTREAM` — dashboard proxy target (default `http://127.0.0.1:8091`)
- `CHAT_PROXY_TIMEOUT` — seconds (default `3600`)

## Auth

- Set a strong `CHAT_TOKEN` in `dashboard/chat/.env`.
- Login UI posts to `/chat/api/auth/login`; cookie is HttpOnly, Path=`/chat`.
- API also accepts `Authorization: Bearer <token>`.

## Security notes

- Chat agent runs with Claude Agent SDK permission mode (default `bypassPermissions` / full auto). Treat the token like a root password for the host.
- Do not expose `:8091` publicly; only the dashboard should proxy it.
- Prefer LAN firewall rules when binding dashboard to `0.0.0.0`.

## Smoke checks

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/chat/
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/health
curl -sS -H "Authorization: Bearer $CHAT_TOKEN" http://127.0.0.1:8090/chat/api/health
```
