#!/usr/bin/env python3
"""Grok Registration Pipeline Dashboard.

Single-file stdlib HTTP server that:
  - probes all pipeline services (email / proxy / turnstile / grokcli / sub2api / router)
  - lists Grok account pool + quota via grokcli-2api
  - samples free-usage tokens over time and exposes USD-equivalent series
  - starts the registration flow with configurable workers/count
  - streams run log output

Usage:
  python dashboard/server.py
  # open http://127.0.0.1:8090
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.request import Request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

HOST = os.getenv("DASHBOARD_HOST", "127.0.0.1")
PORT = int(os.getenv("DASHBOARD_PORT", "8090"))
GROKCLI_URL = os.getenv("GROKCLI_API_URL", "http://127.0.0.1:3000").rstrip("/")
GROKCLI_PASSWORD = os.getenv("GROKCLI_ADMIN_PASSWORD", "grokcli-admin-2026")
YESCAPTCHA_KEY = os.getenv("YESCAPTCHA_KEY", "").strip()

# Usage time-series: sample free-usage tokens (actual/limit) + commercial USD equiv.
DASH_DIR = Path(__file__).resolve().parent
USAGE_DIR = DASH_DIR / "data"
USAGE_HISTORY_PATH = USAGE_DIR / "usage_history.jsonl"
USAGE_SAMPLE_INTERVAL = float(os.getenv("USAGE_SAMPLE_INTERVAL", "60"))
USAGE_RETENTION_DAYS = float(os.getenv("USAGE_RETENTION_DAYS", "14"))
# Chart series: per-bucket usage (not cumulative). Default 15 minutes.
USAGE_BUCKET_SEC = max(
    60, int(float(os.getenv("USAGE_BUCKET_SEC", "900") or 900))
)
# Blended commercial rate for free-tier total tokens ($ / 1M tokens).
# Free tier actual spend is $0; this is reference equivalent value.
GROK_USD_PER_MTOKENS = float(os.getenv("GROK_USD_PER_MTOKENS", "5.0"))
GROK_USD_INPUT_PER_M = float(os.getenv("GROK_USD_INPUT_PER_M", "3.0"))
GROK_USD_OUTPUT_PER_M = float(os.getenv("GROK_USD_OUTPUT_PER_M", "15.0"))
_TOKEN_USAGE_RE = re.compile(
    r"tokens\s*\(actual/limit\)\s*:\s*([\d,]+)\s*/\s*([\d,]+)",
    re.I,
)
_usage_lock = threading.Lock()
_usage_series: list[dict[str, Any]] = []
_usage_latest: dict[str, Any] | None = None
_MAX_USAGE_POINTS = 20_000

# ---------------------------------------------------------------------------
# Service definitions
# ---------------------------------------------------------------------------

SERVICES = [
    {
        "id": "email",
        "name": "Freemail Bridge",
        "url": "http://127.0.0.1:8005/",
        "desc": "临时邮箱 (port 8005)",
        "critical": True,
    },
    {
        "id": "proxy",
        "name": "Proxy Bridge",
        "url": "http://127.0.0.1:8003/",
        "desc": "CF Worker 代理池 (port 8003)",
        "critical": True,
    },
    {
        "id": "turnstile",
        "name": "Turnstile Solver",
        "url": "http://127.0.0.1:5072/",
        "desc": "本地 Turnstile 求解器 (port 5072)",
        "critical": False,
    },
    {
        "id": "grokcli",
        "name": "grokcli-2api",
        "url": "http://127.0.0.1:3000/health",
        "desc": "Grok-4.5 OIDC 网关 (port 3000)",
        "critical": True,
    },
    {
        "id": "sub2api",
        "name": "sub2api",
        "url": "http://127.0.0.1:8080/health",
        "desc": "统一 API 网关 (port 8080)",
        "critical": True,
    },
    {
        "id": "router",
        "name": "Model Router",
        "url": "http://127.0.0.1:8088/health",
        "desc": "Claude Code 路由 (port 8088)",
        "critical": True,
    },
    {
        "id": "grok2api",
        "name": "grok2api",
        "url": "http://127.0.0.1:8000/health",
        "desc": "Grok2API 网关 (port 8000, 可选)",
        "critical": False,
    },
]

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

_admin_token: str | None = None
_admin_token_at = 0.0
_admin_lock = threading.Lock()
# RLock: api_register_start / stop may call _append_log while already holding the lock.
# A plain Lock deadlocks here and freezes /api/overview + /api/register/status forever.
_reg_lock = threading.RLock()
_reg: dict[str, Any] = {
    "running": False,
    "pid": None,
    "started_at": None,
    "finished_at": None,
    "count": 0,
    "workers": 0,
    "exit_code": None,
    "output_dir": None,
    "log_lines": [],
    "error": None,
    "source": None,
}
# Auto-register queue: when a job is already running, further requests pile up here
_reg_queue_count = 0
_reg_queue_workers = 2
_REG_QUEUE_PATH = Path(__file__).resolve().parent / "data" / "register_queue.json"
_MAX_LOG_LINES = 2000

# Short TTL cache so 3–5s browser polls don't stampede grokcli admin API
_accounts_cache: dict[str, Any] | None = None
_accounts_cache_at = 0.0
_accounts_cache_lock = threading.Lock()
_ACCOUNTS_CACHE_TTL = 4.0


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _http(
    method: str,
    url: str,
    *,
    body: dict | None = None,
    headers: dict | None = None,
    timeout: float = 5.0,
) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw.decode(errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read() if hasattr(e, "read") else b""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors="replace")[:400]
    except Exception as e:
        return 0, str(e)


def _probe(url: str, timeout: float = 2.5) -> dict[str, Any]:
    t0 = time.time()
    status, body = _http("GET", url, timeout=timeout)
    latency_ms = int((time.time() - t0) * 1000)
    ok = 200 <= status < 400
    detail = ""
    if isinstance(body, dict):
        detail = body.get("status") or body.get("service") or json.dumps(body)[:80]
    elif isinstance(body, str):
        detail = body[:80]
    return {
        "ok": ok,
        "status_code": status,
        "latency_ms": latency_ms,
        "detail": detail,
    }


# ---------------------------------------------------------------------------
# grokcli-2api
# ---------------------------------------------------------------------------

def _grokcli_auth_headers(token: str) -> dict[str, str]:
    # Send both; require_admin accepts X-Admin-Token, Bearer, or cookie.
    return {
        "X-Admin-Token": token,
        "Authorization": f"Bearer {token}",
    }


def _grokcli_login(*, force: bool = False) -> str:
    """Login to grokcli admin API. Thread-safe; caches token ~6h.

    Network I/O is done **outside** `_admin_lock` so a slow/hung login cannot
    stall every /api/overview + /api/accounts poll (which used to freeze :8090).
    """
    global _admin_token, _admin_token_at
    with _admin_lock:
        if (
            not force
            and _admin_token
            and (time.time() - _admin_token_at) < 6 * 3600
        ):
            return _admin_token

    last_err: Any = None
    for attempt in range(3):
        status, body = _http(
            "POST",
            f"{GROKCLI_URL}/admin/api/login",
            body={"password": GROKCLI_PASSWORD},
            timeout=5,
        )
        if status == 200 and isinstance(body, dict) and body.get("token"):
            tok = str(body["token"])
            with _admin_lock:
                _admin_token = tok
                _admin_token_at = time.time()
            return tok
        last_err = (status, body)
        if status in (400, 403, 404, 409, 422) or (
            isinstance(body, dict)
            and (
                body.get("setup_needed")
                or "setup" in str(body.get("detail", "")).lower()
            )
        ):
            _http(
                "POST",
                f"{GROKCLI_URL}/admin/api/setup",
                body={"password": GROKCLI_PASSWORD},
                timeout=5,
            )
        time.sleep(0.1 * (attempt + 1))

    _http(
        "POST",
        f"{GROKCLI_URL}/admin/api/setup",
        body={"password": GROKCLI_PASSWORD},
        timeout=5,
    )
    status, body = _http(
        "POST",
        f"{GROKCLI_URL}/admin/api/login",
        body={"password": GROKCLI_PASSWORD},
        timeout=5,
    )
    if status == 200 and isinstance(body, dict) and body.get("token"):
        tok = str(body["token"])
        with _admin_lock:
            _admin_token = tok
            _admin_token_at = time.time()
        return tok
    raise RuntimeError(f"grokcli login failed: {status} {body} (prev={last_err})")


def _grokcli(path: str, *, timeout: float = 10.0) -> Any:
    token = _grokcli_login()
    status, body = _http(
        "GET",
        f"{GROKCLI_URL}{path}",
        headers=_grokcli_auth_headers(token),
        timeout=timeout,
    )
    if status == 401:
        token = _grokcli_login(force=True)
        status, body = _http(
            "GET",
            f"{GROKCLI_URL}{path}",
            headers=_grokcli_auth_headers(token),
            timeout=timeout,
        )
    if status != 200:
        raise RuntimeError(f"grokcli {path} → {status}: {body}")
    return body


# ---------------------------------------------------------------------------
# Registration runner
# ---------------------------------------------------------------------------

def _append_log(line: str) -> None:
    with _reg_lock:
        _reg["log_lines"].append(line.rstrip("\n"))
        if len(_reg["log_lines"]) > _MAX_LOG_LINES:
            _reg["log_lines"] = _reg["log_lines"][-_MAX_LOG_LINES:]


def _run_registration(count: int, workers: int, *, source: str = "manual") -> None:
    global _reg_queue_count
    with _reg_lock:
        if _reg["running"]:
            return
        _reg.update(
            {
                "running": True,
                "pid": None,
                "started_at": time.time(),
                "finished_at": None,
                "count": count,
                "workers": workers,
                "exit_code": None,
                "output_dir": None,
                "log_lines": [],
                "error": None,
                "source": source,
            }
        )

    cmd = [
        str(ROOT / ".venv" / "bin" / "python"),
        str(ROOT / "run.py"),
        "--channel",
        "grok",
        "--config",
        str(ROOT / "config.grok.json"),
        "--count",
        str(count),
        "--workers",
        str(workers),
    ]
    env = os.environ.copy()
    if YESCAPTCHA_KEY:
        env["YESCAPTCHA_KEY"] = YESCAPTCHA_KEY
    env["PYTHONUNBUFFERED"] = "1"

    _append_log(f"$ YESCAPTCHA_KEY={'***' if YESCAPTCHA_KEY else '(unset → local solver)'} {' '.join(cmd)}  # source={source}")
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        with _reg_lock:
            _reg["pid"] = proc.pid

        assert proc.stdout is not None
        for line in proc.stdout:
            _append_log(line)
            # capture output dir from log
            if "output=" in line:
                try:
                    out = line.split("output=", 1)[1].strip()
                    with _reg_lock:
                        _reg["output_dir"] = out
                except Exception:
                    pass
        code = proc.wait()
        with _reg_lock:
            _reg["exit_code"] = code
            _reg["finished_at"] = time.time()
            _reg["running"] = False
        _append_log(f"[done] exit_code={code}")
    except Exception as e:
        with _reg_lock:
            _reg["error"] = str(e)
            _reg["finished_at"] = time.time()
            _reg["running"] = False
        _append_log(f"[error] {e}")

    # Drain auto-register queue (accumulated while this job was running)
    with _reg_lock:
        queued = int(_reg_queue_count or 0)
        qworkers = int(_reg_queue_workers or 2)
        _reg_queue_count = 0
        _persist_reg_queue_unlocked()
    if queued > 0:
        _append_log(f"[auto-queue] starting queued registration count={queued}")
        t = threading.Thread(
            target=_run_registration,
            args=(queued, qworkers),
            kwargs={"source": "auto_queue"},
            daemon=True,
            name="grok-register-queue",
        )
        t.start()


def _stop_registration() -> bool:
    with _reg_lock:
        pid = _reg.get("pid")
        running = _reg.get("running")
    if not running or not pid:
        return False
    try:
        os.kill(pid, signal.SIGTERM)
        _append_log(f"[stop] sent SIGTERM to pid={pid}")
        return True
    except ProcessLookupError:
        with _reg_lock:
            _reg["running"] = False
        return False
    except Exception as e:
        _append_log(f"[stop] failed: {e}")
        return False


# ---------------------------------------------------------------------------
# API handlers
# ---------------------------------------------------------------------------

def api_services() -> dict[str, Any]:
    # Parallel short probes so one slow service cannot stall the whole overview
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results_by_id: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=len(SERVICES)) as pool:
        futs = {pool.submit(_probe, svc["url"], 1.5): svc for svc in SERVICES}
        for fut in as_completed(futs):
            svc = futs[fut]
            try:
                probe = fut.result()
            except Exception as e:
                probe = {
                    "ok": False,
                    "status_code": 0,
                    "latency_ms": 0,
                    "detail": str(e)[:80],
                }
            results_by_id[svc["id"]] = {**svc, **probe}
    results = [results_by_id[s["id"]] for s in SERVICES if s["id"] in results_by_id]
    # enrich grokcli with live account count (bounded)
    for r in results:
        if r["id"] == "grokcli" and r["ok"]:
            try:
                status, body = _http("GET", "http://127.0.0.1:3000/health", timeout=2)
                if isinstance(body, dict):
                    r["detail"] = (
                        f"accounts={body.get('accounts_live')}/{body.get('accounts_total')} "
                        f"maintainer={body.get('token_maintainer', {}).get('running')}"
                    )
            except Exception:
                pass
    all_critical_ok = all(r["ok"] for r in results if r["critical"])
    return {
        "ok": all_critical_ok,
        "checked_at": time.time(),
        "services": results,
    }


def _blocked_model_ids(a: dict[str, Any]) -> list[str]:
    ids = a.get("blocked_model_ids")
    if isinstance(ids, list) and ids:
        return [str(x) for x in ids if x]
    blocked = a.get("blocked_models") or {}
    if isinstance(blocked, dict):
        return [str(k) for k in blocked.keys()]
    return []


def _derive_account_status(a: dict[str, Any]) -> dict[str, Any]:
    """Map pool/auth fields → UI status (priority: worst first)."""
    blocked_ids = _blocked_model_ids(a)
    last_err = (a.get("last_error") or "")[:300]
    probe = a.get("last_probe") if isinstance(a.get("last_probe"), dict) else {}
    probe_err = (probe.get("error") or "")[:200]
    free_exhausted = bool(
        "free-usage-exhausted" in last_err
        or "free-usage-exhausted" in probe_err
        or "usage_exhausted" in last_err.lower()
        or "usage_exhausted" in probe_err.lower()
    )

    if a.get("expired"):
        return {
            "status": "expired",
            "label": "Expired",
            "class": "bad",
            "reason": "token expired",
        }
    if a.get("enabled") is False:
        return {
            "status": "disabled",
            "label": "Disabled",
            "class": "bad",
            "reason": a.get("disabled_reason") or "manually disabled",
        }
    if a.get("disabled_for_quota"):
        return {
            "status": "quota_disabled",
            "label": "Quota disabled",
            "class": "bad",
            "reason": a.get("disabled_reason") or last_err or "quota exhausted",
        }
    if blocked_ids:
        models = ", ".join(blocked_ids[:4])
        more = len(blocked_ids) - 4
        if more > 0:
            models = f"{models} +{more}"
        reason = last_err or probe_err or "model blocked"
        if free_exhausted and "free-usage" not in reason:
            reason = f"free-usage-exhausted · {reason}"
        return {
            "status": "blocked",
            "label": f"Blocked ({models})",
            "class": "bad",
            "reason": reason,
        }
    if free_exhausted:
        return {
            "status": "blocked",
            "label": "Blocked (usage)",
            "class": "bad",
            "reason": last_err or probe_err or "free-usage-exhausted",
        }
    if a.get("in_cooldown"):
        until = a.get("cooldown_until")
        left = ""
        try:
            if until is not None:
                sec = max(0, int(float(until) - time.time()))
                left = f" {sec}s" if sec else ""
        except (TypeError, ValueError):
            left = ""
        return {
            "status": "cooldown",
            "label": f"Cooldown{left}",
            "class": "warn",
            "reason": last_err or "cooling down after failure",
        }
    if probe and probe.get("ok") is False and probe.get("available") is False:
        return {
            "status": "probe_fail",
            "label": "Probe fail",
            "class": "warn",
            "reason": probe_err or "last model probe failed",
        }
    return {
        "status": "ok",
        "label": "OK",
        "class": "ok",
        "reason": "",
    }


def api_accounts(*, force: bool = False) -> dict[str, Any]:
    global _accounts_cache, _accounts_cache_at
    # Serve fresh-enough cache to avoid poll storms / client disconnects
    with _accounts_cache_lock:
        if (
            not force
            and _accounts_cache is not None
            and (time.time() - _accounts_cache_at) < _ACCOUNTS_CACHE_TTL
        ):
            cached = dict(_accounts_cache)
            cached["cached"] = True
            return cached

    try:
        # /admin/api/accounts includes pool_summary() with blocked_models,
        # cooldown, last_error, last_probe — the real scheduling state.
        accounts_body = _grokcli("/admin/api/accounts", timeout=10)
        pool = accounts_body.get("pool") if isinstance(accounts_body, dict) else {}
        if not isinstance(pool, dict):
            pool = {}
        pool_accounts = pool.get("accounts") or []
        # Fallback: plain account list (no pool meta)
        if not pool_accounts:
            pool_accounts = accounts_body.get("accounts") or []

        # Prefer pool.last_quota — live /accounts/quota is slow and floods
        # logs when clients disconnect mid-response. Optional best-effort only.
        qmap: dict[str, Any] = {}
        quota_body: dict[str, Any] = {"ok": True, "skipped": True}
        # Skip live quota probe by default (pool meta already has last_quota /
        # blocked_models which are the signals we display).

        items: list[dict[str, Any]] = []
        blocked_count = 0
        cooldown_count = 0
        disabled_count = 0
        ok_count = 0

        for a in pool_accounts:
            if not isinstance(a, dict):
                continue
            aid = a.get("id") or a.get("auth_key") or ""
            blocked_ids = _blocked_model_ids(a)
            st = _derive_account_status(a)

            if st["status"] == "ok":
                ok_count += 1
            elif st["status"] == "blocked":
                blocked_count += 1
            elif st["status"] == "cooldown":
                cooldown_count += 1
            elif st["status"] in ("disabled", "quota_disabled", "expired"):
                disabled_count += 1
            # probe_fail counted in status_summary.other below

            last_q = a.get("last_quota") if isinstance(a.get("last_quota"), dict) else {}
            live_q = qmap.get(aid, {}) if aid else {}
            # Prefer live quota fields when present; else pool-cached last_quota
            q_src = live_q if live_q else last_q
            probe = a.get("last_probe") if isinstance(a.get("last_probe"), dict) else {}
            # Model free-usage block is a stronger "exhausted" signal than
            # monthly billing remaining=0 free/promo.
            model_exhausted = st["status"] == "blocked" or bool(
                a.get("disabled_for_quota")
            )
            exhausted = bool(q_src.get("exhausted")) or model_exhausted

            summary = (
                (q_src.get("display") or {}).get("summary")
                if isinstance(q_src.get("display"), dict)
                else None
            )
            summary = summary or q_src.get("summary") or last_q.get("summary")
            if model_exhausted and blocked_ids:
                summary = f"blocked: {', '.join(blocked_ids[:3])}"
            elif model_exhausted:
                summary = summary or "free usage exhausted"
            elif not summary:
                # New imports often have no last_quota yet — derive from probe/status
                # so the UI never shows a bare "—".
                if st["status"] == "ok" and probe.get("ok") and probe.get("available"):
                    model = probe.get("model") or "model"
                    summary = f"available · {model}"
                    # Treat successful free-tier probe as free/promo for tag color
                    if q_src.get("unlimited_or_free") is None:
                        q_src = {**q_src, "unlimited_or_free": True, "ok": True}
                elif st["status"] == "ok":
                    summary = "free / quota not fetched"
                    if q_src.get("unlimited_or_free") is None:
                        q_src = {**q_src, "unlimited_or_free": True, "ok": True}
                elif st["status"] == "probe_fail":
                    summary = "probe failed · retry pending"
                elif st["status"] == "cooldown":
                    summary = "cooldown"
                elif st["status"] in ("expired", "disabled", "quota_disabled"):
                    summary = st["status"].replace("_", " ")
                else:
                    summary = "unknown"

            items.append(
                {
                    "id": aid,
                    "email": a.get("email") or "",
                    "user_id": a.get("user_id") or "",
                    "team_id": a.get("team_id") or "",
                    "expires_at": a.get("expires_at"),
                    "expired": bool(a.get("expired")),
                    "has_refresh_token": a.get("has_refresh_token"),
                    "create_time": a.get("create_time"),
                    "auth_mode": a.get("auth_mode"),
                    "enabled": a.get("enabled", True),
                    "in_cooldown": bool(a.get("in_cooldown")),
                    "cooldown_until": a.get("cooldown_until"),
                    "disabled_for_quota": bool(a.get("disabled_for_quota")),
                    "disabled_reason": a.get("disabled_reason"),
                    "blocked_model_ids": blocked_ids,
                    "blocked_models": a.get("blocked_models") or {},
                    "last_error": (a.get("last_error") or "")[:300],
                    "last_probe": a.get("last_probe"),
                    "request_count": a.get("request_count"),
                    "success_count": a.get("success_count"),
                    "fail_count": a.get("fail_count"),
                    "last_used_at": a.get("last_used_at"),
                    "status": st["status"],
                    "status_label": st["label"],
                    "status_class": st["class"],
                    "status_reason": st.get("reason") or "",
                    "quota": {
                        "ok": q_src.get("ok", True if (last_q or summary) else None),
                        "unlimited_or_free": q_src.get("unlimited_or_free"),
                        "exhausted": exhausted,
                        "summary": summary,
                        "used": q_src.get("used"),
                        "remaining": q_src.get("remaining"),
                        "monthly_limit": q_src.get("monthly_limit"),
                    },
                }
            )

        # Sort: blocked/disabled first so problems are visible at the top
        _rank = {
            "expired": 0,
            "disabled": 1,
            "quota_disabled": 2,
            "blocked": 3,
            "cooldown": 4,
            "probe_fail": 5,
            "ok": 6,
        }
        items.sort(key=lambda x: (_rank.get(x.get("status") or "ok", 9), x.get("email") or ""))

        pool_mode = pool.get("mode") or accounts_body.get("account_mode")
        out: dict[str, Any] = {
            "ok": True,
            "account_count": accounts_body.get("account_count", len(items)),
            "active_count": accounts_body.get(
                "active_count", pool.get("enabled", len(items))
            ),
            "account_mode": pool_mode,
            "pool_summary": {
                "total": pool.get("total", len(items)),
                "live": pool.get("live"),
                "enabled": pool.get("enabled"),
                "in_cooldown": pool.get("in_cooldown", cooldown_count),
                "quota_disabled": pool.get("quota_disabled"),
                "model_blocked": pool.get("model_blocked", blocked_count),
            },
            "status_summary": {
                "ok": ok_count,
                "blocked": blocked_count,
                "cooldown": cooldown_count,
                "disabled": disabled_count,
                "other": max(
                    0,
                    len(items)
                    - ok_count
                    - blocked_count
                    - cooldown_count
                    - disabled_count,
                ),
            },
            "quota_summary": {
                "count": quota_body.get("count", len(items)),
                "active_ok_count": ok_count,
                "exhausted_count": blocked_count + disabled_count,
                "blocked_count": blocked_count,
                "cooldown_count": cooldown_count,
                "fetched_at": quota_body.get("fetched_at") or time.time(),
                "error": quota_body.get("error"),
            },
            "accounts": items,
            "fetched_at": time.time(),
            "cached": False,
        }
        with _accounts_cache_lock:
            _accounts_cache = dict(out)
            _accounts_cache_at = time.time()
        return out
    except Exception as e:
        return {"ok": False, "error": str(e), "accounts": []}


def api_register_status() -> dict[str, Any]:
    with _reg_lock:
        return {
            "running": _reg["running"],
            "pid": _reg["pid"],
            "started_at": _reg["started_at"],
            "finished_at": _reg["finished_at"],
            "count": _reg["count"],
            "workers": _reg["workers"],
            "exit_code": _reg["exit_code"],
            "output_dir": _reg["output_dir"],
            "error": _reg["error"],
            "source": _reg.get("source"),
            "queued": int(_reg_queue_count or 0),
            "log_line_count": len(_reg["log_lines"]),
            "log_tail": _reg["log_lines"][-80:],
        }


def _persist_reg_queue_unlocked() -> None:
    """Write queue to disk (caller must hold _reg_lock)."""
    try:
        _REG_QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _REG_QUEUE_PATH.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(
                {
                    "count": int(_reg_queue_count or 0),
                    "workers": int(_reg_queue_workers or 2),
                    "updated_at": time.time(),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        os.replace(str(tmp), str(_REG_QUEUE_PATH))
    except Exception:
        pass


def _load_reg_queue() -> None:
    """Restore queue left behind by a previous dashboard process."""
    global _reg_queue_count, _reg_queue_workers
    try:
        if not _REG_QUEUE_PATH.is_file():
            return
        data = json.loads(_REG_QUEUE_PATH.read_text(encoding="utf-8"))
        n = max(0, min(50, int(data.get("count") or 0)))
        w = max(1, min(10, int(data.get("workers") or 2)))
        if n > 0:
            with _reg_lock:
                _reg_queue_count = max(int(_reg_queue_count or 0), n)
                _reg_queue_workers = w
            print(f"[dashboard] restored register queue count={n} workers={w}")
    except Exception as e:
        print(f"[dashboard] register queue load failed: {e}")


def _drain_reg_queue_if_idle() -> None:
    """If nothing running and disk/memory queue > 0, start it."""
    global _reg_queue_count
    with _reg_lock:
        if _reg.get("running"):
            return
        queued = int(_reg_queue_count or 0)
        qworkers = int(_reg_queue_workers or 2)
        if queued <= 0:
            return
        _reg_queue_count = 0
        _persist_reg_queue_unlocked()
    _append_log(f"[auto-queue] resume queued registration count={queued}")
    t = threading.Thread(
        target=_run_registration,
        args=(queued, qworkers),
        kwargs={"source": "auto_queue_resume"},
        daemon=True,
        name="grok-register-queue",
    )
    t.start()


def api_register_start(
    count: int,
    workers: int,
    *,
    source: str = "manual",
) -> dict[str, Any]:
    """Start registration, or queue if already running (for auto_block hooks)."""
    global _reg_queue_count, _reg_queue_workers
    count = max(1, min(int(count), 50))
    workers = max(1, min(int(workers), 10))
    with _reg_lock:
        if _reg["running"]:
            # Auto-block / concurrent hooks: accumulate instead of failing
            _reg_queue_count = min(50, int(_reg_queue_count or 0) + count)
            _reg_queue_workers = workers
            pending = _reg_queue_count
            _persist_reg_queue_unlocked()
            # Safe with RLock; keep message short for UI
            _append_log(
                f"[auto-queue] +{count} while running → pending={pending} source={source}"
            )
            st = {
                "running": True,
                "pid": _reg.get("pid"),
                "started_at": _reg.get("started_at"),
                "finished_at": _reg.get("finished_at"),
                "count": _reg.get("count"),
                "workers": _reg.get("workers"),
                "exit_code": _reg.get("exit_code"),
                "output_dir": _reg.get("output_dir"),
                "error": _reg.get("error"),
                "source": _reg.get("source"),
                "queued": pending,
                "log_line_count": len(_reg.get("log_lines") or []),
                "log_tail": (_reg.get("log_lines") or [])[-40:],
            }
            return {
                "ok": True,
                "queued": True,
                "pending": pending,
                "status": st,
            }
    t = threading.Thread(
        target=_run_registration,
        args=(count, workers),
        kwargs={"source": source or "manual"},
        daemon=True,
        name="grok-register",
    )
    t.start()
    time.sleep(0.3)
    return {"ok": True, "queued": False, "status": api_register_status()}


def api_register_stop() -> dict[str, Any]:
    stopped = _stop_registration()
    return {"ok": stopped, "status": api_register_status()}


def api_overview() -> dict[str, Any]:
    services = api_services()
    # Prefer /health for counts (no admin auth, fast). Fall back to admin list.
    accounts_brief: dict[str, Any] = {"ok": False}
    try:
        status, body = _http("GET", f"{GROKCLI_URL}/health", timeout=2)
        if status == 200 and isinstance(body, dict):
            accounts_brief = {
                "ok": True,
                "account_count": body.get("accounts_total"),
                "active_count": body.get("accounts_live") or body.get("accounts_enabled"),
                "account_mode": body.get("account_mode"),
                "model_blocked": (body.get("model_health") or {}).get("last", {}).get(
                    "auto_action"
                )
                if isinstance(body.get("model_health"), dict)
                else None,
            }
        else:
            raise RuntimeError(f"health {status}")
    except Exception:
        try:
            body = _grokcli("/admin/api/accounts", timeout=4)
            pool = body.get("pool") if isinstance(body, dict) else {}
            if not isinstance(pool, dict):
                pool = {}
            accounts_brief = {
                "ok": True,
                "account_count": body.get("account_count") or pool.get("total"),
                "active_count": body.get("active_count") or pool.get("enabled"),
                "account_mode": pool.get("mode") or body.get("account_mode"),
                "model_blocked": pool.get("model_blocked"),
                "in_cooldown": pool.get("in_cooldown"),
                "quota_disabled": pool.get("quota_disabled"),
            }
        except Exception as e:
            accounts_brief = {"ok": False, "error": str(e)[:120]}
    usage_brief: dict[str, Any] = {"ok": False}
    with _usage_lock:
        if _usage_latest:
            usage_brief = {
                "ok": True,
                "tokens_actual": _usage_latest.get("tokens_actual"),
                "tokens_limit": _usage_latest.get("tokens_limit"),
                "usd_equiv": _usage_latest.get("usd_equiv"),
                "ts": _usage_latest.get("ts"),
            }
    # auto-register status from grokcli /health (any worker; disk-merged)
    auto_reg: dict[str, Any] = {"ok": False}
    try:
        status, body = _http("GET", f"{GROKCLI_URL}/health", timeout=2)
        if status == 200 and isinstance(body, dict):
            ar = body.get("auto_register") if isinstance(body.get("auto_register"), dict) else {}
            auto_reg = {
                "ok": True,
                "enabled": bool(ar.get("enabled")),
                "alive": bool(ar.get("alive", ar.get("enabled"))),
                "pending": ar.get("pending"),
                "fail_streak": ar.get("fail_streak"),
                "last_fire_at": ar.get("last_fire_at"),
                "last_ok": (ar.get("last_result") or {}).get("ok")
                if isinstance(ar.get("last_result"), dict)
                else None,
                "watchdog_running": ar.get("watchdog_running"),
                "url": ar.get("url"),
                "dashboard_ok": ar.get("dashboard_ok"),
            }
    except Exception as e:
        auto_reg = {"ok": False, "error": str(e)[:120]}
    return {
        "services": services,
        "accounts": accounts_brief,
        "register": api_register_status(),
        "usage": usage_brief,
        "auto_register": auto_reg,
        "ts": time.time(),
    }


# ---------------------------------------------------------------------------
# Usage history (tokens over time + USD equivalent)
# ---------------------------------------------------------------------------

def _parse_token_actual_limit(text: str) -> tuple[int, int] | None:
    if not text:
        return None
    m = _TOKEN_USAGE_RE.search(text)
    if not m:
        return None
    try:
        actual = int(m.group(1).replace(",", ""))
        limit = int(m.group(2).replace(",", ""))
        return actual, limit
    except (TypeError, ValueError):
        return None


def _account_token_usage(a: dict[str, Any]) -> tuple[int, int] | None:
    """Extract free-usage tokens (actual, limit) from probe/error/block fields."""
    texts: list[str] = []
    last_err = a.get("last_error")
    if last_err:
        texts.append(str(last_err))
    probe = a.get("last_probe")
    if isinstance(probe, dict):
        if probe.get("error"):
            texts.append(str(probe.get("error")))
        texts.append(json.dumps(probe, ensure_ascii=False))
    blocked = a.get("blocked_models")
    if isinstance(blocked, dict):
        for meta in blocked.values():
            if isinstance(meta, dict):
                if meta.get("reason"):
                    texts.append(str(meta.get("reason")))
            elif meta:
                texts.append(str(meta))
        texts.append(json.dumps(blocked, ensure_ascii=False))
    disabled_reason = a.get("disabled_reason")
    if disabled_reason:
        texts.append(str(disabled_reason))
    for t in texts:
        hit = _parse_token_actual_limit(t)
        if hit:
            return hit
    return None


def _pool_accounts_for_usage() -> list[dict[str, Any]]:
    """Best-effort account list from admin API, else settings.json on disk."""
    try:
        body = _grokcli("/admin/api/accounts", timeout=10)
        pool = body.get("pool") if isinstance(body, dict) else {}
        if isinstance(pool, dict):
            accs = pool.get("accounts")
            if isinstance(accs, list) and accs:
                return [a for a in accs if isinstance(a, dict)]
            # dict-keyed pool (rare shape from some endpoints)
            if accs is None and pool:
                vals = [
                    v
                    for v in pool.values()
                    if isinstance(v, dict)
                    and (
                        "request_count" in v
                        or "last_probe" in v
                        or "blocked_models" in v
                    )
                ]
                if vals:
                    return vals
        if isinstance(body, dict) and isinstance(body.get("accounts"), list):
            return [a for a in body["accounts"] if isinstance(a, dict)]
    except Exception:
        pass

    # Fallback: read grokcli settings.json (same host layout)
    candidates = [
        Path(os.getenv("GROKCLI_SETTINGS", "")),
        Path.home() / "grokcli-2api" / "data" / "settings.json",
        ROOT.parent / "grokcli-2api" / "data" / "settings.json",
        Path("/home/eureka/grokcli-2api/data/settings.json"),
    ]
    for p in candidates:
        if not p or not str(p) or not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            pool = data.get("account_pool")
            if isinstance(pool, dict):
                # map keyed by auth id
                if all(isinstance(v, dict) for v in pool.values()):
                    return list(pool.values())
                accs = pool.get("accounts")
                if isinstance(accs, list):
                    return [a for a in accs if isinstance(a, dict)]
                if isinstance(accs, dict):
                    return list(accs.values())
        except Exception:
            continue
    return []


def _tokens_to_usd(tokens: int | float, price_per_m: float | None = None) -> float:
    rate = GROK_USD_PER_MTOKENS if price_per_m is None else float(price_per_m)
    return round(float(tokens) / 1_000_000.0 * rate, 4)


def collect_usage_snapshot() -> dict[str, Any]:
    """Build one usage sample from current pool state.

    Primary metric: gateway cumulative tokens (sum of recorded completion usage).
    Secondary: free-usage rolling actual/limit from probe errors (often flat when
    all accounts are blocked at the free cap).
    """
    free_actual = 0
    free_limit = 0
    with_free = 0
    req = succ = fail = 0
    cum_prompt = cum_comp = cum_total = 0
    billing_used = 0.0
    billing_limit = 0.0
    billing_n = 0
    usage_totals_api: dict[str, Any] | None = None
    accounts: list[dict[str, Any]] = []

    # Single admin fetch for accounts + usage_totals
    try:
        body = _grokcli("/admin/api/accounts", timeout=10)
        pool = body.get("pool") if isinstance(body, dict) else {}
        if isinstance(pool, dict):
            if isinstance(pool.get("usage_totals"), dict):
                usage_totals_api = pool["usage_totals"]
            accs = pool.get("accounts")
            if isinstance(accs, list) and accs:
                accounts = [a for a in accs if isinstance(a, dict)]
        if not accounts and isinstance(body, dict) and isinstance(body.get("accounts"), list):
            accounts = [a for a in body["accounts"] if isinstance(a, dict)]
    except Exception:
        usage_totals_api = None
    if not accounts:
        accounts = _pool_accounts_for_usage()

    for a in accounts:
        req += int(a.get("request_count") or 0)
        succ += int(a.get("success_count") or 0)
        fail += int(a.get("fail_count") or 0)
        cum_prompt += int(a.get("tokens_prompt") or 0)
        cum_comp += int(a.get("tokens_completion") or 0)
        cum_total += int(a.get("tokens_total") or 0)
        hit = _account_token_usage(a)
        if hit:
            free_actual += hit[0]
            free_limit += hit[1]
            with_free += 1
        last_q = a.get("last_quota") if isinstance(a.get("last_quota"), dict) else {}
        used = last_q.get("used")
        mlim = last_q.get("monthly_limit")
        if (
            used is not None
            and mlim is not None
            and not last_q.get("unlimited_or_free")
            and float(mlim or 0) > 0
        ):
            try:
                billing_used += float(used)
                billing_limit += float(mlim)
                billing_n += 1
            except (TypeError, ValueError):
                pass

    if usage_totals_api:
        cum_prompt = max(cum_prompt, int(usage_totals_api.get("tokens_prompt") or 0))
        cum_comp = max(cum_comp, int(usage_totals_api.get("tokens_completion") or 0))
        cum_total = max(cum_total, int(usage_totals_api.get("tokens_total") or 0))

    # Primary chart series: cumulative gateway tokens (rises with real traffic).
    # Fall back to free-usage actual only when cumulative not yet instrumented.
    primary_tokens = int(cum_total) if cum_total > 0 else int(free_actual)
    price = GROK_USD_PER_MTOKENS
    usd_equiv = _tokens_to_usd(primary_tokens, price)
    # Split pricing when we have prompt/completion breakdown
    usd_split = None
    if cum_prompt > 0 or cum_comp > 0:
        usd_split = round(
            cum_prompt / 1_000_000.0 * GROK_USD_INPUT_PER_M
            + cum_comp / 1_000_000.0 * GROK_USD_OUTPUT_PER_M,
            4,
        )
        # Prefer split pricing for USD curve when available
        usd_equiv = usd_split

    free_pct = None
    if free_limit > 0:
        free_pct = round(100.0 * free_actual / free_limit, 2)

    return {
        "ts": time.time(),
        "accounts_total": len(accounts),
        "accounts_with_usage": with_free,
        # Primary (gateway cumulative) — this should rise as requests succeed
        "tokens_cum": int(cum_total),
        "tokens_prompt": int(cum_prompt),
        "tokens_completion": int(cum_comp),
        "tokens_actual": int(primary_tokens),  # chart primary Y (compat key)
        "tokens_limit": int(free_limit),  # free-tier pool limit (secondary)
        # Free-usage rolling window (often flat when blocked)
        "free_tokens_actual": int(free_actual),
        "free_tokens_limit": int(free_limit),
        "tokens_pct": free_pct,
        "request_count": req,
        "success_count": succ,
        "fail_count": fail,
        "usd_equiv": usd_equiv,
        "usd_free_tier": 0.0,  # free-usage accounts: cash cost is $0
        "price_per_m": price,
        "price_input_per_m": GROK_USD_INPUT_PER_M,
        "price_output_per_m": GROK_USD_OUTPUT_PER_M,
        "billing_used_usd": round(billing_used, 4) if billing_n else None,
        "billing_limit_usd": round(billing_limit, 4) if billing_n else None,
        "billing_accounts": billing_n,
        "metric": "cumulative" if cum_total > 0 else "free_usage_snapshot",
    }


def _load_usage_history() -> None:
    global _usage_series, _usage_latest
    USAGE_DIR.mkdir(parents=True, exist_ok=True)
    series: list[dict[str, Any]] = []
    if USAGE_HISTORY_PATH.is_file():
        try:
            with USAGE_HISTORY_PATH.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(row, dict) and row.get("ts"):
                        series.append(row)
        except Exception as e:
            sys.stderr.write(f"[usage] load history failed: {e}\n")
    cutoff = time.time() - USAGE_RETENTION_DAYS * 86400
    series = [r for r in series if float(r.get("ts") or 0) >= cutoff]
    series.sort(key=lambda r: float(r.get("ts") or 0))
    if len(series) > _MAX_USAGE_POINTS:
        series = series[-_MAX_USAGE_POINTS:]
    with _usage_lock:
        _usage_series = series
        _usage_latest = series[-1] if series else None


def _append_usage_sample(sample: dict[str, Any], *, force: bool = False) -> None:
    """Append sample if interval elapsed (or force). Dedupes near-identical stamps."""
    global _usage_latest
    USAGE_DIR.mkdir(parents=True, exist_ok=True)
    with _usage_lock:
        if not force and _usage_series:
            last_ts = float(_usage_series[-1].get("ts") or 0)
            if time.time() - last_ts < max(15.0, USAGE_SAMPLE_INTERVAL * 0.4):
                return
        _usage_series.append(sample)
        if len(_usage_series) > _MAX_USAGE_POINTS:
            del _usage_series[: len(_usage_series) - _MAX_USAGE_POINTS]
        _usage_latest = sample
        # prune file occasionally by rewriting when too large
        rewrite = len(_usage_series) % 200 == 0
        try:
            if rewrite:
                cutoff = time.time() - USAGE_RETENTION_DAYS * 86400
                kept = [r for r in _usage_series if float(r.get("ts") or 0) >= cutoff]
                _usage_series[:] = kept
                with USAGE_HISTORY_PATH.open("w", encoding="utf-8") as f:
                    for r in _usage_series:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")
            else:
                with USAGE_HISTORY_PATH.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(sample, ensure_ascii=False) + "\n")
        except Exception as e:
            sys.stderr.write(f"[usage] write history failed: {e}\n")


def _usage_range_seconds(range_key: str) -> float | None:
    key = (range_key or "24h").strip().lower()
    mapping = {
        "1h": 3600.0,
        "6h": 6 * 3600.0,
        "12h": 12 * 3600.0,
        "24h": 86400.0,
        "1d": 86400.0,
        "7d": 7 * 86400.0,
        "14d": 14 * 86400.0,
        "all": None,
    }
    if key in mapping:
        return mapping[key]
    # allow e.g. 48h
    m = re.fullmatch(r"(\d+)([hd])", key)
    if m:
        n = int(m.group(1))
        return float(n * (3600 if m.group(2) == "h" else 86400))
    return 86400.0


def _point_primary_tokens(p: dict[str, Any]) -> int:
    """Prefer cumulative gateway tokens; fall back to free-usage / legacy field."""
    for k in ("tokens_cum", "tokens_actual", "free_tokens_actual"):
        v = p.get(k)
        if v is not None:
            try:
                return int(v)
            except (TypeError, ValueError):
                pass
    return 0


def _series_deltas(points: list[dict[str, Any]]) -> dict[str, Any]:
    """Sum per-bucket (15m) usage over the visible window, or fall back to cum Δ."""
    if not points:
        return {
            "delta_tokens": 0,
            "delta_usd": 0.0,
            "rate_tokens_per_hour": 0.0,
            "rate_usd_per_hour": 0.0,
            "window_sec": 0.0,
        }
    # Prefer already-bucketed series (tokens_15m / usd_15m)
    if any(p.get("tokens_15m") is not None or p.get("metric") == "per_15m" for p in points):
        pos_tok = 0
        delta_usd = 0.0
        for p in points:
            try:
                pos_tok += max(0, int(p.get("tokens_15m") if p.get("tokens_15m") is not None else p.get("tokens_actual") or 0))
            except (TypeError, ValueError):
                pass
            try:
                delta_usd += max(0.0, float(p.get("usd_15m") if p.get("usd_15m") is not None else p.get("usd_equiv") or 0))
            except (TypeError, ValueError):
                pass
        delta_usd = round(delta_usd, 4)
        t0 = float(points[0].get("bucket_start") or points[0].get("ts") or 0)
        t1 = float(points[-1].get("bucket_end") or points[-1].get("ts") or 0)
        window = max(0.0, t1 - t0)
        if window <= 0 and len(points) >= 1:
            window = float(USAGE_BUCKET_SEC) * max(1, len(points))
        hours = window / 3600.0 if window > 0 else 0.0
        return {
            "delta_tokens": pos_tok,
            "delta_usd": delta_usd,
            "rate_tokens_per_hour": round(pos_tok / hours, 1) if hours > 0 else 0.0,
            "rate_usd_per_hour": round(delta_usd / hours, 4) if hours > 0 else 0.0,
            "window_sec": round(window, 1),
        }

    if len(points) < 2:
        return {
            "delta_tokens": 0,
            "delta_usd": 0.0,
            "rate_tokens_per_hour": 0.0,
            "rate_usd_per_hour": 0.0,
            "window_sec": 0.0,
        }
    first = _point_primary_tokens(points[0])
    last = _point_primary_tokens(points[-1])
    using_cum = any(int(p.get("tokens_cum") or 0) > 0 for p in points[-5:])
    if using_cum:
        pos_tok = max(0, last - first)
    else:
        pos_tok = 0
        for i in range(1, len(points)):
            a = _point_primary_tokens(points[i])
            b = _point_primary_tokens(points[i - 1])
            if a > b:
                pos_tok += a - b
    t0 = float(points[0].get("ts") or 0)
    t1 = float(points[-1].get("ts") or 0)
    window = max(0.0, t1 - t0)
    hours = window / 3600.0 if window > 0 else 0.0
    u0 = float(points[0].get("usd_equiv") or 0)
    u1 = float(points[-1].get("usd_equiv") or 0)
    if using_cum and u1 >= u0:
        delta_usd = round(u1 - u0, 4)
    else:
        price = float(points[-1].get("price_per_m") or GROK_USD_PER_MTOKENS)
        delta_usd = _tokens_to_usd(pos_tok, price)
    return {
        "delta_tokens": pos_tok,
        "delta_usd": delta_usd,
        "rate_tokens_per_hour": round(pos_tok / hours, 1) if hours > 0 else 0.0,
        "rate_usd_per_hour": round(delta_usd / hours, 4) if hours > 0 else 0.0,
        "window_sec": round(window, 1),
    }


def _bucket_start(ts: float, bucket_sec: int = USAGE_BUCKET_SEC) -> int:
    t = int(float(ts))
    b = int(bucket_sec)
    return (t // b) * b


def _to_15m_series(
    raw_points: list[dict[str, Any]],
    *,
    window_start: float,
    window_end: float,
    bucket_sec: int = USAGE_BUCKET_SEC,
) -> list[dict[str, Any]]:
    """Convert cumulative samples → per-bucket usage points for the chart.

    Y value = tokens/USD consumed *within that 15-minute window* (positive
    cumulative deltas only). Empty buckets are filled with 0 so the fixed
    time window still draws a continuous line.
    """
    bucket_sec = max(60, int(bucket_sec))
    pts = sorted(
        (p for p in raw_points if p and p.get("ts") is not None),
        key=lambda p: float(p.get("ts") or 0),
    )
    # Accumulators keyed by bucket start
    tok: dict[int, int] = {}
    usd: dict[int, float] = {}
    prompt: dict[int, int] = {}
    comp: dict[int, int] = {}
    samples: dict[int, int] = {}
    last_cum: dict[int, int] = {}
    last_free: dict[int, int] = {}
    last_req: dict[int, tuple[int, int, int]] = {}

    def _cum_usd(p: dict[str, Any]) -> float:
        try:
            return float(p.get("usd_equiv") or 0)
        except (TypeError, ValueError):
            return 0.0

    def _cum_tok(p: dict[str, Any]) -> int:
        return _point_primary_tokens(p)

    for i in range(1, len(pts)):
        p0, p1 = pts[i - 1], pts[i]
        t1 = float(p1.get("ts") or 0)
        if t1 <= 0:
            continue
        d_tok = max(0, _cum_tok(p1) - _cum_tok(p0))
        d_usd = max(0.0, _cum_usd(p1) - _cum_usd(p0))
        d_prompt = max(
            0, int(p1.get("tokens_prompt") or 0) - int(p0.get("tokens_prompt") or 0)
        )
        d_comp = max(
            0,
            int(p1.get("tokens_completion") or 0)
            - int(p0.get("tokens_completion") or 0),
        )
        # Attribute the step to the bucket where the later sample lands
        b = _bucket_start(t1, bucket_sec)
        tok[b] = tok.get(b, 0) + d_tok
        usd[b] = usd.get(b, 0.0) + d_usd
        prompt[b] = prompt.get(b, 0) + d_prompt
        comp[b] = comp.get(b, 0) + d_comp
        samples[b] = samples.get(b, 0) + 1
        last_cum[b] = _cum_tok(p1)
        try:
            last_free[b] = int(p1.get("free_tokens_actual") or 0)
        except (TypeError, ValueError):
            last_free[b] = last_free.get(b, 0)
        last_req[b] = (
            int(p1.get("success_count") or 0),
            int(p1.get("fail_count") or 0),
            int(p1.get("request_count") or 0),
        )

    # Wall-clock aligned buckets covering the selected window
    b0 = _bucket_start(window_start, bucket_sec)
    b_end = _bucket_start(window_end, bucket_sec)
    # Include the open current bucket
    out: list[dict[str, Any]] = []
    b = b0
    while b <= b_end:
        t15 = int(tok.get(b, 0))
        u15 = round(float(usd.get(b, 0.0)), 4)
        # If we only have prompt/comp deltas, recompute usd from rates
        if u15 <= 0 and (prompt.get(b, 0) or comp.get(b, 0)):
            u15 = round(
                prompt.get(b, 0) / 1_000_000.0 * GROK_USD_INPUT_PER_M
                + comp.get(b, 0) / 1_000_000.0 * GROK_USD_OUTPUT_PER_M,
                4,
            )
        elif u15 <= 0 and t15 > 0:
            u15 = _tokens_to_usd(t15, GROK_USD_PER_MTOKENS)
        ok_n, fail_n, req_n = last_req.get(b, (0, 0, 0))
        # Place point at bucket end (or now for the open bucket) so the line
        # sits on the interval that just finished / is in progress.
        point_ts = min(float(b + bucket_sec), float(window_end))
        if point_ts < window_start:
            b += bucket_sec
            continue
        out.append(
            {
                "ts": point_ts,
                "bucket_start": float(b),
                "bucket_end": float(b + bucket_sec),
                "bucket_sec": bucket_sec,
                "tokens_15m": t15,
                "usd_15m": u15,
                # Chart primary fields (same UI keys as before)
                "tokens_actual": t15,
                "usd_equiv": u15,
                "usd_free_tier": 0.0,
                "tokens_cum": int(last_cum.get(b, 0)),
                "tokens_prompt": int(prompt.get(b, 0)),
                "tokens_completion": int(comp.get(b, 0)),
                "free_tokens_actual": int(last_free.get(b, 0)),
                "sample_steps": int(samples.get(b, 0)),
                "success_count": ok_n,
                "fail_count": fail_n,
                "request_count": req_n,
                "metric": "per_15m",
                "price_per_m": GROK_USD_PER_MTOKENS,
                "price_input_per_m": GROK_USD_INPUT_PER_M,
                "price_output_per_m": GROK_USD_OUTPUT_PER_M,
            }
        )
        b += bucket_sec
    return out


def _normalize_usage_point(p: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy free-usage samples so charts use consistent metrics."""
    out = dict(p)
    cum = out.get("tokens_cum")
    try:
        cum_i = int(cum) if cum is not None else 0
    except (TypeError, ValueError):
        cum_i = 0
    free_a = out.get("free_tokens_actual")
    if free_a is None and out.get("metric") != "cumulative":
        # Pre-instrumentation samples stored free-usage in tokens_actual
        if cum_i <= 0 and out.get("tokens_actual") is not None:
            try:
                free_a = int(out.get("tokens_actual") or 0)
            except (TypeError, ValueError):
                free_a = 0
    try:
        free_a_i = int(free_a or 0)
    except (TypeError, ValueError):
        free_a_i = 0
    free_l = out.get("free_tokens_limit")
    if free_l is None:
        free_l = out.get("tokens_limit")
    try:
        free_l_i = int(free_l or 0)
    except (TypeError, ValueError):
        free_l_i = 0

    prompt = int(out.get("tokens_prompt") or 0)
    comp = int(out.get("tokens_completion") or 0)
    if cum_i > 0:
        if prompt > 0 or comp > 0:
            usd = round(
                prompt / 1_000_000.0 * GROK_USD_INPUT_PER_M
                + comp / 1_000_000.0 * GROK_USD_OUTPUT_PER_M,
                4,
            )
        else:
            usd = _tokens_to_usd(cum_i, GROK_USD_PER_MTOKENS)
        metric = "cumulative"
        primary = cum_i
    else:
        # No gateway cumulative yet — do NOT paint free-usage as "spend"
        usd = 0.0
        metric = "cumulative"  # chart still uses cum axis (flat at 0)
        primary = 0

    out["tokens_cum"] = cum_i
    out["free_tokens_actual"] = free_a_i
    out["free_tokens_limit"] = free_l_i
    out["tokens_actual"] = primary  # always cumulative primary for chart
    out["tokens_limit"] = free_l_i
    out["usd_equiv"] = usd
    out["usd_free_tier"] = 0.0
    out["metric"] = metric
    return out


