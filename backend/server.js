const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Cloudflare R2 client (S3-compatible)
const r2 = process.env.R2_ACCOUNT_ID ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;

const R2_BUCKET = 'reflect-images';
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN || '';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Serve static files from public directory
app.use('/static', express.static(path.join(__dirname, 'public')));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// API key middleware for protected endpoints
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

const domainFromUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
};

const initializeSchema = async () => {
  const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
  await pool.query(initSql);
};

const resolveSince = (value, fallbackHours = 24) => {
  if (!value) {
    return new Date(Date.now() - fallbackHours * 60 * 60 * 1000).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('invalid since timestamp');
  }

  return parsed.toISOString();
};

// Search indexes all row fields via to_jsonb(row)::text so newly-added capture
// metadata becomes searchable without hand-editing /api/search. Result cards
// still need a compact stable column contract; validate that on startup so
// schema drift fails early with an actionable error.
const SEARCH_SCHEMA_CONTRACT = {
  highlights: ['id', 'client_highlight_id', 'text', 'url', 'annotation', 'context_before', 'context_after', 'xpath', 'created_at'],
  images: ['id', 'client_highlight_id', 'r2_url', 'url', 'page_url', 'page_title', 'width', 'height', 'context_text', 'annotation', 'created_at'],
  notes: ['id', 'url', 'text', 'r2_url', 'created_at'],
  youtube_annotations: ['id', 'url', 'timestamp_seconds', 'annotation', 'created_at']
};

const SEARCH_TYPES = ['image', 'highlight', 'video', 'article'];

const articleEventsCte = (includeSearchText = false) => {
  const searchTextColumn = includeSearchText ? ',\n        source.search_text' : '';

  return `
    article_events AS (
      SELECT
        source.base_url,
        source.title,
        source.domain,
        source.created_at${searchTextColumn}
      FROM (
        SELECT
          h.url AS base_url,
          NULL::text AS title,
          REGEXP_REPLACE(REGEXP_REPLACE(h.url, '^https?://', ''), '/.*$', '') AS domain,
          h.created_at,
          to_jsonb(h)::text AS search_text
        FROM highlights h
        WHERE h.url IS NOT NULL AND h.url NOT LIKE '%youtube.com/watch%' AND h.url NOT LIKE '%youtu.be/%'

        UNION ALL

        SELECT
          i.page_url AS base_url,
          i.page_title AS title,
          REGEXP_REPLACE(REGEXP_REPLACE(i.page_url, '^https?://', ''), '/.*$', '') AS domain,
          i.created_at,
          to_jsonb(i)::text AS search_text
        FROM images i
        WHERE i.page_url IS NOT NULL AND i.page_url != '' AND i.page_url NOT LIKE '%youtube.com/watch%' AND i.page_url NOT LIKE '%youtu.be/%'

        UNION ALL

        SELECT
          n.url AS base_url,
          NULL::text AS title,
          REGEXP_REPLACE(REGEXP_REPLACE(n.url, '^https?://', ''), '/.*$', '') AS domain,
          n.created_at,
          to_jsonb(n)::text AS search_text
        FROM notes n
        WHERE n.url IS NOT NULL AND n.url NOT LIKE '%youtube.com/watch%' AND n.url NOT LIKE '%youtu.be/%'
      ) source
    )
  `;
};

const articleRollupQuery = ({ includeSearchText = false, countAlias = 'highlight_count', domainAlias = 'domain', includeShare = false } = {}) => `
  WITH ${articleEventsCte(includeSearchText)}
  SELECT
    ae.base_url,
    COALESCE(MAX(NULLIF(ae.title, '')), '') AS title,
    COALESCE(MAX(NULLIF(ae.domain, '')), '') AS ${domainAlias},
    COUNT(*) AS ${countAlias},
    MAX(ae.created_at) AS last_activity,
    MIN(ae.created_at) AS created_at${includeSearchText ? `,
    string_agg(ae.search_text, ' ') AS search_text` : ''}${includeShare ? `,
    cs.share_token,
    cs.is_public,
    'article' AS type` : ''}
  FROM article_events ae${includeShare ? `
  LEFT JOIN content_shares cs ON cs.content_url = ae.base_url` : ''}
  GROUP BY ae.base_url${includeShare ? ', cs.share_token, cs.is_public' : ''}
`;

const ensureSearchSchemaCompatibility = async () => {
  const tableNames = Object.keys(SEARCH_SCHEMA_CONTRACT);
  const result = await pool.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [tableNames]
  );

  const existing = {};
  result.rows.forEach(row => {
    if (!existing[row.table_name]) existing[row.table_name] = new Set();
    existing[row.table_name].add(row.column_name);
  });

  const missing = [];
  Object.entries(SEARCH_SCHEMA_CONTRACT).forEach(([table, columns]) => {
    columns.forEach(column => {
      if (!existing[table] || !existing[table].has(column)) {
        missing.push(table + '.' + column);
      }
    });
  });

  if (missing.length > 0) {
    throw new Error('Search schema contract is out of date. Update /api/search for missing columns: ' + missing.join(', '));
  }
};

// Keep existing databases compatible with newer API code. Some DBs may have
// been migrated manually, so make this small idempotent migration part of
// startup to avoid 500s when endpoints select updated_at.
const ensureNotesTableCompatibility = async () => {
  await pool.query(`
    ALTER TABLE IF EXISTS notes
      ADD COLUMN IF NOT EXISTS text TEXT,
      ADD COLUMN IF NOT EXISTS r2_key TEXT,
      ADD COLUMN IF NOT EXISTS r2_url TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);
  await pool.query(`
    UPDATE notes
    SET text = COALESCE(text, note)
    WHERE text IS NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notes' AND column_name = 'note'
    )
  `).catch(() => {});
  await pool.query(`
    UPDATE notes
    SET r2_url = COALESCE(r2_url, image_url)
    WHERE r2_url IS NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notes' AND column_name = 'image_url'
    )
  `).catch(() => {});
  await pool.query(`
    UPDATE notes
    SET updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE updated_at IS NULL
  `);
};

const ensureAnnotatedContentUpdatedAt = async () => {
  await pool.query(`
    ALTER TABLE IF EXISTS highlights
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS youtube_annotations
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS draw_data JSONB
  `);
  await pool.query(`
    UPDATE highlights
    SET updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE updated_at IS NULL
  `);
  await pool.query(`
    UPDATE youtube_annotations
    SET updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE updated_at IS NULL
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_highlights_updated_at ON highlights (updated_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_youtube_annotations_updated_at ON youtube_annotations (updated_at)');
};

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'reflect-backend' });
});

