# ChatGPT Team Promo Redeem (to checkout long URL)

Date: 2026-07-14  
Status: draft for user review  
Location: `baiqi-register-template/scripts/chatgpt_team_redeem.py` (new)

## Goal

Batch-automate the flow **up to and including opening/persisting the Team promo checkout long URL** for already-registered ChatGPT accounts:

1. Log in with Outlook-based ChatGPT accounts (password + OTP via xunmail).
2. Attach an existing personal promo code (`https://chatgpt.com/p/{CODE}`).
3. Call `POST /backend-api/payments/checkout` in the logged-in page context (UK / 2 seats).
4. Persist the hosted checkout URL; close browser; next account.

Human binds card / pays manually using the saved long URLs.

## Non-goals

- Card binding or payment completion
- Applying for new promo codes (use existing `chatgpt_offer_freemail.py` output)
- Multi-region billing (fixed UK: `country=GB`, `currency=GBP`)
- AdsPower or other fingerprint browser profiles
- Parallel multi-browser runs (v1 serial only)
- Registering new ChatGPT accounts from scratch

## Decisions (locked with user)

| Topic | Choice |
|-------|--------|
| Account type | A — already registered; credentials include ChatGPT password |
| Browser | A — Camoufox / Playwright direct control |
| Region | A — fixed UK (`GB` / `GBP`) |
| Promo source | A — consume existing codes only |
| End state | C — batch: generate long URL → disk → close browser → next |
| Input files | A — join credentials file + outlook mail file by email |
| Architecture | Approach 2 — hybrid: browser login + `page.evaluate` checkout API |

## Current assets

| Asset | Path / detail |
|-------|----------------|
| Promo batch applier | `scripts/chatgpt_offer_freemail.py` → `codes.txt` / `codes.jsonl` |
| GPT credentials sample | `email----gpt_password----client_id----refresh_token` (ChatGPT password is field 2; trailing OAuth fields are **not** used for mail OTP) |
| Outlook OAuth sample | `email----mail_password----ms_client_id----ms_refresh_token` (xunmail / Graph) |
| Checkout snippet | User-provided IIFE; same payload shape as `Downloads/async function console.txt` |
| Proxy | Mihomo mixed-port `:17897` + `bridges/mihomo_proxy_bridge.py` `:8003` |
| OTP HTTP API | `https://www.xunmail.cn/api/oauth2/mail-latest` (and mail-count / Junk) |

Note: credentials and outlook rows share emails but **different** client_id/refresh_token. Only the outlook file’s OAuth pair is valid for xunmail.

## Architecture

```
accounts.txt ──┐
               ├─ join by email ──► Account{email, gpt_password, ms_client_id, ms_refresh_token}
outlook.txt ───┘
codes.txt ──────────────────────► CodePool (skip used)

for each (account, promo) serial:
  ProxySession.acquire ──► Camoufox(proxy)
  login_chatgpt (UI + XunmailClient OTP)
  goto /p/{promo}
  page.evaluate(checkout payload) ──► checkout_url
  append results.jsonl + checkout_urls.txt
  mark used; report proxy success/failure; close browser
```

Single new script, same style as `chatgpt_offer_freemail.py` (no new channel package in v1).

## Inputs

### CLI

| Flag | Default | Meaning |
|------|---------|---------|
| `--accounts` | required | credentials file (`email----gpt_password----...`) |
| `--mail` | required | outlook OAuth file (`email----...----client_id----refresh_token`) |
| `--codes` | required | `codes.txt` or jsonl with code/url |
| `--proxy-bridge` | `http://127.0.0.1:8003` | mihomo bridge |
| `--proxy-url` | `http://127.0.0.1:17897` | browser proxy |
| `--xunmail-base` | `https://www.xunmail.cn` | OTP API base |
| `--out-dir` | `/tmp/team_redeem_<ts>` | artifacts |
| `--limit N` | all | max accounts this run |
| `--headed` | false | show browser |
| `--resume` | false | skip emails already `ok` in out-dir results |
| `--otp-timeout` | 120 | seconds |
| `--seats` | 2 | team seat_quantity |
| `--workspace-name` | `myWorkspace` | team_plan_data.workspace_name |
| `--dry-run-checkout` | false | login + open promo only; do not POST checkout |
| `--direct` | false | no proxy (debug only) |

### Join rules

- Key: `email.lower().strip()`
- From accounts: `email`, `gpt_password` (fields 0–1)
- From mail: `ms_client_id`, `ms_refresh_token` (fields 2–3)
- Missing mail OAuth → row `status=skipped`, `error=no_mail_oauth`
- Duplicate emails → keep first occurrence per file

### Code assignment

- Parse lines: `ts\tCODE\tURL\t...`, bare `CODE`, or `https://chatgpt.com/p/CODE`
- `used_codes.json` in out-dir: codes that already produced `ok` checkout
- Assign unused codes 1:1 in file order
- Insufficient codes → remaining accounts `skipped: no_promo`

## Outputs

### `results.jsonl` (one object per attempt)

```json
{
  "email": "user@outlook.com",
  "promo_code": "5HEKF9QRQ9CAJ3GB",
  "checkout_url": "https://...",
  "status": "ok",
  "node": "Wa-0147-alive-83",
  "egress_ip": "x.x.x.x",
  "error": null,
  "opened": true,
  "ts": "2026-07-14 18:00:00"
}
```

Statuses: `ok | skipped | proxy_failed | login_failed | otp_timeout | session_failed | checkout_failed | error`

