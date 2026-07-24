# Grox — Windows Build, Package & Aliyun Publish

**Audience:** A coding agent (or human) with **no prior chat context**.  
**Goal:** On a **Windows 10/11 x64** machine, produce `Grox-Setup-*.exe`, verify it, and publish it to the public download portal on Aliyun so end users can install via browser or one-line PowerShell.

**Product:** Grox — Electron + FastAPI (Claude Agent SDK) + React desktop coding agent.  
**UI:** Codex-like layout, **8090 chat blue–white** theme (`#0ea5e9` brand, light panels).  
**Default LLM gateway after install:** `https://kaggleyes.top/grokapi`

---

## 0. Success criteria (Definition of Done)

When finished, **all** of the following must be true:

1. File exists: `grox/release/Grox-Setup-<version>.exe` (NSIS installer, x64).
2. Double-click install works on the build machine (or silent `/S`).
3. App launches, onboarding accepts:
   - Base URL: `https://kaggleyes.top/grokapi`
   - A valid API key (Bearer)
4. After publish, **public** URLs work from the open internet:
   - `https://kaggleyes.top/downloads/grox/` → 200 (landing page)
   - `https://kaggleyes.top/downloads/grox/latest.json` → JSON with non-null `sha256` and `size_bytes`
   - `https://kaggleyes.top/downloads/grox/Grox-Setup-<version>.exe` → 200 (or 302 to file)
5. PowerShell one-liner works on a clean Windows box (or at least downloads + runs installer):
   ```powershell
   irm https://kaggleyes.top/downloads/grox/install.ps1 | iex
   ```

---

## 1. Public assets & repository

### 1.1 Source (GitHub)

| Item | Value |
|------|--------|
| Remote (**canonical public, use this**) | `https://github.com/EurekaZang/baiqi-register-template.git` |
| Upstream fork parent (read-only for EurekaZang) | `https://github.com/baiqigo/baiqi-register-template.git` |
| App root | `grox/` (monorepo subfolder) |
| Default branch | `main` |
| Handoff doc (raw) | https://github.com/EurekaZang/baiqi-register-template/blob/main/docs/runbooks/GROX_WINDOWS_BUILD_AND_PUBLISH_AGENT.md |

**Clone (Windows agent):**

```powershell
git clone https://github.com/EurekaZang/baiqi-register-template.git
cd baiqi-register-template\grox
```

**Note:** Account `EurekaZang` can **push** to `EurekaZang/baiqi-register-template` but has **pull-only** on `baiqigo/baiqi-register-template`. Always develop/push against the EurekaZang remote unless you have baiqigo write access.

Do **not** commit secrets (API keys, VPS passwords) into the repo.

### 1.2 Public download portal (already on Aliyun)

| URL | Purpose |
|-----|---------|
| https://kaggleyes.top/downloads/grox/ | Landing page |
| https://kaggleyes.top/downloads/grox/latest.json | Version metadata |
| https://kaggleyes.top/downloads/grox/install.ps1 | One-line installer |
| https://kaggleyes.top/downloads/grox/Grox-Setup-*.exe | Installer binary (upload after build) |

### 1.3 Related public API (for app runtime, not for compile)

| URL | Purpose |
|-----|---------|
| https://kaggleyes.top/grokapi/health | Health (no API key) |
| https://kaggleyes.top/grokapi/v1/models | Models (requires `Authorization: Bearer <key>`) |
| https://kaggleyes.top/grokapi/v1/chat/completions | Chat (requires key) |

---

## 2. Aliyun VPS (publish target)

| Field | Value |
|-------|--------|
| Public IP | `47.100.227.205` |
| SSH user | `root` |
| SSH auth | Password (provide via env `SSHPASS`, **never** commit) |
| OS | Alibaba Cloud Linux / openresty via 1Panel |
| Web server | OpenResty container `1Panel-openresty-*` |
| Domain | `kaggleyes.top` (HTTPS; may sit behind Cloudflare) |

### 2.1 Disk path for downloads (on VPS)

```text
/opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox/
```

Nginx maps:

```text
location ^~ /downloads/  →  alias .../index/downloads/
```

So public file `.../index/downloads/grox/Foo.exe` = `https://kaggleyes.top/downloads/grox/Foo.exe`.

### 2.2 Credentials for the agent (runtime only)

The human operator must inject (example):

```powershell
# Windows build machine — only when publishing
$env:SSHPASS = '<ROOT_PASSWORD_FROM_OPERATOR>'
```

```bash
# Linux publish machine
export SSHPASS='<ROOT_PASSWORD_FROM_OPERATOR>'
```

**Security rules for the agent:**

- Prefer `SSHPASS` env + `sshpass`, or SSH key.
- Do **not** write the password into any file under the git repo.
- Do **not** print the password in logs, commits, or PR descriptions.
- If password was exposed in chat history, recommend operator rotate it after publish.

