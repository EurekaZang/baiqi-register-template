from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, TypeVar

from .result import Result

T = TypeVar("T")


@dataclass
class Context:
    channel: str
    task_id: int
    run_id: str
    settings: dict[str, Any]
    email: Any
    captcha: Any
    proxy: Any
    http: Any
    logger: logging.Logger

    def step(self, message: str, **data: Any) -> None:
        extra = " ".join(f"{key}={value}" for key, value in data.items())
        self.logger.info("[%s/%s] %s %s", self.channel, self.task_id, message, extra)

    def run_step(self, name: str, fn: Callable[[], T]) -> T:
        started = time.perf_counter()
        self.step(f"{name}: start")
        try:
            value = fn()
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            self.step(f"{name}: ok", elapsed_ms=elapsed_ms)
            return value
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            self.step(f"{name}: failed", elapsed_ms=elapsed_ms, error=exc)
            raise

    def success(
        self,
        *,
        email: str,
        password: str = "",
        status: str = "success",
        reason: str = "",
        account: dict[str, Any] | None = None,
        artifacts: dict[str, Any] | None = None,
        debug: dict[str, Any] | None = None,
    ) -> Result:
        return Result(
            ok=True,
            status=status,
            email=email,
            password=password,
            reason=reason,
            account=account or {},
            artifacts=artifacts or {},
            debug=debug or {},
        )

    def fail(
        self,
        *,
        status: str = "failed",
        reason: str,
        account: dict[str, Any] | None = None,
        artifacts: dict[str, Any] | None = None,
        debug: dict[str, Any] | None = None,
    ) -> Result:
        return Result(
            ok=False,
            status=status,
            reason=reason,
            account=account or {},
            artifacts=artifacts or {},
            debug=debug or {},
        )