### `checkout_urls.txt`

```
email<TAB>promo_code<TAB>checkout_url
```

### Resume / crash safety

- Append-only writes after each account
- `used_codes.json`, `used_accounts.json` (emails with `ok`)
- Optional screenshot: `shots/{email_safe}.png` on failure when browser alive

## Per-account flow

### 1. Proxy

- `POST {bridge}/acquire` with sticky + prefer_diverse (same contract as offer script)
- On terminal success/failure: `/success` or `/failure`
- Node pool has no reliable UK label; cleanliness via bridge diversity, not country filter

### 2. Browser

- `AsyncCamoufox(headless=not headed)` + context proxy → `proxy_url`
- Serial only (shared mixed-port)

### 3. Login

1. Open ChatGPT login entry (`https://chatgpt.com/auth/login` or current equivalent)
2. Email → continue → `gpt_password` → continue
3. If OTP challenge:
   - Snapshot xunmail `mail-count` for INBOX and Junk
   - Poll `GET {xunmail}/api/oauth2/mail-latest` with `email, client_id, refresh_token, mailbox`
   - Accept only mail newer than challenge start (count increase and/or timestamp)
   - Extract 6-digit code from subject/body
   - Fill OTP and submit
4. Success: `fetch('/api/auth/session')` returns `accessToken`, or URL leaves auth

Selectors centralized in a `SELECTORS` map (role/placeholder first). Login isolated from checkout for easy DOM fixes.

### 4. Promo + checkout (hybrid)

1. `page.goto(https://chatgpt.com/p/{promo})` (matches manual path; establishes promo context)
2. `page.evaluate` equivalent of user script:

```js
const session = await fetch("/api/auth/session").then(r => r.json());
if (!session.accessToken) throw new Error("no accessToken");
const payload = {
  plan_name: "chatgptteamplan",
  team_plan_data: {
    workspace_name: workspaceName,
    price_interval: "month",
    seat_quantity: seats
  },
  billing_details: { country: "GB", currency: "GBP" },
  cancel_url: `https://chatgpt.com/p/${promo}`,
  promo_code: promo,
  checkout_ui_mode: "hosted"
};
const res = await fetch("https://chatgpt.com/backend-api/payments/checkout", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});
return await res.json();
```

3. Require `data.url`; optional `goto(url)` for reachability (`opened` flag; timeout does not fail the job)
4. Persist and close browser

No DevTools, no `allow pasting` — evaluate replaces console paste.

## Error handling

| Stage | status | Retry |
|-------|--------|-------|
| Missing join fields / no promo | skipped | none |
| Proxy acquire | proxy_failed | up to 3 node switches |
| Wrong password / hard login UI fail | login_failed | none |
| OTP not received | otp_timeout | 1× new proxy then re-login |
| Session without token | session_failed | same as otp |
| Checkout response without url | checkout_failed | none (log body summary) |
| Uncaught | error | none; screenshot if possible |

Batch continues after any single-account failure.

## Module layout (single file)

| Section | Responsibility |
|---------|----------------|
| parsers + join | accounts, mail, codes |
| `CodePool` | unused assignment + used persistence |
| `XunmailClient` | count/latest/OTP extract |
| `ProxySession` | acquire/report |
| `login_chatgpt` | UI + OTP |
| `generate_checkout_url` | evaluate payload |
| `run_one` / `run_batch` | orchestration |
| CLI `main` | args + exit code |

## Security

- Do not commit account files, out-dir secrets, or tokens
- Logs: email only; password/token never printed (at most last 4 chars of token on debug)
- Prefer out-dir under `/tmp` or existing ignored `output/`

## Dependencies

- Existing: `httpx`, local mihomo + bridge, Camoufox install on host
- Script requires Camoufox Python package in the env used to run (document in script docstring; add to requirements only if already project-wide)
- Example:

```bash
cd ~/baiqi-register-template
.venv/bin/python scripts/chatgpt_team_redeem.py \
  --accounts /path/to/accountflow-redeem-credentials.txt \
  --mail /path/to/accountflow-redeem-outlook-mail.txt \
  --codes /tmp/chatgpt_offers_100_MASTER/codes.txt \
  --out-dir /tmp/team_redeem_run1 \
  --limit 1 --headed
```

## Testing

Unit (no network):

1. Join credentials ⨯ outlook by email; skip incomplete
2. Parse codes from tab lines / bare / URL
3. OTP regex on sample subjects/bodies
4. Checkout payload builder (promo, GB/GBP, seats)
5. Resume skips emails already `ok` in results.jsonl

Manual smoke:

- `--limit 1 --headed` end-to-end until non-empty `checkout_url`
- `--dry-run-checkout` after login to verify promo page without charging path

## Acceptance

- One joined account + one unused promo → `status=ok` and non-empty `checkout_url`
- `results.jsonl` and `checkout_urls.txt` written immediately
- Failure of account N does not skip account N+1
- No plaintext password/refresh_token in logs
- Scope stops before card entry

## Implementation notes

- Prefer async Camoufox API consistent with `~/grokzhuce`
- Reuse proxy helper patterns from `chatgpt_offer_freemail.py` where practical (copy small helpers rather than tight import coupling if cleaner)
- Login selectors will need a first headed pass against live ChatGPT DOM; treat selector tuning as expected day-1 work, not a design change
- Fixed UK only; if multi-region is needed later, add `--country/--currency` without changing join/OTP flow
