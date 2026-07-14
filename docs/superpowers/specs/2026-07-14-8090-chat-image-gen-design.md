# 8090 Chat · Composer Image Generation (design)

Date: 2026-07-14  
Status: draft (awaiting user review)  
Scope: add **Composer Image mode** to `:8090/chat`, backed by **grok2api** `grok-imagine-image-lite`.

## 1. Goal

Let users generate images from the existing Chat UI without switching models or opening a separate page.

- **UX:** Composer toggle `Chat | Image` (user choice **B**).
- **Backend:** fixed **`http://127.0.0.1:8000`** + model **`grok-imagine-image-lite`** (user choice **A**).
- **Display:** assistant message content is markdown `![image](cdn-url)` using the upstream URL as returned (user choice **B** — no local disk proxy in this iteration).
- **Architecture:** chat-service owns a new JSON API; dashboard continues to reverse-proxy `/chat/*` only (方案 1).

### Non-goals (this iteration)

- `grok-imagine-image` / pro / video / aspect-ratio controls  
- Local image storage or CDN reverse-proxy (`imagine_public_image_proxy`)  
- Agent SDK tools that call image gen  
- Putting lite into model_router or ModelSelect as a chat model  
- NSFW settings UI  

## 2. Architecture

```text
Browser  (:8090/chat)
  Composer  [Chat | Image]
       │
       │  Image mode → POST /chat/api/sessions/{id}/images  (JSON, not SSE)
       ▼
Dashboard proxy  (strip /chat)
       │
       ▼
Chat service  127.0.0.1:8091
  · auth: same CHAT_TOKEN as other /api/*
  · append user + assistant messages to session JSON
  · httpx → grok2api
       │
       ▼
grok2api  127.0.0.1:8000
  POST /v1/images/generations
  { "model": "grok-imagine-image-lite", "prompt": "...", "n": 1 }
       │
       ▼
{ "data": [ { "url": "https://assets.grok.com/..." } ] }
       │
       ▼
Session message (assistant):
  content = "![image](https://assets.grok.com/...)"
  optional meta: { "kind": "image", "model": "grok-imagine-image-lite", "urls": [...] }

MessageList → ReactMarkdown (existing) renders <img>
```

Chat mode is unchanged: still `POST /api/sessions/{id}/messages` → Agent SSE → model_router `:8088`.

## 3. Configuration

Extend `dashboard/chat/backend/app/config.py` + `.env.example`:

| Variable | Default | Meaning |
|----------|---------|---------|
| `CHAT_GROK2API_URL` | `http://127.0.0.1:8000` | Base URL of grok2api |
| `CHAT_IMAGE_MODEL` | `grok-imagine-image-lite` | OpenAI-images model id |
| `CHAT_GROK2API_API_KEY` | `""` | Optional `Authorization: Bearer` for grok2api |
| `CHAT_IMAGE_TIMEOUT_SEC` | `120` | Upstream HTTP timeout |
| `CHAT_IMAGE_N` | `1` | Images per request (clamp 1–4; start with 1 only in UI) |

No change to dashboard proxy env. No change to model_router.

## 4. Backend API

### 4.1 `POST /api/sessions/{session_id}/images`

Auth: same as other session APIs (`Bearer CHAT_TOKEN` / cookie).

**Request**

```json
{
  "prompt": "a red apple on white background, photo",
  "n": 1
}
```

Validation:

- `prompt` required, strip; min length 1; max length 2000  
- `n` optional, int, default `settings.chat_image_n`, clamp `[1, 4]`  
- Session must exist  
- If `session.status == "running"`, return **409** (do not interleave with agent turn)

**Success 200**

```json
{
  "user_message": {
    "id": "…",
    "role": "user",
    "content": "a red apple on white background, photo",
    "created_at": "…",
    "meta": { "kind": "image_prompt" }
  },
  "assistant_message": {
    "id": "…",
    "role": "assistant",
    "content": "![image](https://assets.grok.com/.../image.jpg)",
    "created_at": "…",
    "meta": {
      "kind": "image",
      "model": "grok-imagine-image-lite",
      "urls": ["https://assets.grok.com/.../image.jpg"]
    }
  },
  "session": { "id": "…", "updated_at": "…", "status": "idle", "title": "…" }
}
```

Both messages are **persisted** in the session file before the response returns (same store as chat turns).

**Errors**

| HTTP | When |
|------|------|
| 400 | empty prompt / bad `n` |
| 401 | auth |
| 404 | session missing |
| 409 | session `running` (agent turn in progress) |
| 502 | grok2api unreachable / non-JSON / no `data[].url` |
| 504 | upstream timeout |
| 429 | pass through if grok2api returns rate limit (body include detail string) |

