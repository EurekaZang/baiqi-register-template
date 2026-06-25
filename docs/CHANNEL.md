# Channel Code Shape

Each channel exposes one function:

```python
def register(ctx):
    ...
```

Return `ctx.success(...)` or `ctx.fail(...)`.

Use `ctx.run_step()` around each protocol step so logs show exactly where the flow failed:

```python
session = ctx.run_step("start signup", lambda: start_signup(ctx, inbox.email, route, captcha_token))
```

Recommended step split:

```python
def start_signup(ctx, email, route, captcha_token):
    ...

def send_verification(ctx, session):
    ...

def verify_email(ctx, session, code_or_link):
    ...

def fetch_artifacts(ctx, account):
    ...
```

Use `ctx.http.client(proxy_url=route["proxy_url"])` for protocol requests:

```python
with ctx.http.client(proxy_url=route.get("proxy_url", "")) as client:
    response = client.post("https://target.example/api/register", json={"email": email})
    data = response.json()
```

Success result:

```python
return ctx.success(
    email=email,
    password=password,
    status="success",
    account={"user_id": user_id},
    artifacts={"api_key": api_key}
)
```

Failure result:

```python
return ctx.fail(status="validation_failed", reason="csrf token missing")
```

