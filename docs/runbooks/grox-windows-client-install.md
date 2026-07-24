# Runbook: Windows 客户如何安装 Grox（走阿里云下载站）

**Updated:** 2026-07-24  
**Public portal:** https://kaggleyes.top/downloads/grox/  
**VPS:** `47.100.227.205`（openresty / 1Panel）

## 客户侧（最省事）

### 方式 A — 网页下载（给非技术用户）

1. 打开 **https://kaggleyes.top/downloads/grox/**  
2. 点 **「下载 Windows 安装包」**  
3. 双击 `Grox-Setup-*.exe`，按向导完成  
4. 打开 Grox：  
   - Base URL 默认：`https://kaggleyes.top/grokapi`  
   - 粘贴你的 **API Key**  
   - 选一个工作文件夹 → 开始聊天  

### 方式 B — 一行 PowerShell（给会开终端的用户）

在 **Windows PowerShell**（不必管理员）执行：

```powershell
irm https://kaggleyes.top/downloads/grox/install.ps1 | iex
```

脚本会：

1. 读 `latest.json`  
2. 下载安装包  
3. 若有 `sha256` 则校验  
4. 尝试静默安装（`/S`），失败则弹出交互安装  
5. 找到 `Grox.exe` 并启动  

### 方式 C — 手动下载 + 静默

```powershell
$url = (irm https://kaggleyes.top/downloads/grox/latest.json).installer.url
$out = "$env:TEMP\Grox-Setup.exe"
Invoke-WebRequest $url -OutFile $out
Start-Process $out -ArgumentList '/S' -Wait
```

---

## 你（管理员）要先做的事

**现状：** 下载页 / `install.ps1` / `latest.json` 已在阿里云上线；  
**安装包 `.exe` 尚未上传**（必须在 **Windows 机器** 上构建 Electron + PyInstaller）。

### 1. 在 Windows 上构建安装包

见 `grox/README.md` Packaging 节。摘要：

```bat
cd grox
npm install
npm run build:ui
REM 确保 agent\static 有 UI
cd agent
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller build_sidecar.spec --noconfirm
cd ..
npm run build:win
REM 产物: release\Grox-Setup-0.1.0.exe
```

或：

```bat
set GROX_RUN_PYINSTALLER=1
npm run build:win
```

### 2. 发布到阿里云

在本机 Linux（已配置 `SSHPASS` 或 SSH key）执行：

```bash
cd /home/eureka/baiqi-register-template/grox
export SSHPASS='…'   # root@47.100.227.205
# 把 Windows 编好的 exe 拷到本机后：
./scripts/publish-to-aliyun.sh /path/to/Grox-Setup-0.1.0.exe
```

脚本会：

- `scp` 到  
  `/opt/1panel/apps/openresty/openresty/www/sites/kaggleyes.top/index/downloads/grox/`  
- 更新 `latest.json`（version / sha256 / size / url）  
- 维护 `Grox-Setup-latest.exe` 软链  

### 3. 验证

```bash
curl -I https://kaggleyes.top/downloads/grox/
curl -s https://kaggleyes.top/downloads/grox/latest.json | jq .
curl -I https://kaggleyes.top/downloads/grox/Grox-Setup-0.1.0.exe
```

源站直连（绕过 Cloudflare 挑战时）：

```bash
curl -k --resolve kaggleyes.top:443:47.100.227.205 -I https://kaggleyes.top/downloads/grox/
```

---

## 服务器布局（已部署）

| 公网路径 | 磁盘路径（VPS） |
|----------|-----------------|
| `/downloads/grox/` | `…/www/sites/kaggleyes.top/index/downloads/grox/` |
| `index.html` | 落地页 |
| `install.ps1` | 一键安装 |
| `latest.json` | 版本元数据 |
| `Grox-Setup-*.exe` | 安装包（你上传） |

nginx：`location ^~ /downloads/` → alias 上述目录（`kaggleyes.top.conf`）。

---

## Cloudflare 注意

若橙云对 HTML/脚本出 JS Challenge：

- 对 `/downloads/*` 配置 **Cache Rule + Security Skip**（或 WAF Skip），避免 `install.ps1` / `latest.json` 被拦  
- 大文件 exe 建议 **Cache Everything** 或至少允许源站大 body  

API 路径 `/grokapi/*` 仍建议 Skip Bot 挑战（客户端无浏览器）。

---

## 安全建议

1. **不要**把 VPS root 密码写进客户文档或安装脚本。  
2. 安装包务必填 `latest.json.sha256`，让 `install.ps1` 校验。  
3. 有条件上 **代码签名证书**，减少 SmartScreen 拦截。  
4. 轮换已在聊天中暴露过的 root 密码。  
5. API Key 仍按用户分发；安装包不内置密钥。

---

## 客户 FAQ

| 问题 | 处理 |
|------|------|
| 下载 404 | 管理员尚未 `publish-to-aliyun.sh` |
| SmartScreen 拦截 | 「更多信息 → 仍要运行」；后续上签名 |
| 打开后要 Key | 正常；发用户 API Key + 默认 Base URL |
| 公司代理拦 HTTPS | 放行 `kaggleyes.top` |
| 杀软删 sidecar | 加白名单 `Grox` 安装目录 |
