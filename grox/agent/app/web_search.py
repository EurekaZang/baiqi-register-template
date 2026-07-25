"""Local web-search MCP tool used when the upstream lacks Claude WebSearch."""

from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Any

import httpx
from claude_agent_sdk import create_sdk_mcp_server, tool

SEARCH_URL = "https://www.bing.com/search"
DEFAULT_RESULTS = 6
MAX_RESULTS = 10
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


def _plain_text(value: str | None) -> str:
    text = html.unescape(_TAG_RE.sub(" ", value or ""))
    return _SPACE_RE.sub(" ", text).strip()


def parse_search_rss(raw: str, *, limit: int = DEFAULT_RESULTS) -> list[dict[str, str]]:
    """Parse Bing RSS into a small, stable result representation."""
    root = ET.fromstring(raw)
    results: list[dict[str, str]] = []
    for item in root.findall(".//item"):
        title = _plain_text(item.findtext("title"))
        url = (item.findtext("link") or "").strip()
        if not title or not url.startswith(("http://", "https://")):
            continue
        results.append(
            {
                "title": title,
                "url": url,
                "snippet": _plain_text(item.findtext("description")),
                "published": _plain_text(item.findtext("pubDate")),
            }
        )
        if len(results) >= limit:
            break
    return results


def _domain_clause(domains: Any) -> str:
    if not isinstance(domains, list):
        return ""
    clean = [
        str(domain).strip().lower()
        for domain in domains
        if str(domain).strip() and " " not in str(domain).strip()
    ][:8]
    if not clean:
        return ""
    return " (" + " OR ".join(f"site:{domain}" for domain in clean) + ")"


def _search_query(payload: dict[str, Any]) -> str:
    query = str(payload.get("query") or "").strip()
    allowed = _domain_clause(payload.get("allowed_domains"))
    blocked = _domain_clause(payload.get("blocked_domains"))
    if blocked:
        blocked = " " + " ".join(
            f"-site:{domain}"
            for domain in re.findall(r"site:([^\s)]+)", blocked)
        )
    return f"{query}{allowed}{blocked}".strip()


def _result_text(query: str, results: list[dict[str, str]]) -> str:
    lines = [f"Search results for: {query}", ""]
    for index, result in enumerate(results, start=1):
        lines.append(f"{index}. {result['title']}")
        lines.append(f"   {result['url']}")
        if result["snippet"]:
            lines.append(f"   {result['snippet']}")
        if result["published"]:
            lines.append(f"   Published: {result['published']}")
        lines.append("")
    return "\n".join(lines).rstrip()


@tool(
    "web_search",
    (
        "Search the public web for current information and return titles, URLs, "
        "and snippets. Use this instead of the unavailable built-in WebSearch tool."
    ),
    {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query.",
                "minLength": 1,
            },
            "allowed_domains": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional domains to restrict results to.",
            },
            "blocked_domains": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional domains to exclude from results.",
            },
            "max_results": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_RESULTS,
                "default": DEFAULT_RESULTS,
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    },
)
async def web_search(payload: dict[str, Any]) -> dict[str, Any]:
    query = _search_query(payload)
    if not query:
        return {
            "content": [{"type": "text", "text": "A non-empty search query is required."}],
            "is_error": True,
        }
    try:
        limit = max(1, min(MAX_RESULTS, int(payload.get("max_results") or DEFAULT_RESULTS)))
    except (TypeError, ValueError):
        limit = DEFAULT_RESULTS

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(20.0),
            headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml,text/xml"},
        ) as client:
            response = await client.get(
                SEARCH_URL,
                params={"q": query, "format": "rss", "count": limit},
            )
            response.raise_for_status()
        results = parse_search_rss(response.text, limit=limit)
    except (httpx.HTTPError, ET.ParseError) as exc:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Web search failed: {exc.__class__.__name__}: {exc}",
                }
            ],
            "is_error": True,
        }

    if not results:
        return {
            "content": [{"type": "text", "text": f"No web results found for: {query}"}],
            "is_error": False,
        }
    return {
        "content": [{"type": "text", "text": _result_text(query, results)}],
        "is_error": False,
    }


def create_web_search_server() -> dict[str, Any]:
    """Create a fresh in-process MCP server for one Agent SDK client."""
    return create_sdk_mcp_server(
        name="grox_web",
        version="1.0.0",
        tools=[web_search],
    )
