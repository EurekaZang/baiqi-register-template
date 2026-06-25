# Security

Do not commit:

- `.env`
- real API keys
- real account output
- cookies
- access tokens
- refresh tokens
- raw logs from real targets

The default `.gitignore` excludes common local output paths:

- `output/`
- `tmp/`
- `*.log`
- `config.local.json`
- `*.local.json`

This project is a template for authorized automation and integration testing. Use it only on systems you own or are allowed to test.

If you publish a channel based on a real website, remove private endpoints, credentials, accounts, and operational notes first.

