# 8090 Chat · Subagent Mode (design)

Date: 2026-07-14  
Status: draft (awaiting user review)  
Scope: complete **subagent mode** for `:8090/chat`, nested inside the main conversation.

## 1. Goal

Make the chat page fully support Claude Agent SDK subagents:

1. Main agent can delegate to predefined subagents via the Agent tool.
2. Subagent lifecycle streams live into the UI: start, text, tools, done/error.
3. Subagent UI is **nested under the parent tool card** in the main conversation (user choice **A**).
4. Refresh restores a nested historical summary from persisted session messages.
5. Existing single-agent chat / tool cards / tasks / image mode keep working.

### Non-goals (this iteration)

- Right-side subagent overview panel
- User-authored custom subagent editor
- Separate permission approval UI per subagent
- Switching the whole chat into a dedicated subagent session
- Multi-level deep nesting beyond parent tool → one subagent card

## 2. Architecture

```text
Browser  (:8090/chat)
  MessageList
    ToolCard (Agent / Task / etc.)
      └─ SubAgentCard (nested)
           text stream + ToolCards
       │
       │  POST /chat/api/sessions/{id}/messages  (SSE)
       ▼
Dashboard proxy  (strip /chat)
       │
       ▼
Chat service  127.0.0.1:8091
  agent_bridge.run_agent_turn()
    ClaudeAgentOptions(
      agents={...AgentDefinition},
      include_hook_events=True,
      include_partial_messages=True,
      permission_mode=bypassPermissions,
    )
       │
       ▼
Claude Agent SDK / CLI
  main thread + subagents (parent_tool_use_id)
  SubagentStart / SubagentStop hook events
```

### Event ownership

| Source | Meaning |
|--------|---------|
| `parent_tool_use_id is None` | Main agent stream (current behavior) |
| `parent_tool_use_id == <tool_use_id>` | Content belongs to the subagent spawned by that parent tool |
| `SubagentStart` hook | Subagent started; create/update nested card |
| `SubagentStop` hook | Subagent finished; mark done |

## 3. Backend design

### 3.1 Enable subagents in `build_options()`

Extend `dashboard/chat/backend/app/agent_bridge.py`:

```python
ClaudeAgentOptions(
    ...,
    include_partial_messages=True,
    include_hook_events=True,
    agents=DEFAULT_SUBAGENTS,
)
```

`DEFAULT_SUBAGENTS` is a fixed dict of `AgentDefinition` values. Initial set:

| Key | Purpose | Tools bias |
|-----|---------|------------|
| `explore` | Read-only codebase/file exploration | Read/search tools preferred; no write-heavy tools if SDK allows restriction |
| `shell` | Command execution / diagnostics | Bash-oriented |
| `review` | Code review / critique | Read + analysis |
| `general` | General-purpose delegation | Broad tool access |

Each definition uses:
- `description`: when the main agent should pick it
- `prompt`: focused system behavior
- `model`: `"inherit"` (follow session model) unless a definition needs a cheaper override later
- `permissionMode`: inherit main session / `bypassPermissions` for this app’s current security model

Config knobs (optional, later if needed):
- `CHAT_SUBAGENTS_ENABLED=true` kill switch
- Keep first version always-on once shipped, unless tests need a flag

### 3.2 SSE protocol additions

Keep existing events:
- `meta`, `text_delta`, `tool_start`, `tool_end`, `task_create`, `task_update`, `context_usage`, `error`, `done`

Add:

#### `subagent_start`
```json
{
  "id": "agent-abc123",
  "name": "explore",
  "agent_type": "explore",
  "parent_tool_use_id": "toolu_01...",
  "status": "running"
}
```

#### `subagent_text_delta`
```json
{
  "id": "agent-abc123",
  "text": "Searching for auth handlers..."
}
```

#### `subagent_tool_start`
```json
{
  "id": "agent-abc123",
  "tool": {
    "id": "toolu_02...",
    "name": "Read",
    "input_summary": "src/auth.py"
  }
}
```

#### `subagent_tool_end`
```json
{
  "id": "agent-abc123",
  "tool": {
    "id": "toolu_02...",
    "name": "Read",
    "output_summary": "...",
    "ok": true
  }
}
```

#### `subagent_done`
```json
{
  "id": "agent-abc123",
  "status": "done",
  "summary": "optional short summary"
}
```

Error path:
- If subagent fails, emit `subagent_done` with `status: "error"` and keep parent tool `ok` based on the parent tool result as today.

### 3.3 Mapping rules in `map_sdk_message()`

1. **Hook events** (`SystemMessage` / `HookEventMessage` when present):
   - `SubagentStart` → `subagent_start`
   - `SubagentStop` → `subagent_done`
2. **Parented stream/messages**:
   - `StreamEvent` / `AssistantMessage` / `UserMessage` with `parent_tool_use_id`:
     - text → `subagent_text_delta`
     - tool use → `subagent_tool_start`
     - tool result → `subagent_tool_end`
