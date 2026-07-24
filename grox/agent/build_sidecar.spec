# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller onedir spec for Grox agent-sidecar.

Build (from grox/agent, with venv active or .venv/bin/pyinstaller):

    pyinstaller build_sidecar.spec

Output: dist/agent-sidecar/agent-sidecar[.exe]

Notes
-----
- Prefer onedir over onefile for native deps (uvicorn loops, claude binary).
- claude_agent_sdk ships a large `_bundled/claude` CLI binary; we collect it
  via collect_all. If Analysis/build fails on a host without that package, or
  the binary is platform-mismatched (e.g. Linux build for Windows), keep this
  best-effort datas list and re-run on the ship target (Windows).
- Health-only smoke does not need the Claude binary to start FastAPI; agent
  turns will fail without it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None
SPECDIR = Path(SPECPATH).resolve()

# --- optional package data / binaries -----------------------------------------
datas: list = []
binaries: list = []
hiddenimports: list[str] = [
    # uvicorn runtime plugins (dynamic imports)
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    # app + stack
    "app",
    "app.main",
    "app.config",
    "app.runtime_config",
    "app.auth",
    "app.sessions",
    "app.models_api",
    "app.agent_bridge",
    "app.attachments",
    "app.sse",
    "app.tasks",
    "app.image_gen",
    "claude_agent_sdk",
    "sse_starlette",
    "sse_starlette.sse",
    "httpx",
    "anyio",
    "anyio._backends._asyncio",
    "pydantic_settings",
    "multipart",
    "email_validator",
]

# Collect claude_agent_sdk package data (includes _bundled/claude when present).
try:
    cas_datas, cas_binaries, cas_hidden = collect_all("claude_agent_sdk")
    datas += cas_datas
    binaries += cas_binaries
    hiddenimports += list(cas_hidden)
except Exception as exc:  # noqa: BLE001 — best-effort packaging
    sys.stderr.write(
        f"[build_sidecar.spec] WARN: collect_all(claude_agent_sdk) failed: {exc}\n"
        "  Health endpoint may still work; agent turns need the bundled CLI.\n"
    )
    try:
        hiddenimports += collect_submodules("claude_agent_sdk")
    except Exception as exc2:  # noqa: BLE001
        sys.stderr.write(
            f"[build_sidecar.spec] WARN: collect_submodules(claude_agent_sdk) failed: {exc2}\n"
        )

# Optional SPA static files if present (Electron often loads via loopback SPA).
static_dir = SPECDIR / "static"
if static_dir.is_dir():
    datas.append((str(static_dir), "static"))

# De-dupe hiddenimports while preserving order
_seen: set[str] = set()
_unique_hidden: list[str] = []
for name in hiddenimports:
    if name not in _seen:
        _seen.add(name)
        _unique_hidden.append(name)
hiddenimports = _unique_hidden

a = Analysis(
    [str(SPECDIR / "sidecar_main.py")],
    pathex=[str(SPECDIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "pytest_asyncio",
        "tkinter",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="agent-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="agent-sidecar",
)
