"""Unit tests: SDK message types → SSE event mapping (no live CLI)."""

from __future__ import annotations

import json

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from app.agent_bridge import (
    EMPTY_FINAL_PLACEHOLDER,
    TurnAccumulator,
    build_options,
    map_exception,
    map_sdk_message,
    normalize_context_usage,
)
from app.sse import format_sse, sse_dict


def test_format_sse_encodes_json_data():
    evt = format_sse("text_delta", {"text": "hi"})
    assert evt.event == "text_delta"
    assert json.loads(evt.data) == {"text": "hi"}
    encoded = evt.encode().decode("utf-8")
    assert "event: text_delta" in encoded
    assert 'data: {"text": "hi"}' in encoded or 'data: {"text":"hi"}' in encoded


def test_sse_dict_helper():
    d = sse_dict("meta", {"session_id": "abc", "model": "grok-4.5"})
    assert d["event"] == "meta"
    assert json.loads(d["data"])["model"] == "grok-4.5"


def test_map_assistant_text_block():
    msg = AssistantMessage(content=[TextBlock(text="Hello")], model="grok-4.5")
    acc = TurnAccumulator()
    events = map_sdk_message(msg, acc)
    assert len(events) == 1
    assert events[0]["event"] == "text_delta"
    assert events[0]["data"] == {"text": "Hello"}
    assert acc.content_text() == "Hello"


def test_map_stream_event_text_delta():
    acc = TurnAccumulator()
    partial = StreamEvent(
        uuid="u1",
        session_id="sdk-s1",
        event={
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "Hel"},
        },
    )
    events = map_sdk_message(partial, acc)
    assert events == [{"event": "text_delta", "data": {"text": "Hel"}}]
    assert acc.content_text() == "Hel"
    assert acc.streamed_via_partial is True
    assert acc.sdk_session_id == "sdk-s1"

    # Thinking / non-text deltas must not pollute assistant content.
    thinking = StreamEvent(
        uuid="u2",
        session_id="sdk-s1",
        event={
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "thinking_delta", "thinking": "hmm"},
        },
    )
    assert map_sdk_message(thinking, acc) == []
    assert acc.content_text() == "Hel"


def test_final_assistant_text_skipped_after_partial_stream():
    acc = TurnAccumulator()
    map_sdk_message(
        StreamEvent(
            uuid="u1",
            session_id="sdk-s1",
            event={
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hi"},
            },
        ),
        acc,
    )
    map_sdk_message(
        StreamEvent(
            uuid="u2",
            session_id="sdk-s1",
            event={
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "!"},
            },
        ),
        acc,
    )
    # Final AssistantMessage repeats full text; must not double-emit or double-store.
    final = AssistantMessage(content=[TextBlock(text="Hi!")], model="grok-4.5")
    events = map_sdk_message(final, acc)
    assert events == []
    assert acc.content_text() == "Hi!"
    # Flag resets so a later assistant message (after tools) can still stream.
    assert acc.streamed_via_partial is False


def test_empty_final_placeholder_is_suppressed_across_stream_chunks():
    acc = TurnAccumulator()
    midpoint = len(EMPTY_FINAL_PLACEHOLDER) // 2
    chunks = [
        EMPTY_FINAL_PLACEHOLDER[:midpoint],
        EMPTY_FINAL_PLACEHOLDER[midpoint:],
    ]
    events = []
    for index, chunk in enumerate(chunks):
        events.extend(
            map_sdk_message(
                StreamEvent(
                    uuid=f"u{index}",
                    session_id="sdk-empty",
                    event={
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": chunk},
                    },
                ),
                acc,
            )
        )
    final = AssistantMessage(
        content=[TextBlock(text=EMPTY_FINAL_PLACEHOLDER)],
        model="grok-4.5",
    )
    events.extend(map_sdk_message(final, acc))

    assert events == []
    assert acc.content_text() == ""
    assert acc.needs_empty_final_recovery is True


def test_build_options_enables_partial_messages():
    opts = build_options(
        {
            "cwd": "/tmp",
            "model": "grok-4.5",
            "sdk_session_id": None,
        }
    )
    assert opts.include_partial_messages is True


def test_normalize_context_usage_from_sdk_shape():
    raw = {
        "categories": [
            {"name": "System prompt", "tokens": 1200, "color": "#0ea5e9"},
            {"name": "Messages", "tokens": 3400, "color": "#22c55e"},
        ],
        "totalTokens": 4600,
        "maxTokens": 200000,
        "rawMaxTokens": 200000,
        "percentage": 2.3,
        "model": "grok-4.5",
        "isAutoCompactEnabled": True,
        "autoCompactThreshold": 180000,
    }
    out = normalize_context_usage(raw)
    assert out is not None
    assert out["total_tokens"] == 4600
    assert out["max_tokens"] == 200000
    assert out["percentage"] == 2.3
    assert out["model"] == "grok-4.5"
    assert out["auto_compact"] is True
    assert out["auto_compact_threshold"] == 180000
    assert len(out["categories"]) == 2
    assert out["categories"][0]["name"] == "System prompt"
    assert "updated_at" in out


