# Adapter API Contracts

The template intentionally avoids vendor SDKs. Use `http_api` and adapt your own platform to these small HTTP contracts.

All auth is optional. If `api_key` or `api_key_env` is configured, requests send:

```http
Authorization: Bearer <key>
```

## Email Provider

Config:

```json
{
  "email": {
    "provider": "http_api",
    "api_url": "http://127.0.0.1:8001/email",
    "api_key_env": "EMAIL_API_KEY"
  }
}
```

### `POST /acquire`

Request:

```json
{
  "service": "target_site"
}
```

Response:

```json
{
  "email": "user@example.com",
  "token": "optional-provider-token"
}
```

Required: `email`.

### `POST /wait`

Request:

```json
{
  "email": "user@example.com",
  "token": "optional-provider-token",
  "kind": "code",
  "timeout": 180
}
```

Response:

```json
{
  "value": "123456"
}
```

The template also accepts `text`. If channel code passes a regex pattern, the first match is returned.

### `POST /release`

Request:

```json
{
  "email": "user@example.com",
  "token": "optional-provider-token",
  "success": true
}
```

Response can be any JSON object.

## Captcha Provider

Config:

```json
{
  "captcha": {
    "provider": "http_api",
    "api_url": "http://127.0.0.1:8002/solve",
    "api_key_env": "CAPTCHA_API_KEY"
  }
}
```

### `POST <api_url>`

Request:

```json
{
  "kind": "turnstile",
  "url": "https://target.example/register",
  "sitekey": "site-key"
}
```

Response:

```json
{
  "token": "captcha-solution-token"
}
```

The template also accepts `result`. Empty token is treated as failure.

## Proxy Provider

Config:

```json
{
  "proxy": {
    "provider": "http_api",
    "api_url": "http://127.0.0.1:8003/proxy",
    "api_key_env": "PROXY_API_KEY"
  }
}
```

### `POST /acquire`

Request:

```json
{
  "target": "my_site",
  "account": "user@example.com",
  "sticky": true
}
```

Response:

```json
{
  "proxy_url": "socks5://127.0.0.1:7890"
}
```

The template also accepts `proxy`.

### `POST /success`

Request:

```json
{
  "proxy_url": "socks5://127.0.0.1:7890"
}
```

### `POST /failure`

Request:

```json
{
  "proxy_url": "socks5://127.0.0.1:7890",
  "reason": "blocked"
}
```