// Save highlight
app.post('/api/highlight', requireApiKey, async (req, res) => {
  try {
    const { machine_id, client_highlight_id, text, url, annotation, xpath, context_before, context_after } = req.body;

    if (client_highlight_id) {
      const result = await pool.query(
        `INSERT INTO highlights (machine_id, client_highlight_id, text, url, annotation, xpath, context_before, context_after, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (machine_id, client_highlight_id) WHERE client_highlight_id IS NOT NULL
         DO UPDATE SET
           annotation = COALESCE(NULLIF(EXCLUDED.annotation, ''), highlights.annotation),
           updated_at = NOW(),
           processed = FALSE,
           processed_at = NULL
         RETURNING id, created_at, updated_at`,
        [machine_id, client_highlight_id, text, url, annotation, xpath, context_before, context_after]
      );
      return res.json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at, updated_at: result.rows[0].updated_at, upserted: true });
    }

    const result = await pool.query(
      `INSERT INTO highlights (machine_id, text, url, annotation, xpath, context_before, context_after, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, created_at, updated_at`,
      [machine_id, text, url, annotation, xpath, context_before, context_after]
    );

    res.json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at, updated_at: result.rows[0].updated_at });
  } catch (error) {
    console.error('Error saving highlight:', error);
    res.status(500).json({ error: 'Failed to save highlight', details: error.message });
  }
});

// Save image (from highlight)
app.post('/api/image', requireApiKey, async (req, res) => {
  try {
    const { machine_id, client_image_id, client_highlight_id, base64, mime_type, url, page_url, page_title, width, height, context_text } = req.body;

    if (!base64 || !machine_id || !client_image_id) {
      return res.status(400).json({ error: 'Missing required fields: base64, machine_id, client_image_id' });
    }

    if (!r2) {
      return res.status(503).json({ error: 'R2 storage not configured' });
    }

    // Decode base64 — strip data URI prefix if present
    let rawBase64 = base64;
    let detectedMime = mime_type || 'image/jpeg';
    const dataUriMatch = base64.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      detectedMime = dataUriMatch[1];
      rawBase64 = dataUriMatch[2];
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    const ext = detectedMime.split('/')[1] || 'jpeg';
    const r2Key = `images/${crypto.randomUUID()}.${ext}`;

    // Upload to R2
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: detectedMime,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const r2Url = `https://${R2_PUBLIC_DOMAIN}/${r2Key}`;

    // Insert into database
    const result = await pool.query(
      `INSERT INTO images (machine_id, client_image_id, client_highlight_id, url, page_url, page_title, r2_key, r2_url, mime_type, size_bytes, width, height, context_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (machine_id, client_image_id)
       DO UPDATE SET
         r2_key = EXCLUDED.r2_key,
         r2_url = EXCLUDED.r2_url,
         processed = FALSE,
         processed_at = NULL
       RETURNING id, created_at`,
      [machine_id, client_image_id, client_highlight_id, url, page_url, page_title, r2Key, r2Url, detectedMime, buffer.length, width, height, context_text]
    );

    res.json({ success: true, id: result.rows[0].id, r2_url: r2Url, created_at: result.rows[0].created_at });
  } catch (error) {
    console.error('Error saving image:', error);
    res.status(500).json({ error: 'Failed to save image', details: error.message });
  }
});

// Check whether a video already has annotations.
app.get('/api/video-watched', requireApiKey, async (req, res) => {
  try {
    const videoUrl = req.query.video_url;
    if (!videoUrl) {
      return res.status(400).json({ error: 'video_url required' });
    }

    let baseUrl;
    try {
      const u = new URL(videoUrl);
      u.searchParams.delete('t');
      baseUrl = u.origin + u.pathname + '?v=' + u.searchParams.get('v');
    } catch (e) {
      return res.status(400).json({ error: 'Invalid video_url' });
    }

    const annotations = await pool.query(
      `SELECT COUNT(*) as count FROM youtube_annotations WHERE url LIKE $1`,
      [baseUrl + '%']
    );

    const annotationCount = parseInt(annotations.rows[0].count);

    res.json({
      watched: annotationCount > 0,
      visit_count: 0,
      annotation_count: annotationCount
    });
  } catch (error) {
    console.error('Error checking video watched:', error);
    res.status(500).json({ error: 'Failed to check', details: error.message });
  }
});

// Get YouTube annotations for a specific video
app.get('/api/youtube-annotations', requireApiKey, async (req, res) => {
  try {
    const videoUrl = req.query.video_url;
    const since = req.query.since || null;
    if (!videoUrl) {
      return res.status(400).json({ error: 'video_url query parameter required' });
    }

    // Strip t= param to get base video URL, then match by base URL pattern
    let baseUrl;
    try {
      const u = new URL(videoUrl);
      u.searchParams.delete('t');
      baseUrl = u.origin + u.pathname + '?v=' + u.searchParams.get('v');
    } catch (e) {
      return res.status(400).json({ error: 'Invalid video_url' });
    }

    let sinceIso = null;
    try {
      if (since) {
        sinceIso = resolveSince(since);
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const result = await pool.query(
      `SELECT id, machine_id, client_annotation_id, timestamp_seconds, annotation, draw_data, created_at, updated_at
       FROM youtube_annotations
       WHERE url LIKE $1
       ${sinceIso ? 'AND updated_at > $2' : ''}
       ORDER BY timestamp_seconds ASC`,
      sinceIso
        ? [baseUrl + '%', sinceIso]
        : [baseUrl + '%']
    );

    res.json({ annotations: result.rows });
  } catch (error) {
    console.error('Error fetching YouTube annotations:', error);
    res.status(500).json({ error: 'Failed to fetch annotations', details: error.message });
  }
});

// Update highlight text and/or annotation
app.put('/api/highlight/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, annotation } = req.body;

    const sets = [];
    const vals = [];
    let idx = 1;

    if (text !== undefined) {
      sets.push('text = $' + idx);
      vals.push(text);
      idx++;
    }
    if (annotation !== undefined) {
      sets.push('annotation = $' + idx);
      vals.push(annotation);
      idx++;
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'text or annotation required' });
    }

    sets.push('processed = FALSE', 'processed_at = NULL', 'updated_at = NOW()');
    vals.push(id);

    const result = await pool.query(
      'UPDATE highlights SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING id, text, annotation',
      vals
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ success: true, highlight: result.rows[0] });
  } catch (error) {
    console.error('Error updating highlight:', error);
    res.status(500).json({ error: 'Failed to update highlight', details: error.message });
  }
});

// Update YouTube annotation text
app.put('/api/youtube-annotation/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { annotation } = req.body;

    if (!annotation) {
      return res.status(400).json({ error: 'annotation required' });
    }

    const result = await pool.query(
      `UPDATE youtube_annotations SET annotation = $1, processed = FALSE, processed_at = NULL, updated_at = NOW()
       WHERE id = $2 RETURNING id`,
      [annotation, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error updating YouTube annotation:', error);
    res.status(500).json({ error: 'Failed to update annotation', details: error.message });
  }
});

// Save YouTube timestamp annotation
app.post('/api/youtube-annotation', requireApiKey, async (req, res) => {
  try {
    const { machine_id, client_annotation_id, client_visit_id, url, timestamp_seconds, annotation, draw_data } = req.body;

    if (!client_annotation_id || !annotation) {
      return res.status(400).json({ error: 'client_annotation_id and annotation required' });
    }

    const drawDataJson = draw_data ? JSON.stringify(draw_data) : null;

    const result = await pool.query(
      `INSERT INTO youtube_annotations (machine_id, client_annotation_id, client_visit_id, url, timestamp_seconds, annotation, draw_data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (machine_id, client_annotation_id) WHERE client_annotation_id IS NOT NULL
       DO UPDATE SET
         annotation = EXCLUDED.annotation,
         draw_data = EXCLUDED.draw_data,
         updated_at = NOW(),
         processed = FALSE,
         processed_at = NULL
       RETURNING id, created_at, updated_at`,
      [machine_id, client_annotation_id, client_visit_id, url, timestamp_seconds, annotation, drawDataJson]
    );

    res.json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at });
  } catch (error) {
    console.error('Error saving YouTube annotation:', error);
    res.status(500).json({ error: 'Failed to save YouTube annotation', details: error.message });
  }
});

