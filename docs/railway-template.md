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

Required user-provided variable on backend service:

- `API_KEY` — long random secret

Automatically provided by Railway:

- `DATABASE_URL` — from the PostgreSQL service
- `PORT` — do not ask users to fill this

Do not require `NODE_ENV`; the backend runs without it.

Optional image/note attachment variables. Do not include these in the one-click required setup unless the template is specifically for R2 uploads:

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
