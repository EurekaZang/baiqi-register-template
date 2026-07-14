# ChatGPT Team Promo Redeem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `scripts/chatgpt_team_redeem.py` that serial-logs into existing ChatGPT accounts (password + xunmail OTP), attaches an existing UK promo code, evaluates the Team checkout API for a 2-seat hosted long URL, and appends results — no card payment.

**Architecture:** Single async Python CLI (same style as `scripts/chatgpt_offer_freemail.py`). Pure helpers for parse/join/codes/OTP/payload are unit-tested first. Browser work uses Camoufox; checkout is `page.evaluate` of the known `payments/checkout` payload (not DevTools paste). Mihomo proxy via local bridge `:8003` / mixed-port `:17897`.

**Tech Stack:** Python 3.12, `httpx`, Camoufox (`camoufox.async_api.AsyncCamoufox`), pytest, local mihomo proxy bridge.

**Spec:** `docs/superpowers/specs/2026-07-14-chatgpt-team-redeem-design.md`

## Global Constraints

- Scope stops at persisting `checkout_url`; never automate card entry or payment submit.
- Fixed billing: `country="GB"`, `currency="GBP"`, default `seat_quantity=2`.
- Do not apply for new promo codes; only consume `--codes` input.
- Join two files by email: credentials (gpt password) + outlook mail (ms OAuth for xunmail).
- Serial batch only (one browser at a time); shared mihomo mixed-port.
- Never log plaintext passwords or full refresh tokens.
- Prefer append-only crash-safe writes under `--out-dir`.
- Camoufox is **not** currently in `.venv`; install before browser tasks (`pip install camoufox` + browser fetch as needed). Pure unit tests must run without Camoufox.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/chatgpt_team_redeem.py` | All runtime: parsers, xunmail, proxy, login, checkout, batch CLI |
| `tests/test_chatgpt_team_redeem.py` | Unit tests for pure helpers + resume/code pool (no network/browser) |
| `requirements.txt` | Add optional comment or `camoufox` line if install is project-standard |
| Spec (read-only) | `docs/superpowers/specs/2026-07-14-chatgpt-team-redeem-design.md` |

Reuse patterns (copy small helpers, do not hard-import offer script):

- Proxy acquire/report shape from `scripts/chatgpt_offer_freemail.py` (`acquire_proxy`, `report_proxy`)
- Logging style: `log(msg)` + `flush=True`

---

### Task 1: Pure parsers + OTP extract + checkout payload (TDD)

**Files:**
- Create: `tests/test_chatgpt_team_redeem.py`
- Create: `scripts/chatgpt_team_redeem.py` (helpers only first)

**Interfaces:**
- Produces:
  - `parse_delimited_line(line: str) -> list[str]`
  - `parse_credentials_file(text: str) -> dict[str, dict]` mapping email → `{email, gpt_password}`
  - `parse_mail_file(text: str) -> dict[str, dict]` mapping email → `{email, ms_client_id, ms_refresh_token}`
  - `join_accounts(creds: dict, mail: dict) -> list[dict]` each `{email, gpt_password, ms_client_id, ms_refresh_token}` or with `skip_reason`
  - `parse_promo_code_line(line: str) -> str | None` → bare promo code
  - `parse_codes_file(text: str) -> list[str]` unique preserving order
  - `extract_otp(text: str) -> str | None` 6-digit code
  - `build_checkout_payload(promo: str, *, seats: int = 2, workspace_name: str = "myWorkspace") -> dict`
  - `CHECKOUT_JS` template string or `build_checkout_evaluate_source(promo, seats, workspace_name) -> str`

- [ ] **Step 1: Write failing unit tests**

```python
# tests/test_chatgpt_team_redeem.py
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import chatgpt_team_redeem as m  # noqa: E402


def test_parse_credentials_and_mail_join():
    creds = m.parse_credentials_file(
        "格式：邮箱----gptpassword----client-id----refresh-token\n"
        "a@outlook.com----GptPass1----app_xxx----rt.1.xxx\n"
        "b@outlook.com----GptPass2----app_yyy----rt.1.yyy\n"
    )
    mail = m.parse_mail_file(
        "a@outlook.com----mailpw----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C552_TOKEN\n"
        # b missing on purpose
    )
    joined = m.join_accounts(creds, mail)
    assert len(joined) == 2
    ok = [j for j in joined if not j.get("skip_reason")]
    skipped = [j for j in joined if j.get("skip_reason")]
    assert len(ok) == 1
    assert ok[0]["email"] == "a@outlook.com"
    assert ok[0]["gpt_password"] == "GptPass1"
    assert ok[0]["ms_client_id"] == "9e5f94bc-e8a4-4e73-b8be-63364c29d753"
    assert ok[0]["ms_refresh_token"].startswith("M.C552")
    assert skipped[0]["email"] == "b@outlook.com"
    assert skipped[0]["skip_reason"] == "no_mail_oauth"