// Get timeline (for popup)
app.get('/api/timeline', requireApiKey, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 1;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [highlights, ytAnnotations, standaloneImages] = await Promise.all([
      pool.query(
        `SELECT id, text, url, annotation, created_at FROM highlights
         WHERE created_at > $1
         ORDER BY created_at DESC`,
        [since]
      ),
      pool.query(
        `SELECT id, url, timestamp_seconds, annotation, draw_data, created_at FROM youtube_annotations
         WHERE created_at > $1
         ORDER BY created_at DESC`,
        [since]
      ),
      pool.query(
        `SELECT id, r2_url, page_url, created_at FROM images
         WHERE created_at > $1 AND client_highlight_id IS NULL
         ORDER BY created_at DESC`,
        [since]
      )
    ]);

    res.json({
      highlights: highlights.rows,
      youtube_annotations: ytAnnotations.rows,
      youtube_reflections: [],
      images: standaloneImages.rows
    });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    res.status(500).json({ error: 'Failed to fetch timeline', details: error.message });
  }
});

// Get unified feed (for masonry library)
async function fetchVideoPreviews(videoItems) {
  if (!videoItems.length) return;
  const videoUrls = videoItems.map(r => r.base_url);
  const likeClauses = videoUrls.map((_, i) => `url LIKE $${i + 1}`).join(' OR ');
  const likeParams = videoUrls.map(u => u + '%');
  const previewResult = await pool.query(
    `SELECT url, timestamp_seconds, annotation FROM youtube_annotations WHERE ${likeClauses} ORDER BY timestamp_seconds ASC`,
    likeParams
  );
  const previews = {};
  previewResult.rows.forEach(function(r) {
    var matchUrl = videoUrls.find(u => r.url.startsWith(u));
    if (!matchUrl) return;
    if (!previews[matchUrl]) previews[matchUrl] = [];
    if (previews[matchUrl].length < 3) {
      previews[matchUrl].push({ timestamp_seconds: r.timestamp_seconds, annotation: r.annotation });
    }
  });
  videoItems.forEach(item => { item.previews = previews[item.base_url] || []; });
}

