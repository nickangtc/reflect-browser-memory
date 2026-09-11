const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const express = require('express');
const { Pool } = require('pg');
const createSocialPostsRouter = require('../routes/social-posts');

function commandPath(name) {
  const result = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed: ${result.stderr || result.stdout}`);
  }
}

function payload(clientCaptureId, observedAt, overrides = {}) {
  const id = '7412345678901234567';
  return {
    contract_version: 1,
    machine_id: 'postgres-test-machine',
    client_capture_id: clientCaptureId,
    post: {
      platform: 'linkedin',
      platform_post_id: id,
      permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`,
      author_name: 'Original Author',
      author_profile_url: 'https://www.linkedin.com/in/original-author',
      content_text: 'Original content',
      published_at: '2026-09-11T09:00:17.456Z',
      published_at_raw: '1h',
      published_at_source: 'linkedin_activity_id',
      media: {},
      embedded_post: null,
      corrections: {},
      ...overrides
    },
    snapshot: {
      observed_at: observedAt,
      surface: 'feed',
      metrics: { reactions: 1, comments: 0, reposts: 0, impressions: 100 },
      metrics_raw: {},
      parser_version: 'linkedin-v1',
      extraction_confidence: 'high',
      capture_context: {}
    },
    reflection: {
      ownership: 'own',
      performance_assessment: 'too_early_or_unknown',
      text: 'Integration test reflection',
      tags: []
    }
  };
}

async function postJson(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/v1/social-post-captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const responseBody = await response.json();
  assert.equal(response.status, 200, JSON.stringify(responseBody));
  return responseBody;
}

test('PostgreSQL preserves canonical corrections and concurrent idempotency', { timeout: 30000 }, async t => {
  const initdb = commandPath('initdb');
  const pgCtl = commandPath('pg_ctl');
  const createdb = commandPath('createdb');
  if (!initdb || !pgCtl || !createdb) {
    t.skip('PostgreSQL server binaries are not installed');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-social-postgres-'));
  const data = path.join(root, 'data');
  const port = await freePort();
  let pool;
  let server;

  t.after(async () => {
    if (server) {
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }
    if (pool) await pool.end();
    spawnSync(pgCtl, ['-D', data, '-m', 'fast', 'stop'], { encoding: 'utf8' });
    fs.rmSync(root, { recursive: true, force: true });
  });

  run(initdb, ['-D', data, '-A', 'trust', '-U', 'postgres']);
  run(pgCtl, ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start']);
  run(createdb, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'reflect_test']);

  pool = new Pool({ connectionString: `postgresql://postgres@127.0.0.1:${port}/reflect_test` });
  const initSql = fs.readFileSync(path.join(__dirname, '..', 'init.sql'), 'utf8');
  await pool.query(initSql);

  const app = express();
  app.use(express.json());
  app.use('/api', createSocialPostsRouter({ pool, requireApiKey: (req, res, next) => next() }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await postJson(baseUrl, payload('capture-1', '2026-09-11T10:00:00.000Z'));
  await postJson(baseUrl, payload('capture-2', '2026-09-12T10:00:00.000Z', {
    author_name: null,
    content_text: null,
    published_at: null,
    published_at_raw: null,
    published_at_source: 'unknown',
    corrections: { author_name: true, content_text: true, published_at: true }
  }));
  await postJson(baseUrl, payload('capture-3', '2026-09-13T10:00:00.000Z', {
    author_name: 'Parser tried to refill this',
    content_text: 'Parser tried to refill this too',
    published_at: '2026-09-13T09:00:00.000Z',
    published_at_source: 'linkedin_activity_id',
    corrections: {}
  }));

  const result = await pool.query(
    `SELECT author_name, content_text, published_at,
            author_name_user_corrected, content_text_user_corrected, published_at_user_corrected,
            (SELECT COUNT(*)::int FROM social_post_snapshots) AS snapshot_count
     FROM social_posts WHERE platform_post_id = $1`,
    ['7412345678901234567']
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].author_name, null);
  assert.equal(result.rows[0].content_text, null);
  assert.equal(result.rows[0].published_at, null);
  assert.equal(result.rows[0].author_name_user_corrected, true);
  assert.equal(result.rows[0].content_text_user_corrected, true);
  assert.equal(result.rows[0].published_at_user_corrected, true);
  assert.equal(result.rows[0].snapshot_count, 3);

  const raceId = '7422222222222222222';
  const racePayloads = ['Race Author A', 'Race Author B'].map((author, index) => {
    const body = payload('shared-race-capture', '2026-09-14T10:00:00.000Z', {
      author_name: author,
      corrections: { author_name: true }
    });
    body.post.platform_post_id = raceId;
    body.post.permalink = `https://www.linkedin.com/feed/update/urn:li:activity:${raceId}/`;
    body.reflection.text = `Race reflection ${index}`;
    return body;
  });
  const raceResponses = await Promise.all(racePayloads.map(body => postJson(baseUrl, body)));
  const winners = raceResponses
    .map((response, index) => ({ response, index }))
    .filter(item => item.response.replayed !== true);
  assert.equal(winners.length, 1, 'exactly one concurrent delivery must create evidence');

  const raceResult = await pool.query(
    `SELECT author_name, author_name_user_corrected,
            (SELECT COUNT(*)::int FROM social_post_snapshots WHERE post_id = social_posts.id) AS snapshot_count
     FROM social_posts WHERE platform_post_id = $1`,
    [raceId]
  );
  assert.equal(raceResult.rowCount, 1);
  assert.equal(raceResult.rows[0].author_name, racePayloads[winners[0].index].post.author_name);
  assert.equal(raceResult.rows[0].author_name_user_corrected, true);
  assert.equal(raceResult.rows[0].snapshot_count, 1);
});
