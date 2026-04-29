# Reflect Backend

Express + PostgreSQL API for Reflect sync, dashboard data, images, notes, Read Later, and sharing.

## Railway

1. Deploy this repo on Railway.
2. Add PostgreSQL.
3. Set service root directory to `/backend`.
4. Set `API_KEY` to a long random secret.
5. Generate a public domain.

`DATABASE_URL` comes from Railway PostgreSQL and `PORT` is provided by Railway. Do not ask users to fill either value in the template. The backend creates/updates its schema on startup.

Optional attachment upload variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_DOMAIN`. Leave them unset unless using R2. R2 uploads use a bucket named `reflect-images`.

## Local

```bash
npm install
cp .env.example .env
# edit API_KEY and uncomment/set DATABASE_URL for local dev
npm start
```

## Endpoints

Protected endpoints require `X-API-Key` matching `API_KEY`.

- Capture: `POST /api/highlight`, `POST /api/image`, `POST /api/youtube-annotation`
- Dashboard: `GET /api/feed`, `GET /api/feed-sparkline`, `GET /api/timeline`, `GET /api/library`, `GET /api/analytics`
- Detail: `GET /api/article-highlights`, `GET /api/youtube-annotations`, `GET /api/annotated-videos`
- Notes: `/api/note`, `/api/notes`
- Read Later: `/api/read-later`, `/api/read-later/check`
- Sharing: `/api/content-share`, `/api/video-share`, `/api/shared-article/:token`, `/api/shared-video/:token`