async function fetchArticlePreviews(articleItems) {
  if (!articleItems.length) return;
  const articleUrls = articleItems.map(r => r.base_url);
  const [previewResult, imageResult] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (url, text) url, text, annotation FROM highlights WHERE url = ANY($1) ORDER BY url, text, created_at DESC`,
      [articleUrls]
    ),
    pool.query(
      `SELECT page_url, r2_url, width, height FROM images WHERE page_url = ANY($1) ORDER BY created_at ASC`,
      [articleUrls]
    )
  ]);
  const previews = {};
  previewResult.rows.forEach(function(r) {
    if (!previews[r.url]) previews[r.url] = [];
    if (previews[r.url].length < 3) {
      previews[r.url].push({ text: r.text, annotation: r.annotation });
    }
  });
  const imgsByUrl = {};
  imageResult.rows.forEach(function(r) {
    if (!imgsByUrl[r.page_url]) imgsByUrl[r.page_url] = [];
    imgsByUrl[r.page_url].push({ r2_url: r.r2_url, width: r.width, height: r.height });
  });
  articleItems.forEach(item => {
    item.previews = previews[item.base_url] || [];
    const imgs = imgsByUrl[item.base_url] || [];
    item.preview_image = imgs.length > 0 ? imgs[0] : null;
    item.image_count = imgs.length;
    item.highlight_count = parseInt(item.highlight_count);
  });
}

app.get('/api/feed', requireApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const typeFilter = req.query.type || null;

    const videoQuery = `
      SELECT
        COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(url, '[&?]t=\\d+', '', 'g')) AS base_url,
        NULL::text AS youtube_title,
        NULL::text AS youtube_channel,
        COUNT(*) AS annotation_count,
        NULL::text AS youtube_annotation,
        MAX(created_at) AS last_activity,
        MIN(created_at) AS created_at
      FROM youtube_annotations
      GROUP BY COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(url, '[&?]t=\\d+', '', 'g'))
    `;

    const articleQuery = articleRollupQuery();

    if (typeFilter) {
      let result, countResult;

      switch (typeFilter) {
        case 'image':
          [result, countResult] = await Promise.all([
            pool.query(
              `SELECT id, r2_url, width, height, context_text, page_url, page_title, annotation, client_highlight_id, created_at
               FROM images ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
            pool.query('SELECT COUNT(*) FROM images')
          ]);
          result.rows.forEach(r => r.type = 'image');
          break;

        case 'highlight':
          [result, countResult] = await Promise.all([
            pool.query(
              `SELECT id, text, url, annotation, created_at
               FROM highlights
               ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
            pool.query('SELECT COUNT(*) FROM highlights')
          ]);
          result.rows.forEach(r => r.type = 'highlight');
          break;

        case 'video':
          [result, countResult] = await Promise.all([
            pool.query(`${videoQuery} ORDER BY last_activity DESC LIMIT $1 OFFSET $2`, [limit, offset]),
            pool.query(`SELECT COUNT(*) FROM (${videoQuery}) sub`)
          ]);
          result.rows.forEach(r => { r.type = 'video'; r.annotation_count = parseInt(r.annotation_count); });
          await fetchVideoPreviews(result.rows);
          break;

        case 'article':
          [result, countResult] = await Promise.all([
            pool.query(`${articleQuery} ORDER BY last_activity DESC LIMIT $1 OFFSET $2`, [limit, offset]),
            pool.query(`SELECT COUNT(*) FROM (${articleQuery}) sub`)
          ]);
          result.rows.forEach(r => { r.type = 'article'; r.highlight_count = parseInt(r.highlight_count); });
          await fetchArticlePreviews(result.rows);
          break;

        default:
          return res.status(400).json({ error: 'Invalid type filter: ' + typeFilter });
      }

      const total = parseInt(countResult.rows[0].count);
      res.json({ items: result.rows, total, counts: { [typeFilter]: total } });
      return;
    }

    const perTableLimit = 200;
    const [images, highlights, videos, articles] = await Promise.all([
      pool.query(
        `SELECT id, r2_url, width, height, context_text, page_url, page_title, annotation, client_highlight_id, created_at
         FROM images ORDER BY created_at DESC LIMIT $1`, [perTableLimit]),
      pool.query(
        `SELECT id, text, url, annotation, created_at
         FROM highlights ORDER BY created_at DESC LIMIT $1`, [perTableLimit]),
      pool.query(`${videoQuery} ORDER BY last_activity DESC LIMIT $1`, [perTableLimit]),
      pool.query(`${articleQuery} ORDER BY last_activity DESC LIMIT $1`, [perTableLimit])
    ]);

    await Promise.all([fetchArticlePreviews(articles.rows), fetchVideoPreviews(videos.rows)]);

    const articleUrlSet = new Set(articles.rows.map(r => r.base_url));
    const allItems = [
      ...images.rows.filter(r => !articleUrlSet.has(r.page_url)).map(r => ({ ...r, type: 'image' })),
      ...highlights.rows.filter(r => !articleUrlSet.has(r.url)).map(r => ({ ...r, type: 'highlight' })),
      ...videos.rows.map(r => ({ ...r, annotation_count: parseInt(r.annotation_count), type: 'video' })),
      ...articles.rows.map(r => ({ ...r, highlight_count: parseInt(r.highlight_count), type: 'article' }))
    ];

    allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const items = allItems.slice(offset, offset + limit);
    const counts = {};
    allItems.forEach(function(item) { counts[item.type] = (counts[item.type] || 0) + 1; });

    res.json({ items, total: allItems.length, counts });
  } catch (error) {
    console.error('Error fetching feed:', error);
    res.status(500).json({ error: 'Failed to feed', details: error.message });
  }
});

// Backend-owned keyword search for the new tab Library. The query searches a
// unified document set built from explicit capture tables only; it avoids
// passive history and automatically includes newly-added table columns through
// row JSON text.
app.get('/api/search', requireApiKey, async (req, res) => {
  try {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) {
      return res.status(400).json({ error: 'q query parameter required' });
    }

    const parsedLimit = parseInt(req.query.limit);
    const parsedOffset = parseInt(req.query.offset);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 40, 1), 100);
    const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
    const typeFilter = req.query.type || null;

    if (typeFilter && SEARCH_TYPES.indexOf(typeFilter) === -1) {
      return res.status(400).json({ error: 'Invalid type filter: ' + typeFilter });
    }

    const likeQuery = rawQuery.replace(/[\\%_]/g, '\\$&');

    const result = await pool.query(`
      WITH search_query AS (
        SELECT websearch_to_tsquery('english', $1) AS query
      ),
      ${articleEventsCte(true)},
      candidates AS (
        SELECT
          'image'::text AS type,
          i.id::text AS id,
          NULL::text AS base_url,
          i.r2_url,
          i.width,
          i.height,
          i.context_text,
          i.page_url,
          i.page_title,
          i.annotation,
          i.client_highlight_id,
          NULL::text AS text,
          NULL::text AS url,
          NULL::text AS youtube_title,
          NULL::text AS youtube_channel,
          NULL::bigint AS annotation_count,
          NULL::text AS youtube_annotation,
          NULL::bigint AS highlight_count,
          NULL::text AS title,
          NULL::text AS domain,
          i.created_at AS last_activity,
          i.created_at,
          to_jsonb(i)::text AS search_text
        FROM images i

        UNION ALL

        SELECT
          'highlight'::text AS type,
          h.id::text AS id,
          NULL::text AS base_url,
          NULL::text AS r2_url,
          NULL::integer AS width,
          NULL::integer AS height,
          NULL::text AS context_text,
          NULL::text AS page_url,
          NULL::text AS page_title,
          h.annotation,
          h.client_highlight_id,
          h.text,
          h.url,
          NULL::text AS youtube_title,
          NULL::text AS youtube_channel,
          NULL::bigint AS annotation_count,
          NULL::text AS youtube_annotation,
          NULL::bigint AS highlight_count,
          NULL::text AS title,
          REGEXP_REPLACE(REGEXP_REPLACE(h.url, '^https?://', ''), '/.*$', '') AS domain,
          h.created_at AS last_activity,
          h.created_at,
          to_jsonb(h)::text AS search_text
        FROM highlights h

        UNION ALL

        SELECT
          'video'::text AS type,
          NULL::text AS id,
          COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(ya.url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(ya.url, '[&?]t=\\d+', '', 'g')) AS base_url,
          NULL::text AS r2_url,
          NULL::integer AS width,
          NULL::integer AS height,
          NULL::text AS context_text,
          NULL::text AS page_url,
          NULL::text AS page_title,
          NULL::text AS annotation,
          NULL::text AS client_highlight_id,
          NULL::text AS text,
          NULL::text AS url,
          NULL::text AS youtube_title,
          NULL::text AS youtube_channel,
          COUNT(*) AS annotation_count,
          NULL::text AS youtube_annotation,
          NULL::bigint AS highlight_count,
          NULL::text AS title,
          'youtube.com'::text AS domain,
          MAX(ya.created_at) AS last_activity,
          MIN(ya.created_at) AS created_at,
          string_agg(to_jsonb(ya)::text, ' ') AS search_text
        FROM youtube_annotations ya
        GROUP BY COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(ya.url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(ya.url, '[&?]t=\\d+', '', 'g'))

        UNION ALL

        SELECT
          'article'::text AS type,
          NULL::text AS id,
          ae.base_url,
          NULL::text AS r2_url,
          NULL::integer AS width,
          NULL::integer AS height,
          NULL::text AS context_text,
          NULL::text AS page_url,
          NULL::text AS page_title,
          NULL::text AS annotation,
          NULL::text AS client_highlight_id,
          NULL::text AS text,
          NULL::text AS url,
          NULL::text AS youtube_title,
          NULL::text AS youtube_channel,
          NULL::bigint AS annotation_count,
          NULL::text AS youtube_annotation,
          COUNT(*) AS highlight_count,
          COALESCE(MAX(NULLIF(ae.title, '')), '') AS title,
          COALESCE(MAX(NULLIF(ae.domain, '')), '') AS domain,
          MAX(ae.created_at) AS last_activity,
          MIN(ae.created_at) AS created_at,
          string_agg(ae.search_text, ' ') AS search_text
        FROM article_events ae
        GROUP BY ae.base_url
      ),
      ranked AS (
        SELECT
          candidates.*,
          ts_rank_cd(to_tsvector('english', COALESCE(search_text, '')), search_query.query) +
            CASE WHEN COALESCE(title, page_title, youtube_title, '') ILIKE '%' || $5 || '%' ESCAPE E'\\\\' THEN 0.4 ELSE 0 END +
            CASE WHEN COALESCE(base_url, url, page_url, '') ILIKE '%' || $5 || '%' ESCAPE E'\\\\' THEN 0.2 ELSE 0 END AS search_rank
        FROM candidates, search_query
        WHERE ($4::text IS NULL OR candidates.type = $4)
          AND (
            to_tsvector('english', COALESCE(search_text, '')) @@ search_query.query
            OR search_text ILIKE '%' || $5 || '%' ESCAPE E'\\\\'
          )
      ),
      grouped AS (
        SELECT *
        FROM (
          SELECT
            ranked.*,
            ROW_NUMBER() OVER (
              PARTITION BY
                CASE
                  WHEN $4::text IS NULL
                    AND ranked.type IN ('article', 'highlight', 'image')
                    AND COALESCE(ranked.base_url, ranked.url, ranked.page_url, '') != ''
                    AND COALESCE(ranked.base_url, ranked.url, ranked.page_url, '') NOT LIKE '%youtube.com/watch%'
                    AND COALESCE(ranked.base_url, ranked.url, ranked.page_url, '') NOT LIKE '%youtu.be/%'
                  THEN 'article:' || COALESCE(ranked.base_url, ranked.url, ranked.page_url, '')
                  ELSE ranked.type || ':' || COALESCE(ranked.id, ranked.base_url, ranked.url, ranked.page_url, '')
                END
              ORDER BY
                CASE WHEN ranked.type = 'article' THEN 0 ELSE 1 END,
                ranked.search_rank DESC,
                ranked.last_activity DESC
            ) AS group_rank
          FROM ranked
        ) grouped_candidates
        WHERE group_rank = 1
      )
      SELECT *, COUNT(*) OVER() AS total
      FROM grouped
      ORDER BY search_rank DESC, last_activity DESC
      LIMIT $2 OFFSET $3
    `, [rawQuery, limit, offset, typeFilter, likeQuery]);

    const items = result.rows.map(row => {
      const total = row.total;
      delete row.total;
      delete row.group_rank;
      delete row.search_text;
      row.search_rank = Number(row.search_rank || 0);
      if (row.annotation_count != null) row.annotation_count = parseInt(row.annotation_count);
      if (row.highlight_count != null) row.highlight_count = parseInt(row.highlight_count);
      row._total = total;
      return row;
    });

    await Promise.all([
      fetchArticlePreviews(items.filter(item => item.type === 'article')),
      fetchVideoPreviews(items.filter(item => item.type === 'video'))
    ]);

    const total = items.length ? parseInt(items[0]._total) : 0;
    items.forEach(item => { delete item._total; });
    res.json({ items, total, limit, offset, query: rawQuery, mode: 'keyword' });
  } catch (error) {
    console.error('Error searching library:', error);
    res.status(500).json({ error: 'Failed to search', details: error.message });
  }
});

// 7-day activity sparkline (matches feed "All" item types)
app.get('/api/feed-sparkline', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d::date AS date, COALESCE(c.count, 0)::int AS count FROM
      generate_series(NOW()::date - INTERVAL '6 days', NOW()::date, '1 day') AS d
      LEFT JOIN (
        SELECT created_at::date AS day, COUNT(*) AS count FROM (
          SELECT created_at FROM highlights WHERE created_at > NOW() - INTERVAL '7 days'
          UNION ALL SELECT created_at FROM youtube_annotations WHERE created_at > NOW() - INTERVAL '7 days'
          UNION ALL SELECT created_at FROM images WHERE created_at > NOW() - INTERVAL '7 days'
          UNION ALL SELECT created_at FROM notes WHERE created_at > NOW() - INTERVAL '7 days'
          UNION ALL SELECT created_at FROM read_later WHERE created_at > NOW() - INTERVAL '7 days'
        ) AS events GROUP BY day
      ) c ON c.day = d::date
      ORDER BY d::date
    `);
    res.json({ days: result.rows });
  } catch (error) {
    console.error('Error fetching feed sparkline:', error);
    res.status(500).json({ error: 'Failed to fetch sparkline' });
  }
});

