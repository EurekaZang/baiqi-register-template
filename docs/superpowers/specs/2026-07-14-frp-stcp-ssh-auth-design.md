# FRP STCP SSH Auth Design

**Date:** 2026-07-14  
**Status:** Approved for implementation  
**Problem:** `47.100.227.205:6000` is a public TCP FRP mapping to local OpenSSH (`127.0.0.1:22`) with no port-level token. Anyone who finds the port reaches the SSH banner.

## Goal

Replace public TCP SSH exposure with **FRP STCP** so that:

1. The public internet no longer has a bare SSH listener on `:6000`.
2. Only clients that hold a shared **`secretKey`** (plus FRP control-plane `auth.token`) can open the tunnel via an `frpc` visitor.
3. Day-to-day use stays simple: start visitor locally, then `ssh -p <bindPort> user@127.0.0.1`.

## Non-goals

- Multi-user OAuth / per-user token rotation UI.
- Changing OpenSSH password/pubkey policy (optional follow-up hardening).
- XTCP/P2P (more NAT fragility; STCP via frps matches current path).
- Exposing dashboard or other HTTP services via this change.

## Current state (verified)

| Item | Value |
|------|--------|
| Public entry | `47.100.227.205:6000` → SSH banner `OpenSSH_9.6p1` |
| FRP proxy | name `ssh`, type `tcp`, online |
| Local backend | `127.0.0.1:22` |
| Local frpc | systemd `frpc.service`, config `/opt/frp/frpc.toml` (root-only) |
| Remote frps | `47.100.227.205:7000`, version `0.70.0` |
| Dashboard | `:7500` Basic Auth only (does **not** protect `:6000`) |
| Local monitor | Grok dashboard `/api/frp` on `:8090` probes TCP + `remote_port` |

## Architecture

```
Client machine                         frps (47.100.227.205)              Home machine (eureka)
──────────────                         ────────────────────              ────────────────────
frpc visitor  ── auth.token ─────────► :7000  ◄── auth.token ──────────  frpc (stcp server)
     │                                    │                                    │
     │         STCP (secretKey, name=ssh) │                                    │
     └─ bind 127.0.0.1:6000 ◄─────────────┴──────────────────────────────────► 127.0.0.1:22
        ssh -p 6000 user@127.0.0.1
```

**Two secrets (both required):**

1. **`auth.token`** — frpc ↔ frps control plane (who may register proxies/visitors).
2. **`secretKey`** — STCP application plane (who may visit proxy name `ssh`). This is the user-facing “token” for SSH access.

Without a visitor + correct `secretKey`, scanners never see SSH on a public port.

## Components

### 1. Local frpc (STCP server)

Path: `/opt/frp/frpc.toml` (backup before edit).

Conceptual config (field names for frp 0.70 TOML):

```toml
serverAddr = "47.100.227.205"
serverPort = 7000

[auth]
method = "token"
token = "<shared-with-frps>"

[[proxies]]
name = "ssh"
type = "stcp"
secretKey = "<long-random-secret>"
localIP = "127.0.0.1"
localPort = 22
```

- Remove `remotePort = 6000` and `type = "tcp"`.
- Keep proxy name `ssh` so dashboard history and visitor `serverName` stay stable.

### 2. Remote frps

On `47.100.227.205`:

- Ensure frps `auth.method = "token"` and the same `auth.token` as local frpc.
- No public TCP mapping for SSH is required after cutover.
- Close or stop listening on public **6000** (frps no longer binds it once the tcp proxy is gone; also drop security-group/firewall allow if present).
- Leave dashboard `:7500` Basic Auth as-is.

### 3. Client visitor template

Deliver a root-owned or user-local template, e.g. `frpc-ssh-visitor.toml.example` (no real secrets committed):

```toml
serverAddr = "47.100.227.205"
serverPort = 7000

[auth]
method = "token"
token = "<shared-with-frps>"

[[visitors]]
name = "ssh-visitor"
type = "stcp"
serverName = "ssh"
secretKey = "<same-as-server-proxy>"
bindAddr = "127.0.0.1"
bindPort = 6000
```