def test_parse_codes_file_variants():
    text = "\n".join(
        [
            "2026-07-13 01:16:42\t45WSCV353PWHXY9M\thttps://chatgpt.com/p/45WSCV353PWHXY9M\taz@kaggleyes.top",
            "https://chatgpt.com/p/6TFU8CKZ3FMCDA6N",
            "7PQKFAQFTWM9ATYR",
            "45WSCV353PWHXY9M",  # duplicate
            "",
        ]
    )
    codes = m.parse_codes_file(text)
    assert codes == [
        "45WSCV353PWHXY9M",
        "6TFU8CKZ3FMCDA6N",
        "7PQKFAQFTWM9ATYR",
    ]


def test_extract_otp_from_subject_and_body():
    assert m.extract_otp("Your ChatGPT code is 123456") == "123456"
    assert m.extract_otp("code: 987654 expires soon") == "987654"
    assert m.extract_otp("no code here") is None
    # prefer standalone 6-digit over longer numbers
    assert m.extract_otp("order 1234567890 use 654321") == "654321"


def test_build_checkout_payload_uk_two_seats():
    p = m.build_checkout_payload("5HEKF9QRQ9CAJ3GB", seats=2)
    assert p["plan_name"] == "chatgptteamplan"
    assert p["team_plan_data"]["seat_quantity"] == 2
    assert p["team_plan_data"]["price_interval"] == "month"
    assert p["billing_details"] == {"country": "GB", "currency": "GBP"}
    assert p["promo_code"] == "5HEKF9QRQ9CAJ3GB"
    assert p["cancel_url"] == "https://chatgpt.com/p/5HEKF9QRQ9CAJ3GB"
    assert p["checkout_ui_mode"] == "hosted"
```

- [ ] **Step 2: Run tests — expect fail (module missing)**

```bash
cd /home/eureka/baiqi-register-template
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
```

Expected: `ModuleNotFoundError` or import error for `chatgpt_team_redeem`.

- [ ] **Step 3: Implement pure helpers in `scripts/chatgpt_team_redeem.py`**

Minimal skeleton:

```python
#!/usr/bin/env python3
"""ChatGPT Team promo redeem → hosted checkout long URL (no card payment).

See docs/superpowers/specs/2026-07-14-chatgpt-team-redeem-design.md
"""
from __future__ import annotations

import re
from typing import Any

_OTP_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")
_PROMO_URL_RE = re.compile(r"chatgpt\.com/p/([A-Za-z0-9]+)", re.I)


def parse_delimited_line(line: str) -> list[str]:
    line = line.strip()
    if not line or line.startswith("格式"):
        return []
    return [p.strip() for p in line.split("----")]