// Get highlights for a specific page URL (for cross-machine sync)
app.get('/api/highlights-by-url', requireApiKey, async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) {
      return res.status(400).json({ error: 'url query parameter required' });
    }

    // Match by origin+pathname prefix (pageKey() in content.js strips query params)
    const result = await pool.query(
      `SELECT client_highlight_id, machine_id, text, xpath, context_before, context_after, annotation, created_at
       FROM highlights
       WHERE url LIKE $1
       ORDER BY created_at ASC`,
      [pageUrl + '%']
    );

    res.json({ highlights: result.rows });
  } catch (error) {
    console.error('Error fetching highlights by URL:', error);
    res.status(500).json({ error: 'Failed to fetch highlights', details: error.message });
  }
});

// Delete highlight by client_highlight_id (any machine — for cross-machine deletion)
app.delete('/api/highlight-by-client-id/:client_highlight_id', requireApiKey, async (req, res) => {
  try {
    const { client_highlight_id } = req.params;
    const result = await pool.query(
      'DELETE FROM highlights WHERE client_highlight_id = $1 RETURNING id',
      [client_highlight_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting highlight by client ID:', error);
    res.status(500).json({ error: 'Failed to delete', details: error.message });
  }
});

// Delete highlight by client_highlight_id
app.delete('/api/highlight/:machine_id/:client_highlight_id', requireApiKey, async (req, res) => {
  try {
    const { machine_id, client_highlight_id } = req.params;
    const result = await pool.query(
      'DELETE FROM highlights WHERE machine_id = $1 AND client_highlight_id = $2 RETURNING id',
      [machine_id, client_highlight_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting highlight:', error);
    res.status(500).json({ error: 'Failed to delete', details: error.message });
  }
});

// Delete a timeline item
app.delete('/api/timeline/:table/:id', requireApiKey, async (req, res) => {
  try {
    const { table, id } = req.params;
    const allowed = ['highlights', 'youtube_annotations', 'notes'];
    if (allowed.indexOf(table) === -1) {
      return res.status(400).json({ error: 'Invalid table' });
    }
    const result = await pool.query(
      `DELETE FROM ${table} WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting timeline item:', error);
    res.status(500).json({ error: 'Failed to delete', details: error.message });
  }
});

// Delete image
app.delete('/api/image/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;

    // Get the R2 key before deleting
    const lookup = await pool.query('SELECT r2_key FROM images WHERE id = $1', [id]);
    if (lookup.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete from R2
    if (r2) {
      await r2.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: lookup.rows[0].r2_key,
      }));
    }

    // Delete from database
    await pool.query('DELETE FROM images WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image', details: error.message });
  }
});

// Analytics endpoint — aggregated data for newtab Analytics tab
app.get('/api/analytics', requireApiKey, async (req, res) => {
  try {
    const now = new Date();
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const yearAgoISO = yearAgo.toISOString();

    const [heatmapResult, totalsResult, weekdayResult, hourlyResult, topDomainsResult, monthlyResult, streakResult] = await Promise.all([
      pool.query(`
        SELECT d::date AS date, COALESCE(c.count, 0) AS count FROM
        generate_series(NOW() - INTERVAL '364 days', NOW(), '1 day') AS d
        LEFT JOIN (
          SELECT created_at::date AS day, COUNT(*) AS count FROM (
            SELECT created_at FROM highlights WHERE created_at > $1
            UNION ALL SELECT created_at FROM youtube_annotations WHERE created_at > $1
            UNION ALL SELECT created_at FROM images WHERE created_at > $1
            UNION ALL SELECT created_at FROM notes WHERE created_at > $1
            UNION ALL SELECT created_at FROM read_later WHERE created_at > $1
          ) AS events GROUP BY day
        ) c ON c.day = d::date
        ORDER BY d::date
      `, [yearAgoISO]),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM highlights) AS highlights,
          (SELECT COUNT(*) FROM youtube_annotations) AS youtube_annotations,
          0 AS video_reflections,
          (SELECT COUNT(*) FROM images) AS images,
          (SELECT COUNT(*) FROM notes) AS notes,
          (SELECT COUNT(*) FROM read_later) AS read_later
      `),
      pool.query(`
        SELECT EXTRACT(DOW FROM created_at) AS dow, COUNT(*) AS count FROM (
          SELECT created_at FROM highlights
          UNION ALL SELECT created_at FROM youtube_annotations
          UNION ALL SELECT created_at FROM images
          UNION ALL SELECT created_at FROM notes
          UNION ALL SELECT created_at FROM read_later
        ) AS events GROUP BY dow ORDER BY dow
      `),
      pool.query(`
        SELECT EXTRACT(HOUR FROM created_at) AS hour, COUNT(*) AS count FROM (
          SELECT created_at FROM highlights
          UNION ALL SELECT created_at FROM youtube_annotations
          UNION ALL SELECT created_at FROM images
          UNION ALL SELECT created_at FROM notes
          UNION ALL SELECT created_at FROM read_later
        ) AS events GROUP BY hour ORDER BY hour
      `),
      pool.query(`
        SELECT domain, COUNT(*) AS count FROM (
          SELECT REGEXP_REPLACE(REGEXP_REPLACE(url, '^https?://', ''), '/.*$', '') AS domain FROM highlights WHERE url IS NOT NULL
          UNION ALL SELECT REGEXP_REPLACE(REGEXP_REPLACE(page_url, '^https?://', ''), '/.*$', '') AS domain FROM images WHERE page_url IS NOT NULL
          UNION ALL SELECT REGEXP_REPLACE(REGEXP_REPLACE(url, '^https?://', ''), '/.*$', '') AS domain FROM notes WHERE url IS NOT NULL
          UNION ALL SELECT domain FROM read_later WHERE domain IS NOT NULL AND domain != ''
        ) AS domains
        WHERE domain != '' AND domain IS NOT NULL
        GROUP BY domain ORDER BY count DESC LIMIT 15
      `),
      pool.query(`
        SELECT m::date AS month,
          COALESCE(h.c, 0) AS highlights,
          COALESCE(y.c, 0) AS youtube_annotations,
          COALESCE(i.c, 0) AS images,
          COALESCE(n.c, 0) AS notes
        FROM generate_series(date_trunc('month', NOW()) - INTERVAL '11 months', date_trunc('month', NOW()), '1 month') AS m
        LEFT JOIN (SELECT date_trunc('month', created_at) AS mo, COUNT(*) AS c FROM highlights GROUP BY mo) h ON h.mo = m
        LEFT JOIN (SELECT date_trunc('month', created_at) AS mo, COUNT(*) AS c FROM youtube_annotations GROUP BY mo) y ON y.mo = m
        LEFT JOIN (SELECT date_trunc('month', created_at) AS mo, COUNT(*) AS c FROM images GROUP BY mo) i ON i.mo = m
        LEFT JOIN (SELECT date_trunc('month', created_at) AS mo, COUNT(*) AS c FROM notes GROUP BY mo) n ON n.mo = m
        ORDER BY m
      `),
      pool.query(`
        SELECT DISTINCT created_at::date AS day FROM (
          SELECT created_at FROM highlights
          UNION ALL SELECT created_at FROM youtube_annotations
          UNION ALL SELECT created_at FROM images
          UNION ALL SELECT created_at FROM notes
          UNION ALL SELECT created_at FROM read_later
        ) AS events ORDER BY day DESC
      `)
    ]);

    const activeDays = streakResult.rows.map(r => r.day.toISOString().slice(0, 10));
    const todayStr = now.toISOString().slice(0, 10);
    const yesterdayStr = new Date(now - 86400000).toISOString().slice(0, 10);
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    if (activeDays.length > 0) {
      const startsToday = activeDays[0] === todayStr;
      const startsYesterday = activeDays[0] === yesterdayStr;
      if (startsToday || startsYesterday) {
        currentStreak = 1;
        for (let i = 1; i < activeDays.length; i++) {
          const prev = new Date(activeDays[i - 1]);
          const curr = new Date(activeDays[i]);
          const diffDays = (prev - curr) / 86400000;
          if (diffDays === 1) currentStreak++;
          else break;
        }
      }
    }

    for (let i = 0; i < activeDays.length; i++) {
      if (i === 0) tempStreak = 1;
      else {
        const prev = new Date(activeDays[i - 1]);
        const curr = new Date(activeDays[i]);
        const diffDays = (prev - curr) / 86400000;
        tempStreak = diffDays === 1 ? tempStreak + 1 : 1;
      }
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    }

    const weekdays = Array(7).fill(0);
    weekdayResult.rows.forEach(r => { weekdays[parseInt(r.dow)] = parseInt(r.count); });
    const hours = Array(24).fill(0);
    hourlyResult.rows.forEach(r => { hours[parseInt(r.hour)] = parseInt(r.count); });
    const totals = totalsResult.rows[0];

    res.json({
      heatmap: heatmapResult.rows.map(r => ({ date: r.date.toISOString().slice(0, 10), count: parseInt(r.count) })),
      streaks: {
        current: currentStreak,
        longest: longestStreak,
        today: heatmapResult.rows.length > 0 ? parseInt(heatmapResult.rows[heatmapResult.rows.length - 1].count) : 0,
        total_active_days: activeDays.length
      },
      totals: {
        highlights: parseInt(totals.highlights),
        youtube_annotations: parseInt(totals.youtube_annotations),
        video_reflections: parseInt(totals.video_reflections),
        images: parseInt(totals.images),
        notes: parseInt(totals.notes),
        read_later: parseInt(totals.read_later)
      },
      weekdays,
      hours,
      top_domains: topDomainsResult.rows.map(r => ({ domain: r.domain, count: parseInt(r.count) })),
      monthly_trend: monthlyResult.rows.map(r => ({
        month: r.month.toISOString().slice(0, 7),
        highlights: parseInt(r.highlights),
        youtube_annotations: parseInt(r.youtube_annotations),
        images: parseInt(r.images),
        notes: parseInt(r.notes)
      }))
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics', details: error.message });
  }
});

// Keep existing databases compatible with the renamed share table.
// `video_shares.video_url` was reused for both articles and videos; the new
// name makes that generic behavior explicit without changing the public API.
const ensureContentSharesTable = async () => {
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.content_shares') IS NULL AND to_regclass('public.video_shares') IS NOT NULL THEN
        ALTER TABLE video_shares RENAME TO content_shares;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content_url TEXT NOT NULL,
      share_token VARCHAR(32) UNIQUE NOT NULL,
      is_public BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'content_shares' AND column_name = 'video_url'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'content_shares' AND column_name = 'content_url'
      ) THEN
        ALTER TABLE content_shares RENAME COLUMN video_url TO content_url;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS content_shares
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);
  await pool.query(`
    UPDATE content_shares
    SET updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE updated_at IS NULL
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.idx_video_shares_url') IS NOT NULL AND to_regclass('public.idx_content_shares_url') IS NULL THEN
        ALTER INDEX idx_video_shares_url RENAME TO idx_content_shares_url;
      END IF;
    END $$;
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_content_shares_url ON content_shares (content_url)');
  console.log('✓ content_shares table ready');
};

// Get library items (videos + articles, sorted by recency)
app.get('/api/library', requireApiKey, async (req, res) => {
  try {
    const [videosResult, articlesResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(ya.url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(ya.url, '[&?]t=\\d+', '', 'g')) AS base_url,
          COUNT(*) AS item_count,
          MAX(ya.created_at) AS last_activity,
          NULL::text AS title,
          NULL::text AS subtitle,
          cs.share_token,
          cs.is_public,
          'video' AS type
        FROM youtube_annotations ya
        LEFT JOIN content_shares cs ON cs.content_url = COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(ya.url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(ya.url, '[&?]t=\\d+', '', 'g'))
        GROUP BY base_url, cs.share_token, cs.is_public
      `),
      pool.query(articleRollupQuery({
        countAlias: 'item_count',
        domainAlias: 'subtitle',
        includeShare: true
      }))
    ]);

    const items = [...videosResult.rows, ...articlesResult.rows];
    items.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
    res.json({ items });
  } catch (error) {
    console.error('Error fetching library:', error);
    res.status(500).json({ error: 'Failed to fetch library', details: error.message });
  }
});

