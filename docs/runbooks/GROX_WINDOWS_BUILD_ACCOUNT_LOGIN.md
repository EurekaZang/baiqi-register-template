# Grox Windows Build Guide — Account Login Edition (for coding agents)

**Audience:** A Windows coding agent **without** prior chat context.  
**Goal:** Clone the latest public repos, build `Grox-Setup-*.exe` that uses **username/password login** (no API key in the app), point at the host gateway, and optionally publish the installer.

**Do not** ask the end user to paste an API key. Admin creates accounts on the server; Grox only logs in.

---

## 0. Definition of Done

1. `grox/release/Grox-Setup-<version>.exe` exists on the Windows build machine.  
2. Install + launch Grox → **login screen** (username/password), not API-key onboarding.  
3. Login against `https://kaggleyes.top/grokapi` with a test account succeeds; `/v1/me` shows tier.  
4. Send a short chat message successfully.  
5. (Optional) Installer published to `https://kaggleyes.top/downloads/grox/`.

---

## 1. Public source repositories (GitHub)

| Repo | URL | Role |
|------|-----|------|
| **Grox + docs (clone this)** | https://github.com/EurekaZang/baiqi-register-template | Desktop app under `grox/` |
| **API server (host already runs it)** | Prefer host deployment; source with user-tiers: push target may be `EurekaZang/grokcli-2api` or lab `HM2899/grokcli-2api` | Account/session/tiers |

**Windows agent should clone:**

```powershell
git clone https://github.com/EurekaZang/baiqi-register-template.git
cd baiqi-register-template
git checkout main
git pull
cd grox
```

**Handoff docs in-tree:**

| Doc | Path |
|-----|------|
| This guide | `docs/runbooks/GROX_WINDOWS_BUILD_ACCOUNT_LOGIN.md` |
| Full package/publish (older + still valid packaging) | `docs/runbooks/GROX_WINDOWS_BUILD_AND_PUBLISH_AGENT.md` |
| Client install portal | `docs/runbooks/grox-windows-client-install.md` |
| Account tiers design | `docs/superpowers/specs/2026-07-25-grox-account-tiers-sqlite-design.md` |
| Operator API guide (server) | on host: `grokcli-2api/docs/USER_TIERS.md` |

---

## 2. Runtime topology (do not reinvent)

```text
Grox.exe (Windows)
  → HTTPS https://kaggleyes.top/grokapi
       POST /v1/auth/login   {username, password}
       Authorization: Bearer <session_token>
       GET  /v1/me
       POST /v1/chat/completions
  → Host openresty → FRP → grokcli-2api (Linux)
       SQLite users/tiers/usage
       Grok account pool (unchanged)
```

**Defaults for Grox UI (already in code):**

- Base URL: `https://kaggleyes.top/grokapi`  
- Auth: session after login  
- Tiers: free / plus / pro (display only; admin sets on server)

**Test account (lab — change after first use if public):**

| Field | Value |
|-------|--------|
| Base URL | `https://kaggleyes.top/grokapi` |
| Username | `groxtest` |
| Password | `TestGrox2026!` |
| Tier | `plus` |

If login fails publicly, Cloudflare may challenge `/grokapi/*` — operator must Skip Bot for API paths. Prefer verifying against origin or ask operator for a working path.

---

## 3. Windows prerequisites

| Tool | Version |
|------|---------|
| Windows | 10/11 x64 |
| Git | recent |
| Node.js | **≥ 20.19 or ≥ 22** (not 18) |
| Python | 3.11 or 3.12 x64 + PATH |
| Free disk | ≥ 8 GB |

```powershell
node -v
npm -v
python --version
git --version
```

---

## 4. Build Grox installer (exact order)

From `baiqi-register-template\grox`:

```powershell
cd ...\baiqi-register-template\grox
npm install

cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -r requirements.txt
pip install pyinstaller
cd ..

# One-shot: UI → agent/static → PyInstaller sidecar → Electron → NSIS
$env:GROX_RUN_PYINSTALLER = "1"
npm run build:win
```

**Artifact:**

```powershell
Get-ChildItem .\release\*.exe
# e.g. release\Grox-Setup-0.1.0.exe
```

### Order rules (failure if wrong)

1. Build UI → `ui/dist`  
2. Copy to `agent/static` **before** PyInstaller  
3. PyInstaller embeds SPA into sidecar  
4. Electron main + electron-builder  