Usage:

```bash
frpc -c frpc-ssh-visitor.toml
ssh -p 6000 <user>@127.0.0.1
```

`bindAddr = "127.0.0.1"` so the visitor does not re-expose SSH on the client’s LAN/WAN.

### 4. Local dashboard `/api/frp` adaptation

File: `dashboard/server.py` (and UI labels if they assume TCP public URL).

- Treat `stcp` proxies as first-class: show type `stcp`, online/offline from frps API.
- **Do not** public-probe `server:remotePort` for STCP (there is no public remote port).
- Optional: show hint text “use visitor + secretKey; no public SSH port”.
- Keep control-port and dashboard health probes.

### 5. Secret handling

- Generate `secretKey` with high entropy (e.g. 32+ bytes, url-safe base64 or hex).
- Store only in root-readable frpc configs and operator password manager — **never** in git, README, or design commits.
- `auth.token`: if missing today, create one and set on **both** frps and all frpc clients; if present, reuse after verifying match.
- Do not log full secrets in dashboard API responses.

## Cutover sequence

1. Backup local `/opt/frp/frpc.toml` and remote frps config.
2. Align `auth.token` on frps + local frpc (reload/restart as needed; keep existing TCP proxy up until next step if possible).
3. Prepare visitor config with the new `secretKey` on an operator machine (can be the home machine itself for loopback self-test via a second frpc process — only if auth allows; otherwise test from another host).
4. Switch local proxy `tcp` → `stcp` with `secretKey`; restart/reload `frpc`.
5. Confirm frps dashboard shows proxy type `stcp` online; confirm `47.100.227.205:6000` no longer speaks SSH (connection refused / timeout / non-SSH).
6. Start visitor; `ssh -p 6000 user@127.0.0.1` succeeds.
7. Negative test: wrong `secretKey` fails.
8. Update dashboard STCP display; document operator runbook.
9. Revoke any old “just use :6000” notes; distribute visitor config out-of-band.

## Failure / rollback

| Failure | Action |
|---------|--------|
| STCP online but visitor cannot connect | Check `serverName`, `secretKey`, `auth.token`, frpc/frps versions (both 0.70.x). |
| frpc cannot login to frps after auth change | Restore previous token on both sides from backup. |
| Need emergency public SSH again | Temporarily restore TCP proxy + `remotePort` from backup (accept risk); prefer Tailscale `100.100.248.86` if available. |

Rollback is “restore previous `frpc.toml` / frps config and restart services”.

## Acceptance criteria

1. Public `47.100.227.205:6000` does **not** present an SSH banner to unauthenticated scanners.
2. Visitor with correct `auth.token` + `secretKey` can SSH to local bind port.
3. Visitor with wrong `secretKey` cannot open the tunnel.
4. Local `frpc` remains systemd-managed and survives reboot.
5. Dashboard `/api/frp` reports STCP proxy online without false “public port down” alarms.
6. No real secrets committed to the git repository.

## Testing plan

- **Public probe:** TCP connect to `47.100.227.205:6000` — expect fail or non-SSH.
- **Positive path:** visitor up → `ssh -o BatchMode=yes -p 6000 …` with an authorized key.
- **Negative path:** mutate `secretKey` one character → visitor/proxy fails.
- **Control plane:** wrong `auth.token` → frpc login fails (journal shows error).
- **Dashboard:** `GET /api/frp` JSON includes stcp proxy, no hard dependency on public `:6000`.

## Implementation notes

- frp **0.70** supports `frpc stcp` and `frpc stcp visitor` CLI; prefer TOML config for systemd.
- Local config is root-only; implementation needs elevated privileges on the home machine and root SSH to the frps host.
- Credentials used only for operator access during implementation must not be written into this repo or this spec.

## Success definition

Remote SSH access remains available to authorized operators via visitor + secrets, while casual internet exposure of OpenSSH on `:6000` is eliminated.
