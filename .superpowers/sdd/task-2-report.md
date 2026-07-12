# Task 2 Report: Token auth middleware

## What implemented

- Added token authentication helpers in `dashboard/chat/backend/app/auth.py`.
- Protected routes can use `Depends(require_token)`.
- Tokens are accepted from `Authorization: Bearer ...` or the `chat_token` cookie.
- Token comparison uses `hmac.compare_digest`.
- Added `POST /api/auth/login` accepting `{ "token": "..." }`; valid login sets `chat_token` with `HttpOnly`, `SameSite=lax`, and `Path=/chat`.
- Added protected `GET /api/sessions` stub returning `[]`.
- Kept `GET /api/health` unauthenticated.
- Added focused auth tests and test import scaffolding.

## Tests run + output

Focused test command:

```bash
cd /home/eureka/baiqi-register-template/dashboard/chat/backend && PYTHONPATH= .venv/bin/pytest tests/test_auth.py -q
```

Output:

```text
.....                                                                    [100%]
=============================== warnings summary ===============================
.venv/lib/python3.12/site-packages/fastapi/testclient.py:1
  /home/eureka/baiqi-register-template/dashboard/chat/backend/.venv/lib/python3.12/site-packages/fastapi/testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
5 passed, 1 warning in 0.15s
```

Runtime verification launched the FastAPI app on `127.0.0.1:18091` and drove the API over HTTP. Observed:

```text
health 200 {"status":"ok","service":"chat-agent"}
sessions missing token 401 {"detail":"Invalid or missing token"}
sessions bearer default token 200 []
sessions cookie default token 200 []
login valid default token 200 {"ok":true}
login invalid token 401 {"detail":"Invalid token"}
sessions malformed bearer 401 {"detail":"Invalid or missing token"}
```

Cookie header observed for valid login:

```text
set-cookie: chat_token=change-me; HttpOnly; Path=/chat; SameSite=lax
```

## TDD evidence

1. Added `tests/test_auth.py` before production auth code.
2. Initial test run hit an environment pytest plugin issue from `PYTHONPATH=/opt/ros/jazzy/lib/python3.12/site-packages` loading ROS pytest plugins with missing `lark`.
3. With external plugin autoload disabled, the test setup first exposed missing backend import path; `tests/conftest.py` was added as test scaffolding.
4. The intended RED failure was then observed:

```text
FAILED tests/test_auth.py::test_sessions_requires_token - AssertionError: assert 404 == 401
1 failed, 1 passed, 1 warning in 0.17s
```

5. Expanded tests for cookie auth and login behavior before implementing production auth code; RED showed four route/auth failures due to missing routes:

```text
4 failed, 1 passed, 1 warning in 0.18s
```

6. Implemented minimal production code in `app/auth.py` and `app/main.py`; focused tests then passed.

## Files changed

- `dashboard/chat/backend/app/auth.py`
- `dashboard/chat/backend/app/main.py`
- `dashboard/chat/backend/tests/conftest.py`
- `dashboard/chat/backend/tests/test_auth.py`
- `.superpowers/sdd/task-2-report.md`

## Self-review

- Brief requirements checked: `auth.py` added, `main.py` wired, auth tests added, `conftest.py` added, sessions stub returns `[]`.
- Health remains public and returns 200 without auth.
- `/api/sessions` requires auth and accepts bearer header or cookie token.
- Login uses the requested body shape and sets cookie attributes requested verbatim.
- No changes made to `dashboard/server.py` or `dashboard/index.html`.
- Did not kill or restart anything on port 8088.
- Only focused backend auth files and this report are intended for the task commit.

## Concerns

- The host environment has `PYTHONPATH` pointing at ROS site-packages, which causes plain `.venv/bin/pytest` to autoload ROS pytest plugins and fail before collection due to missing `lark`. Focused verification used a clean `PYTHONPATH=` for the final test run.
- FastAPI/Starlette emits a deprecation warning about `httpx` vs `httpx2`; tests pass and this is unrelated to Task 2.
