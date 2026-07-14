# 8090 Chat Nested Subagent Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully enable Claude Agent SDK subagents in `:8090/chat` with nested live cards under parent tools.

**Architecture:** Backend enables `agents` + `include_hook_events`, maps `parent_tool_use_id` and SubagentStart/Stop into nested SSE events, and persists `tool.subagent` on assistant messages. Frontend handles those events and renders `SubAgentCard` under parent `ToolCard`s.

**Tech Stack:** FastAPI chat-service, Claude Agent SDK (`AgentDefinition`, hooks), React/Vite frontend, existing ToolCard/MessageList patterns.

## Global Constraints

- Nested under parent tool only (no right panel in v1)
- Preserve existing main-agent `text_delta` / `tool_*` / `task_*` behavior
- Persist under `message.tools[].subagent`
- Default subagents: `explore`, `shell`, `review`, `general`
- Permission model remains `bypassPermissions` inheritance

---

### Task 1: Backend subagent mapping + options

**Files:**
- Modify: `dashboard/chat/backend/app/agent_bridge.py`
- Test: `dashboard/chat/backend/tests/test_sse_map.py`, `dashboard/chat/backend/tests/test_subagents.py`

- [ ] Add `DEFAULT_SUBAGENTS`, accumulator subagent state, map parented events + hooks
- [ ] Enable `agents` + `include_hook_events` in `build_options`
- [ ] Persist `subagent` onto parent tool cards in `assistant_message()`
- [ ] Unit tests for parented text/tools, start/stop hooks, fallback synthetic start

### Task 2: Frontend nested subagent UI

**Files:**
- Modify: `dashboard/chat/frontend/src/api.ts`
- Modify: `dashboard/chat/frontend/src/components/ChatView.tsx`
- Modify: `dashboard/chat/frontend/src/components/MessageList.tsx`
- Modify: `dashboard/chat/frontend/src/components/ToolCard.tsx`
- Create: `dashboard/chat/frontend/src/components/SubAgentCard.tsx`
- Modify: `dashboard/chat/frontend/src/index.css` or `App.css` as needed

- [ ] Extend `ToolCard` / stream types with `SubAgent`
- [ ] Handle `subagent_*` SSE events and nest under parent tools
- [ ] Render historical `tool.subagent`
- [ ] Build frontend

### Task 3: Verify + restart service

- [ ] Run backend unit tests
- [ ] Restart detached chat-service from `.env`
- [ ] Smoke `/chat/api/health` and auth models
