# FRP STCP SSH Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace public TCP SSH on `47.100.227.205:6000` with FRP STCP + `secretKey`, so only clients with a visitor config can reach local OpenSSH.

**Architecture:** Align `auth.token` on frps + frpc; convert local proxy `ssh` from `tcp/remotePort=6000` to `stcp/secretKey`; ship visitor template; lightly adapt dashboard display for no public port; verify public port is dead and visitor path works.

**Tech Stack:** frp 0.70 (frps/frpc TOML), systemd `frpc.service`, OpenSSH, Python dashboard (`dashboard/server.py`, `dashboard/index.html`).

## Global Constraints

- frp version target: **0.70.x** (already deployed on both sides).
- Proxy name stays **`ssh`** (stable `serverName` for visitors).
- Secrets (`auth.token`, `secretKey`, host passwords) **never** committed to git.
- Visitor must bind **`127.0.0.1` only** (default bindPort `6000`).
- Prefer backup → change → verify → document; keep Tailscale/`100.x` as emergency SSH path if available.
- Do not kill or restart `model_router` / port 8088.

## File map

| Path | Role |
|------|------|
| `/opt/frp/frpc.toml` (home) | Local STCP server proxy |
| `/opt/frp/frpc.toml.bak-*` | Pre-change backup |
| Remote frps config (on `47.100.227.205`) | Control-plane `auth.token`; no SSH tcp map |
| `/opt/frp/frpc-ssh-visitor.toml.example` | Operator visitor template (placeholders only if copied into repo) |
| `docs/runbooks/frp-stcp-ssh.md` | How to connect after cutover |
| `dashboard/server.py` | STCP public field + skip public probe (mostly already OK) |
| `dashboard/index.html` | UI hint when type is stcp |
| `docs/superpowers/specs/2026-07-14-frp-stcp-ssh-auth-design.md` | Approved design (already committed) |

---

### Task 1: Inventory + backups + secrets

**Files:**
- Read: remote frps config, local `/opt/frp/frpc.toml`
- Create: backups under `/opt/frp/` and remote frps conf dir
- Create: secrets only under `/opt/frp/` or root home (not git)

- [ ] **Step 1: SSH to frps host and print frps layout**

```bash
# Use operator-provided root access once; do not echo password into files/logs.
ssh -o StrictHostKeyChecking=accept-new root@47.100.227.205 'set -e; ss -tlnp | grep -E "6000|7000|7500"; find / -name "frps.toml" 2>/dev/null | head; systemctl cat frps 2>/dev/null | head -40; ls -la /opt/frp /etc/frp 2>/dev/null'
```

Expected: frps running, config path found, `:6000` currently listening (tcp proxy).

- [ ] **Step 2: Backup remote + local configs**

```bash
ssh root@47.100.227.205 'cp -a /path/to/frps.toml /path/to/frps.toml.bak-$(date +%Y%m%d%H%M%S)'
sudo cp -a /opt/frp/frpc.toml /opt/frp/frpc.toml.bak-$(date +%Y%m%d%H%M%S)
sudo cp -a /opt/frp/frpc.toml /tmp/frpc.toml.work && sudo chmod 600 /tmp/frpc.toml.work
```

- [ ] **Step 3: Generate secrets (write only to root-readable files)**

```bash
AUTH_TOKEN=$(openssl rand -base64 32 | tr -d '\n')
SECRET_KEY=$(openssl rand -base64 32 | tr -d '\n')
# If existing auth.token already present and shared, REUSE it instead of rotating blindly.
printf '%s\n' "$AUTH_TOKEN" | sudo tee /opt/frp/.auth_token >/dev/null
printf '%s\n' "$SECRET_KEY" | sudo tee /opt/frp/.stcp_secret >/dev/null
sudo chmod 600 /opt/frp/.auth_token /opt/frp/.stcp_secret
```

- [ ] **Step 4: Record whether old auth.token existed**

```bash
sudo grep -n 'token\|auth' /opt/frp/frpc.toml || true
ssh root@47.100.227.205 'grep -n "token\|auth" /path/to/frps.toml || true'
```

If both already share a token, keep it in `/opt/frp/.auth_token` and skip rotation.

---

### Task 2: Align frps `auth.token` and drop public TCP SSH mapping