def test_normalize_context_usage_rejects_invalid():
    assert normalize_context_usage(None) is None
    assert normalize_context_usage({"totalTokens": 1}) is None
    assert normalize_context_usage({"totalTokens": 1, "maxTokens": 0}) is None


def test_map_assistant_multiple_text_blocks():
    msg = AssistantMessage(
        content=[TextBlock(text="A"), TextBlock(text="B")],
        model="grok-4.5",
    )
    acc = TurnAccumulator()
    events = map_sdk_message(msg, acc)
    assert [e["event"] for e in events] == ["text_delta", "text_delta"]
    assert acc.content_text() == "AB"


def test_map_assistant_tool_use_block():
    msg = AssistantMessage(
        content=[
            ToolUseBlock(
                id="toolu_1",
                name="Bash",
                input={"command": "echo hi"},
            )
        ],
        model="grok-4.5",
    )
    acc = TurnAccumulator()
    events = map_sdk_message(msg, acc)
    assert len(events) == 1
    assert events[0]["event"] == "tool_start"
    assert events[0]["data"]["id"] == "toolu_1"
    assert events[0]["data"]["name"] == "Bash"
    assert "echo hi" in events[0]["data"]["input_summary"]
    assert len(acc.tools) == 1
    assert acc.tools[0]["name"] == "Bash"


def test_map_user_tool_result_block():
    acc = TurnAccumulator()
    # Pretend tool was started earlier
    acc.start_tool("toolu_1", "Bash", {"command": "ls"})

    msg = UserMessage(
        content=[
            ToolResultBlock(
                tool_use_id="toolu_1",
                content="file.txt\n",
                is_error=False,
            )
        ]
    )
    events = map_sdk_message(msg, acc)
    assert len(events) == 1
    assert events[0]["event"] == "tool_end"
    assert events[0]["data"]["id"] == "toolu_1"
    assert events[0]["data"]["name"] == "Bash"
    assert events[0]["data"]["ok"] is True
    assert "file.txt" in events[0]["data"]["output_summary"]
    assert acc.tools[0]["ok"] is True
    assert "file.txt" in acc.tools[0]["output_summary"]


def test_map_user_tool_result_error():
    acc = TurnAccumulator()
    acc.start_tool("toolu_err", "Bash", {"command": "false"})
    msg = UserMessage(
        content=[
            ToolResultBlock(
                tool_use_id="toolu_err",
                content="exit 1",
                is_error=True,
            )
        ]
    )
    events = map_sdk_message(msg, acc)
    assert events[0]["event"] == "tool_end"
    assert events[0]["data"]["ok"] is False
    assert acc.tools[0]["ok"] is False


def test_map_result_message_done():
    msg = ResultMessage(
        subtype="success",
        duration_ms=10,
        duration_api_ms=5,
        is_error=False,
        num_turns=1,
        session_id="sdk-sess-123",
        total_cost_usd=0.01,
        usage={"input_tokens": 3, "output_tokens": 4},
    )
    acc = TurnAccumulator()
    events = map_sdk_message(msg, acc)
    assert len(events) == 1
    assert events[0]["event"] == "done"
    assert events[0]["data"]["sdk_session_id"] == "sdk-sess-123"
    assert events[0]["data"]["total_cost_usd"] == 0.01
    assert events[0]["data"]["usage"]["input_tokens"] == 3
    assert acc.sdk_session_id == "sdk-sess-123"


def test_map_result_message_error_also_emits_error():
    msg = ResultMessage(
        subtype="error",
        duration_ms=1,
        duration_api_ms=1,
        is_error=True,
        num_turns=1,
        session_id="sdk-err",
        errors=["boom"],
    )
    events = map_sdk_message(msg)
    kinds = [e["event"] for e in events]
    assert "error" in kinds
    assert "done" in kinds
    err = next(e for e in events if e["event"] == "error")
    assert "boom" in err["data"]["message"]


def test_map_exception():
    evt = map_exception(RuntimeError("CLI exploded"))
    assert evt["event"] == "error"
    assert evt["data"]["message"] == "CLI exploded"


def test_map_mixed_assistant_text_and_tool():
    msg = AssistantMessage(
        content=[
            TextBlock(text="I'll run a command."),
            ToolUseBlock(id="t1", name="Bash", input={"command": "pwd"}),
        ],
        model="grok-4.5",
    )
    events = map_sdk_message(msg)
    assert [e["event"] for e in events] == ["text_delta", "tool_start"]
