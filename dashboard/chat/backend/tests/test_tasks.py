"""Unit tests for TaskCreate/TaskUpdate mapping and persistence helpers."""

from __future__ import annotations

from claude_agent_sdk import AssistantMessage, ToolUseBlock, UserMessage, ToolResultBlock

from app.agent_bridge import TurnAccumulator, map_sdk_message
from app.tasks import (
    apply_task_create,
    apply_task_update,
    parse_task_id_from_result,
    provisional_create_from_tool_start,
)


def test_parse_task_id_from_result_variants():
    assert parse_task_id_from_result({"id": 3}) == "3"
    assert parse_task_id_from_result({"taskId": "12"}) == "12"
    assert parse_task_id_from_result("Created task id: 7") == "7"
    assert parse_task_id_from_result("Task #4 completed") == "4"


def test_provisional_create_and_finalize():
    session: dict = {"tasks": []}
    provisional_create_from_tool_start(
        session,
        tool_use_id="toolu_a",
        payload={
            "subject": "Scaffold backend",
            "description": "Create health endpoint",
            "activeForm": "Scaffolding backend",
        },
    )
    assert len(session["tasks"]) == 1
    assert session["tasks"][0]["id"].startswith("tmp:")
    assert session["tasks"][0]["status"] == "pending"

    task = apply_task_create(
        session,
        tool_use_id="toolu_a",
        payload={
            "subject": "Scaffold backend",
            "description": "Create health endpoint",
            "activeForm": "Scaffolding backend",
        },
        result_task_id="1",
    )
    assert task["id"] == "1"
    assert session["tasks"][0]["id"] == "1"
    assert session["tasks"][0]["subject"] == "Scaffold backend"


def test_apply_task_update_status_and_soft_delete():
    session = {
        "tasks": [
            {
                "id": "1",
                "subject": "Do thing",
                "status": "pending",
                "created_at": "t0",
                "updated_at": "t0",
            }
        ]
    }
    updated = apply_task_update(
        session,
        tool_use_id="toolu_b",
        payload={"taskId": "1", "status": "in_progress", "activeForm": "Doing thing"},
    )
    assert updated is not None
    assert updated["status"] == "in_progress"
    assert updated["activeForm"] == "Doing thing"

    deleted = apply_task_update(
        session,
        tool_use_id="toolu_c",
        payload={"taskId": "1", "status": "deleted"},
    )
    assert deleted is not None
    assert deleted["status"] == "deleted"


def test_map_sdk_task_create_and_update_events():
    session: dict = {"tasks": []}
    acc = TurnAccumulator()

    create_msg = AssistantMessage(
        content=[
            ToolUseBlock(
                id="toolu_1",
                name="TaskCreate",
                input={
                    "subject": "Build UI",
                    "description": "shadcn task panel",
                    "activeForm": "Building UI",
                },
            )
        ],
        model="grok-4.5",
    )
    events = map_sdk_message(create_msg, acc, session=session)
    assert any(e["event"] == "tool_start" for e in events)
    create_events = [e for e in events if e["event"] == "task_create"]
    assert len(create_events) == 1
    assert create_events[0]["data"]["provisional"] is True
    assert create_events[0]["data"]["task"]["subject"] == "Build UI"

    # tool result finalizes id
    result_msg = UserMessage(
        content=[
            ToolResultBlock(
                tool_use_id="toolu_1",
                content='{"id":"1","ok":true}',
                is_error=False,
            )
        ]
    )
    events2 = map_sdk_message(result_msg, acc, session=session)
    assert any(e["event"] == "tool_end" for e in events2)
    final_creates = [e for e in events2 if e["event"] == "task_create"]
    assert final_creates
    assert final_creates[-1]["data"]["task"]["id"] == "1"
    assert final_creates[-1]["data"]["provisional"] is False

    update_msg = AssistantMessage(
        content=[
            ToolUseBlock(
                id="toolu_2",
                name="TaskUpdate",
                input={"taskId": "1", "status": "completed"},
            )
        ],
        model="grok-4.5",
    )
    events3 = map_sdk_message(update_msg, acc, session=session)
    updates = [e for e in events3 if e["event"] == "task_update"]
    assert updates
    assert updates[0]["data"]["task"]["status"] == "completed"
    assert session["tasks"][0]["status"] == "completed"