### 2.3 SSH smoke (from Linux or WSL with sshpass)

```bash
export SSHPASS='...'   # from operator
sshpass -e ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password \
  -o PubkeyAuthentication=no root@47.100.227.205 'hostname; ls -la /opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox/'
```

If the client machine routes through a TUN proxy and SSH hangs, bind to the physical NIC IP (lab example `10.32.0.190`):

```bash
sshpass -e ssh -b 10.32.0.190 -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  root@47.100.227.205 'echo ok'
```

---

## 3. Prerequisites on the Windows build machine

| Tool | Version | Notes |
|------|---------|--------|
| Windows | 10/11 x64 | Ship target |
| Git | any recent | |
| Node.js | **≥ 20.19 or ≥ 22.12** | Vite 8; **Node 18 fails** |
| npm | comes with Node | |
| Python | **3.11 or 3.12** x64 | Check “Add to PATH” |
| Disk free | **≥ 8 GB** | Electron + PyInstaller onedir is large |
| Network | Yes | npm/pip; later upload to VPS |

Verify:

```powershell
node -v
npm -v
python --version
git --version
```

---

## 4. Build pipeline (exact order — do not reorder)

Architecture reminder:

```text
Grox-Setup.exe
  └─ Electron main
       └─ spawns agent-sidecar (PyInstaller onedir)
            └─ FastAPI serves SPA from embedded agent/static
            └─ Claude Agent SDK → ANTHROPIC_BASE_URL (user config)
```

**Critical order:**

1. Build UI → `ui/dist`
2. Copy UI → `agent/static` (must exist **before** PyInstaller)
3. PyInstaller → `agent/dist/agent-sidecar/` (embeds `static/`)
4. Compile Electron TS → `electron/dist/`
5. electron-builder → `release/Grox-Setup-*.exe`

Root `package.json` has `"main": "electron/dist/main.js"`.  
`npm run build:win` runs `scripts/build-win.mjs` which does 1→2→(optional PyInstaller)→4→5.

---

## 5. Step-by-step commands (Windows PowerShell)

### 5.1 Clone and enter app

```powershell
cd $env:USERPROFILE\source
# or: cd D:\work
git clone https://github.com/baiqigo/baiqi-register-template.git
cd baiqi-register-template\grox
git checkout main
git pull
```

If the remote is private, use a PAT/SSH key. If `grox/` still missing, stop and push from the lab machine (section 1.1).

### 5.2 Install JS deps

```powershell
cd ...\baiqi-register-template\grox
npm install
```

Workspaces: `ui` (package name `grox-ui`), `electron` (package name `grox-electron`).

### 5.3 Python venv + agent deps

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
# If execution policy blocks:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install -U pip
pip install -r requirements.txt
pip install pyinstaller
cd ..
```

### 5.4 One-shot package (recommended)

```powershell
cd ...\baiqi-register-template\grox
$env:GROX_RUN_PYINSTALLER = "1"
npm run build:win
```

What this does (`scripts/build-win.mjs`):

1. `npm run build -w grox-ui` → `ui/dist`
2. Copy `ui/dist` → `agent/static`
3. If `GROX_RUN_PYINSTALLER=1`: run  
   `agent\.venv\Scripts\pyinstaller.exe build_sidecar.spec --noconfirm`  
   (working directory `agent/`)
4. Else: **require** `agent/dist/agent-sidecar/agent-sidecar.exe` or exit 1
5. `npm run build -w electron` (or workspace equivalent)
6. `electron-builder --win` → `release/`

### 5.5 Two-phase package (if one-shot fails mid-way)

```powershell
cd ...\grox
npm run build:ui
# ensure static present
if (Test-Path agent\static) { Remove-Item -Recurse -Force agent\static }
Copy-Item -Recurse ui\dist agent\static

cd agent
.\.venv\Scripts\Activate.ps1
pyinstaller build_sidecar.spec --noconfirm
cd ..

# Do NOT set GROX_RUN_PYINSTALLER if sidecar already built
Remove-Item Env:GROX_RUN_PYINSTALLER -ErrorAction SilentlyContinue
npm run build:win
```

### 5.6 Locate artifact

```powershell
Get-ChildItem -Recurse release\*.exe
# Expected pattern: release\Grox-Setup-0.1.0.exe
```

Version comes from `grox/package.json` → `"version": "0.1.0"` (bump if releasing a new number; keep `latest.json` in sync).

---

## 6. Local verification (before publish)

### 6.1 Install locally

```powershell
# Interactive
Start-Process .\release\Grox-Setup-0.1.0.exe -Wait

