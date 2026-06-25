from __future__ import annotations

import os
import re
import time
import logging
from dataclasses import dataclass
from typing import Any

import httpx

SENSITIVE_KEYS = ("authorization", "api_key", "token", "password", "cookie", "secret")


@dataclass
class Inbox:
    email: str
    token: str = ""
    meta: dict[str, Any] | None = None


class EmailService:
    def __init__(self, settings: dict[str, Any], logger: logging.Logger):
        self.settings = settings
        self.logger = logger

    def acquire(self, service: str = "default", **opts: Any) -> Inbox:
        provider = self.settings.get("provider", "mock")
        self.logger.info("email.acquire provider=%s service=%s", provider, service)
        if provider == "mock":
            domain = self.settings.get("domain", "example.test")
            name = opts.get("name") or f"user-{int(time.time() * 1000)}"
            inbox = Inbox(email=f"{name}@{domain}")
            self.logger.info("email.acquire ok email=%s", inbox.email)
            return inbox
        if provider == "http_api":
            data = self._post("acquire", {"service": service, **opts})
            email = str(data.get("email") or "")
            if not email:
                raise ValueError("email api response missing email")
            inbox = Inbox(email=email, token=str(data.get("token") or ""), meta=data)
            self.logger.info("email.acquire ok email=%s", inbox.email)
            return inbox
        raise ValueError(f"unsupported email provider: {provider}")

    def wait(self, inbox: Inbox, kind: str = "code", timeout: int = 180, pattern: str | None = None) -> str:
        started = time.perf_counter()
        self.logger.info("email.wait start email=%s kind=%s timeout=%s", inbox.email, kind, timeout)
        if self.settings.get("provider", "mock") == "mock":
            self.logger.info("email.wait ok email=%s elapsed_ms=0", inbox.email)
            return "000000"
        data = self._post("wait", {"email": inbox.email, "token": inbox.token, "kind": kind, "timeout": timeout})
        text = str(data.get("value") or data.get("text") or "")
        if pattern:
            match = re.search(pattern, text)
            if not match:
                raise RuntimeError("email pattern not found")
            text = match.group(1) if match.groups() else match.group(0)
        if not text:
            raise RuntimeError("email wait returned empty value")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        self.logger.info("email.wait ok email=%s elapsed_ms=%s", inbox.email, elapsed_ms)
        return text

    def release(self, inbox: Inbox, success: bool) -> None:
        self.logger.info("email.release email=%s success=%s", inbox.email, success)
        if self.settings.get("provider", "mock") == "mock":
            return
        self._post("release", {"email": inbox.email, "token": inbox.token, "success": success})

    def _post(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = str(self.settings.get("api_url") or "").rstrip("/")
        if not url:
            raise ValueError("email.api_url is required for http_api")
        headers = _auth_headers(self.settings)
        response = httpx.post(f"{url}/{action}", json=payload, headers=headers, timeout=60)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("email api response must be object")
        return data


class CaptchaService:
    def __init__(self, settings: dict[str, Any], logger: logging.Logger):
        self.settings = settings
        self.logger = logger

    def solve(self, kind: str, *, url: str = "", sitekey: str = "", **opts: Any) -> str:
        provider = self.settings.get("provider", "none")
        self.logger.info("captcha.solve provider=%s kind=%s url=%s", provider, kind, url)
        if provider == "none":
            return ""
        if provider == "http_api":
            api_url = str(self.settings.get("api_url") or "").rstrip("/")
            if not api_url:
                raise ValueError("captcha.api_url is required for http_api")
            payload = {"kind": kind, "url": url, "sitekey": sitekey, **opts}
            response = httpx.post(api_url, json=payload, headers=_auth_headers(self.settings), timeout=180)
            response.raise_for_status()
            data = response.json()
            token = str(data.get("token") or data.get("result") or "")
            if not token:
                raise RuntimeError("captcha api returned empty token")
            self.logger.info("captcha.solve ok kind=%s", kind)
            return token
        raise ValueError(f"unsupported captcha provider: {provider}")


class ProxyService:
    def __init__(self, settings: dict[str, Any], logger: logging.Logger):
        self.settings = settings
        self.logger = logger

    def acquire(self, target: str, account: str = "", sticky: bool = True) -> dict[str, Any]:
        provider = self.settings.get("provider", "none")
        self.logger.info("proxy.acquire provider=%s target=%s account=%s", provider, target, account)
        if provider == "none":
            return {"proxy_url": ""}
        if provider == "static":
            proxy_url = str(self.settings.get("static_url") or "")
            if not proxy_url:
                raise ValueError("proxy.static_url is required for static provider")
            return {"proxy_url": proxy_url}
        if provider == "http_api":
            api_url = str(self.settings.get("api_url") or "").rstrip("/")
            if not api_url:
                raise ValueError("proxy.api_url is required for http_api")
            response = httpx.post(
                f"{api_url}/acquire",
                json={"target": target, "account": account, "sticky": sticky},
                headers=_auth_headers(self.settings),
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            proxy_url = str(data.get("proxy_url") or data.get("proxy") or "")
            if not proxy_url:
                raise RuntimeError("proxy api response missing proxy_url")
            self.logger.info("proxy.acquire ok target=%s", target)
            return {"proxy_url": proxy_url, "meta": data}
        raise ValueError(f"unsupported proxy provider: {provider}")

    def success(self, route: dict[str, Any]) -> None:
        self.logger.info("proxy.success has_proxy=%s", bool(route.get("proxy_url")))
        self._report("success", route)

    def failure(self, route: dict[str, Any], reason: str = "") -> None:
        self.logger.info("proxy.failure has_proxy=%s reason=%s", bool(route.get("proxy_url")), reason)
        self._report("failure", {**route, "reason": reason})

    def _report(self, action: str, payload: dict[str, Any]) -> None:
        if self.settings.get("provider") != "http_api":
            return
        api_url = str(self.settings.get("api_url") or "").rstrip("/")
        if not api_url:
            return
        httpx.post(f"{api_url}/{action}", json=payload, headers=_auth_headers(self.settings), timeout=15)


class HttpService:
    def __init__(self, logger: logging.Logger):
        self.logger = logger

    def client(self, proxy_url: str = "", headers: dict[str, str] | None = None) -> "LoggedHttpClient":
        return LoggedHttpClient(logger=self.logger, proxy_url=proxy_url, headers=headers or {})


class LoggedHttpClient:
    def __init__(self, logger: logging.Logger, proxy_url: str = "", headers: dict[str, str] | None = None):
        self.logger = logger
        self.client = httpx.Client(
            proxy=proxy_url or None,
            headers=headers,
            timeout=60,
            follow_redirects=True,
        )

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        started = time.perf_counter()
        self.logger.info("http.request method=%s url=%s json=%s data=%s", method, url, _summary(kwargs.get("json")), _summary(kwargs.get("data")))
        try:
            response = self.client.request(method, url, **kwargs)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            self.logger.info(
                "http.response method=%s url=%s status=%s elapsed_ms=%s body=%s",
                method,
                url,
                response.status_code,
                elapsed_ms,
                _text_summary(response.text),
            )
            response.raise_for_status()
            return response
        except Exception:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            self.logger.exception("http.failed method=%s url=%s elapsed_ms=%s", method, url, elapsed_ms)
            raise

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "LoggedHttpClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def build_services(settings: dict[str, Any], logger: logging.Logger) -> dict[str, Any]:
    proxy = ProxyService(settings.get("proxy", {}), logger)
    return {
        "email": EmailService(settings.get("email", {}), logger),
        "captcha": CaptchaService(settings.get("captcha", {}), logger),
        "proxy": proxy,
        "http": HttpService(logger),
    }


def _auth_headers(settings: dict[str, Any]) -> dict[str, str]:
    key = str(settings.get("api_key") or "")
    env_name = str(settings.get("api_key_env") or "")
    if env_name and not key:
        key = str(os.getenv(env_name) or "")
    return {"Authorization": f"Bearer {key}"} if key else {}


def _summary(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    return {key: ("***" if _is_sensitive(key) else value[key]) for key in value}


def _text_summary(text: str, limit: int = 500) -> str:
    if not text:
        return ""
    return text.replace("\r", "\\r").replace("\n", "\\n")[:limit]


def _is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in SENSITIVE_KEYS)