If `build:win` says sidecar missing: ensure `GROX_RUN_PYINSTALLER=1` or manually:

```powershell
npm run build:ui
Remove-Item -Recurse -Force agent\static -ErrorAction SilentlyContinue
Copy-Item -Recurse ui\dist agent\static
cd agent
.\.venv\Scripts\Activate.ps1
pyinstaller build_sidecar.spec --noconfirm
cd ..
Remove-Item Env:GROX_RUN_PYINSTALLER -ErrorAction SilentlyContinue
npm run build:win
```

---

## 5. Local verification (account login)

1. Install `Grox-Setup-*.exe` (or run portable output if present).  
2. Launch Grox → expect **login**, not API key form.  
3. Base URL: `https://kaggleyes.top/grokapi` (Advanced only if needed).  
4. Username / password: use operator test account (e.g. `groxtest` / given password).  
5. Confirm tier chip or settings shows **plus** (or free/pro).  
6. Send a short message; confirm stream reply.  
7. Optional API check:

```powershell
$base = "https://kaggleyes.top/grokapi"
$login = Invoke-RestMethod -Method POST -Uri "$base/v1/auth/login" `
  -ContentType "application/json" `
  -Body '{"username":"groxtest","password":"TestGrox2026!"}'
$h = @{ Authorization = "Bearer $($login.session_token)" }
Invoke-RestMethod -Uri "$base/v1/me" -Headers $h
```

---

## 6. Publish installer to Aliyun (optional)

Portal (already live): https://kaggleyes.top/downloads/grox/

On a Linux/WSL machine with `SSHPASS` (password **from operator env only**, never commit):

```bash
cd /path/to/baiqi-register-template/grox
export SSHPASS='...'   # root@47.100.227.205
./scripts/publish-to-aliyun.sh /path/to/Grox-Setup-0.1.0.exe
```

VPS:

| Field | Value |
|-------|--------|
| Host | `47.100.227.205` |
| User | `root` |
| Web dir | `/opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox/` |
| Public | `https://kaggleyes.top/downloads/grox/` |

End-user one-liner after publish:

```powershell
irm https://kaggleyes.top/downloads/grox/install.ps1 | iex
```

---

## 7. Server-side notes (for humans / ops agents)

Account system lives in **grokcli-2api** on the Linux host (not rebuilt into Windows installer beyond the client).

- SQLite: `{DATA_DIR}/g2a.sqlite3`  
- Admin: existing grokcli admin password + `POST /admin/api/users`  
- Guide: `docs/USER_TIERS.md` in grokcli-2api tree  

Windows build agent **does not** need to recompile grokcli-2api unless also deploying the API host.

---

## 8. Agent checklist

```text
[ ] Node ≥ 20, Python 3.11+, Git on Windows x64
[ ] git clone https://github.com/EurekaZang/baiqi-register-template.git
[ ] cd grox && npm install && agent venv + pip
[ ] GROX_RUN_PYINSTALLER=1 npm run build:win
[ ] release\Grox-Setup-*.exe exists
[ ] Install → login UI (no API key required)
[ ] Login + chat against https://kaggleyes.top/grokapi
[ ] Report SHA256, version, pass/fail
[ ] Optional: publish-to-aliyun.sh
[ ] Never commit VPS passwords or user passwords
```

---

## 9. Report template

```markdown
## Grox account-login Windows build

- Commit (baiqi-register-template): <sha>
- Installer: <path> size=<bytes> sha256=<hex>
- Login UI present: yes/no
- Login + /v1/me: pass/fail
- Chat smoke: pass/fail
- Published to downloads/grox: yes/no/skipped
- Blockers:
```

---

## 10. Troubleshooting

| Issue | Fix |
|-------|-----|
| Node 18 / Vite errors | Install Node 20+ |
| Sidecar missing | `GROX_RUN_PYINSTALLER=1` or build static first |
| Blank window after install | SPA not in sidecar — rebuild order |
| Login 401 | Wrong password or user suspended |
| Login 403 HTML | Cloudflare challenge on `/grokapi` |
| quota_exceeded | Admin raise tier or wait month |
| Old key onboarding UI | Pull latest `main` — account login is required |

---

**End.** Build from `EurekaZang/baiqi-register-template`, ship installer, users only need account credentials from admin.
