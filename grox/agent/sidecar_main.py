"""CLI entry for the Grox agent sidecar (dev + PyInstaller onedir)."""

from __future__ import annotations

import argparse
import sys

import uvicorn

from app.config import settings
from app.runtime_config import bootstrap_from_disk


def main() -> None:
    p = argparse.ArgumentParser(prog="agent-sidecar")
    p.add_argument("--host", default=settings.chat_host)
    p.add_argument("--port", type=int, default=settings.chat_port)
    args = p.parse_args()
    bootstrap_from_disk()

    # String import works in source/dev; frozen onedir needs the app object so
    # uvicorn does not re-import by module path from a broken sys.path.
    if getattr(sys, "frozen", False):
        from app.main import app

        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    else:
        uvicorn.run("app.main:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