// Get highlights for a specific article URL
app.get('/api/article-highlights', requireApiKey, async (req, res) => {
  try {
    const articleUrl = req.query.url;
    const since = req.query.since;
    let sinceIso = null;
    if (!articleUrl) return res.status(400).json({ error: 'url query parameter required' });
    if (since) {
      try { sinceIso = resolveSince(since); }
      catch (error) { return res.status(400).json({ error: error.message }); }
    }

    const [highlights, metadata, share, images] = await Promise.all([
      pool.query(
        `SELECT id, client_highlight_id, text, annotation, context_before, context_after, created_at, updated_at
         FROM highlights
         WHERE url = $1
         ${sinceIso ? 'AND updated_at > $2' : ''}
         ORDER BY created_at ASC`,
        sinceIso ? [articleUrl, sinceIso] : [articleUrl]
      ),
      pool.query(
        `SELECT title, domain FROM (
           SELECT page_title AS title, REGEXP_REPLACE(REGEXP_REPLACE(page_url, '^https?://', ''), '/.*$', '') AS domain, created_at
           FROM images WHERE page_url = $1 AND page_title IS NOT NULL AND page_title != ''
           UNION ALL
           SELECT NULL::text AS title, REGEXP_REPLACE(REGEXP_REPLACE(url, '^https?://', ''), '/.*$', '') AS domain, created_at
           FROM notes WHERE url = $1
           UNION ALL
           SELECT title, domain, created_at FROM read_later WHERE url = $1 AND title IS NOT NULL AND title != ''
         ) m ORDER BY created_at DESC LIMIT 1`,
        [articleUrl]
      ),
      pool.query('SELECT share_token, is_public FROM content_shares WHERE content_url = $1', [articleUrl]),
      pool.query(
        `SELECT id, client_highlight_id, r2_url, width, height, annotation
         FROM images WHERE page_url = $1 ORDER BY created_at ASC`,
        [articleUrl]
      )
    ]);

    const imagesByHighlight = {};
    for (const img of images.rows) {
      if (!img.client_highlight_id) continue;
      if (!imagesByHighlight[img.client_highlight_id]) imagesByHighlight[img.client_highlight_id] = [];
      imagesByHighlight[img.client_highlight_id].push(img);
    }

    res.json({
      url: articleUrl,
      title: metadata.rows[0]?.title || null,
      domain: metadata.rows[0]?.domain || domainFromUrl(articleUrl),
      share_token: share.rows[0]?.share_token || null,
      is_public: share.rows[0]?.is_public || false,
      highlights: highlights.rows.map(h => ({ ...h, images: imagesByHighlight[h.client_highlight_id] || [] }))
    });
  } catch (error) {
    console.error('Error fetching article highlights:', error);
    res.status(500).json({ error: 'Failed to fetch highlights', details: error.message });
  }
});

