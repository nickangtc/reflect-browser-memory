# Reflect

Reflect is a local-first Chrome extension for saving what you want to remember: highlights, annotations, nearby images, notes, Read Later pages, and YouTube timestamp notes.

Sync is **off by default**. For cross-device sync, dashboard data, and sharing annotations through public URLs, deploy the Railway backend and configure it in the extension settings.

## Quickstart

### 1. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repo root.
4. Highlight text with `Cmd+Shift+E` / `Ctrl+Shift+E`.

That is enough for local text highlights. Read Later, image uploads, cross-device sync, dashboard data, and public annotation sharing require the backend.

### 2. Optional Railway sync

After the Railway template is published, click its **Deploy on Railway** button.

Until then:

1. Create a Railway project from this GitHub repo.
2. Add a PostgreSQL database.
3. Set the backend service **Root Directory** to `/backend`.
4. Set variables:
   - `DATABASE_URL` from the Railway PostgreSQL service
   - `API_KEY` to a long random secret
5. Generate a public domain for the backend service.

The backend initializes its own schema on startup. Then open the extension options page and set:

- **Backend URL**: your Railway service URL
- **API key**: the same value as `API_KEY`
- **Enable Backend Sync**: on

Cloudflare R2 variables are optional and only needed for image/note attachment uploads. If configured, create an R2 bucket named `reflect-images`.

## What Reflect captures

- Text highlights and highlight annotations
- Nearby images for highlights, when backend/R2 sync is configured
- Standalone notes and note images
- Read Later pages, when backend sync is configured
- YouTube timestamp annotations and progress-bar markers
- Optional YouTube watch reflections

Reflect does **not** capture general page history, browsing trails, referrers, social interactions, or network requests. See [`PRIVACY.md`](PRIVACY.md).

## Review surfaces

Reflect replaces the new tab page with:

- **Library** — captured highlights, articles, images, videos, notes, and sharing controls. Sharing creates public URLs and requires the backend.
- **Read** — Read Later inbox
- **Activity** — recent capture timeline
- **Analytics** — activity heatmap, streaks, hourly/weekday charts, monthly trends, and top domains

The popup saves/unsaves the current page for Read Later and links to shortcut/settings controls.

## Backend

The Railway backend lives in [`backend/`](backend/) and uses Express + PostgreSQL.

Main tables:

- `highlights`
- `images`
- `notes`
- `youtube_annotations`
- `read_later`
- `content_shares`

Protected endpoints require an `X-API-Key` header matching `API_KEY`. Public annotation share URLs are served by the backend, so sharing is unavailable in local-only mode.

## Development checks

```bash
node --check background-with-api.js
node --check content.js
node --check newtab.js
node --check settings.js
node --check backend/server.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```

## License

MIT — see [`LICENSE`](LICENSE).
