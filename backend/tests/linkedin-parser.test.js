const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const captureScript = fs.readFileSync(path.join(__dirname, '..', '..', 'linkedin-capture.js'), 'utf8');

function parserFor(body, url = 'https://www.linkedin.com/feed/') {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url,
    runScripts: 'outside-only'
  });
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} } },
    storage: { local: { get(keys, callback) { callback({}); } } }
  };
  dom.window.eval(captureScript);
  return { dom, parser: dom.window.__reflectLinkedInParserForTests };
}

function actions() {
  return `
    <div class="actions">
      <button aria-label="Like">Like</button>
      <button aria-label="Comment">Comment</button>
      <button aria-label="Repost">Repost</button>
      <button aria-label="Send">Send</button>
    </div>`;
}

test('extracts a normal outer post with exact publication and observation times', () => {
  const id = '7412345678901234567';
  const { dom, parser } = parserFor(`
    <article data-urn="urn:li:activity:${id}">
      <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/nick-ang/"><span aria-hidden="true">Nick Ang</span></a>
      <a href="https://www.linkedin.com/feed/update/urn:li:activity:${id}/"><time datetime="2026-09-11T09:00:17.456Z">1h</time></a>
      <div class="update-components-text">A sufficiently long outer post about building an evidence-grounded writing practice.</div>
      <div class="social-details-social-counts"><span aria-label="12 reactions">12 reactions</span><span>3 comments</span><span>1 repost</span><span>120 impressions</span></div>
      ${actions()}
    </article>`);

  const root = parser.findPostRoot(dom.window.document.querySelector('.update-components-text'));
  const result = parser.extractPost(root);
  assert.equal(result.identity.platformPostId, id);
  assert.equal(result.author.name, 'Nick Ang');
  assert.match(result.content.text, /evidence-grounded/);
  assert.equal(result.published.value, '2026-09-11T09:00:17.456Z');
  assert.equal(result.metrics.values.reactions, 12);
  assert.equal(result.metrics.values.comments, 3);
  assert.equal(result.metrics.values.reposts, 1);
  assert.equal(result.metrics.values.impressions, 120);
  assert.ok(!Number.isNaN(Date.parse(result.observedAt)));
  assert.equal(result.nestedContext.isolationComplete, true);
});

test('isolates a nested repost subtree from outer author, content, time, and metrics', () => {
  const outerId = '7412345678901234567';
  const nestedId = '7312345678901234567';
  const { dom, parser } = parserFor(`
    <article data-urn="urn:li:activity:${outerId}">
      <a class="update-components-actor__meta-link" href="/in/outer-author"><span aria-hidden="true">Outer Author</span></a>
      <a href="/feed/update/urn:li:activity:${outerId}/"><time datetime="2026-09-11T09:00:00.000Z">1h</time></a>
      <div class="update-components-text">Outer commentary that must remain the selected canonical post content.</div>
      <div class="update-components-mini-update-v2" data-urn="urn:li:activity:${nestedId}">
        <a class="update-components-actor__meta-link" href="/in/nested-author"><span aria-hidden="true">Nested Author</span></a>
        <a href="/feed/update/urn:li:activity:${nestedId}/"><time datetime="2026-01-01T09:00:00.000Z">8mo</time></a>
        <div class="update-components-text">Nested content that must not replace the outer commentary during extraction.</div>
        <span aria-label="999 reactions">999 reactions</span><span>500 comments</span>
      </div>
      <div class="social-details-social-counts"><span aria-label="5 reactions">5 reactions</span><span>2 comments</span></div>
      ${actions()}
    </article>`);

  const result = parser.extractPost(dom.window.document.querySelector('article'));
  assert.equal(result.nestedContext.isolationComplete, true);
  assert.equal(result.author.name, 'Outer Author');
  assert.match(result.content.text, /^Outer commentary/);
  assert.equal(result.published.value, '2026-09-11T09:00:00.000Z');
  assert.equal(result.metrics.values.reactions, 5);
  assert.equal(result.metrics.values.comments, 2);
  assert.equal(result.embeddedPost.platform_post_id, nestedId);
  assert.match(result.embeddedPost.permalink, new RegExp(nestedId));
  assert.equal(result.embeddedPost.author_name, 'Nested Author');
});

test('isolates a permalink-only nested post when it has a semantic reshared root', () => {
  const outerId = '7412345678901234567';
  const nestedId = '7312345678901234567';
  const { dom, parser } = parserFor(`
    <article data-urn="urn:li:activity:${outerId}">
      <a href="/in/outer-author"><span aria-hidden="true">Outer Author</span></a>
      <a href="/feed/update/urn:li:activity:${outerId}/">1h</a>
      <div class="update-components-text">Outer text long enough to be selected instead of nested fallback text.</div>
      <div data-view-name="feed-reshared-content">
        <a href="/feed/update/urn:li:activity:${nestedId}/">Nested timestamp</a>
        <div class="update-components-text">Nested text that should be excluded from the outer post.</div>
        <span>800 reactions</span>
      </div>
      <span>7 reactions</span>
      ${actions()}
    </article>`);

  const result = parser.extractPost(dom.window.document.querySelector('article'));
  assert.equal(result.nestedContext.isolationComplete, true);
  assert.match(result.content.text, /^Outer text/);
  assert.equal(result.metrics.values.reactions, 7);
  assert.equal(result.embeddedPost.platform_post_id, nestedId);
  assert.match(result.embeddedPost.permalink, new RegExp(nestedId));
});

test('rejects confidence when a nested permalink has no isolatable semantic root', () => {
  const outerId = '7412345678901234567';
  const nestedId = '7312345678901234567';
  const { dom, parser } = parserFor(`
    <article data-urn="urn:li:activity:${outerId}">
      <a href="/feed/update/urn:li:activity:${outerId}/">Outer</a>
      <div class="update-components-text">Outer content that is sufficiently long for extraction.</div>
      <div><a href="/feed/update/urn:li:activity:${nestedId}/">Unmarked nested post</a><span>900 reactions</span></div>
      ${actions()}
    </article>`);

  const result = parser.extractPost(dom.window.document.querySelector('article'));
  assert.equal(result.nestedContext.isolationComplete, false);
  assert.equal(result.confidence, 'low');
});

test('classifies ownership only by exact normalized profile identity', () => {
  const { parser } = parserFor('');
  assert.equal(parser.inferOwnership('https://linkedin.com/in/Nick-Ang/', 'https://www.linkedin.com/in/nick-ang?trk=x'), 'own');
  assert.equal(parser.inferOwnership('https://linkedin.com/in/nick-ang', 'https://linkedin.com/in/someone-else'), 'external');
  assert.equal(parser.inferOwnership('https://linkedin.com/in/nick-ang', ''), 'unknown');
  assert.equal(parser.inferOwnership('', 'https://linkedin.com/in/nick-ang'), 'unknown');
});
