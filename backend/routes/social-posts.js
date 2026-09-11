const express = require('express');

const CONTRACT_VERSION = 1;
const OWNERSHIP_VALUES = new Set(['own', 'external', 'unknown']);
const PERFORMANCE_VALUES = new Set(['doing_well', 'underperforming', 'too_early_or_unknown']);
const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);
const SURFACE_VALUES = new Set(['feed', 'detail', 'unknown']);
const PUBLISHED_SOURCE_VALUES = new Set(['time_element', 'linkedin_activity_id', 'user_corrected', 'unknown']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableString(value) {
  return nonEmptyString(value) ? value.trim() : null;
}

function validTimestamp(value) {
  if (!nonEmptyString(value)) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 15 || offsetMinute > 59) return false;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= maxDay && !Number.isNaN(Date.parse(value));
}

function validClientIdentifier(value) {
  return nonEmptyString(value) && value.trim().length <= 255;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withinLength(value, max) {
  return value === null || value === undefined || (typeof value === 'string' && value.length <= max);
}

function validLinkedInProfileUrl(value) {
  if (value === null || value === undefined || value === '') return true;
  try {
    const url = new URL(value);
    return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/(in|company)\/[^/?#]+\/?$/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function validLinkedInPermalink(value, platformPostId) {
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return false;
    const decodedPath = decodeURIComponent(url.pathname);
    if (!/^\/feed\/update\/urn:li:activity:\d+\/?$/i.test(decodedPath) &&
        !/^\/posts\/[^/]*activity-\d+[^/]*\/?$/i.test(decodedPath)) return false;
    const match = decodedPath.match(/urn:li:activity:(\d{10,})|activity-(\d{10,})/i);
    return !!match && (match[1] || match[2]) === platformPostId;
  } catch (_) {
    return false;
  }
}

function validMetrics(metrics) {
  if (!plainObject(metrics)) return false;
  return ['reactions', 'comments', 'reposts', 'impressions'].every(key => {
    const value = metrics[key];
    return value === null || value === undefined || (Number.isInteger(value) && value >= 0);
  });
}

function normalizeMetrics(metrics) {
  const normalized = {};
  for (const key of ['reactions', 'comments', 'reposts', 'impressions']) {
    const value = metrics && metrics[key];
    normalized[key] = Number.isInteger(value) && value >= 0 ? value : null;
  }
  return normalized;
}

module.exports = function createSocialPostsRouter({ pool, requireApiKey }) {
  const router = express.Router();

  router.post('/v1/social-post-captures', requireApiKey, async (req, res) => {
    const body = req.body || {};
    const post = body.post || {};
    const snapshot = body.snapshot || {};
    const reflection = body.reflection || {};

    if (body.contract_version !== CONTRACT_VERSION) {
      return res.status(400).json({ error: `contract_version must be ${CONTRACT_VERSION}` });
    }
    if (!validClientIdentifier(body.machine_id) || !validClientIdentifier(body.client_capture_id)) {
      return res.status(400).json({ error: 'machine_id and client_capture_id are required and must be at most 255 characters' });
    }
    if (post.platform !== 'linkedin' || typeof post.platform_post_id !== 'string' ||
        !/^\d{10,30}$/.test(post.platform_post_id) || !nonEmptyString(post.permalink)) {
      return res.status(400).json({ error: 'A numeric LinkedIn platform_post_id and permalink are required' });
    }
    if (!validLinkedInPermalink(post.permalink, post.platform_post_id)) {
      return res.status(400).json({ error: 'post.permalink must be a LinkedIn URL matching platform_post_id' });
    }
    if (!validLinkedInProfileUrl(post.author_profile_url)) {
      return res.status(400).json({ error: 'post.author_profile_url must be a LinkedIn profile or company URL' });
    }
    if (!withinLength(post.permalink, 2048) || !withinLength(post.author_name, 500) ||
        !withinLength(post.author_profile_url, 2048) || !withinLength(post.content_text, 100000) ||
        !withinLength(post.published_at_raw, 500)) {
      return res.status(400).json({ error: 'One or more post fields exceed the supported length' });
    }
    if (post.published_at !== null && post.published_at !== undefined && !validTimestamp(post.published_at)) {
      return res.status(400).json({ error: 'post.published_at must be null or an ISO timestamp' });
    }
    if (!PUBLISHED_SOURCE_VALUES.has(post.published_at_source || 'unknown')) {
      return res.status(400).json({ error: 'post.published_at_source is invalid' });
    }
    if (!plainObject(post.media) || (post.embedded_post !== null && post.embedded_post !== undefined && !plainObject(post.embedded_post)) ||
        (post.corrections !== null && post.corrections !== undefined && !plainObject(post.corrections))) {
      return res.status(400).json({ error: 'post media, embedded_post, and corrections must be objects' });
    }
    if (plainObject(post.corrections) && ['author_name', 'author_profile_url', 'content_text', 'published_at']
      .some(key => post.corrections[key] !== undefined && typeof post.corrections[key] !== 'boolean')) {
      return res.status(400).json({ error: 'post correction flags must be boolean' });
    }
    if (!validTimestamp(snapshot.observed_at)) {
      return res.status(400).json({ error: 'snapshot.observed_at must be an ISO timestamp' });
    }
    if (!SURFACE_VALUES.has(snapshot.surface || 'unknown')) {
      return res.status(400).json({ error: 'snapshot.surface is invalid' });
    }
    if (!CONFIDENCE_VALUES.has(snapshot.extraction_confidence)) {
      return res.status(400).json({ error: 'snapshot.extraction_confidence is invalid' });
    }
    if (!nonEmptyString(snapshot.parser_version) || snapshot.parser_version.length > 100) {
      return res.status(400).json({ error: 'snapshot.parser_version is required and must be at most 100 characters' });
    }
    if (!validMetrics(snapshot.metrics) || !plainObject(snapshot.metrics_raw) || !plainObject(snapshot.capture_context)) {
      return res.status(400).json({ error: 'snapshot metrics, metrics_raw, and capture_context are invalid' });
    }
    if (!OWNERSHIP_VALUES.has(reflection.ownership)) {
      return res.status(400).json({ error: 'reflection.ownership is invalid' });
    }
    if (!PERFORMANCE_VALUES.has(reflection.performance_assessment)) {
      return res.status(400).json({ error: 'reflection.performance_assessment is invalid' });
    }
    if (!nonEmptyString(reflection.text) || reflection.text.length > 10000) {
      return res.status(400).json({ error: 'reflection.text is required and must be at most 10000 characters' });
    }
    if (!Array.isArray(reflection.tags) || reflection.tags.length > 20 ||
        reflection.tags.some(tag => !nonEmptyString(tag) || tag.length > 100)) {
      return res.status(400).json({ error: 'reflection.tags must contain at most 20 non-empty tags' });
    }

    const publishedAt = post.published_at || null;
    const tags = reflection.tags.map(tag => tag.trim());
    const corrections = post.corrections && typeof post.corrections === 'object' ? post.corrections : {};
    const captureContext = snapshot.capture_context && typeof snapshot.capture_context === 'object'
      ? { ...snapshot.capture_context }
      : {};
    // Preserve exactly which confirmed canonical fields accompanied each
    // metrics snapshot. Later imperfect captures must not erase earlier truth.
    captureContext.observed_post = {
      author_name: nullableString(post.author_name),
      author_profile_url: nullableString(post.author_profile_url),
      content_text: nullableString(post.content_text),
      published_at: publishedAt,
      published_at_raw: nullableString(post.published_at_raw),
      published_at_source: nullableString(post.published_at_source),
      media: post.media && typeof post.media === 'object' ? post.media : {},
      embedded_post: post.embedded_post && typeof post.embedded_post === 'object' ? post.embedded_post : null,
      corrections: {
        author_name: corrections.author_name === true,
        author_profile_url: corrections.author_profile_url === true,
        content_text: corrections.content_text === true,
        published_at: corrections.published_at === true
      }
    };
    let client = null;
    let inTransaction = false;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      inTransaction = true;

      const existingDelivery = await client.query(
        `SELECT
           snapshots.id AS snapshot_id,
           snapshots.post_id,
           snapshots.observed_at,
           posts.platform,
           posts.platform_post_id,
           reflections.id AS reflection_id
         FROM social_post_snapshots snapshots
         JOIN social_posts posts ON posts.id = snapshots.post_id
         LEFT JOIN social_post_reflections reflections ON reflections.snapshot_id = snapshots.id
         WHERE snapshots.machine_id = $1 AND snapshots.client_capture_id = $2`,
        [body.machine_id.trim(), body.client_capture_id.trim()]
      );

      if (existingDelivery.rowCount > 0) {
        const existing = existingDelivery.rows[0];
        if (existing.platform !== post.platform || existing.platform_post_id !== post.platform_post_id.trim()) {
          await client.query('ROLLBACK');
          inTransaction = false;
          return res.status(409).json({ error: 'client_capture_id is already associated with another post' });
        }
        await client.query('COMMIT');
        inTransaction = false;
        return res.json({
          success: true,
          replayed: true,
          contract_version: CONTRACT_VERSION,
          post_id: existing.post_id,
          snapshot_id: existing.snapshot_id,
          id: existing.reflection_id,
          reflection_id: existing.reflection_id,
          observed_at: existing.observed_at
        });
      }

      const postResult = await client.query(
        `INSERT INTO social_posts (
           platform, platform_post_id, permalink, author_name, author_profile_url,
           content_text, published_at, published_at_raw, published_at_source,
           media, embedded_post, author_name_user_corrected,
           author_profile_url_user_corrected, content_text_user_corrected,
           published_at_user_corrected, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, NOW())
         ON CONFLICT (platform, platform_post_id)
         DO UPDATE SET
           permalink = COALESCE(NULLIF(social_posts.permalink, ''), EXCLUDED.permalink),
           author_name = CASE
             WHEN EXCLUDED.author_name_user_corrected THEN EXCLUDED.author_name
             WHEN social_posts.author_name_user_corrected THEN social_posts.author_name
             ELSE COALESCE(social_posts.author_name, EXCLUDED.author_name)
           END,
           author_profile_url = CASE
             WHEN EXCLUDED.author_profile_url_user_corrected THEN EXCLUDED.author_profile_url
             WHEN social_posts.author_profile_url_user_corrected THEN social_posts.author_profile_url
             ELSE COALESCE(social_posts.author_profile_url, EXCLUDED.author_profile_url)
           END,
           content_text = CASE
             WHEN EXCLUDED.content_text_user_corrected THEN EXCLUDED.content_text
             WHEN social_posts.content_text_user_corrected THEN social_posts.content_text
             ELSE COALESCE(social_posts.content_text, EXCLUDED.content_text)
           END,
           published_at = CASE
             WHEN EXCLUDED.published_at_user_corrected THEN EXCLUDED.published_at
             WHEN social_posts.published_at_user_corrected THEN social_posts.published_at
             WHEN EXCLUDED.published_at IS NULL THEN social_posts.published_at
             WHEN social_posts.published_at IS NULL THEN EXCLUDED.published_at
             WHEN (CASE EXCLUDED.published_at_source WHEN 'time_element' THEN 2 WHEN 'linkedin_activity_id' THEN 1 ELSE 0 END)
                >= (CASE social_posts.published_at_source WHEN 'time_element' THEN 2 WHEN 'linkedin_activity_id' THEN 1 ELSE 0 END)
               THEN EXCLUDED.published_at ELSE social_posts.published_at
           END,
           published_at_raw = CASE
             WHEN EXCLUDED.published_at_user_corrected THEN EXCLUDED.published_at_raw
             WHEN social_posts.published_at_user_corrected THEN social_posts.published_at_raw
             WHEN EXCLUDED.published_at IS NOT NULL AND
                  (CASE EXCLUDED.published_at_source WHEN 'time_element' THEN 2 WHEN 'linkedin_activity_id' THEN 1 ELSE 0 END)
                  >= (CASE social_posts.published_at_source WHEN 'time_element' THEN 2 WHEN 'linkedin_activity_id' THEN 1 ELSE 0 END)
               THEN EXCLUDED.published_at_raw ELSE social_posts.published_at_raw
           END,
           published_at_source = CASE
             WHEN EXCLUDED.published_at_user_corrected THEN EXCLUDED.published_at_source
             WHEN social_posts.published_at_user_corrected THEN social_posts.published_at_source
             WHEN EXCLUDED.published_at IS NOT NULL AND
                  (CASE EXCLUDED.published_at_source WHEN 'time_element' THEN 2 WHEN 'linkedin_activity_id' THEN 1 ELSE 0 END)
                  >= (CASE social_posts.published_at_source WHEN 'time_element' THEN 2 WHEN 'linkedin_activity_id' THEN 1 ELSE 0 END)
               THEN EXCLUDED.published_at_source ELSE social_posts.published_at_source
           END,
           author_name_user_corrected = social_posts.author_name_user_corrected OR EXCLUDED.author_name_user_corrected,
           author_profile_url_user_corrected = social_posts.author_profile_url_user_corrected OR EXCLUDED.author_profile_url_user_corrected,
           content_text_user_corrected = social_posts.content_text_user_corrected OR EXCLUDED.content_text_user_corrected,
           published_at_user_corrected = social_posts.published_at_user_corrected OR EXCLUDED.published_at_user_corrected,
           media = CASE WHEN social_posts.media = '{}'::jsonb THEN EXCLUDED.media ELSE social_posts.media END,
           embedded_post = COALESCE(social_posts.embedded_post, EXCLUDED.embedded_post),
           updated_at = NOW()
         RETURNING id`,
        [
          post.platform,
          post.platform_post_id.trim(),
          post.permalink.trim(),
          nullableString(post.author_name),
          nullableString(post.author_profile_url),
          nullableString(post.content_text),
          publishedAt,
          nullableString(post.published_at_raw),
          nullableString(post.published_at_source),
          JSON.stringify(post.media && typeof post.media === 'object' ? post.media : {}),
          post.embedded_post && typeof post.embedded_post === 'object' ? JSON.stringify(post.embedded_post) : null,
          corrections.author_name === true,
          corrections.author_profile_url === true,
          corrections.content_text === true,
          corrections.published_at === true
        ]
      );
      const postId = postResult.rows[0].id;

      const snapshotResult = await client.query(
        `INSERT INTO social_post_snapshots (
           post_id, machine_id, client_capture_id, observed_at, surface, metrics,
           metrics_raw, parser_version, extraction_confidence, capture_context
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
         ON CONFLICT (machine_id, client_capture_id) DO NOTHING
         RETURNING id`,
        [
          postId,
          body.machine_id.trim(),
          body.client_capture_id.trim(),
          snapshot.observed_at,
          snapshot.surface || 'unknown',
          JSON.stringify(normalizeMetrics(snapshot.metrics)),
          JSON.stringify(snapshot.metrics_raw && typeof snapshot.metrics_raw === 'object' ? snapshot.metrics_raw : {}),
          snapshot.parser_version.trim(),
          snapshot.extraction_confidence,
          JSON.stringify(captureContext)
        ]
      );
      if (snapshotResult.rowCount === 0) {
        const racedDelivery = await client.query(
          `SELECT snapshots.id AS snapshot_id, snapshots.post_id, snapshots.observed_at,
                  posts.platform, posts.platform_post_id, reflections.id AS reflection_id
           FROM social_post_snapshots snapshots
           JOIN social_posts posts ON posts.id = snapshots.post_id
           LEFT JOIN social_post_reflections reflections ON reflections.snapshot_id = snapshots.id
           WHERE snapshots.machine_id = $1 AND snapshots.client_capture_id = $2`,
          [body.machine_id.trim(), body.client_capture_id.trim()]
        );
        const existing = racedDelivery.rows[0];
        if (!existing || existing.platform !== post.platform || existing.platform_post_id !== post.platform_post_id.trim()) {
          await client.query('ROLLBACK');
          inTransaction = false;
          return res.status(409).json({ error: 'client_capture_id conflicts with another delivery' });
        }
        // This request lost a concurrent idempotency race after touching the
        // canonical post. Roll back those changes before returning the winner.
        await client.query('ROLLBACK');
        inTransaction = false;
        return res.json({
          success: true,
          replayed: true,
          contract_version: CONTRACT_VERSION,
          post_id: existing.post_id,
          snapshot_id: existing.snapshot_id,
          id: existing.reflection_id,
          reflection_id: existing.reflection_id,
          observed_at: existing.observed_at
        });
      }
      const snapshotId = snapshotResult.rows[0].id;

      const reflectionResult = await client.query(
        `INSERT INTO social_post_reflections (
           snapshot_id, ownership, performance_assessment, reflection_text, tags, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (snapshot_id)
         DO UPDATE SET
           ownership = EXCLUDED.ownership,
           performance_assessment = EXCLUDED.performance_assessment,
           reflection_text = EXCLUDED.reflection_text,
           tags = EXCLUDED.tags,
           updated_at = NOW()
         RETURNING id`,
        [snapshotId, reflection.ownership, reflection.performance_assessment, reflection.text.trim(), tags]
      );

      await client.query('COMMIT');
      inTransaction = false;
      res.json({
        success: true,
        contract_version: CONTRACT_VERSION,
        post_id: postId,
        snapshot_id: snapshotId,
        id: reflectionResult.rows[0].id,
        reflection_id: reflectionResult.rows[0].id,
        observed_at: snapshot.observed_at
      });
    } catch (error) {
      if (client && inTransaction) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) {
          console.error('Failed to roll back social-post capture:', rollbackError);
        }
      }
      console.error('Error saving social-post capture:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to save social-post capture' });
    } finally {
      if (client) client.release();
    }
  });

  return router;
};

module.exports.CONTRACT_VERSION = CONTRACT_VERSION;
