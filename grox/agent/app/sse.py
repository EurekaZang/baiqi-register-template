"""SSE helpers for chat agent streaming."""

from __future__ import annotations

import json
from typing import Any

from sse_starlette.sse import ServerSentEvent


def format_sse(event: str, data: dict[str, Any] | None = None) -> ServerSentEvent:
    """Build a ServerSentEvent with JSON-encoded data payload."""
    payload = "" if data is None else json.dumps(data, ensure_ascii=False, default=str)
    return ServerSentEvent(event=event, data=payload)


def sse_dict(event: str, data: dict[str, Any] | None = None) -> dict[str, str]:
    """
    Dict form accepted by EventSourceResponse content iterables.

    Useful for tests and when callers prefer plain dicts over ServerSentEvent.
    """
    return {
        "event": event,
        "data": "" if data is None else json.dumps(data, ensure_ascii=False, default=str),
    }
