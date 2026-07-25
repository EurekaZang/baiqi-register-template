from __future__ import annotations

import pytest

from app.web_search import (
    _search_query,
    parse_search_rss,
    web_search,
)


RSS = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Claude &amp; Agent SDK</title>
      <link>https://example.com/sdk</link>
      <description><![CDATA[<b>Current</b> SDK documentation.]]></description>
      <pubDate>Sat, 25 Jul 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second result</title>
      <link>https://example.org/two</link>
      <description>Another result.</description>
    </item>
  </channel>
</rss>
"""


def test_parse_search_rss_normalizes_results() -> None:
    results = parse_search_rss(RSS, limit=1)
    assert results == [
        {
            "title": "Claude & Agent SDK",
            "url": "https://example.com/sdk",
            "snippet": "Current SDK documentation.",
            "published": "Sat, 25 Jul 2026 00:00:00 GMT",
        }
    ]


def test_search_query_supports_domain_filters() -> None:
    query = _search_query(
        {
            "query": "agent sdk",
            "allowed_domains": ["docs.example.com"],
            "blocked_domains": ["spam.example"],
        }
    )
    assert query == "agent sdk (site:docs.example.com) -site:spam.example"


@pytest.mark.asyncio
async def test_web_search_returns_regular_mcp_content(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        text = RSS

        def raise_for_status(self) -> None:
            return None

    class Client:
        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, *_args: object, **_kwargs: object) -> Response:
            return Response()

    monkeypatch.setattr("app.web_search.httpx.AsyncClient", lambda **_kwargs: Client())
    result = await web_search.handler({"query": "Claude Agent SDK", "max_results": 1})
    assert result["is_error"] is False
    text = result["content"][0]["text"]
    assert "Claude & Agent SDK" in text
    assert "https://example.com/sdk" in text
