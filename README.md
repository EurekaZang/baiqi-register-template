# Baiqi Register Template / 白起通用注册模板

一个轻量、可改造的注册链路模板。它不内置真实渠道，也不绑定某个邮箱、打码、代理平台；它只提供一套能直接跑的骨架，让你把抓包得到的注册协议链路填进去。

适合：

- 学习如何把注册流程拆成可维护的步骤
- 快速接入邮箱聚合平台、打码平台、代理平台
- 把新站点的协议链路改造成可批量运行的 channel

不适合：

- 开箱即用注册真实网站
- 绕过目标站规则、风控或权限
- 保存真实账号、密钥、cookie 到仓库

## Features

- 单文件 CLI：`run.py`
- 渠道模板：`channels/example`
- 完整假链路：`channels/fake_protocol`
- 邮箱接口：`mock` / `http_api`
- 打码接口：`none` / `http_api`
- 代理接口：`none` / `static` / `http_api`
- 每轮输出：`results.json`、`accounts_for_import.jsonl`、`run.log`
- 详细步骤日志：开始、成功、失败、耗时、HTTP 状态码

## Quick Start

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python run.py --channel example --config config.example.json --count 2
python run.py --channel fake_protocol --config config.example.json --count 1
python tests/test_smoke.py
```

Linux / macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py --channel fake_protocol --config config.example.json --count 1
```

输出目录：

```text
output/<channel>/<run_id>/
  results.json
  accounts_for_import.jsonl
  run.log
```

## How Channels Work

复制 `channels/example`，改名为你的渠道：

```text
channels/my_site/
  __init__.py
  manifest.py
  flow.py
```

`manifest.py` 指向入口函数：

```python
MANIFEST = {
    "name": "my_site",
    "label": "My Site",
    "flow": "channels.my_site.flow:register",
    "defaults": {"mode": "protocol"}
}
```

把抓包链路填进 `flow.py`：

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

真实项目里通常就是这几段：

1. 打开注册页，拿 cookie / csrf / session
2. 提交注册邮箱和密码
3. 发送邮箱验证码
4. 等邮箱验证码或验证链接
5. 提交验证码
6. 创建 API key 或读取 token

## External Services

渠道代码里直接用：

```python
inbox = ctx.email.acquire(service="target_site")
code = ctx.email.wait(inbox, kind="code", pattern=r"\b\d{6}\b")
ctx.email.release(inbox, success=True)

captcha_token = ctx.captcha.solve(kind="turnstile", url=page_url, sitekey=sitekey)

route = ctx.proxy.acquire(target=ctx.channel, account=inbox.email)
ctx.proxy.success(route)
ctx.proxy.failure(route, reason="blocked")
```

HTTP 接口契约见 [docs/ADAPTERS.md](docs/ADAPTERS.md)。

## Config

`config.example.json` 默认使用 mock/none，能直接本地跑通。

接平台时改成：

```json
{
  "mode": "protocol",
  "workers": 1,
  "email": {
    "provider": "http_api",
    "api_url": "http://127.0.0.1:8001/email",
    "api_key_env": "EMAIL_API_KEY"
  },
  "captcha": {
    "provider": "http_api",
    "api_url": "http://127.0.0.1:8002/solve",
    "api_key_env": "CAPTCHA_API_KEY"
  },
  "proxy": {
    "provider": "http_api",
    "api_url": "http://127.0.0.1:8003/proxy",
    "api_key_env": "PROXY_API_KEY"
  }
}
```

把真实密钥放到环境变量或 `.env`，不要提交到 Git。

## Logs

每次运行会生成 `run.log`。日志会记录：

- channel / task id
- 每个注册步骤 start / ok / failed
- 每步耗时 `elapsed_ms`
- 邮箱、打码、代理调用
- HTTP method、URL、状态码、响应摘要
- 异常堆栈

敏感字段名包含 `token`、`password`、`cookie`、`secret`、`api_key` 时会在请求日志里打码。

## Tests

```bash
python tests/test_smoke.py
python -m compileall -q .
```

## Project Layout

```text
registrar/
  context.py     # ctx, step logs, success/fail result helpers
  services.py    # email/captcha/proxy/http adapters
  io.py          # output writer
channels/
  example/       # empty channel template
  fake_protocol/ # runnable fake protocol chain
tests/
  test_smoke.py
```

## License

MIT
