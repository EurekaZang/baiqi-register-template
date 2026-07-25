"""Unit tests for nested subagent SSE mapping and options."""

from __future__ import annotations

from claude_agent_sdk import (
    AssistantMessage,
    HookEventMessage,
    StreamEvent,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from app.agent_bridge import TurnAccumulator, build_options, map_sdk_message
from app.config import settings


def test_build_options_enables_subagents_and_hooks():
    opts = build_options(
        {
            "cwd": "/tmp",
            "model": "grok-4.5",
            "sdk_session_id": None,
        }
    )
    assert opts.include_partial_messages is True
    assert opts.include_hook_events is True
    assert opts.skills == "all"
    assert opts.setting_sources == ["user", "project", "local"]
    assert opts.agents is not None
    assert "explore" in opts.agents
    assert "shell" in opts.agents
    assert "review" in opts.agents
    assert "general" in opts.agents


def test_build_options_supports_skill_allowlist_and_disable(monkeypatch):
    session = {"cwd": "/tmp", "model": "grok-4.5", "sdk_session_id": None}

    monkeypatch.setattr(settings, "chat_skills", "review, frontend-design")
    assert build_options(session).skills == ["review", "frontend-design"]

    monkeypatch.setattr(settings, "chat_skills", "off")
    assert build_options(session).skills == []


def test_subagent_start_and_done_hooks():
    acc = TurnAccumulator()
    start = HookEventMessage(
        subtype="hook_response",
        hook_event_name="SubagentStart",
        data={
            "hook_event": "SubagentStart",
            "agent_id": "agent-1",
            "agent_type": "explore",
            "parent_tool_use_id": "toolu_parent",
        },
    )
    events = map_sdk_message(start, acc)
    assert events[0]["event"] == "subagent_start"
    assert events[0]["data"]["id"] == "agent-1"
    assert events[0]["data"]["parent_tool_use_id"] == "toolu_parent"
    assert acc.subagents_by_id["agent-1"]["status"] == "running"

    # Parent tool later attaches the nested snapshot.
    acc.start_tool("toolu_parent", "Agent", {"description": "explore auth"})
    assert acc.tools_by_id["toolu_parent"]["subagent"]["id"] == "agent-1"

    stop = HookEventMessage(
        subtype="hook_response",
        hook_event_name="SubagentStop",
        data={
            "hook_event": "SubagentStop",
            "agent_id": "agent-1",
            "agent_type": "explore",
            "parent_tool_use_id": "toolu_parent",
            "summary": "found middleware",
        },
    )
    events2 = map_sdk_message(stop, acc)
    assert events2[0]["event"] == "subagent_done"
    assert events2[0]["data"]["status"] == "done"
    assert acc.subagents_by_id["agent-1"]["status"] == "done"
    msg = acc.assistant_message()
    parent = next(t for t in msg["tools"] if t["id"] == "toolu_parent")
    assert parent["subagent"]["id"] == "agent-1"
    assert parent["subagent"]["status"] == "done"


def test_parented_stream_text_maps_to_subagent_delta():
    acc = TurnAccumulator()
    acc.start_tool("toolu_parent", "Agent", {"subagent_type": "explore"})
    partial = StreamEvent(
        uuid="u1",
        session_id="sdk-s1",
        parent_tool_use_id="toolu_parent",
        event={
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "Looking"},
        },
    )
    events = map_sdk_message(partial, acc)
    assert events[0]["event"] == "subagent_text_delta"
    assert events[0]["data"]["text"] == "Looking"
    assert events[0]["data"]["parent_tool_use_id"] == "toolu_parent"
    # Main content must remain empty for parented stream.
    assert acc.content_text() == ""
    nested = acc.tools_by_id["toolu_parent"]["subagent"]
    assert "Looking" in nested["text"]


def test_parented_tool_use_and_result():
    acc = TurnAccumulator()
    acc.start_tool("toolu_parent", "Agent", {"description": "explore"})
    use = AssistantMessage(
        content=[
            ToolUseBlock(
                id="toolu_child",
                name="Read",
                input={"path": "src/auth.py"},
            )
        ],
        model="grok-4.5",
        parent_tool_use_id="toolu_parent",
    )
    events = map_sdk_message(use, acc)
    assert events[0]["event"] == "subagent_tool_start"
    assert events[0]["data"]["tool"]["id"] == "toolu_child"
    assert events[0]["data"]["tool"]["name"] == "Read"

    result = UserMessage(
        content=[
            ToolResultBlock(
                tool_use_id="toolu_child",
                content="def login(): ...",
                is_error=False,
            )
        ],
        parent_tool_use_id="toolu_parent",
    )
    events2 = map_sdk_message(result, acc)
    assert events2[0]["event"] == "subagent_tool_end"
    assert events2[0]["data"]["tool"]["ok"] is True
    nested = acc.tools_by_id["toolu_parent"]["subagent"]
    assert any(t["id"] == "toolu_child" for t in nested["tools"])


def test_parented_final_text_skipped_after_partial():
    acc = TurnAccumulator()
    acc.start_tool("toolu_parent", "Agent", {})
    map_sdk_message(
        StreamEvent(
            uuid="u1",
            session_id="s",
            parent_tool_use_id="toolu_parent",
            event={
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hi"},
            },
        ),
        acc,
    )
    final = AssistantMessage(
        content=[TextBlock(text="Hi")],
        model="grok-4.5",
        parent_tool_use_id="toolu_parent",
    )
    events = map_sdk_message(final, acc)
    assert events == []
    nested = acc.tools_by_id["toolu_parent"]["subagent"]
    assert nested["text"] == "Hi"


def test_unparented_events_still_main_agent():
    acc = TurnAccumulator()
    msg = AssistantMessage(content=[TextBlock(text="hello")], model="grok-4.5")
    events = map_sdk_message(msg, acc)
    assert events[0]["event"] == "text_delta"
    assert acc.content_text() == "hello"