3. **Unparented events**:
   - keep current main-agent mapping unchanged
4. **Fallback if hooks missing**:
   - still create a synthetic subagent on first parented event for a `parent_tool_use_id`
   - `id` may be derived as `parent_tool_use_id` until a real agent id appears
   - when a later `subagent_start` arrives with the same parent, merge/replace ids carefully

### 3.4 Persistence

Extend tool cards stored on assistant messages:

```json
{
  "id": "toolu_01...",
  "name": "Agent",
  "input_summary": "explore: find auth middleware",
  "output_summary": "...",
  "ok": true,
  "subagent": {
    "id": "agent-abc123",
    "name": "explore",
    "status": "done",
    "text": "final or accumulated text",
    "tools": [
      {
        "id": "toolu_02...",
        "name": "Read",
        "input_summary": "src/auth.py",
        "output_summary": "...",
        "ok": true
      }
    ]
  }
}
```

Rules:
- While streaming, accumulate subagent state in `TurnAccumulator` keyed by subagent id and parent tool id.
- On finalize, attach `subagent` onto the matching parent tool card when present.
- Historical UI reads `message.tools[].subagent` and renders nested cards without needing live SSE.

Do **not** invent a separate top-level `session.subagents` store in v1; nesting under tools is enough for reload and matches the chosen UX.

## 4. Frontend design

### 4.1 Types (`api.ts`)

```ts
export type SubAgentStatus = 'running' | 'done' | 'error' | string

export type SubAgent = {
  id: string
  name: string
  agent_type?: string
  parent_tool_use_id?: string
  status: SubAgentStatus
  text?: string
  tools?: ToolCard[]
  summary?: string
}

export type ToolCard = {
  id: string
  name: string
  input_summary?: string
  output_summary?: string
  ok?: boolean
  subagent?: SubAgent
}
```

### 4.2 Stream state

Extend live streaming state:

```ts
type StreamState = {
  text: string
  tools: ToolCard[]
  active: boolean
  subagents?: Record<string, SubAgent>
} | null
```

`ChatView` handlers:
- `subagent_start` → upsert subagent; attach to parent tool if known
- `subagent_text_delta` → append text
- `subagent_tool_start/end` → update nested tools
- `subagent_done` → set status/summary

When parent tool card already exists, nest `tool.subagent = subagent`.
If parent tool arrives later, backfill attachment by `parent_tool_use_id`.

### 4.3 Components

#### `SubAgentCard`
- Header: agent name/type, status chip (`running`/`done`/`error`), chevron
- Body:
  - streamed markdown/text (reuse existing bubble/markdown styling where practical)
  - nested `ToolCardView` list
- Default open while `running`; collapsed after `done` unless user expanded manually

#### `ToolCards` / `ToolCardView`
- If `tool.subagent` exists, render `SubAgentCard` under the parent tool
- Keep current dense tool trail behavior for non-subagent tools

No new design system dependency: continue with existing shadcn/base-ui/lucide/motion stack.

### 4.4 History reload

`getSession()` already returns messages with tools. On load:
- if `tool.subagent` present, render nested card
- no extra API call needed

## 5. Testing plan

### Backend unit tests
- parented `StreamEvent` text → `subagent_text_delta`
- parented tool use/result → `subagent_tool_start/end`
- `SubagentStart` / `SubagentStop` → start/done
- synthetic start fallback when parented content arrives before hook
- finalize attaches `subagent` onto parent tool card
- unparented events remain main-agent events

### Frontend
- stream handler attaches nested subagent under parent tool
- reload path renders historical `tool.subagent`
- non-subagent chats unchanged

### Manual verification
1. Start chat-service with updated code
2. Ask main agent to explore a repo path with delegation
3. Confirm nested card appears under Agent tool, streams text/tools, ends as done
4. Refresh page and confirm nested summary remains
5. Confirm ordinary non-delegating chat still works

## 6. Implementation order

1. Backend mapping + options + unit tests
2. Persistence shape on tool cards
3. Frontend types + ChatView event handling
4. `SubAgentCard` + ToolCard nesting
5. Build frontend + restart chat-service
6. Manual end-to-end check

## 7. Risks / mitigations

| Risk | Mitigation |
|------|------------|
| Hook events unavailable / shape differs by CLI version | Fallback synthetic subagent from `parent_tool_use_id` |
| Parent tool id arrives after child events | Buffer by parent id; attach when parent tool_start arrives |
| Too much UI noise | Collapse completed subagents; keep running expanded |
| Permission model too open | Keep current app model (`bypassPermissions`); document that subagents inherit it |
| SDK agent names differ from tool display | Prefer hook `agent_type` / definition key; show tool input summary as subtitle |

## 8. Success criteria

- Main agent can spawn at least one predefined subagent in a real chat turn
- UI shows nested live subagent activity under the parent tool
- Subagent tools/text are visible during the turn
- Refresh preserves nested subagent summary
- Existing chat/tool/task/image flows still pass tests and manual smoke checks
