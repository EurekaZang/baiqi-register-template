# Runbook: grokcli-2api 公网穿透（阿里云 FRP）

**Updated:** 2026-07-24

## 架构

```
Client  ──HTTPS :443──►  openresty(kaggleyes.top)
                              │  location /grokapi/
                              ▼
                         127.0.0.1:13000  (frps TCP)
                              │
                         FRP tunnel
                              │
本地 frpc  ──►  127.0.0.1:3000  (grokcli-2api)
```

| 组件 | 位置 | 说明 |
|------|------|------|
| grokcli-2api | 本机 `127.0.0.1:3000` | user systemd `grokcli-2api.service` |
| frpc（主） | `/opt/frp/frpc.toml` | `ssh` + `grokcli-2api` |
| frpc（dashboard） | `~/.config/frp/frpc-eureka-dashboard.toml` | 仅 `eureka-dashboard` |
| frps | `47.100.227.205:7000` | `/etc/frp/frps.toml` |
| nginx 反代 | openresty `kaggleyes.top` | `location ^~ /grokapi/` → `127.0.0.1:13000` |

**为什么不直接用 `47.100.227.205:13000`？**  
本机 firewalld 已放行 `13000/tcp`，但阿里云安全组未放行该端口；公网应走 **80/443 + `/grokapi/`**。

## 公网入口

| 用途 | URL |
|------|-----|
| 推荐（路径反代） | `https://kaggleyes.top/grokapi` |
| Health（无需 Key） | `GET /grokapi/health` |
| OpenAI 兼容 | `POST /grokapi/v1/chat/completions` |
| Models | `GET /grokapi/v1/models` |
| Anthropic 兼容 | `POST /grokapi/v1/messages` |

Base URL 示例（客户端填这个）：

```text
https://kaggleyes.top/grokapi/v1
```

### Cloudflare 注意

若域名走 Cloudflare 代理，`/grokapi/*` 可能被 **Bot Fight / JS Challenge** 拦成 403。  
API 调用需要在 Cloudflare 为 `/grokapi/*` 配置 **Skip/Bypass**（或 DNS 仅灰云到源站）。  
源站直连验证（绕过 CF）可用：

```bash
curl -k --resolve kaggleyes.top:443:47.100.227.205 \
  https://kaggleyes.top/grokapi/health
```

## 鉴权（简单 API Key）

本地已开启：

- `GROK2API_REQUIRE_API_KEY=1`
- `GROK2API_API_KEY=...`（写在 `~/grokcli-2api/.env`，mode `600`）

客户端二选一：

```http
Authorization: Bearer <API_KEY>
```

或

```http
x-api-key: <API_KEY>
```

Key 文件（本机）：

```text
~/.config/grokcli-2api/public-api-key
```

未带 Key / 错误 Key → `401 Invalid or missing API key`。  
`/health` 不要求 Key（便于探活）。

### curl 示例

```bash
KEY=$(grep -v '^#' ~/.config/grokcli-2api/public-api-key | head -1)
BASE=https://kaggleyes.top/grokapi

curl -sS "$BASE/health"
curl -sS -H "Authorization: Bearer $KEY" "$BASE/v1/models"
curl -sS -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4.5","messages":[{"role":"user","content":"hi"}],"max_tokens":32}'
```

### OpenAI SDK 示例

```python
from openai import OpenAI
client = OpenAI(
    base_url="https://kaggleyes.top/grokapi/v1",
    api_key="<API_KEY>",
)
print(client.chat.completions.create(
    model="grok-4.5",
    messages=[{"role": "user", "content": "hi"}],
    max_tokens=32,
))
```

## 运维检查

```bash
# 本机
systemctl --user is-active grokcli-2api
systemctl is-active frpc
systemctl --user is-active frpc-eureka-dashboard
curl -sS http://127.0.0.1:3000/health | jq '{status,auth_required}'

# frps 代理列表
curl -sS -u 'admin:<dashboard_password>' \
  http://47.100.227.205:7500/api/proxy/tcp | jq .

# 公网（源站）
curl -k --resolve kaggleyes.top:443:47.100.227.205 \
  -o /dev/null -w '%{http_code}\n' https://kaggleyes.top/grokapi/health
```

期望代理 online：

- `ssh` → remote 6000  
- `grokcli-2api` → remote 13000  
- `eureka-dashboard` → remote 18090  

## 配置文件位置

| 文件 | 作用 |
|------|------|
| `/opt/frp/frpc.toml` | 主 frpc：`ssh` + `grokcli-2api` |
| `~/.config/frp/frpc-eureka-dashboard.toml` | 用户 frpc：dashboard only |
| `~/grokcli-2api/.env` | API Key + 强制鉴权 |
| VPS openresty | `/opt/1panel/apps/openresty/openresty/conf/conf.d/kaggleyes.top.conf` 内 `/grokapi/` |

## 轮换 API Key

```bash
# 1) 生成新 key
python3 - <<'PY'
import secrets; print("sk-g2a-" + secrets.token_urlsafe(32))
PY
# 2) 写入 ~/grokcli-2api/.env 的 GROK2API_API_KEY=
# 3) 同步 ~/.config/grokcli-2api/public-api-key
# 4) systemctl --user restart grokcli-2api
```

## 回滚

```bash
# 停公网 API 隧道：从 /opt/frp/frpc.toml 删除 grokcli-2api 段后
sudo systemctl restart frpc

# 关闭强制鉴权（仅本机调试，勿对公网开放）
# 编辑 .env: GROK2API_REQUIRE_API_KEY=0 并去掉 GROK2API_API_KEY
systemctl --user restart grokcli-2api
```

nginx `/grokapi/` 段可从 `kaggleyes.top.conf` 删除后 `nginx -s reload`（容器 `1Panel-openresty-*`）。
