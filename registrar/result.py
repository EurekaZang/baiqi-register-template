from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Result:
    ok: bool
    status: str
    email: str = ""
    password: str = ""
    reason: str = ""
    account: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, Any] = field(default_factory=dict)
    debug: dict[str, Any] = field(default_factory=dict)

    def to_record(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "status": self.status,
            "email": self.email,
            "password": self.password,
            "reason": self.reason,
            "account": self.account,
            "artifacts": self.artifacts,
            "debug": self.debug,
        }