# Or silent NSIS
Start-Process .\release\Grox-Setup-0.1.0.exe -ArgumentList '/S' -Wait
```

Typical install locations to check:

```text
%LOCALAPPDATA%\Programs\Grox\Grox.exe
%ProgramFiles%\Grox\Grox.exe
```

### 6.2 First-run app check

1. Launch Grox.
2. Onboarding:
   - Base URL: `https://kaggleyes.top/grokapi`
   - API Key: operator-provided test key (or env you are given)
3. New thread → pick a folder → send `ping` / short message.
4. Confirm streaming reply and (if tools run) tool cards.

### 6.3 Optional: API smoke without app

```powershell
$key = '<API_KEY>'
Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } `
  https://kaggleyes.top/grokapi/v1/models
```

If this 401s, fix key/CF before blaming the installer.

### 6.4 Dev mode (debug only, not for customers)

```powershell
cd grox
npm run dev
# UI http://127.0.0.1:5173  agent http://127.0.0.1:17890
# Token default: grox-local-token
```

---

## 7. Publish to Aliyun (public download)

### 7.1 Preferred: script from Linux/WSL/lab

Script path: `grox/scripts/publish-to-aliyun.sh`  
(Make executable: `chmod +x grox/scripts/publish-to-aliyun.sh`)

```bash
# Copy exe from Windows to this machine first if needed
cd /path/to/baiqi-register-template/grox
export SSHPASS='<ROOT_PASSWORD_FROM_OPERATOR>'
# Optional if TUN breaks SSH:
# export GROX_BIND_IP=10.32.0.190
./scripts/publish-to-aliyun.sh /path/to/Grox-Setup-0.1.0.exe
```

The script will:

1. `scp` installer → VPS `.../downloads/grox/`
2. Write `latest.json` with `version`, `url`, `sha256`, `size_bytes`, `published_at`
3. Symlink/copy `Grox-Setup-latest.exe`

### 7.2 Manual publish (if script unavailable)

On a machine with `ssh`/`scp` and password or key:

```bash
EXE=Grox-Setup-0.1.0.exe
REMOTE=root@47.100.227.205
DIR=/opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox
SHA=$(sha256sum "$EXE" | awk '{print $1}')
SIZE=$(wc -c <"$EXE" | tr -d ' ')
VER=0.1.0

scp "$EXE" "$REMOTE:$DIR/"
ssh "$REMOTE" "cat > $DIR/latest.json <<EOF
{
  \"name\": \"Grox\",
  \"version\": \"$VER\",
  \"published_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"installer\": {
    \"filename\": \"$EXE\",
    \"url\": \"https://kaggleyes.top/downloads/grox/$EXE\",
    \"sha256\": \"$SHA\",
    \"size_bytes\": $SIZE
  },
  \"notes\": \"Published by build agent\",
  \"default_base_url\": \"https://kaggleyes.top/grokapi\",
  \"min_windows\": \"10\"
}
EOF
ln -sfn '$EXE' '$DIR/Grox-Setup-latest.exe' || cp -f '$DIR/$EXE' '$DIR/Grox-Setup-latest.exe'
"
```

### 7.3 From Windows-only (OpenSSH client)

```powershell
$exe = ".\release\Grox-Setup-0.1.0.exe"
# Use scp (Windows 10+ OpenSSH) — password prompt or key
scp $exe root@47.100.227.205:/opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox/
# Then ssh in and write latest.json as above (compute SHA256):
Get-FileHash $exe -Algorithm SHA256
```

### 7.4 Public verification

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://kaggleyes.top/downloads/grox/
curl -sS https://kaggleyes.top/downloads/grox/latest.json
curl -sS -o /dev/null -w '%{http_code}\n' https://kaggleyes.top/downloads/grox/install.ps1
curl -sS -o /dev/null -w '%{http_code}\n' -I https://kaggleyes.top/downloads/grox/Grox-Setup-0.1.0.exe
```

If Cloudflare returns 403 HTML challenge for API/scripts, ask operator to **Skip Bot Fight** for:

- `/downloads/*`
- `/grokapi/*`

Origin bypass check (from lab with physical NIC):

```bash
curl -k --resolve kaggleyes.top:443:47.100.227.205 -I https://kaggleyes.top/downloads/grox/
```

---

## 8. End-user install (what you enable)

Document for humans (already on portal):

```text
https://kaggleyes.top/downloads/grox/
```

One-liner:

```powershell
irm https://kaggleyes.top/downloads/grox/install.ps1 | iex
```

`install.ps1` reads `latest.json`, downloads installer, verifies SHA256 if present, runs NSIS `/S`, launches `Grox.exe` if found.

---

## 9. Key files map (for debugging)

