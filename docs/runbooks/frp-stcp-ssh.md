# Runbook: SSH via FRP STCP (no public :6000)

**Updated:** 2026-07-14

## What changed

Public `47.100.227.205:6000` no longer maps TCP → local OpenSSH.

SSH is exposed only as an **STCP** proxy named `ssh`. Clients must run an
`frpc` **visitor** with the shared `auth.token` and `secretKey`, then SSH to
the visitor’s **local** bind address.

## Operator files (home machine)

| Path | Purpose |
|------|---------|
| `/opt/frp/frpc.toml` | STCP **server** side (systemd `frpc.service`) |
| `/opt/frp/frpc-ssh-visitor.toml` | Ready visitor config (root-only secrets) |
| `/opt/frp/.auth_token` | FRP control-plane token (same as frps) |
| `/opt/frp/.stcp_secret` | STCP `secretKey` |
| `/opt/frp/frpc.toml.bak-*` | Pre-cutover backups |

Do **not** commit real tokens/secrets to git.

## Connect from another machine

1. Install frpc **0.70.x** (match server).
2. Copy secrets out-of-band from the home machine (e.g. `sudo cat /opt/frp/frpc-ssh-visitor.toml`) into a local file mode `600`.
3. Start visitor:

```bash
frpc -c frpc-ssh-visitor.toml
```

4. SSH to the local bind port (default **6000** on loopback):

```bash
ssh -p 6000 <user>@127.0.0.1
```

Visitor must keep `bindAddr = "127.0.0.1"` so SSH is not re-exposed on the client’s network.

Example template (placeholders only): `docs/examples/frpc-ssh-visitor.toml.example`.

## Verify health

```bash
systemctl is-active frpc
journalctl -u frpc -n 30 --no-pager
# frps dashboard API (needs dashboard basic auth):
# GET http://47.100.227.205:7500/api/proxy/stcp  → ssh status=online
curl -sS http://127.0.0.1:8090/api/frp | python3 -m json.tool | head
```

Public check (should **not** show SSH):

```bash
nc -vz 47.100.227.205 6000 || true
```

## Rollback (emergency public TCP)

Only if you accept re-opening public SSH:

```bash
sudo cp -a /opt/frp/frpc.toml.bak-TIMESTAMP /opt/frp/frpc.toml
sudo systemctl restart frpc
# On frps host, re-add firewall 6000/tcp if it was removed.
```

Prefer Tailscale (`100.100.248.86`) over reopening public `:6000`.

## Security notes

- Rotate the frps host root password if it was shared in chat.
- Rotate `secretKey` if a visitor config was leaked; update server + all visitors together.
- `auth.token` protects who can register with frps; `secretKey` protects who can open the SSH tunnel.
