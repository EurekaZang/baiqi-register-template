"""Tests for project-path attachments."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.attachments import (
    CHAT_ATTACH_DIRNAME,
    build_prompt_with_attachments,
    normalize_path_attachments,
    public_attachments,
    resolve_path_under_cwd,
    save_upload_under_cwd,
)


def test_resolve_relative_and_reject_escape(tmp_path: Path):
    root = tmp_path / "proj"
    root.mkdir()
    f = root / "src" / "a.png"
    f.parent.mkdir()
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 20)

    resolved = resolve_path_under_cwd(root, "src/a.png")
    assert resolved == f.resolve()

    outside = tmp_path / "secret.txt"
    outside.write_text("nope")
    with pytest.raises(HTTPException) as ei:
        resolve_path_under_cwd(root, str(outside))
    assert ei.value.status_code == 400

    with pytest.raises(HTTPException):
        resolve_path_under_cwd(root, "../secret.txt")


def test_normalize_path_attachments_images_and_text(tmp_path: Path):
    root = tmp_path / "ws"
    root.mkdir()
    img = root / "shot.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 40)
    txt = root / "notes.md"
    txt.write_text("# hi\nhello\n", encoding="utf-8")

    items = normalize_path_attachments(
        str(root),
        [
            {"type": "path", "path": "shot.png"},
            {"type": "path", "path": "notes.md"},
            {"type": "path", "path": "shot.png"},  # dedupe
        ],
    )
    assert len(items) == 2
    assert items[0]["kind"] == "image"
    assert items[0]["path"] == "shot.png"
    assert items[1]["kind"] == "text"
    assert "abs_path" in items[0]

    pub = public_attachments(items)
    assert "abs_path" not in pub[0]
    assert pub[0]["path"] == "shot.png"


def test_build_prompt_embeds_image(tmp_path: Path):
    root = tmp_path / "ws"
    root.mkdir()
    img = root / "ui.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"imgdata")

    items = normalize_path_attachments(str(root), [{"type": "path", "path": "ui.png"}])
    prompt, public = build_prompt_with_attachments("What is wrong here?", items)
    assert isinstance(prompt, list)
    types = [b.get("type") for b in prompt]
    assert "text" in types
    assert "image" in types
    text_block = next(b for b in prompt if b["type"] == "text")
    assert "ui.png" in text_block["text"]
    assert "What is wrong here?" in text_block["text"]
    img_block = next(b for b in prompt if b["type"] == "image")
    assert img_block["source"]["type"] == "base64"
    assert public[0]["path"] == "ui.png"


def test_build_prompt_text_only_paths(tmp_path: Path):
    root = tmp_path / "ws"
    root.mkdir()
    f = root / "a.py"
    f.write_text("print(1)\n", encoding="utf-8")
    items = normalize_path_attachments(str(root), [{"type": "path", "path": "a.py"}])
    prompt, public = build_prompt_with_attachments("Review this", items)
    assert isinstance(prompt, str)
    assert "a.py" in prompt
    assert "print(1)" in prompt
    assert public[0]["kind"] == "text"


def test_save_upload_under_cwd(tmp_path: Path):
    root = tmp_path / "proj"
    root.mkdir()
    data = b"\x89PNG\r\n\x1a\n" + b"drop-me"
    item = save_upload_under_cwd(
        root,
        "sess-1",
        filename="../../evil.png",
        data=data,
        content_type="image/png",
    )
    assert item["kind"] == "image"
    assert item["path"].startswith(f"{CHAT_ATTACH_DIRNAME}/sess-1/")
    assert ".." not in item["path"]
    saved = root / item["path"]
    assert saved.is_file()
    assert saved.read_bytes() == data
    # Still resolvable as a normal path attachment
    items = normalize_path_attachments(str(root), [{"type": "path", "path": item["path"]}])
    assert items[0]["path"] == item["path"]


def test_save_upload_rejects_huge_and_bad_type(tmp_path: Path):
    root = tmp_path / "proj"
    root.mkdir()
    with pytest.raises(HTTPException) as ei:
        save_upload_under_cwd(
            root,
            "s",
            filename="x.exe",
            data=b"MZ" + b"0" * 100,
            content_type="application/octet-stream",
        )
    assert ei.value.status_code == 400

    with pytest.raises(HTTPException):
        save_upload_under_cwd(
            root,
            "s",
            filename="big.png",
            data=b"x" * (20 * 1024 * 1024 + 10),
            content_type="image/png",
        )