def parse_credentials_file(text: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for line in text.splitlines():
        parts = parse_delimited_line(line)
        if len(parts) < 2:
            continue
        email = parts[0].strip().lower()
        if not email or "@" not in email:
            continue
        if email in out:
            continue
        out[email] = {"email": email, "gpt_password": parts[1]}
    return out


def parse_mail_file(text: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for line in text.splitlines():
        parts = parse_delimited_line(line)
        if len(parts) < 4:
            continue
        email = parts[0].strip().lower()
        if not email or "@" not in email:
            continue
        if email in out:
            continue
        out[email] = {
            "email": email,
            "ms_client_id": parts[2],
            "ms_refresh_token": parts[3],
        }
    return out


def join_accounts(
    creds: dict[str, dict[str, str]],
    mail: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for email, c in creds.items():
        m = mail.get(email)
        if not m:
            rows.append({**c, "skip_reason": "no_mail_oauth"})
            continue
        rows.append(
            {
                "email": email,
                "gpt_password": c["gpt_password"],
                "ms_client_id": m["ms_client_id"],
                "ms_refresh_token": m["ms_refresh_token"],
            }
        )
    return rows


def parse_promo_code_line(line: str) -> str | None:
    line = line.strip()
    if not line:
        return None
    m = _PROMO_URL_RE.search(line)
    if m:
        return m.group(1).upper()
    # tab-separated codes.txt from offer script: ts, code, url, ...
    if "\t" in line:
        cols = line.split("\t")
        if len(cols) >= 2 and re.fullmatch(r"[A-Za-z0-9]{8,}", cols[1].strip()):
            return cols[1].strip().upper()
    token = line.split()[0].strip()
    if re.fullmatch(r"[A-Za-z0-9]{8,}", token):
        return token.upper()
    return None


def parse_codes_file(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for line in text.splitlines():
        code = parse_promo_code_line(line)
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


def extract_otp(text: str) -> str | None:
    if not text:
        return None
    # Prefer codes that are not part of longer digit runs already handled by lookaround
    matches = _OTP_RE.findall(text)
    if not matches:
        return None
    # Heuristic: last 6-digit standalone often is the OTP in promo/login mails
    return matches[-1]


def build_checkout_payload(
    promo: str,
    *,
    seats: int = 2,
    workspace_name: str = "myWorkspace",
) -> dict[str, Any]:
    promo = promo.strip()
    return {
        "plan_name": "chatgptteamplan",
        "team_plan_data": {
            "workspace_name": workspace_name,
            "price_interval": "month",
            "seat_quantity": int(seats),
        },
        "billing_details": {"country": "GB", "currency": "GBP"},
        "cancel_url": f"https://chatgpt.com/p/{promo}",
        "promo_code": promo,
        "checkout_ui_mode": "hosted",
    }
```

- [ ] **Step 4: Run tests — expect pass**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/test_chatgpt_team_redeem.py scripts/chatgpt_team_redeem.py
git commit -m "feat(team-redeem): pure parsers, OTP extract, UK checkout payload"
```

---

### Task 2: Code pool, result persistence, resume helpers

**Files:**
- Modify: `scripts/chatgpt_team_redeem.py`
- Modify: `tests/test_chatgpt_team_redeem.py`

**Interfaces:**
- Consumes: `parse_codes_file`
- Produces:
  - `class CodePool` with `from_files(codes_text, used_path)`, `allocate() -> str | None`, `mark_used(code)`, `save()`
  - `load_ok_emails(results_path: Path) -> set[str]`
  - `append_result(out_dir: Path, row: dict) -> None` writes `results.jsonl` + on ok also `checkout_urls.txt` and updates used files

- [ ] **Step 1: Write failing tests**

```python
import json
from pathlib import Path


def test_code_pool_skips_used(tmp_path: Path):
    used = tmp_path / "used_codes.json"
    used.write_text(json.dumps({"codes": ["AAAA1111"]}) + "\n", encoding="utf-8")
    pool = m.CodePool.from_text("AAAA1111\nBBBB2222\n", used_path=used)
    assert pool.allocate() == "BBBB2222"
    assert pool.allocate() is None
    pool.mark_used("BBBB2222")
    pool.save()
    data = json.loads(used.read_text(encoding="utf-8"))
    assert "BBBB2222" in data["codes"]


def test_append_result_and_resume(tmp_path: Path):
    row = {
        "email": "a@outlook.com",
        "promo_code": "CODE1",
        "checkout_url": "https://pay.example/x",
        "status": "ok",
        "error": None,
        "ts": "2026-07-14 00:00:00",
    }
    m.append_result(tmp_path, row)
    assert (tmp_path / "results.jsonl").exists()
    assert "https://pay.example/x" in (tmp_path / "checkout_urls.txt").read_text(encoding="utf-8")
    ok = m.load_ok_emails(tmp_path / "results.jsonl")
    assert ok == {"a@outlook.com"}
```

- [ ] **Step 2: Run tests — expect fail on missing CodePool/append_result**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py::test_code_pool_skips_used tests/test_chatgpt_team_redeem.py::test_append_result_and_resume -v
```

- [ ] **Step 3: Implement CodePool + persistence**

```python
import json
import time
from pathlib import Path
from typing import Any


def load_ok_emails(results_path: Path) -> set[str]:
    if not results_path.exists():
        return set()
    ok: set[str] = set()
    for line in results_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("status") == "ok" and row.get("email"):
            ok.add(str(row["email"]).lower())
    return ok


def append_result(out_dir: Path, row: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "results.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        fh.flush()
    if row.get("status") == "ok" and row.get("checkout_url"):
        with (out_dir / "checkout_urls.txt").open("a", encoding="utf-8") as fh:
            fh.write(
                f"{row.get('email','')}\t{row.get('promo_code','')}\t{row.get('checkout_url','')}\n"
            )
            fh.flush()
        # used markers
        _add_used_code(out_dir / "used_codes.json", str(row.get("promo_code") or ""))
        _add_used_email(out_dir / "used_accounts.json", str(row.get("email") or ""))


def _read_used_list(path: Path, key: str) -> list[str]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        items = data.get(key) if isinstance(data, dict) else data
        return [str(x) for x in (items or [])]
    except Exception:
        return []


def _add_used_code(path: Path, code: str) -> None:
    if not code:
        return
    codes = _read_used_list(path, "codes")
    if code not in codes:
        codes.append(code)
    path.write_text(json.dumps({"codes": codes}, indent=2) + "\n", encoding="utf-8")


def _add_used_email(path: Path, email: str) -> None:
    if not email:
        return
    emails = _read_used_list(path, "emails")
    email = email.lower()
    if email not in emails:
        emails.append(email)
    path.write_text(json.dumps({"emails": emails}, indent=2) + "\n", encoding="utf-8")


class CodePool:
    def __init__(self, codes: list[str], used_path: Path):
        self.used_path = used_path
        used = set(_read_used_list(used_path, "codes"))
        self._queue = [c for c in codes if c not in used]
        self._used = set(used)

    @classmethod
    def from_text(cls, text: str, used_path: Path) -> "CodePool":
        return cls(parse_codes_file(text), used_path)

    def allocate(self) -> str | None:
        if not self._queue:
            return None
        return self._queue.pop(0)

    def mark_used(self, code: str) -> None:
        if code:
            self._used.add(code)

    def save(self) -> None:
        path = self.used_path
        existing = _read_used_list(path, "codes")
        merged = list(dict.fromkeys([*existing, *sorted(self._used)]))
        # preserve insertion: used set order not critical; append_result also writes
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"codes": merged}, indent=2) + "\n", encoding="utf-8")
```

Note: `append_result` already updates `used_codes.json` on ok; `CodePool.mark_used/save` is for in-memory + explicit save if needed. Keep both consistent (mark_used after ok before next allocate is enough if append_result writes disk).

- [ ] **Step 4: Run tests — expect pass**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
```

- [ ] **Step 5: Commit**

```bash
git add tests/test_chatgpt_team_redeem.py scripts/chatgpt_team_redeem.py
git commit -m "feat(team-redeem): code pool and append-only result persistence"
```

---

### Task 3: Xunmail client + proxy helpers (no browser)

**Files:**
- Modify: `scripts/chatgpt_team_redeem.py`
- Modify: `tests/test_chatgpt_team_redeem.py` (OTP already covered; add small unit test for URL building if pure)

**Interfaces:**
- Produces:
  - `class XunmailClient`:
    - `__init__(self, base: str = "https://www.xunmail.cn")`
    - `mail_count(self, email, client_id, refresh_token, mailbox="INBOX") -> int`
    - `mail_latest(self, email, client_id, refresh_token, mailbox="INBOX") -> dict`
    - `wait_otp(self, email, client_id, refresh_token, *, since_ts: float, timeout: float = 120, interval: float = 5) -> str`
  - `acquire_proxy(bridge, account, **kwargs) -> dict`
  - `report_proxy(bridge, kind, proxy_url, reason="", node="", egress_ip="") -> None`
  - Defaults: `DEFAULT_PROXY_BRIDGE`, `DEFAULT_PROXY_URL`, `DEFAULT_XUNMAIL_BASE`

- [ ] **Step 1: Implement XunmailClient using httpx**

```python
import httpx

DEFAULT_XUNMAIL_BASE = "https://www.xunmail.cn"
DEFAULT_PROXY_BRIDGE = "http://127.0.0.1:8003"
DEFAULT_PROXY_URL = "http://127.0.0.1:17897"


class XunmailClient:
    def __init__(self, base: str = DEFAULT_XUNMAIL_BASE):
        self.base = base.rstrip("/")

    def _params(self, email: str, client_id: str, refresh_token: str, mailbox: str) -> dict[str, str]:
        return {
            "email": email,
            "client_id": client_id,
            "refresh_token": refresh_token,
            "mailbox": mailbox,
        }

    def mail_count(self, email: str, client_id: str, refresh_token: str, mailbox: str = "INBOX") -> int:
        with httpx.Client(timeout=30) as client:
            r = client.get(
                f"{self.base}/api/oauth2/mail-count",
                params=self._params(email, client_id, refresh_token, mailbox),
            )
            r.raise_for_status()
            data = r.json()
        return int(data.get("count") or 0)

    def mail_latest(self, email: str, client_id: str, refresh_token: str, mailbox: str = "INBOX") -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            r = client.get(
                f"{self.base}/api/oauth2/mail-latest",
                params=self._params(email, client_id, refresh_token, mailbox),
            )
            r.raise_for_status()
            return r.json() if r.content else {}

    def wait_otp(
        self,
        email: str,
        client_id: str,
        refresh_token: str,
        *,
        since_ts: float,
        timeout: float = 120.0,
        interval: float = 5.0,
    ) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            for mailbox in ("INBOX", "Junk"):
                try:
                    data = self.mail_latest(email, client_id, refresh_token, mailbox=mailbox)
                except Exception:
                    continue
                mail = data.get("mail") if isinstance(data, dict) else None
                if not isinstance(mail, dict):
                    # some deployments return fields at top level
                    mail = data if isinstance(data, dict) else {}
                subject = str(mail.get("subject") or "")
                body = str(mail.get("body") or mail.get("text") or mail.get("content") or "")
                blob = f"{subject}\n{body}"
                # optional: if API returns received time, skip older; else accept any new OTP
                code = extract_otp(blob)
                if code:
                    return code
            time.sleep(interval)
        raise TimeoutError(f"otp_timeout after {timeout}s for {email}")
```

Proxy helpers (mirror offer script, simplified):

```python
def acquire_proxy(
    bridge: str,
    account: str,
    *,
    exclude_nodes: list[str] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "target": "chatgpt.com",
        "account": account,
        "sticky": True,
        "prefer_diverse": True,
        "prefer_unique_egress": True,
    }
    if exclude_nodes:
        body["exclude_nodes"] = exclude_nodes
    with httpx.Client(timeout=30) as client:
        r = client.post(f"{bridge.rstrip('/')}/acquire", json=body)
        r.raise_for_status()
        return r.json()


def report_proxy(
    bridge: str,
    kind: str,
    proxy_url: str,
    reason: str = "",
    *,
    node: str = "",
    egress_ip: str = "",
) -> None:
    path = "success" if kind == "success" else "failure"
    body: dict[str, Any] = {"proxy_url": proxy_url}
    if reason:
        body["reason"] = reason[:200]
    if node:
        body["node"] = node
    if egress_ip:
        body["egress_ip"] = egress_ip
    try:
        with httpx.Client(timeout=15) as client:
            client.post(f"{bridge.rstrip('/')}/{path}", json=body)
    except Exception as exc:  # noqa: BLE001
        log(f"  warn: proxy {path} report failed: {exc}")


def log(msg: str) -> None:
    print(msg, flush=True)
```

- [ ] **Step 2: Add unit test for extract already done; add test that wait_otp is not required offline**

No live xunmail test in CI. Optional: mock with `httpx.MockTransport` if time permits:

```python
def test_xunmail_mail_latest_params_shape():
    # pure: _params
    c = m.XunmailClient("https://www.xunmail.cn")
    p = c._params("a@b.com", "cid", "rt", "INBOX")
    assert p["email"] == "a@b.com"
    assert p["mailbox"] == "INBOX"
```

- [ ] **Step 3: Run unit tests**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
```

- [ ] **Step 4: Commit**

```bash
git add scripts/chatgpt_team_redeem.py tests/test_chatgpt_team_redeem.py
git commit -m "feat(team-redeem): xunmail OTP client and mihomo proxy helpers"
```

---

### Task 4: Checkout evaluate source builder + CLI skeleton

**Files:**
- Modify: `scripts/chatgpt_team_redeem.py`
- Modify: `tests/test_chatgpt_team_redeem.py`

**Interfaces:**
- Produces:
  - `build_checkout_evaluate_source(promo: str, seats: int = 2, workspace_name: str = "myWorkspace") -> str`  
    Returns JS async function body that returns `{url}` or error object (JSON-serializable).
  - `build_arg_parser() -> argparse.ArgumentParser`
  - `main() -> int` (wire later in Task 6; here can dry-parse only)

- [ ] **Step 1: Test evaluate source embeds promo and GB**

```python
def test_checkout_evaluate_source_contains_promo_and_uk():
    src = m.build_checkout_evaluate_source("5HEKF9QRQ9CAJ3GB", seats=2)
    assert "5HEKF9QRQ9CAJ3GB" in src
    assert "chatgptteamplan" in src
    assert '"GB"' in src or "'GB'" in src
    assert "payments/checkout" in src
    assert "seat_quantity" in src
```

- [ ] **Step 2: Implement `build_checkout_evaluate_source`**

Use `json.dumps` for safe embedding of payload:

```python
def build_checkout_evaluate_source(
    promo: str,
    seats: int = 2,
    workspace_name: str = "myWorkspace",
) -> str:
    payload = build_checkout_payload(promo, seats=seats, workspace_name=workspace_name)
    payload_json = json.dumps(payload, ensure_ascii=False)
    return f"""
async () => {{
  const session = await fetch("/api/auth/session").then((r) => r.json());
  if (!session.accessToken) {{
    return {{ error: "no_access_token", session }};
  }}
  const payload = {payload_json};
  const response = await fetch("https://chatgpt.com/backend-api/payments/checkout", {{
    method: "POST",
    headers: {{
      Authorization: `Bearer ${{session.accessToken}}`,
      "Content-Type": "application/json",
    }},
    body: JSON.stringify(payload),
  }});
  const data = await response.json().catch(() => ({{ error: "non_json", status: response.status }}));
  return data;
}}
"""
```

- [ ] **Step 3: Add argparse matching spec flags**

```python
import argparse


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChatGPT Team promo redeem → checkout long URL")
    p.add_argument("--accounts", required=True, help="credentials: email----gpt_password----...")
    p.add_argument("--mail", required=True, help="outlook oauth: email----...----client_id----refresh_token")
    p.add_argument("--codes", required=True, help="codes.txt or promo list from offer script")
    p.add_argument("--proxy-bridge", default=DEFAULT_PROXY_BRIDGE)
    p.add_argument("--proxy-url", default=DEFAULT_PROXY_URL)
    p.add_argument("--xunmail-base", default=DEFAULT_XUNMAIL_BASE)
    p.add_argument("--out-dir", default="")
    p.add_argument("--limit", type=int, default=0, help="0 = all")
    p.add_argument("--headed", action="store_true")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--otp-timeout", type=float, default=120.0)
    p.add_argument("--seats", type=int, default=2)
    p.add_argument("--workspace-name", default="myWorkspace")
    p.add_argument("--dry-run-checkout", action="store_true")
    p.add_argument("--direct", action="store_true", help="skip proxy acquire")
    p.add_argument("--serial-gap", type=float, default=3.0)
    return p
```

- [ ] **Step 4: pytest pass + commit**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
git add scripts/chatgpt_team_redeem.py tests/test_chatgpt_team_redeem.py
git commit -m "feat(team-redeem): checkout evaluate JS builder and CLI flags"
```

---

### Task 5: Camoufox login + checkout browser functions

**Files:**
- Modify: `scripts/chatgpt_team_redeem.py`
- Optionally note in script docstring: install camoufox

**Interfaces:**
- Produces (async):
  - `async def launch_browser(*, headed: bool, proxy_url: str | None)`
  - `async def login_chatgpt(page, account: dict, xunmail: XunmailClient, *, otp_timeout: float) -> None`  
    Raises `RuntimeError` with codes: `login_failed`, `otp_timeout`, `session_failed`
  - `async def generate_checkout_url(page, promo: str, *, seats: int, workspace_name: str, dry_run: bool) -> dict`  
    Returns `{url, raw, opened}`
  - `SELECTORS` dict for email/password/continue/otp fields — use resilient role/placeholder; **first headed run may require selector tweaks** (expected).

**Prereq step (once per machine):**

```bash
cd /home/eureka/baiqi-register-template
.venv/bin/pip install camoufox
.venv/bin/python -c "from camoufox.async_api import AsyncCamoufox; print('ok')"
# if browsers missing:
.venv/bin/camoufox fetch
```

Add to `requirements.txt`:

```
httpx>=0.27.0
curl_cffi>=0.11.0
camoufox>=0.4.0
```

- [ ] **Step 1: Implement browser helpers**

Sketch (adjust selectors during first headed smoke):

```python
async def login_chatgpt(page, account, xunmail, *, otp_timeout: float = 120.0) -> None:
    email = account["email"]
    password = account["gpt_password"]
    await page.goto("https://chatgpt.com/auth/login", wait_until="domcontentloaded", timeout=60000)
    # Email
    email_box = page.get_by_role("textbox").first
    await email_box.fill(email)
    await page.get_by_role("button", name=re.compile("continue|继续|next", re.I)).first.click()
    # Password
    await page.wait_for_timeout(800)
    pw = page.locator('input[type="password"]').first
    await pw.fill(password)
    await page.get_by_role("button", name=re.compile("continue|继续|log ?in|next", re.I)).first.click()
    # OTP or session
    deadline = time.time() + otp_timeout
    while time.time() < deadline:
        session = await page.evaluate(
            """async () => {
              try {
                const s = await fetch('/api/auth/session').then(r => r.json());
                return s && s.accessToken ? true : false;
              } catch (e) { return false; }
            }"""
        )
        if session:
            return
        # detect OTP input
        otp_input = page.locator('input[inputmode="numeric"], input[name*="code" i], input[autocomplete="one-time-code"]')
        if await otp_input.count() > 0:
            since = time.time()
            code = xunmail.wait_otp(
                email,
                account["ms_client_id"],
                account["ms_refresh_token"],
                since_ts=since,
                timeout=otp_timeout,
            )
            await otp_input.first.fill(code)
            btn = page.get_by_role("button", name=re.compile("continue|verify|确认|继续", re.I))
            if await btn.count():
                await btn.first.click()
            await page.wait_for_timeout(1500)
            continue
        await page.wait_for_timeout(1000)
    raise RuntimeError("otp_timeout")


async def generate_checkout_url(
    page,
    promo: str,
    *,
    seats: int = 2,
    workspace_name: str = "myWorkspace",
    dry_run: bool = False,
    open_checkout: bool = True,
) -> dict[str, Any]:
    await page.goto(f"https://chatgpt.com/p/{promo}", wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(1500)
    if dry_run:
        return {"url": "", "raw": {"dry_run": True, "promo": promo}, "opened": False}
    src = build_checkout_evaluate_source(promo, seats=seats, workspace_name=workspace_name)
    data = await page.evaluate(src)
    url = ""
    if isinstance(data, dict):
        url = str(data.get("url") or "")
    opened = False
    if url and open_checkout:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            opened = True
        except Exception:
            opened = False
    return {"url": url, "raw": data, "opened": opened}
```

Launch:

```python
async def with_browser(headed: bool, proxy_url: str | None):
    from camoufox.async_api import AsyncCamoufox
    proxy = None
    if proxy_url:
        # http://host:port
        u = proxy_url
        proxy = {"server": u}
    camoufox = AsyncCamoufox(headless=not headed, proxy=proxy)
    browser = await camoufox.start()
    return browser
```

Exact Camoufox proxy API may differ by version — verify against installed package / grokzhuce usage (`context` proxy dict). If `AsyncCamoufox(proxy=...)` unsupported, create context with `proxy=` after launch.

- [ ] **Step 2: No automated browser test** — document manual smoke in script docstring

- [ ] **Step 3: Commit**

```bash
git add scripts/chatgpt_team_redeem.py requirements.txt
git commit -m "feat(team-redeem): Camoufox login, OTP fill, checkout evaluate"
```

---

### Task 6: `run_one` / `run_batch` orchestration + main

**Files:**
- Modify: `scripts/chatgpt_team_redeem.py`

**Interfaces:**
- Produces:
  - `async def run_one(account, promo, args, out_dir) -> dict` status row
  - `async def run_batch(args) -> int`
  - `def main() -> int` uses `asyncio.run`

- [ ] **Step 1: Implement orchestration**

Logic:

```text
out_dir = Path(args.out_dir or f"/tmp/team_redeem_{timestamp}")
creds = parse_credentials_file(Path(args.accounts).read_text())
mail = parse_mail_file(Path(args.mail).read_text())
joined = join_accounts(creds, mail)
pool = CodePool.from_text(Path(args.codes).read_text(), out_dir / "used_codes.json")
done = load_ok_emails(out_dir / "results.jsonl") if args.resume else set()

for account in joined:
  if limit reached: break
  if resume and email in done: continue
  if account.skip_reason:
    append_result(skipped); continue
  promo = pool.allocate()
  if not promo:
    append_result(no_promo); continue
  try run_one...
  finally serial_gap
```

`run_one`:

1. proxy acquire (unless `--direct`) — up to 3 tries
2. launch browser
3. login_chatgpt
4. generate_checkout_url
5. if url: status ok else checkout_failed
6. append_result; report proxy; close browser
7. map exceptions to status strings

Exit code: `0` if at least one `ok` OR all skipped intentionally with no work; `1` if any attempted account failed and zero ok (match offer script spirit: partial ok → 0 if any success; document: `0` when `ok_count > 0 or nothing_to_do`, else `1`).

- [ ] **Step 2: Dry CLI parse smoke**

```bash
.venv/bin/python scripts/chatgpt_team_redeem.py --help
```

Expected: help text with all flags.

- [ ] **Step 3: Unit tests still pass**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
```

- [ ] **Step 4: Commit**

```bash
git add scripts/chatgpt_team_redeem.py
git commit -m "feat(team-redeem): serial batch orchestration and CLI entrypoint"
```

---

### Task 7: Headed smoke on one real account (manual gate)

**Files:** none required (runtime only); fix selectors in `login_chatgpt` if needed

- [ ] **Step 1: Confirm infra**

```bash
curl -s http://127.0.0.1:8003/health | head -c 200; echo
curl -sI https://www.xunmail.cn/api/oauth2/mail-latest | head -5
```

- [ ] **Step 2: Run limit 1 headed**

```bash
cd /home/eureka/baiqi-register-template
.venv/bin/python scripts/chatgpt_team_redeem.py \
  --accounts "/home/eureka/Downloads/credentials_txt-3-20260713T012142Z/accountflow-redeem-credentials.txt" \
  --mail "/home/eureka/Downloads/outlook_mail_txt-3-20260713T012221Z/accountflow-redeem-outlook-mail.txt" \
  --codes /tmp/chatgpt_offers_100_MASTER/codes.txt \
  --out-dir /tmp/team_redeem_smoke1 \
  --limit 1 --headed
```

- [ ] **Step 3: Verify artifacts**

```bash
cat /tmp/team_redeem_smoke1/results.jsonl
cat /tmp/team_redeem_smoke1/checkout_urls.txt
```

Expected: one line `status=ok` with non-empty `checkout_url` **or** documented failure with screenshot for selector fix.

- [ ] **Step 4: If login selectors fail, fix and re-run Step 2; commit selector fix**

```bash
git add scripts/chatgpt_team_redeem.py
git commit -m "fix(team-redeem): harden ChatGPT login selectors after headed smoke"
```

- [ ] **Step 5: Optional dry-run-checkout path**

```bash
.venv/bin/python scripts/chatgpt_team_redeem.py ... --limit 1 --headed --dry-run-checkout
```

---

### Task 8: Short operator note in script docstring (no README bloat unless needed)

**Files:**
- Modify: `scripts/chatgpt_team_redeem.py` top docstring with usage + prereqs only

Ensure docstring includes:

- Prereqs: mihomo bridge, xunmail reachable, camoufox installed, joined account files, codes from offer script
- Example command (Task 7)
- Explicit: does not bind cards

- [ ] **Step 1: Polish docstring**
- [ ] **Step 2: Final pytest**

```bash
.venv/bin/python -m pytest tests/test_chatgpt_team_redeem.py -v
```

- [ ] **Step 3: Commit**

```bash
git add scripts/chatgpt_team_redeem.py
git commit -m "docs(team-redeem): operator usage in script docstring"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Join credentials ⨯ outlook by email | 1 |
| Consume codes only; 1:1; used_codes | 2, 6 |
| xunmail OAuth2 OTP INBOX+Junk | 3, 5 |
| Camoufox + mihomo serial | 5, 6 |
| Fixed UK / 2 seats checkout evaluate | 1, 4, 5 |
| Open promo page then checkout | 5 |
| results.jsonl + checkout_urls.txt append | 2, 6 |
| resume / skip ok emails | 2, 6 |
| No card payment | Global + 5/6 |
| Error statuses + continue batch | 6 |
| Log redaction | 6 (never print password/token) |
| Unit tests parsers/otp/payload/pool | 1–4 |
| Headed smoke | 7 |

## Placeholder / consistency self-review

- No TBD steps; Camoufox proxy kwarg noted as version-check at implement time.
- Function names consistent: `join_accounts`, `CodePool`, `XunmailClient.wait_otp`, `build_checkout_payload`, `build_checkout_evaluate_source`, `append_result`, `run_one`, `run_batch`.
- Status strings match spec: `ok | skipped | proxy_failed | login_failed | otp_timeout | session_failed | checkout_failed | error`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-14-chatgpt-team-redeem.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with `executing-plans`, checkpoints between tasks  

Which approach?
