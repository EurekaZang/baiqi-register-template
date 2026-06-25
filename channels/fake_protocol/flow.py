from __future__ import annotations

import secrets


def register(ctx):
    inbox = ctx.run_step("email acquire", lambda: ctx.email.acquire(service="fake_target", name=f"fake-{ctx.task_id}"))
    route = ctx.run_step("proxy acquire", lambda: ctx.proxy.acquire(target=ctx.channel, account=inbox.email))
    try:
        captcha_token = ctx.run_step(
            "captcha solve",
            lambda: ctx.captcha.solve(kind="turnstile", url="https://fake.local/register", sitekey="fake-sitekey"),
        )
        session = ctx.run_step("start signup", lambda: start_signup(ctx, inbox.email, route, captcha_token))
        ctx.run_step("send verification", lambda: send_verification(ctx, session))
        code = ctx.run_step("email wait", lambda: ctx.email.wait(inbox, kind="code", pattern=r"\b\d{6}\b"))
        account = ctx.run_step("verify email", lambda: verify_email(ctx, session, code))
        artifacts = ctx.run_step("fetch artifacts", lambda: fetch_artifacts(ctx, account))
        ctx.email.release(inbox, success=True)
        ctx.proxy.success(route)
        return ctx.success(
            email=inbox.email,
            password=account["password"],
            status="success",
            reason="fake protocol completed",
            account=account,
            artifacts=artifacts,
        )
    except Exception:
        ctx.email.release(inbox, success=False)
        ctx.proxy.failure(route, reason="registration_failed")
        raise


def start_signup(ctx, email, route, captcha_token):
    password = f"Pass-{secrets.token_hex(4)}"
    return {
        "session_id": f"sess-{ctx.run_id}-{ctx.task_id}",
        "email": email,
        "password": password,
        "proxy_used": bool(route.get("proxy_url")),
        "captcha_used": bool(captcha_token),
    }


def send_verification(ctx, session):
    if not session.get("email"):
        raise ValueError("session missing email")
    return {"sent": True}


def verify_email(ctx, session, code):
    if not code:
        raise ValueError("verification code empty")
    return {
        "user_id": f"user-{ctx.run_id}-{ctx.task_id}",
        "email": session["email"],
        "password": session["password"],
        "verified": True,
    }


def fetch_artifacts(ctx, account):
    if not account.get("verified"):
        raise ValueError("account not verified")
    return {
        "api_key": f"sk-fake-{secrets.token_hex(8)}",
        "access_token": f"at-{secrets.token_hex(8)}",
        "refresh_token": f"rt-{secrets.token_hex(8)}",
    }