**Files:**
- Modify: remote `frps.toml` (actual path from Task 1)
- Restart: remote `frps` systemd unit

- [ ] **Step 1: Ensure frps auth block**

Remote `frps.toml` must include (merge with existing dashboard settings):

```toml
bindPort = 7000

[auth]
method = "token"
token = "<same as /opt/frp/.auth_token>"

# keep existing webServer / dashboard user+password if present
```

Do **not** define a TCP proxy for SSH on frps (proxies are client-defined).

- [ ] **Step 2: Restart frps and confirm control + dashboard**

```bash
ssh root@47.100.227.205 'systemctl restart frps; systemctl is-active frps; ss -tlnp | grep -E "7000|7500|6000"'
```

Expected: `7000`/`7500` up. `:6000` may still be up until local frpc drops the tcp proxy.

- [ ] **Step 3: Smoke local frpc still logs in (may fail until local token matches)**

```bash
sudo systemctl restart frpc
journalctl -u frpc -n 20 --no-pager
```

If login fails with auth error, proceed immediately to Task 3 token sync (do not leave broken overnight).

---

### Task 3: Convert local frpc proxy to STCP

**Files:**
- Modify: `/opt/frp/frpc.toml`
- Create: `/opt/frp/frpc-ssh-visitor.toml` (operator machine; secrets, mode 600)
- Create: repo example without secrets

Local `frpc.toml` target shape:

```toml
serverAddr = "47.100.227.205"
serverPort = 7000

[auth]
method = "token"
token = "<from /opt/frp/.auth_token>"

[[proxies]]
name = "ssh"
type = "stcp"
secretKey = "<from /opt/frp/.stcp_secret>"
localIP = "127.0.0.1"
localPort = 22
```

- [ ] **Step 1: Write new frpc.toml via sudo tee (preserve any extra non-ssh settings if present)**

```bash
AUTH=$(sudo cat /opt/frp/.auth_token)
SK=$(sudo cat /opt/frp/.stcp_secret)
sudo tee /opt/frp/frpc.toml >/dev/null <<EOF
serverAddr = "47.100.227.205"
serverPort = 7000

[auth]
method = "token"
token = "${AUTH}"

[[proxies]]
name = "ssh"
type = "stcp"
secretKey = "${SK}"
localIP = "127.0.0.1"
localPort = 22
EOF
sudo chmod 600 /opt/frp/frpc.toml
```

If the existing file has other proxies/settings, merge manually instead of overwriting blindly.

- [ ] **Step 2: Restart frpc and confirm STCP online**

```bash
sudo systemctl restart frpc
sleep 2
journalctl -u frpc -n 30 --no-pager
curl -sS -u "$FRP_DASHBOARD_USER:$FRP_DASHBOARD_PASSWORD" http://47.100.227.205:7500/api/proxy/stcp
curl -sS -u "$FRP_DASHBOARD_USER:$FRP_DASHBOARD_PASSWORD" http://47.100.227.205:7500/api/proxy/tcp
```

Expected: `stcp` lists `ssh` online; `tcp` no longer lists public `:6000` ssh (or empty).

- [ ] **Step 3: Public port must not speak SSH**

```bash
python3 - <<'PY'
import socket
s=socket.socket(); s.settimeout(3)
try:
    s.connect(("47.100.227.205",6000))
    data=s.recv(100)
    print("CONNECTED", repr(data))
except Exception as e:
    print("OK_CLOSED_OR_FILTERED", type(e).__name__, e)
finally:
    s.close()
PY
```

Expected: connection error, or data that is **not** `SSH-2.0-...`.

- [ ] **Step 4: Write local visitor config + self-test**

```bash
AUTH=$(sudo cat /opt/frp/.auth_token)
SK=$(sudo cat /opt/frp/.stcp_secret)
sudo tee /opt/frp/frpc-ssh-visitor.toml >/dev/null <<EOF
serverAddr = "47.100.227.205"
serverPort = 7000

[auth]
method = "token"
token = "${AUTH}"

[[visitors]]
name = "ssh-visitor"
type = "stcp"
serverName = "ssh"
secretKey = "${SK}"
bindAddr = "127.0.0.1"
bindPort = 6001
EOF
sudo chmod 600 /opt/frp/frpc-ssh-visitor.toml

# Run visitor in background (bind 6001 to avoid clash with anything on 6000)
sudo /opt/frp/frpc -c /opt/frp/frpc-ssh-visitor.toml &
sleep 2
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -p 6001 eureka@127.0.0.1 'echo STCP_SSH_OK'
```