def api_usage(range_key: str = "24h") -> dict[str, Any]:
    span = _usage_range_seconds(range_key)
    now = time.time()
    with _usage_lock:
        full = list(_usage_series)
        latest = dict(_usage_latest) if _usage_latest else None
    # Fixed chart window for the selected range (so 1h vs 24h look different
    # even when all samples sit in the last few minutes).
    if span is None:
        # "all": from first retained sample → now (min 1h so axis isn't a point)
        if full:
            window_start = float(full[0].get("ts") or now) - 60.0
        else:
            window_start = now - 3600.0
        window_start = min(window_start, now - 3600.0)
    else:
        window_start = now - span
    window_end = now

    # Include a little lookback so the first 15m bucket can compute Δ from a
    # prior cumulative sample (otherwise first step is always 0).
    lookback = window_start - float(USAGE_BUCKET_SEC)
    raw_window = [
        p
        for p in full
        if lookback <= float(p.get("ts") or 0) <= window_end + 1.0
    ]
    raw_window = [_normalize_usage_point(p) for p in raw_window]
    if latest:
        latest_raw = _normalize_usage_point(latest)
    else:
        latest_raw = None

    # Aggregate cumulative samples → per-15-minute usage for the chart
    series = _to_15m_series(
        raw_window,
        window_start=window_start,
        window_end=window_end,
        bucket_sec=USAGE_BUCKET_SEC,
    )
    # Downsample buckets only if extreme (e.g. 14d @ 15m ≈ 1344 pts)
    max_pts = 720
    if len(series) > max_pts:
        step = max(1, len(series) // max_pts)
        first = series[0]
        last = series[-1]
        mid = series[::step]
        series = mid
        if series[0].get("ts") != first.get("ts"):
            series = [first] + series
        if series[-1].get("ts") != last.get("ts"):
            series.append(last)

    deltas = _series_deltas(series)
    # data span = time span of raw samples that contributed (not empty buckets)
    raw_in_win = [
        p
        for p in raw_window
        if window_start <= float(p.get("ts") or 0) <= window_end + 1.0
    ]
    data_start = float(raw_in_win[0]["ts"]) if raw_in_win else None
    data_end = float(raw_in_win[-1]["ts"]) if raw_in_win else None
    data_span_sec = (
        round(data_end - data_start, 1) if data_start is not None and data_end else 0.0
    )
    tracking_started_at = None
    with _usage_lock:
        if _usage_series:
            tracking_started_at = float(_usage_series[0].get("ts") or 0) or None
    if tracking_started_at is None and USAGE_HISTORY_PATH.is_file():
        try:
            tracking_started_at = float(USAGE_HISTORY_PATH.stat().st_ctime)
        except Exception:
            tracking_started_at = None
    pre_free = None
    if latest_raw:
        try:
            pre_free = int(latest_raw.get("free_tokens_actual") or 0)
        except (TypeError, ValueError):
            pre_free = None

    # "latest" for stats = most recent non-empty 15m bucket, else last bucket
    latest_15: dict[str, Any] | None = None
    for p in reversed(series):
        if int(p.get("tokens_15m") or 0) > 0 or float(p.get("usd_15m") or 0) > 0:
            latest_15 = p
            break
    if latest_15 is None and series:
        latest_15 = series[-1]
    if latest_15 is None and latest_raw:
        latest_15 = {
            **latest_raw,
            "tokens_15m": 0,
            "usd_15m": 0.0,
            "tokens_actual": 0,
            "usd_equiv": 0.0,
            "metric": "per_15m",
        }
    elif latest_15 and latest_raw:
        # Keep pool counters / free snapshot from live sample
        latest_15 = {
            **latest_15,
            "accounts_total": latest_raw.get("accounts_total"),
            "accounts_with_usage": latest_raw.get("accounts_with_usage"),
            "success_count": latest_raw.get("success_count"),
            "fail_count": latest_raw.get("fail_count"),
            "request_count": latest_raw.get("request_count"),
            "free_tokens_actual": latest_raw.get("free_tokens_actual"),
            "free_tokens_limit": latest_raw.get("free_tokens_limit"),
            "tokens_cum_total": latest_raw.get("tokens_cum"),
        }

    return {
        "ok": True,
        "range": range_key or "24h",
        "mode": "per_15m",
        "bucket_sec": USAGE_BUCKET_SEC,
        "sample_interval_sec": USAGE_SAMPLE_INTERVAL,
        # Chart must use these for X domain (not data min/max alone)
        "window_start": window_start,
        "window_end": window_end,
        "window_sec": round(window_end - window_start, 1),
        "data_start": data_start,
        "data_end": data_end,
        "data_span_sec": data_span_sec,
        "tracking_started_at": tracking_started_at,
        "pre_tracking_note": (
            "曲线为每 15 分钟用量（由累计采样差分得到）。"
            "记账开始前的用量没有时间序列，无法回填到 15 分钟桶。"
            + (
                f" 当前 free 滚动窗合计约 {pre_free:,} tokens（含统计开始前）。"
                if pre_free
                else ""
            )
        ),
        "pricing": {
            "usd_per_m_tokens": GROK_USD_PER_MTOKENS,
            "usd_input_per_m": GROK_USD_INPUT_PER_M,
            "usd_output_per_m": GROK_USD_OUTPUT_PER_M,
            "note": (
                "Each chart point is tokens/USD used in that 15-minute bucket "
                "(positive delta of gateway cumulative counters). Free-tier "
                "cash = $0; usd uses commercial input/output rates."
            ),
        },
        "latest": latest_15,
        "deltas": deltas,
        "point_count": len(series),
        "series": series,
        "ts": now,
    }


def _usage_sampler_loop() -> None:
    # Initial sample soon after start
    time.sleep(2.0)
    while True:
        try:
            sample = collect_usage_snapshot()
            _append_usage_sample(sample)
        except Exception as e:
            sys.stderr.write(f"[usage] sample failed: {e}\n")
        time.sleep(max(15.0, USAGE_SAMPLE_INTERVAL))


def start_usage_sampler() -> None:
    _load_usage_history()
    # Always take one sample at boot so the chart is never empty after deploy
    try:
        _append_usage_sample(collect_usage_snapshot(), force=True)
    except Exception as e:
        sys.stderr.write(f"[usage] initial sample failed: {e}\n")
    t = threading.Thread(
        target=_usage_sampler_loop, name="usage-sampler", daemon=True
    )
    t.start()


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

def _load_html() -> str:
    return (Path(__file__).parent / "index.html").read_text(encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        # quieter access log
        if "/api/" in (args[0] if args else ""):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def log_error(self, fmt: str, *args: Any) -> None:
        # Suppress broken-pipe noise from polling clients that disconnect early
        msg = fmt % args if args else str(fmt)
        if "Broken pipe" in msg or "Connection reset" in msg:
            return
        super().log_error(fmt, *args)

    def _json(self, status: int, body: Any) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Client navigated away / poll aborted — not a server fault
            return

    def _html(self) -> None:
        raw = _load_html().encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def _read_json(self) -> dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except Exception:
            return {}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query or "")
        if path in {"/", "/index.html"}:
            self._html()
            return
        if path == "/api/overview":
            self._json(200, api_overview())
            return
        if path == "/api/services":
            self._json(200, api_services())
            return
        if path == "/api/accounts":
            self._json(200, api_accounts())
            return
        if path == "/api/usage":
            range_key = (qs.get("range") or ["24h"])[0]
            self._json(200, api_usage(range_key))
            return
        if path == "/api/register/status":
            self._json(200, api_register_status())
            return
        if path == "/api/health":
            self._json(200, {"status": "ok", "service": "grok-dashboard"})
            return
        self._json(404, {"error": "not found", "path": path})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        body = self._read_json()
        if path == "/api/register/start":
            count = body.get("count", 1)
            workers = body.get("workers", 1)
            source = str(body.get("source") or "manual")
            self._json(200, api_register_start(count, workers, source=source))
            return
        if path == "/api/register/stop":
            self._json(200, api_register_stop())
            return
        if path == "/api/services/refresh":
            self._json(200, api_services())
            return
        self._json(404, {"error": "not found", "path": path})


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Don't dump full tracebacks for client disconnects during polling."""

    # Default is only 5 — under poll storms + slow admin calls the accept
    # queue fills and the browser sees "timeout" even though the process lives.
    request_queue_size = 128
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:  # noqa: ANN001
        exc = sys.exc_info()[1]
        if isinstance(
            exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)
        ):
            return
        # Also swallow socketserver's "Exception occurred during processing"
        # wrapper when the root cause is a disconnect.
        msg = str(exc or "")
        if "Broken pipe" in msg or "Connection reset" in msg:
            return
        super().handle_error(request, client_address)


def main() -> int:
    start_usage_sampler()
    # Restore auto-register backlog that survived a previous crash/restart
    _load_reg_queue()
    threading.Thread(
        target=lambda: (time.sleep(2.0), _drain_reg_queue_if_idle()),
        name="reg-queue-resume",
        daemon=True,
    ).start()
    server = QuietThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Grok Dashboard → http://{HOST}:{PORT}")
    print(f"  ROOT={ROOT}")
    print(f"  GROKCLI={GROKCLI_URL}")
    print(
        f"  USAGE sample={USAGE_SAMPLE_INTERVAL}s "
        f"price=${GROK_USD_PER_MTOKENS}/Mtok history={USAGE_HISTORY_PATH}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutdown")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
