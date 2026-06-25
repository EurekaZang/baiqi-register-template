from __future__ import annotations

import secrets


def register(ctx):
    mode = str(ctx.settings.get("mode") or "dry_run").lower()
    if mode == "dry_run":
        return dry_run(ctx)
    if mode == "protocol":
        return protocol_template(ctx)
    return ctx.fail(status="validation_failed", reason=f"unknown mode: {mode}")


def dry_run(ctx):
    inbox = ctx.email.acquire(name=f"demo-{ctx.task_id}")
    password = f"Pass-{secrets.token_hex(4)}"
    return ctx.success(
        email=inbox.email,
        password=password,
        status="dry_run",
        reason="mock account generated",
        account={"user_id": f"user-{ctx.run_id}-{ctx.task_id}"},
        artifacts={"api_key": f"sk-demo-{secrets.token_hex(8)}"},
    )


def protocol_template(ctx):
    inbox = ctx.run_step("email acquire", lambda: ctx.email.acquire(service="target_site"))
    route = ctx.run_step("proxy acquire", lambda: ctx.proxy.acquire(target=ctx.channel, account=inbox.email))
    try:
        # Fill these calls with the captured protocol chain for your target site.
        captcha_token = ctx.run_step(
            "captcha solve",
            lambda: ctx.captcha.solve(kind="turnstile", url="https://target.example/register", sitekey=""),
        )
        session = ctx.run_step("start signup", lambda: start_signup(ctx, inbox.email, route, captcha_token))
        ctx.run_step("send verification", lambda: send_verification(ctx, session))
        code_or_link = ctx.run_step("email wait", lambda: ctx.email.wait(inbox, kind="code", pattern=r"\b\d{6}\b"))
        account = ctx.run_step("verify email", lambda: verify_email(ctx, session, code_or_link))
        artifacts = ctx.run_step("fetch artifacts", lambda: fetch_artifacts(ctx, account))
        ctx.email.release(inbox, success=True)
        ctx.proxy.success(route)
        return ctx.success(
            email=inbox.email,
            password=account.get("password", ""),
            status="success",
            account=account,
            artifacts=artifacts,
        )
    except Exception:
        ctx.email.release(inbox, success=False)
        ctx.proxy.failure(route, reason="registration_failed")
        raise


def start_signup(ctx, email, route, captcha_token):
    raise NotImplementedError("paste register/start request here")


def send_verification(ctx, session):
    raise NotImplementedError("paste send-email-code request here")


def verify_email(ctx, session, code_or_link):
    raise NotImplementedError("paste verify-email request here")


def fetch_artifacts(ctx, account):
    raise NotImplementedError("paste create-api-key / fetch-token request here")