// Get public sharing state for any content (video or article)
app.get('/api/content-share/status', requireApiKey, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'url required' });
    }

    const result = await pool.query(
      'SELECT share_token, is_public FROM content_shares WHERE content_url = $1',
      [url]
    );

    res.json({
      share_token: result.rows[0]?.share_token || null,
      is_public: result.rows[0]?.is_public || false
    });
  } catch (error) {
    console.error('Error fetching content share status:', error);
    res.status(500).json({ error: 'Failed to fetch share status', details: error.message });
  }
});

// Toggle public sharing for any content (video or article)
app.post('/api/content-share', requireApiKey, async (req, res) => {
  try {
    const { url, is_public } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url required' });
    }

    const token = crypto.randomBytes(16).toString('hex');

    const result = await pool.query(`
      INSERT INTO content_shares (content_url, share_token, is_public)
      VALUES ($1, $2, $3)
      ON CONFLICT (content_url)
      DO UPDATE SET is_public = $3, updated_at = NOW()
      RETURNING share_token, is_public
    `, [url, token, is_public !== false]);

    res.json({ success: true, share_token: result.rows[0].share_token, is_public: result.rows[0].is_public });
  } catch (error) {
    console.error('Error toggling content share:', error);
    res.status(500).json({ error: 'Failed to toggle share', details: error.message });
  }
});

// Get shared article data (public, no auth required)
app.get('/api/shared-article/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const share = await pool.query('SELECT content_url, is_public FROM content_shares WHERE share_token = $1', [token]);
    if (share.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    if (!share.rows[0].is_public) return res.status(403).json({ error: 'This article is not publicly shared' });

    const articleUrl = share.rows[0].content_url;
    const [highlights, metadata] = await Promise.all([
      pool.query(
        `SELECT id, text, annotation, context_before, context_after, created_at
         FROM highlights WHERE url = $1 ORDER BY created_at ASC`,
        [articleUrl]
      ),
      pool.query(
        `SELECT title, domain FROM (
           SELECT page_title AS title, REGEXP_REPLACE(REGEXP_REPLACE(page_url, '^https?://', ''), '/.*$', '') AS domain, created_at
           FROM images WHERE page_url = $1 AND page_title IS NOT NULL AND page_title != ''
           UNION ALL
           SELECT NULL::text AS title, REGEXP_REPLACE(REGEXP_REPLACE(url, '^https?://', ''), '/.*$', '') AS domain, created_at
           FROM notes WHERE url = $1
           UNION ALL
           SELECT title, domain, created_at FROM read_later WHERE url = $1 AND title IS NOT NULL AND title != ''
         ) m ORDER BY created_at DESC LIMIT 1`,
        [articleUrl]
      )
    ]);

    res.json({
      url: articleUrl,
      title: metadata.rows[0]?.title || null,
      domain: metadata.rows[0]?.domain || domainFromUrl(articleUrl),
      highlights: highlights.rows
    });
  } catch (error) {
    console.error('Error fetching shared article:', error);
    res.status(500).json({ error: 'Failed to fetch shared article', details: error.message });
  }
});

