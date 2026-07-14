"""Project-path attachments: resolve paths under session cwd for agent turns."""

from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

# First-wave image types for multimodal feed.
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Small text-ish files we may inline (agent still gets path for tools).
TEXT_SUFFIXES = {
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".html",
    ".htm",
    ".xml",
    ".csv",
    ".log",
    ".sh",
    ".bash",
    ".zsh",
    ".rs",
    ".go",
    ".java",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".rb",
    ".php",
    ".sql",
    ".env",
    ".gitignore",
    ".dockerignore",
}

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MiB (align with common vision limits)
MAX_INLINE_TEXT_BYTES = 64 * 1024  # 64 KiB inline preview
MAX_ATTACHMENTS = 12


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_path_under_cwd(cwd: str | Path, raw_path: str) -> Path:
    """
    Resolve a user-supplied path against session cwd.

    Accepts absolute paths (must stay under cwd) or relative paths.
    Rejects path escape and missing files.
    """
    text = (raw_path or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="attachment path must not be empty",
        )
    # Normalize accidental leading ./
    while text.startswith("./"):
        text = text[2:]

    root = Path(cwd).expanduser().resolve(strict=False)
    if not root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"session cwd is not a directory: {root}",
        )

    candidate = Path(text).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except (FileNotFoundError, OSError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"attachment path does not exist: {text}",
        ) from None

    if not _is_relative_to(resolved, root):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"attachment path must be inside session cwd: {text}",
        )
    if not resolved.is_file():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"attachment path is not a file: {text}",
        )
    return resolved


def classify_path(path: Path) -> tuple[str, str]:
    """Return (kind, mime) where kind is image|text|file."""
    suffix = path.suffix.lower()
    if suffix in IMAGE_MIME:
        return "image", IMAGE_MIME[suffix]
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed and guessed.startswith("image/"):
        return "image", guessed
    if suffix in TEXT_SUFFIXES or (guessed and guessed.startswith("text/")):
        return "text", guessed or "text/plain"
    return "file", guessed or "application/octet-stream"


def normalize_path_attachments(
    cwd: str,
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """
    Validate and normalize path attachments for persistence + agent prompt.

    Output items:
      type: "path"
      path: relative posix path under cwd (display/stable)
      abs_path: absolute path (server-only, stripped before client if needed)
      name, kind, mime, size
    """
    if not attachments:
        return []
    if len(attachments) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"at most {MAX_ATTACHMENTS} attachments per message",
        )

    root = Path(cwd).expanduser().resolve(strict=False)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for raw in attachments:
        if not isinstance(raw, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="each attachment must be an object",
            )
        atype = str(raw.get("type") or "path").lower()
        if atype != "path":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"unsupported attachment type: {atype} (only path supported)",
            )
        path_text = str(raw.get("path") or raw.get("name") or "").strip()
        resolved = resolve_path_under_cwd(root, path_text)
        rel = resolved.relative_to(root).as_posix()
        if rel in seen:
            continue
        seen.add(rel)
        kind, mime = classify_path(resolved)
        size = resolved.stat().st_size
        if kind == "image" and size > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"image too large (>{MAX_IMAGE_BYTES} bytes): {rel}",
            )
        out.append(
            {
                "type": "path",
                "path": rel,
                "abs_path": str(resolved),
                "name": resolved.name,
                "kind": kind,
                "mime": mime,
                "size": size,
            }
        )
    return out


def public_attachments(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip server-only fields before returning to clients / session JSON."""
    public: list[dict[str, Any]] = []
    for item in items:
        public.append(
            {
                "type": item.get("type") or "path",
                "path": item.get("path"),
                "name": item.get("name"),
                "kind": item.get("kind"),
                "mime": item.get("mime"),
                "size": item.get("size"),
            }
        )
    return public


def build_prompt_with_attachments(
    user_text: str,
    attachments: list[dict[str, Any]],
) -> tuple[str | Any, list[dict[str, Any]]]:
    """
    Build SDK query prompt.

    Returns (prompt, content_blocks_meta) where prompt is either a plain string
    (no images) or an async-iterable factory isn't used here — caller gets
    either str or list of Anthropic content blocks for multimodal query.
    """
    text = (user_text or "").strip()
    if not attachments:
        return text, []

    image_blocks: list[dict[str, Any]] = []
    path_lines: list[str] = []
    inline_notes: list[str] = []

    for att in attachments:
        rel = str(att.get("path") or att.get("name") or "")
        kind = att.get("kind") or "file"
        abs_path = Path(str(att.get("abs_path") or ""))
        mime = str(att.get("mime") or "application/octet-stream")
        size = int(att.get("size") or 0)
        path_lines.append(f"- [{kind}] {rel} ({mime}, {size} bytes)")

        if kind == "image" and abs_path.is_file():
            data = abs_path.read_bytes()
            if len(data) <= MAX_IMAGE_BYTES:
                b64 = base64.standard_b64encode(data).decode("ascii")
                image_blocks.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime if mime.startswith("image/") else "image/png",
                            "data": b64,
                        },
                    }
                )
                # Help the model map image ↔ path for tools / edits.
                path_lines.append(f"  (image embedded above corresponds to {rel})")
        elif kind == "text" and abs_path.is_file() and size <= MAX_INLINE_TEXT_BYTES:
            try:
                body = abs_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                body = ""
            if body:
                # Keep inline modest; full file still available via Read tool.
                snippet = body if len(body) <= 8000 else body[:8000] + "\n… [truncated]"
                inline_notes.append(
                    f"\n--- begin {rel} ---\n{snippet}\n--- end {rel} ---"
                )

    attach_section = "Attached project paths (all under the session cwd):\n" + "\n".join(
        path_lines
    )
    if inline_notes:
        attach_section += "\n\nInline text previews (full files remain on disk):\n" + "\n".join(
            inline_notes
        )
    attach_section += (
        "\n\nYou may use Read / other tools on these paths as needed. "
        "For images embedded above, use the visual content directly."
    )

    combined_text = f"{text}\n\n{attach_section}".strip() if text else attach_section

    if not image_blocks:
        return combined_text, public_attachments(attachments)

    # Multimodal content: text + images (Anthropic-style blocks for CLI).
    content: list[dict[str, Any]] = [{"type": "text", "text": combined_text}]
    content.extend(image_blocks)
    return content, public_attachments(attachments)


async def prompt_as_sdk_query(prompt: str | list[dict[str, Any]]):
    """
    Yield a single user message dict for ClaudeSDKClient.query(AsyncIterable).

    String prompts should be passed directly to query(); this is for multimodal.
    """
    if isinstance(prompt, str):
        yield {
            "type": "user",
            "message": {"role": "user", "content": prompt},
            "parent_tool_use_id": None,
        }
        return
    yield {
        "type": "user",
        "message": {"role": "user", "content": prompt},
        "parent_tool_use_id": None,
    }