Upstream error body: map to `detail` string for the UI toast; do not dump full upstream stack.

### 4.2 Implementation sketch (modules)

New module preferred: `dashboard/chat/backend/app/image_gen.py`

- `generate_image_for_session(session_id, prompt, n) -> dict`  
- Uses `httpx.AsyncClient` against  
  `{CHAT_GROK2API_URL}/v1/images/generations`  
- Payload:

```json
{
  "model": "<CHAT_IMAGE_MODEL>",
  "prompt": "<prompt>",
  "n": <n>
}
```

- On success extract all `data[i].url` (or `b64_json` only if url missing — **prefer url**; if only b64, this iteration returns 502 with clear detail “upstream returned no url” unless we later add local save).  
- Build markdown: one line per image, blank-line separated:

```markdown
![image](url1)

![image](url2)
```

- Reuse session helpers from `sessions.py` / `agent_bridge.py` for appending messages (`append_user_message` style). If append helpers today are agent-specific, add small shared helpers rather than forking session schema.

**Session status**

- Set `status` to a short-lived `"generating_image"` only if easy and race-safe; otherwise keep `idle` and rely on frontend disable during in-flight request. Prefer **frontend busy flag + 409 if agent running**; avoid new status enum if it complicates agent paths.  
- **Recommendation:** no new status value; check `status != "running"`; frontend disables composer while image request in flight.

**Title**

- If session title is still default `"New chat"`, set title from first ~40 chars of prompt (same spirit as agent first message).

### 4.3 Auth & router wiring

- Register router in `main.py` (same pattern as `agent_router`).  
- Dependency: existing auth dependency used by sessions/messages (mirror whatever `api_post_message` uses — cookie/Bearer).

### 4.4 Health (optional small)

Extend `/api/health` optionally with:

```json
{ "status": "ok", "service": "chat-agent", "image": { "upstream": "http://127.0.0.1:8000", "model": "grok-imagine-image-lite" } }
```

Config echo only — do not probe grok2api on every health check.

## 5. Frontend

### 5.1 Composer mode toggle

File: `frontend/src/components/Composer.tsx` (+ light CSS)

- Local state: `mode: 'chat' | 'image'` (default `'chat'`).  
- Toolbar left: segmented control or two small toggle buttons **Chat** / **Image** (icon: MessageSquare / ImageIcon — ImageIcon already imported).  
- When `mode === 'image'`:
  - Placeholder → e.g. `Describe an image to generate…`
  - Hide or disable Path / Upload / drag-drop attach (image gen is text prompt only this iteration). Clear attachments when switching into Image mode, or block switch while attachments present with a short hint.  
  - Send label → **Generate** (not Send).  
  - `canSend` = non-empty trimmed text only (ignore attachments).  
  - Hotkey hint → `Enter generate · Image mode`  
- When `mode === 'chat'`: current behavior unchanged.

Props: either

- `onSend` stays for chat; add `onGenerateImage?: (prompt: string) => void`, or  
- unify: `onSend({ text, attachments, mode })` and parent branches.

**Recommendation:** extend payload:

```ts
type SendPayload = {
  text: string
  attachments: PathAttachment[]
  mode?: 'chat' | 'image'
}
```

Parent (`ChatView`) branches on `mode`.

### 5.2 ChatView flow

File: `frontend/src/components/ChatView.tsx`

Image send path:

1. Ensure session exists (same as chat: create draft session if needed with current cwd/model — model field remains the **chat** model; image model is server-side fixed).  
2. Optimistically append user bubble (or wait for response — prefer **wait for server** for simpler consistency, show composer busy).  
3. `POST /api/sessions/{id}/images` with `{ prompt }`.  
4. On success: merge `user_message` + `assistant_message` into local messages (or reload session).  
5. On error: toast / inline error; do not leave orphan half-state.  
6. Do **not** open SSE agent stream.

Busy: reuse `streaming` UX lightly or separate `imageBusy` so Stop button is **not** shown for image (no interrupt API this iteration). Disable composer + show “Generating…” on submit button.

### 5.3 API client

File: `frontend/src/api.ts`

```ts
export async function generateSessionImage(
  sessionId: string,
  prompt: string,
  n = 1,
): Promise<ImageGenResponse>
```

Uses existing `apiFetch` + auth headers.

### 5.4 Rendering

- No MessageList change required if content is standard markdown image syntax; `ReactMarkdown` + `remark-gfm` already renders images.  
- Optional polish (same PR if tiny): markdown `img` CSS `max-width: 100%; border-radius; …`.  
- CDN 403 risk is accepted per product choice; document in UI? Optional muted footnote under first image failure only — skip unless easy.

