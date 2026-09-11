const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backgroundScript = fs.readFileSync(path.join(__dirname, '..', '..', 'background-with-api.js'), 'utf8');

function createHarness() {
  const storage = {
    machineId: 'machine-test',
    apiEnabled: true,
    apiBaseUrl: 'https://reflect.example',
    apiKey: 'secret'
  };
  let messageListener;
  let alarmListener;
  let fetchCalls = 0;

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(key => { if (key in storage) result[key] = storage[key]; });
          queueMicrotask(() => callback(result));
        },
        set(values, callback) {
          Object.assign(storage, values);
          queueMicrotask(() => callback && callback());
        }
      }
    },
    alarms: {
      create() {},
      onAlarm: { addListener(listener) { alarmListener = listener; } }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { query() {}, sendMessage() {} }
  };

  const context = {
    chrome,
    console,
    URL,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    fetch: async () => {
      fetchCalls++;
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        async json() { return { error: 'contract rejected' }; }
      };
    },
    self: { addEventListener() {} }
  };
  vm.createContext(context);
  vm.runInContext(backgroundScript, context);

  function send(message) {
    return new Promise(resolve => {
      const keepAlive = messageListener(message, {}, resolve);
      assert.equal(keepAlive, true);
    });
  }

  return {
    storage,
    send,
    fireAlarm() { alarmListener({ name: 'reflect-retry-failed-requests' }); },
    fetchCalls() { return fetchCalls; }
  };
}

function capture(id) {
  return {
    contract_version: 1,
    client_capture_id: id,
    post: { platform: 'linkedin', platform_post_id: '7412345678901234567' },
    snapshot: { observed_at: '2026-09-11T10:00:00.000Z' },
    reflection: { text: 'A reflection' }
  };
}

test('concurrent permanent failures remain local, become failed, and are not retried by alarms', async () => {
  const harness = createHarness();
  const [first, second] = await Promise.all([
    harness.send({ action: 'save-social-post-capture', capture: capture('capture-a') }),
    harness.send({ action: 'save-social-post-capture', capture: capture('capture-b') })
  ]);

  assert.equal(first.ok, false);
  assert.equal(first.permanent_failure, true);
  assert.equal(second.ok, false);
  assert.equal(second.permanent_failure, true);

  const records = harness.storage.xr_social_post_captures;
  assert.equal(records.length, 2);
  assert.deepEqual(Array.from(records, record => record.client_capture_id).sort(), ['capture-a', 'capture-b']);
  assert.ok(records.every(record => record.sync_status === 'failed'));
  assert.equal(harness.fetchCalls(), 2);

  harness.fireAlarm();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(harness.fetchCalls(), 2, 'failed captures must not retry forever');

  const listed = await harness.send({ action: 'get-social-post-outbox' });
  assert.equal(listed.ok, true);
  assert.equal(listed.captures.length, 2);
  const discarded = await harness.send({ action: 'discard-social-post-capture', client_capture_id: 'capture-a' });
  assert.equal(discarded.ok, true);
  const afterDiscard = await harness.send({ action: 'get-social-post-outbox' });
  assert.deepEqual(Array.from(afterDiscard.captures, record => record.client_capture_id), ['capture-b']);
});