// Get all annotated videos (grouped by base video URL)
app.get('/api/annotated-videos', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(ya.url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(ya.url, '[&?]t=\\d+', '', 'g')) AS base_url,
        COUNT(*) AS annotation_count,
        MIN(ya.created_at) AS first_annotation,
        MAX(ya.created_at) AS last_annotation,
        NULL::text AS title,
        NULL::text AS channel,
        cs.share_token,
        cs.is_public
      FROM youtube_annotations ya
      LEFT JOIN content_shares cs ON cs.content_url = COALESCE('https://www.youtube.com/watch?v=' || SUBSTRING(ya.url FROM '[&?]v=([^&]+)'), REGEXP_REPLACE(ya.url, '[&?]t=\\d+', '', 'g'))
      GROUP BY base_url, cs.share_token, cs.is_public
      ORDER BY last_annotation DESC
    `);
    res.json({ videos: result.rows });
  } catch (error) {
    console.error('Error fetching annotated videos:', error);
    res.status(500).json({ error: 'Failed to fetch annotated videos', details: error.message });
  }
});

// Get annotated articles and videos changed in a recent window
// Toggle public sharing for a video
app.post('/api/video-share', requireApiKey, async (req, res) => {
  try {
    const { video_url, is_public } = req.body;
    if (!video_url) {
      return res.status(400).json({ error: 'video_url required' });
    }

    const token = crypto.randomBytes(16).toString('hex');

    const result = await pool.query(`
      INSERT INTO content_shares (content_url, share_token, is_public)
      VALUES ($1, $2, $3)
      ON CONFLICT (content_url)
      DO UPDATE SET is_public = $3, updated_at = NOW()
      RETURNING share_token, is_public
    `, [video_url, token, is_public !== false]);

    res.json({ success: true, share_token: result.rows[0].share_token, is_public: result.rows[0].is_public });
  } catch (error) {
    console.error('Error toggling video share:', error);
    res.status(500).json({ error: 'Failed to toggle share', details: error.message });
  }
});

// Get shared video data (public, no auth required)
app.get('/api/shared-video/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const share = await pool.query('SELECT content_url, is_public FROM content_shares WHERE share_token = $1', [token]);
    if (share.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    if (!share.rows[0].is_public) return res.status(403).json({ error: 'This video is not publicly shared' });

    const videoUrl = share.rows[0].content_url;
    const annotations = await pool.query(
      `SELECT id, timestamp_seconds, annotation, created_at
       FROM youtube_annotations
       WHERE url LIKE $1
       ORDER BY timestamp_seconds ASC`,
      [videoUrl + '%']
    );

    res.json({ video_url: videoUrl, title: null, channel: null, annotations: annotations.rows });
  } catch (error) {
    console.error('Error fetching shared video:', error);
    res.status(500).json({ error: 'Failed to fetch shared video', details: error.message });
  }
});

// Serve shared video page
app.get('/v/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shared.html'));
});

// Serve shared article page
app.get('/a/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shared-article.html'));
});

// ---- Notes (standalone, attached to article/video URLs) ----

// Create a note
app.post('/api/note', requireApiKey, async (req, res) => {
  try {
    const { url, text, base64, mime_type } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    if (!text && !base64) return res.status(400).json({ error: 'text or base64 image required' });

    let r2Key = null;
    let r2Url = null;

    if (base64) {
      if (!r2) return res.status(503).json({ error: 'R2 storage not configured' });

      let rawBase64 = base64;
      let detectedMime = mime_type || 'image/png';
      const dataUriMatch = base64.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        detectedMime = dataUriMatch[1];
        rawBase64 = dataUriMatch[2];
      }

      const buffer = Buffer.from(rawBase64, 'base64');
      const ext = detectedMime.split('/')[1] || 'png';
      r2Key = `notes/${crypto.randomUUID()}.${ext}`;

      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: buffer,
        ContentType: detectedMime,
        CacheControl: 'public, max-age=31536000, immutable',
      }));

      r2Url = `https://${process.env.R2_PUBLIC_DOMAIN}/${r2Key}`;
    }

    const result = await pool.query(
      `INSERT INTO notes (url, text, r2_key, r2_url) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [url, text || null, r2Key, r2Url]
    );

    res.json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at, r2_url: r2Url });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note', details: error.message });
  }
});

// Get notes for a URL
app.get('/api/notes', requireApiKey, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });

    const result = await pool.query(
      `SELECT id, url, text, r2_url, created_at FROM notes WHERE url = $1 ORDER BY created_at ASC`,
      [url]
    );

    res.json({ notes: result.rows });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes', details: error.message });
  }
});

// Update a note's text
app.put('/api/note/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const result = await pool.query(
      `UPDATE notes SET text = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
      [text, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note', details: error.message });
  }
});

// Delete a note (+ R2 cleanup)
app.delete('/api/note/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query(`SELECT r2_key FROM notes WHERE id = $1`, [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    if (existing.rows[0].r2_key && r2) {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: existing.rows[0].r2_key }));
    }

    await pool.query(`DELETE FROM notes WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note', details: error.message });
  }
});

// ---- Read Later ----

// Save a URL for reading later (upsert on url)
app.post('/api/read-later', requireApiKey, async (req, res) => {
  try {
    const { url, title, domain, preview_image } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const result = await pool.query(
      `INSERT INTO read_later (url, title, domain, preview_image)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, read_later.title),
         domain = COALESCE(EXCLUDED.domain, read_later.domain),
         preview_image = COALESCE(EXCLUDED.preview_image, read_later.preview_image)
       RETURNING id, url, title, domain, preview_image, is_read, created_at`,
      [url, title || null, domain || null, preview_image || null]
    );

    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error('Error saving read-later:', error);
    res.status(500).json({ error: 'Failed to save', details: error.message });
  }
});

// List read later items
app.get('/api/read-later', requireApiKey, async (req, res) => {
  try {
    const { is_read } = req.query;
    let query = 'SELECT id, url, title, domain, preview_image, is_read, created_at FROM read_later';
    const params = [];

    if (is_read !== undefined) {
      params.push(is_read === 'true');
      query += ' WHERE is_read = $1';
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Error fetching read-later:', error);
    res.status(500).json({ error: 'Failed to fetch', details: error.message });
  }
});

// Check if a URL is saved
app.get('/api/read-later/check', requireApiKey, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });

    const result = await pool.query(
      'SELECT id, url, title, domain, preview_image, is_read, created_at FROM read_later WHERE url = $1',
      [url]
    );

    if (result.rows.length === 0) return res.json({ found: false });
    res.json({ found: true, item: result.rows[0] });
  } catch (error) {
    console.error('Error checking read-later:', error);
    res.status(500).json({ error: 'Failed to check', details: error.message });
  }
});

// Update read status
app.put('/api/read-later/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_read } = req.body;

    const result = await pool.query(
      'UPDATE read_later SET is_read = $1 WHERE id = $2 RETURNING id, is_read',
      [is_read, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error('Error updating read-later:', error);
    res.status(500).json({ error: 'Failed to update', details: error.message });
  }
});

// Delete a read later item
app.delete('/api/read-later/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM read_later WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting read-later:', error);
    res.status(500).json({ error: 'Failed to delete', details: error.message });
  }
});

initializeSchema()
  .then(() => Promise.all([
    ensureAnnotatedContentUpdatedAt(),
    ensureNotesTableCompatibility(),
    ensureContentSharesTable()
  ]))
  .then(() => ensureSearchSchemaCompatibility())
  .then(() => {
    app.listen(port, () => {
      console.log(`🚀 Reflect backend listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize backend schema:', error);
    process.exit(1);
  });