### 5.5 ModelSelect

Unchanged. Image mode does not change selected agent model.

## 6. Data model

Session message objects gain optional `meta` (backward compatible; old messages omit it).

```json
{
  "id": "uuid",
  "role": "user" | "assistant",
  "content": "string",
  "created_at": "iso",
  "meta": {
    "kind": "image_prompt" | "image",
    "model": "grok-imagine-image-lite",
    "urls": ["…"]
  }
}
```

Frontend types: extend `Message` with optional `meta?: { kind?: string; model?: string; urls?: string[] }`.

## 7. Error handling & edge cases

| Case | Behavior |
|------|----------|
| grok2api down | 502 + toast “Image backend unreachable” |
| Rate limit | 429 + toast “Image rate limit — try later” |
| Empty prompt | client-side disable + 400 |
| Agent running | 409 + toast “Wait for the current agent turn” |
| Multiple tabs | last write wins on session file (existing pattern) |
| Draft session | create session first, then image POST |
| Prompt only whitespace | treat as empty |
| Upstream returns URL that 403s in browser | show broken image (accepted); future: local proxy |

No cancel/stop for in-flight image request in v1 (browser can navigate away; server still finishes and may write messages — acceptable). If request is aborted client-side, ignore late response if sessionId changed.

## 8. Security

- Endpoint requires same chat auth as messages.  
- Prompt is user-controlled text sent only to loopback grok2api — no shell.  
- Do not log full prompt at info level in production if avoidable; debug ok.  
- No SSRF: upstream URL is config-fixed, not user-supplied.  
- CDN URLs stored as returned; do not fetch them server-side in this iteration (avoids pulling binary into chat-service).

## 9. Testing

### Backend (pytest)

- `test_image_gen_requires_auth`  
- `test_image_gen_empty_prompt_400`  
- `test_image_gen_running_session_409`  
- `test_image_gen_success_persists_messages` (httpx mock grok2api → url)  
- `test_image_gen_upstream_error_502`  

### Manual

1. Start grok2api `:8000`, chat-service `:8091`, dashboard `:8090`.  
2. Open `/chat`, login, open/create session.  
3. Toggle **Image**, prompt “a yellow banana on white background”, Generate.  
4. See user + assistant bubbles; image renders or shows broken icon (CDN).  
5. Toggle back to **Chat**, send a normal message — agent path still works.  
6. During agent stream, Image mode should be disabled or return 409.  
7. Stop grok2api → Generate → clear error toast.

## 10. Files to touch

| Path | Change |
|------|--------|
| `dashboard/chat/backend/app/config.py` | image settings |
| `dashboard/chat/backend/app/image_gen.py` | **new** route + upstream client |
| `dashboard/chat/backend/app/main.py` | include router |
| `dashboard/chat/backend/app/sessions.py` or agent helpers | shared message append if needed |
| `dashboard/chat/backend/tests/test_image_gen.py` | **new** |
| `dashboard/chat/.env.example` | document env vars |
| `dashboard/chat/README.md` | short Image mode section |
| `dashboard/chat/frontend/src/api.ts` | `generateSessionImage` |
| `dashboard/chat/frontend/src/components/Composer.tsx` | mode toggle |
| `dashboard/chat/frontend/src/components/ChatView.tsx` | branch send path |
| `dashboard/chat/frontend/src/**/*.css` or component styles | toggle + img polish |

## 11. Rollout

1. Backend + tests  
2. Frontend + build `npm run build`  
3. Restart chat-service (`scripts/start_chat_service.sh`)  
4. Hard-refresh `/chat`  
5. Manual smoke on lite model  

No migration for old sessions.

## 12. Future (out of scope)

- Local save / proxy of CDN images (`b64_json` or download-to-`.chat-attachments`)  
- Pro model toggle  
- `n > 1` UI  
- Image-to-image edit  
- Agent tool `image_gen` for natural language in Chat mode  

## 13. Decisions log

| Decision | Choice |
|----------|--------|
| UX entry | Composer Chat \| Image toggle |
| Upstream | grok2api `:8000` + `grok-imagine-image-lite` only |
| Display | Upstream CDN markdown URL (no local proxy) |
| Transport | JSON POST (not SSE) |
| Agent path | Untouched |
| ModelSelect | Untouched |

## 14. Success criteria

1. From `/chat`, user can generate at least one image via Image mode without leaving the page.  
2. Messages persist across reload.  
3. Chat mode still works with Agent SSE.  
4. Failure modes show actionable errors (backend down / rate limit / busy).  
5. Automated tests cover happy path + 409/400/502 with mocked upstream.