Expected: `STCP_SSH_OK` (requires existing local key auth for user `eureka`).

- [ ] **Step 5: Negative test wrong secret**

Copy visitor, change one char of `secretKey`, run briefly — expect tunnel/SSH fail. Kill test visitor processes after.

---

### Task 4: Dashboard + docs (no secrets)

**Files:**
- Modify: `dashboard/server.py` (`api_frp` public field for stcp)
- Modify: `dashboard/index.html` (render hint for stcp)
- Create: `docs/runbooks/frp-stcp-ssh.md`
- Create: `docs/examples/frpc-ssh-visitor.toml.example` (placeholders only)

- [ ] **Step 1: Adjust public display for STCP in `api_frp`**

When `type` is `stcp`/`xtcp`/`sudp` and no `remote_port`, set:

```python
entry["public"] = "stcp (visitor + secretKey)"
entry["public_probe"] = {"ok": None, "skipped": True, "reason": "no public remote port"}
```

Skip `_tcp_probe` when `remote_port` is missing (already true) **and** when type is stcp even if a stale remote port appears.

- [ ] **Step 2: UI row shows type + public without red “down” for stcp**

In `renderFrp`, if `p.type === 'stcp'`, show public text as visitor-based; do not color as hard failure solely because `public_probe.ok` is false/null.

- [ ] **Step 3: Write runbook + example visitor**

`docs/runbooks/frp-stcp-ssh.md` contents:

1. Start visitor: `frpc -c frpc-ssh-visitor.toml`
2. SSH: `ssh -p 6000 user@127.0.0.1`
3. Where secrets live on the home server (`/opt/frp/…`)
4. Rollback pointer to backups
5. Explicit: public `:6000` is intentionally closed

Example file uses `CHANGE_ME_AUTH_TOKEN` / `CHANGE_ME_STCP_SECRET` only.

- [ ] **Step 4: Commit only repo files (no /opt secrets)**

```bash
git add dashboard/server.py dashboard/index.html docs/runbooks/frp-stcp-ssh.md docs/examples/frpc-ssh-visitor.toml.example docs/superpowers/plans/2026-07-14-frp-stcp-ssh-auth.md
git commit -m "feat(frp): STCP visitor auth for SSH; dashboard + runbook"
```

---

### Task 5: Final acceptance + cleanup

- [ ] **Step 1: Re-run acceptance checklist from design**

| # | Check | Pass criteria |
|---|--------|----------------|
| 1 | Public `:6000` | No SSH banner |
| 2 | Visitor + good secret | SSH works |
| 3 | Wrong secret | Fails |
| 4 | `systemctl is-active frpc` | `active` |
| 5 | `GET http://127.0.0.1:8090/api/frp` | stcp online, no false public-down panic |
| 6 | `git status` / `git grep` | no real token/secret in repo |

- [ ] **Step 2: Stop temporary visitor processes used for testing if not needed as a service**

- [ ] **Step 3: Remind operator to rotate the frps root password shared in chat**

---

## Rollback

```bash
sudo cp -a /opt/frp/frpc.toml.bak-TIMESTAMP /opt/frp/frpc.toml
sudo systemctl restart frpc
ssh root@47.100.227.205 'cp -a /path/to/frps.toml.bak-TIMESTAMP /path/to/frps.toml; systemctl restart frps'
```

Emergency alternate: Tailscale SSH to `100.100.248.86` without reopening public `:6000`.

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| STCP replace public TCP | Task 3 |
| auth.token both sides | Tasks 1–2 |
| secretKey visitor | Task 3 |
| Close public 6000 SSH | Tasks 2–3, 5 |
| Dashboard adaptation | Task 4 |
| Runbook / example | Task 4 |
| Acceptance tests | Tasks 3, 5 |
| No secrets in git | Tasks 1, 4, 5 |
| Rollback | Rollback section |

## Placeholder scan

None intentional; remote frps path filled in Task 1 before editing.
