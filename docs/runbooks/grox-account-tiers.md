# Runbook: Grox account tiers (pointer)

**Updated:** 2026-07-24

Operator steps for Free / Plus / Pro accounts live in the **grokcli-2api** repo:

→ **`/home/eureka/grokcli-2api/docs/USER_TIERS.md`**

(Also relative from that tree: `docs/USER_TIERS.md`.)

## What that doc covers

- Tier defaults: free 500k / plus 5M / pro 30M monthly tokens
- Admin curl: login → create user → set plus/pro → rotate key
- User curl: `POST /v1/auth/login` → `GET /v1/me` → optional chat with session Bearer
- Copy/paste end-to-end smoke script
- Grox client notes (no API-key onboarding; session token as Bearer)

## Related local docs

| Doc | Path |
|-----|------|
| Design | `docs/superpowers/specs/2026-07-25-grox-account-tiers-sqlite-design.md` |
| Plan | `docs/superpowers/plans/2026-07-25-grox-account-tiers-sqlite.md` |
| Public FRP / base URL | `docs/runbooks/grokcli-2api-frp-public.md` |

## Quick smoke (from operator machine)

```bash
export G2A=https://kaggleyes.top/grokapi   # or http://127.0.0.1:3000
export ADMIN_PW='…'
# then run the "End-to-end smoke" block in USER_TIERS.md
```

## Grox UI expectation

After login, sidebar shows a tier chip (e.g. `Plus · 0 / 5M tokens`) from
`GET /v1/me`. Settings shows account/usage; API key is not required for normal
users.
