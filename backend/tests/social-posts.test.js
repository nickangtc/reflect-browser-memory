const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createSocialPostsRouter = require('../routes/social-posts');

function createFakePool() {
  const deliveries = new Map();
  let currentPost = null;

  const client = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) return { rowCount: 0, rows: [] };

      if (compact.startsWith('SELECT snapshots.id AS snapshot_id')) {
        const delivery = deliveries.get(params[0] + ':' + params[1]);
        return { rowCount: delivery ? 1 : 0, rows: delivery ? [delivery] : [] };
      }

      if (compact.startsWith('INSERT INTO social_posts')) {
        currentPost = { id: 'post-' + params[1], platform: params[0], platform_post_id: params[1] };
        return { rowCount: 1, rows: [{ id: currentPost.id }] };
      }

      if (compact.startsWith('INSERT INTO social_post_snapshots')) {
        const key = params[1] + ':' + params[2];
        if (deliveries.has(key)) return { rowCount: 0, rows: [] };
        const delivery = {
          snapshot_id: 'snapshot-' + params[2],
          post_id: params[0],
          observed_at: params[3],
          platform: currentPost.platform,
          platform_post_id: currentPost.platform_post_id,
          reflection_id: null
        };
        deliveries.set(key, delivery);
        return { rowCount: 1, rows: [{ id: delivery.snapshot_id }] };
      }

      if (compact.startsWith('INSERT INTO social_post_reflections')) {
        const delivery = Array.from(deliveries.values()).find(item => item.snapshot_id === params[0]);
        delivery.reflection_id = 'reflection-' + params[0];
        return { rowCount: 1, rows: [{ id: delivery.reflection_id }] };
      }

      throw new Error('Unexpected SQL in fake pool: ' + compact.slice(0, 100));
    },
    release() {}
  };

  return { async connect() { return client; } };
}

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSocialPostsRouter({
    pool: createFakePool(),
    requireApiKey: (req, res, next) => next()
  }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function capture(overrides = {}) {
  const base = {
    contract_version: 1,
    machine_id: 'machine-test',
    client_capture_id: 'capture-test',
    post: {
      platform: 'linkedin',
      platform_post_id: '7412345678901234567',
      permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:7412345678901234567/',
      author_name: 'Test Author',
      author_profile_url: 'https://www.linkedin.com/in/test-author',
      content_text: 'A test post',
      published_at: '2026-09-11T09:00:00.000Z',
      published_at_raw: '1h',
      published_at_source: 'linkedin_activity_id',
      media: { type: 'none' },
      embedded_post: null
    },
    snapshot: {
      observed_at: '2026-09-11T10:00:00.000Z',
      surface: 'feed',
      metrics: { reactions: 3, comments: 1, reposts: 0, impressions: 120 },
      metrics_raw: { impressions: '120 impressions' },
      parser_version: 'linkedin-v1',
      extraction_confidence: 'high',
      capture_context: { page_url: 'https://www.linkedin.com/feed/' }
    },
    reflection: {
      ownership: 'own',
      performance_assessment: 'underperforming',
      text: 'This angle may not resonate.',
      tags: ['topic']
    }
  };
  return { ...base, ...overrides };
}

async function postJson(baseUrl, body) {
  const response = await fetch(baseUrl + '/api/v1/social-post-captures', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

test('persists a valid capture and treats an exact retry as a replay', async () => {
  await withServer(async baseUrl => {
    const first = await postJson(baseUrl, capture());
    assert.equal(first.response.status, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.replayed, undefined);
    assert.ok(first.body.post_id);
    assert.ok(first.body.snapshot_id);
    assert.ok(first.body.reflection_id);

    const replay = await postJson(baseUrl, capture());
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.snapshot_id, first.body.snapshot_id);
  });
});

test('rejects reuse of a delivery ID for another post', async () => {
  await withServer(async baseUrl => {
    await postJson(baseUrl, capture());
    const changed = capture();
    changed.post = {
      ...changed.post,
      platform_post_id: '7499999999999999999',
      permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:7499999999999999999/'
    };
    const result = await postJson(baseUrl, changed);
    assert.equal(result.response.status, 409);
  });
});

test('rejects numeric platform IDs and non-post LinkedIn URLs as contract errors', async () => {
  await withServer(async baseUrl => {
    const numericId = capture();
    numericId.post = { ...numericId.post, platform_post_id: 7412345678901234567 };
    const numericResult = await postJson(baseUrl, numericId);
    assert.equal(numericResult.response.status, 400);

    const nonPostUrl = capture({ client_capture_id: 'capture-non-post-url' });
    nonPostUrl.post = {
      ...nonPostUrl.post,
      permalink: 'https://www.linkedin.com/in/test-author?activity=7412345678901234567'
    };
    const urlResult = await postJson(baseUrl, nonPostUrl);
    assert.equal(urlResult.response.status, 400);
  });
});

test('rejects non-ISO and impossible observation timestamps before opening a DB connection', async () => {
  await withServer(async baseUrl => {
    const invalid = capture();
    invalid.snapshot = { ...invalid.snapshot, observed_at: 'yesterday' };
    const result = await postJson(baseUrl, invalid);
    assert.equal(result.response.status, 400);

    const impossible = capture({ client_capture_id: 'capture-impossible-date' });
    impossible.snapshot = { ...impossible.snapshot, observed_at: '2026-02-31T10:00:00.000Z' };
    const impossibleResult = await postJson(baseUrl, impossible);
    assert.equal(impossibleResult.response.status, 400);

    const invalidOffset = capture({ client_capture_id: 'capture-invalid-offset' });
    invalidOffset.snapshot = { ...invalidOffset.snapshot, observed_at: '2026-02-28T10:00:00.000+16:00' };
    const invalidOffsetResult = await postJson(baseUrl, invalidOffset);
    assert.equal(invalidOffsetResult.response.status, 400);
  });
});
