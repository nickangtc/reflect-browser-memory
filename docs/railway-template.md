# Railway Template Setup

Use this when publishing the one-click Railway template for Reflect.

## Services

- **Backend service**
  - Source: this public GitHub repo
  - Root Directory: `/backend`
  - Config file: `/backend/railway.json`
  - Public domain: enabled
- **PostgreSQL service**
  - Attach to backend so `DATABASE_URL` is available

## Variables

Required on backend service:

- `API_KEY` — user-provided long random secret

Provided by Railway PostgreSQL:

- `DATABASE_URL`

Optional for image/note attachments:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_DOMAIN`

If enabled, the Cloudflare R2 bucket must be named `reflect-images`.

## README button

After publishing the template, replace the placeholder sentence in `README.md` with:

```md
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/YOUR_TEMPLATE_SLUG)
```