| Path | Role |
|------|------|
| `grox/package.json` | version, workspaces, `"main": "electron/dist/main.js"` |
| `grox/scripts/build-win.mjs` | Windows package orchestration |
| `grox/scripts/publish-to-aliyun.sh` | Upload + latest.json |
| `grox/electron-builder.yml` | NSIS config, `extraResources` → sidecar |
| `grox/electron/src/main.ts` | Spawn sidecar, load `http://127.0.0.1:P/` |
| `grox/electron/src/preload.ts` | `window.grox.apiBase` **string** origin |
| `grox/agent/sidecar_main.py` | CLI entry for frozen sidecar |
| `grox/agent/build_sidecar.spec` | PyInstaller onedir |
| `grox/agent/app/config.py` | `GROX_*` settings, default base URL |
| `grox/ui/` | React SPA (base `/`) |
| `docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md` | Product design |
| `grox/docs/ACCEPTANCE.md` | MVP checklist |

---

## 10. Environment variables (reference)

| Variable | Where | Meaning |
|----------|--------|---------|
| `GROX_RUN_PYINSTALLER=1` | build-win | Run PyInstaller after copying static |
| `GROX_DATA_DIR` | agent | Sessions + runtime.json |
| `GROX_CHAT_HOST` | agent | Must stay `127.0.0.1` |
| `GROX_CHAT_PORT` | agent | e.g. `17890` |
| `GROX_CHAT_TOKEN` | agent/Electron | Loopback API bearer |
| `GROX_ANTHROPIC_BASE_URL` | agent | LLM gateway |
| `GROX_ANTHROPIC_API_KEY` | agent | LLM key |
| `GROX_DEV_URL` | Electron | Load Vite instead of sidecar SPA |
| `SSHPASS` | publish | VPS root password for sshpass |
| `GROX_BIND_IP` | publish | Local source IP for ssh/scp |
| `GROX_VPS_HOST` | publish | Default `47.100.227.205` |

---

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Node 18 / `styleText` / rolldown errors | Install Node 20+; new terminal |
| `build:win` exits: sidecar missing | Set `GROX_RUN_PYINSTALLER=1` or build sidecar after `agent/static` exists |
| Installer runs but blank window | SPA not in sidecar — rebuild with static **before** PyInstaller |
| App 401 to models | Wrong/missing API key; or CF challenge on `/grokapi` |
| Download page 200 but exe 404 | Not published yet — run section 7 |
| `install.ps1` gets HTML challenge | CF Bot Fight — Skip `/downloads/*` |
| SSH timeout from lab | Use `-b <physical IP>` / `GROX_BIND_IP` |
| Antivirus deletes sidecar | Whitelist build dir and install dir |
| PyInstaller huge / slow | Expected (Electron + Claude CLI bundle, often 200–400MB+) |
| SmartScreen blocks Setup | “More info → Run anyway”; later code-sign |

---

## 12. Agent execution checklist (copy-paste)

```text
[ ] Confirm Windows x64 + Node≥20 + Python 3.11/3.12
[ ] Clone/push so grox/ is available from GitHub
[ ] npm install in grox/
[ ] agent venv + pip install -r requirements.txt + pyinstaller
[ ] GROX_RUN_PYINSTALLER=1 npm run build:win
[ ] release/Grox-Setup-*.exe exists
[ ] Local install + onboarding with kaggleyes.top/grokapi
[ ] Obtain VPS password via operator env (SSHPASS), not git
[ ] publish-to-aliyun.sh OR manual scp + latest.json
[ ] curl public URLs: landing, latest.json, exe all OK
[ ] Document SHA256 and version in the PR/report
[ ] Do not commit secrets
```

---

## 13. Report back template (agent → human)

```markdown
## Grox Windows build report

- Git commit: <sha>
- Installer: <filename>
- Size: <bytes>
- SHA256: <hex>
- Local install: PASS/FAIL
- Smoke chat via kaggleyes.top/grokapi: PASS/FAIL
- Published to 47.100.227.205 downloads/grox: PASS/FAIL
- Public checks:
  - landing: <code>
  - latest.json: <code> version=<ver>
  - exe: <code>
- Blockers / notes:
```

---

## 14. Out of scope for this handoff

- Code signing certificate purchase/config (optional follow-up)
- macOS/Linux installers
- Changing production API account pool
- Killing or restarting unrelated services on the lab machine (especially any local model router used by other tools)

---

## 15. Related runbooks

| Doc | Path |
|-----|------|
| Client install (human) | `docs/runbooks/grox-windows-client-install.md` |
| Public grokapi FRP | `docs/runbooks/grokcli-2api-frp-public.md` |
| Design | `docs/superpowers/specs/2026-07-24-grox-windows-desktop-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-07-24-grox-windows-desktop.md` |

---

**End of handoff.** Implement on Windows, publish to `47.100.227.205`, verify GitHub-visible source + public download URLs.
