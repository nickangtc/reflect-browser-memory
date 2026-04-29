# Reflect Chrome Extension

## Project Structure
- **Root**: Chrome extension (manifest v3) — content script, background service worker, popup, settings, new tab dashboard
- **backend/**: Express + PostgreSQL API server

## Current Scope
- Highlights + highlight annotations
- Optional nearby image capture/upload
- Standalone notes
- Read Later without referrer/breadcrumb tracking
- YouTube timestamp annotations and watch reflections
- New tab Library / Read / Activity / Analytics surfaces
- Optional backend sync

Removed from scope: passive browsing history, browsing trails, automatic social tracking, network interception, YouTube blocking/checkpoints, hosted backend review pages, processing endpoints, Obsidian sync, settings sync stats, and extension action shortcut.

OSS migration task tracking lives in uppercase `TASKS.md`; keep that filename casing.

## Backend
- Entry point: `backend/server.js`
- `npm start` runs `node server.js`
- Uses `PORT` env var (default 3000), `DATABASE_URL`, `API_KEY`
- Protected endpoints require `x-api-key` header
- Backend schema/API is scoped to retained capture types: highlights, images, notes, Read Later, YouTube annotations, and share metadata.
- Analytics “Top Capture Sources”/domain counts must be derived only from explicit capture tables (`highlights`, `images`, `notes`, `read_later`), not passive page visits.
- Share metadata lives in `content_shares` (`content_url`, `share_token`, `is_public`); `/a/:token` and `/v/:token` public URLs both use this table.
- Notes use `text`, `r2_key`, and `r2_url`; do not query legacy `notes.title`/`notes.note` in feed or metadata queries.

## Deployment
- `backend/railway.json` is intended for running `railway up` from `backend/`; keep `watchPatterns` relative to that directory (currently `**`, not `backend/**`).
- For public release, do not publish the existing git history as-is; old commits contain private deployment/proxy references. Use a clean-history repo/export or rewrite history first.
- The backend initializes/updates schema from `backend/init.sql` at startup so Railway deploys do not need a manual `psql` step.
- Railway template setup should only require users to fill `API_KEY`; `PORT` is Railway-provided, `DATABASE_URL` comes from the Postgres service reference, `NODE_ENV` is unnecessary, and R2 variables should stay optional unless attachments are explicitly configured.

## Extension
- Service worker: `background-with-api.js`
- Content script: `content.js`
- New tab override: `newtab.html` + `newtab.js`
- Popup: `popup.html` + `popup.js`
- Options page: `settings.html` + `settings.js`
- Popup Read Later preview uses `chrome.scripting.executeScript`; keep the Manifest V3 `scripting` permission when touching `manifest.json`.
