// Background service worker for Reflect.
// Sync is optional and configured from the extension settings page.

var HIGHLIGHT_KEY = 'xr_highlights';
var SOCIAL_POST_CAPTURE_KEY = 'xr_social_post_captures';
var YOUTUBE_WATCHED_KEY_PREFIX = 'xr_youtube_watched:';

function youtubeVideoId(videoUrl) {
  try {
    return new URL(videoUrl).searchParams.get('v');
  } catch (error) {
    return null;
  }
}

function youtubeWatchedStorageKey(videoUrl) {
  var videoId = youtubeVideoId(videoUrl);
  return videoId ? YOUTUBE_WATCHED_KEY_PREFIX + videoId : null;
}

async function getLocallyWatchedVideo(videoUrl) {
  var key = youtubeWatchedStorageKey(videoUrl);
  if (!key) return null;

  return await new Promise(resolve => {
    chrome.storage.local.get([key], result => resolve(result[key] || null));
  });
}

async function rememberWatchedVideo(videoUrl, source) {
  var key = youtubeWatchedStorageKey(videoUrl);
  if (!key) return false;

  await new Promise(resolve => {
    chrome.storage.local.set({
      [key]: {
        videoId: youtubeVideoId(videoUrl),
        watchedAt: new Date().toISOString(),
        source: source || 'local-playback'
      }
    }, resolve);
  });
  return true;
}

const API_CONFIG = {
  baseUrl: '',
  apiKey: '',
  machineId: null,
  enabled: false
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['machineId', 'apiEnabled'], (result) => {
    if (!result.machineId) {
      const machineId = `machine-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      chrome.storage.local.set({ machineId, apiEnabled: false });
      API_CONFIG.machineId = machineId;
      console.log('✓ Generated machine ID:', machineId);
    } else {
      API_CONFIG.machineId = result.machineId;
      API_CONFIG.enabled = result.apiEnabled === true;
      console.log('✓ Loaded machine ID:', result.machineId);
    }
  });
});

chrome.storage.local.get(['machineId', 'apiEnabled', 'apiBaseUrl', 'apiKey'], (result) => {
  if (result.machineId) API_CONFIG.machineId = result.machineId;
  if (result.apiEnabled !== undefined) API_CONFIG.enabled = result.apiEnabled;
  API_CONFIG.baseUrl = result.apiBaseUrl || '';
  API_CONFIG.apiKey = result.apiKey || '';
});

async function ensureConfig() {
  await new Promise(resolve => {
    chrome.storage.local.get(['machineId', 'apiEnabled', 'apiBaseUrl', 'apiKey'], (result) => {
      if (result.machineId) API_CONFIG.machineId = result.machineId;
      if (result.apiEnabled !== undefined) API_CONFIG.enabled = result.apiEnabled;
      API_CONFIG.baseUrl = result.apiBaseUrl || '';
      API_CONFIG.apiKey = result.apiKey || '';
      resolve();
    });
  });
}

async function apiGet(endpoint) {
  await ensureConfig();
  if (!API_CONFIG.enabled) return null;
  if (!API_CONFIG.apiKey || !API_CONFIG.baseUrl) return null;

  try {
    const response = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
      headers: { 'X-API-Key': API_CONFIG.apiKey }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('API GET failed:', endpoint, error.message);
    return null;
  }
}

async function apiErrorMessage(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body.details || body.error || '';
  } catch (error) {
    // The status text below is still useful when the response has no JSON body.
  }
  return detail || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

async function apiRequest(endpoint, data, retries = 3, queueOnFailure = true) {
  await ensureConfig();
  if (!API_CONFIG.enabled) return null;

  if (!API_CONFIG.apiKey || !API_CONFIG.baseUrl || !API_CONFIG.machineId) {
    console.warn('API sync skipped: missing backend URL, API key, or machine ID in settings');
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_CONFIG.apiKey
        },
        body: JSON.stringify({ machine_id: API_CONFIG.machineId, ...data })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      console.log('✓ Synced to backend:', endpoint, result.id);
      return result;
    } catch (error) {
      console.error(`API request failed (${attempt}/${retries}):`, error.message);
      if (attempt === retries) {
        if (queueOnFailure) queueFailedRequest(endpoint, data);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

async function deliverSocialCapture(capture, retries = 3) {
  await ensureConfig();
  if (!API_CONFIG.enabled || !API_CONFIG.apiKey || !API_CONFIG.baseUrl || !API_CONFIG.machineId) {
    return { state: 'pending', error: 'Backend sync is not configured' };
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/api/v1/social-post-captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_CONFIG.apiKey
        },
        body: JSON.stringify({ machine_id: API_CONFIG.machineId, ...capture })
      });
      if (response.ok) return { state: 'synced', result: await response.json() };

      const error = await apiErrorMessage(response);
      const retryable = response.status === 401 || response.status === 403 ||
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable) return { state: 'failed', error: error, status: response.status };
      if (attempt === retries) return { state: 'pending', error: error, status: response.status };
    } catch (error) {
      if (attempt === retries) return { state: 'pending', error: error.message };
    }
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
  }

  return { state: 'pending', error: 'Unknown delivery failure' };
}

async function deliverAndUpdateSocialCapture(capture, retries) {
  const delivery = await deliverSocialCapture(capture, retries);
  if (delivery.state === 'synced') {
    await removeLocalSocialCapture(capture.client_capture_id);
  } else {
    await storeLocalSocialCapture(capture, delivery.state, {
      error: delivery.error || null,
      status: delivery.status || null
    });
  }
  return delivery;
}

function queueFailedRequest(endpoint, data) {
  chrome.storage.local.get(['failedRequests'], (result) => {
    const queue = result.failedRequests || [];
    queue.push({ endpoint, data, timestamp: Date.now() });
    chrome.storage.local.set({ failedRequests: queue.slice(-100) });
  });
}

var socialStorageMutation = Promise.resolve();

function readLocalSocialCaptures() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([SOCIAL_POST_CAPTURE_KEY], result => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(result[SOCIAL_POST_CAPTURE_KEY] || []);
    });
  });
}

function storeLocalSocialCapture(capture, syncStatus, backendResult) {
  var mutation = socialStorageMutation.catch(function () {}).then(async function () {
    const captures = await readLocalSocialCaptures();
    const record = {
      ...capture,
      sync_status: syncStatus,
      backend_result: backendResult || null,
      locally_updated_at: new Date().toISOString()
    };
    const existingIndex = captures.findIndex(item => item.client_capture_id === capture.client_capture_id);
    if (existingIndex >= 0) captures[existingIndex] = record;
    else captures.push(record);

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [SOCIAL_POST_CAPTURE_KEY]: captures }, function () {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve();
      });
    });
  });
  socialStorageMutation = mutation;
  return mutation;
}

function removeLocalSocialCapture(clientCaptureId) {
  var mutation = socialStorageMutation.catch(function () {}).then(async function () {
    const captures = await readLocalSocialCaptures();
    const remaining = captures.filter(item => item.client_capture_id !== clientCaptureId);
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [SOCIAL_POST_CAPTURE_KEY]: remaining }, function () {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve();
      });
    });
  });
  socialStorageMutation = mutation;
  return mutation;
}

async function syncPendingSocialCaptures() {
  await ensureConfig();
  if (!API_CONFIG.enabled || !API_CONFIG.apiKey || !API_CONFIG.baseUrl || !API_CONFIG.machineId) return;

  var captures;
  try {
    captures = await readLocalSocialCaptures();
  } catch (error) {
    console.error('Could not read social-post outbox:', error.message);
    return;
  }

  for (const capture of captures) {
    if (capture.sync_status !== 'pending') continue;
    try {
      await deliverAndUpdateSocialCapture(capture, 1);
    } catch (error) {
      console.error('Could not update social-post outbox:', error.message);
    }
  }
}

async function retryFailedRequests() {
  chrome.storage.local.get(['failedRequests'], async (result) => {
    const queue = result.failedRequests || [];
    if (queue.length === 0) return;

    console.log(`Retrying ${queue.length} failed requests...`);
    const remaining = [];
    for (const item of queue) {
      const success = await apiRequest(item.endpoint, item.data, 1, false);
      if (success && item.endpoint === '/api/v1/social-post-captures') {
        await removeLocalSocialCapture(item.data.client_capture_id);
      }
      if (!success) {
        const age = Date.now() - item.timestamp;
        if (age < 7 * 24 * 60 * 60 * 1000) remaining.push(item);
      }
    }
    chrome.storage.local.set({ failedRequests: remaining });
  });
}

const RETRY_ALARM = 'reflect-retry-failed-requests';
chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === RETRY_ALARM) {
    retryFailedRequests();
    syncPendingSocialCaptures();
  }
});
chrome.runtime.onStartup.addListener(function () {
  retryFailedRequests();
  syncPendingSocialCaptures();
});
self.addEventListener('online', function () {
  retryFailedRequests();
  syncPendingSocialCaptures();
});

chrome.commands.onCommand.addListener(function (command) {
  if (command === 'highlight-selection' || command === 'annotate-youtube' || command === 'capture-linkedin-post') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      var action = command === 'highlight-selection'
        ? 'highlight'
        : command === 'annotate-youtube'
          ? 'annotate-youtube'
          : 'start-social-post-capture';
      chrome.tabs.sendMessage(tabs[0].id, { action: action }, function () {
        // Reading lastError prevents a noisy service-worker warning on non-matching pages.
        void chrome.runtime.lastError;
      });
    });
  }
});

self.__reflectBackgroundForTests = {
  deliverSocialCapture: deliverSocialCapture,
  syncPendingSocialCaptures: syncPendingSocialCaptures,
  readLocalSocialCaptures: readLocalSocialCaptures
};

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (msg.action === 'get-social-post-outbox') {
    readLocalSocialCaptures()
      .then(captures => reply({ ok: true, captures: captures }))
      .catch(error => reply({ ok: false, error: error.message, captures: [] }));
    return true;
  }

  if (msg.action === 'retry-social-post-capture') {
    (async function () {
      try {
        var captures = await readLocalSocialCaptures();
        var capture = captures.find(item => item.client_capture_id === msg.client_capture_id);
        if (!capture) return reply({ ok: false, error: 'Capture not found' });
        await storeLocalSocialCapture(capture, 'pending', null);
        var delivery = await deliverAndUpdateSocialCapture(capture, 1);
        reply({
          ok: delivery.state !== 'failed',
          synced: delivery.state === 'synced',
          state: delivery.state,
          error: delivery.error || null
        });
      } catch (error) {
        reply({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'discard-social-post-capture') {
    removeLocalSocialCapture(msg.client_capture_id)
      .then(() => reply({ ok: true }))
      .catch(error => reply({ ok: false, error: error.message }));
    return true;
  }

  if (msg.action === 'save-social-post-capture') {
    (async function () {
      try {
        var capture = msg.capture;
        if (!capture || !capture.client_capture_id) {
          reply({ ok: false, error: 'Invalid social-post capture' });
          return;
        }

        await storeLocalSocialCapture(capture, 'pending', null);
        // The durable local outbox owns retries for social captures. Permanent
        // contract errors become visible failed records instead of retrying forever.
        var delivery = await deliverAndUpdateSocialCapture(capture, 3);
        if (delivery.state === 'synced') {
          reply({ ok: true, synced: true, backend: delivery.result });
        } else if (delivery.state === 'failed') {
          reply({
            ok: false,
            saved_locally: true,
            permanent_failure: true,
            error: `Saved locally, but the backend rejected this capture: ${delivery.error}`
          });
        } else {
          reply({ ok: true, synced: false, pending: true, error: delivery.error || null });
        }
      } catch (error) {
        reply({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'highlight-created') {
    chrome.storage.local.get([HIGHLIGHT_KEY], function (res) {
      var arr = res[HIGHLIGHT_KEY] || [];
      arr.push(msg.highlight);
      chrome.storage.local.set({ [HIGHLIGHT_KEY]: arr });

      apiRequest('/api/highlight', {
        client_highlight_id: msg.highlight.id || '',
        text: msg.highlight.text,
        url: msg.highlight.url,
        annotation: msg.highlight.annotation || '',
        page_title: msg.highlight.pageTitle || '',
        xpath: msg.highlight.xpath || '',
        context_before: msg.highlight.contextBefore || '',
        context_after: msg.highlight.contextAfter || ''
      });
    });
    reply({ ok: true });
    return true;
  }

  if (msg.action === 'images-captured') {
    (async function () {
      await ensureConfig();
      if (!API_CONFIG.apiKey || !API_CONFIG.machineId) return;

      var images = msg.images || [];
      for (var i = 0; i < images.length; i++) {
        var img = images[i];
        await apiRequest('/api/image', {
          client_image_id: img.clientImageId,
          client_highlight_id: msg.clientHighlightId,
          base64: img.base64,
          mime_type: img.mimeType,
          url: img.originalUrl,
          page_url: msg.pageUrl,
          page_title: msg.pageTitle,
          width: img.width,
          height: img.height,
          context_text: msg.contextText
        });
      }
    })();
    reply({ ok: true });
    return true;
  }

  if (msg.action === 'get-timeline') {
    (async function () {
      await ensureConfig();
      if (!API_CONFIG.apiKey) return reply({ error: 'API not configured' });
      var data = await apiGet('/api/timeline?days=' + (msg.days || 1));
      reply(data || { error: 'Failed to load timeline' });
    })();
    return true;
  }

  if (msg.action === 'get-highlights-for-url') {
    (async function () {
      var data = await apiGet('/api/highlights-by-url?url=' + encodeURIComponent(msg.pageUrl));
      reply(data || { highlights: [] });
    })();
    return true;
  }

  if (msg.action === 'delete-highlight') {
    (async function () {
      await ensureConfig();
      try {
        var resp = await fetch(`${API_CONFIG.baseUrl}/api/highlight-by-client-id/${encodeURIComponent(msg.clientHighlightId)}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': API_CONFIG.apiKey }
        });
        reply({ ok: resp.ok });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'delete-timeline-item') {
    (async function () {
      await ensureConfig();
      try {
        var resp = await fetch(`${API_CONFIG.baseUrl}/api/timeline/${encodeURIComponent(msg.table)}/${encodeURIComponent(msg.id)}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': API_CONFIG.apiKey }
        });
        reply({ ok: resp.ok });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'youtube-annotation') {
    apiRequest('/api/youtube-annotation', {
      client_annotation_id: 'reflection-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      client_visit_id: msg.visitId,
      url: msg.url,
      youtube_title: msg.youtubeTitle || '',
      youtube_channel: msg.youtubeChannel || '',
      timestamp_seconds: null,
      annotation: msg.annotation
    });
    reply({ ok: true });
    return true;
  }

  if (msg.action === 'youtube-timestamp-annotation') {
    apiRequest('/api/youtube-annotation', {
      client_annotation_id: msg.annotationId,
      client_visit_id: msg.visitId,
      url: msg.url,
      youtube_title: msg.youtubeTitle || '',
      youtube_channel: msg.youtubeChannel || '',
      timestamp_seconds: msg.timestampSeconds,
      annotation: msg.annotation,
      draw_data: msg.drawData
    }).then(function (result) {
      reply({ ok: !!result, synced: !!result, offline: !result, id: result ? result.id : null });
    });
    return true;
  }

  if (msg.action === 'check-video-watched') {
    (async function () {
      var localRecord = await getLocallyWatchedVideo(msg.videoUrl);
      if (localRecord) {
        reply({ watched: true, locally_watched: true, annotation_count: 0 });
        return;
      }

      // Existing server annotations are also evidence that this video was watched.
      var result = await apiGet('/api/video-watched?video_url=' + encodeURIComponent(msg.videoUrl));
      if (result && result.watched) {
        await rememberWatchedVideo(msg.videoUrl, 'server-annotation');
      }
      reply(result || { watched: false, locally_watched: false, annotation_count: 0 });
    })();
    return true;
  }

  if (msg.action === 'mark-video-watched') {
    (async function () {
      var saved = await rememberWatchedVideo(msg.videoUrl, 'local-playback');
      reply({ ok: saved });
    })();
    return true;
  }

  if (msg.action === 'get-youtube-annotations') {
    (async function () {
      var result = await apiGet('/api/youtube-annotations?video_url=' + encodeURIComponent(msg.videoUrl));
      reply(result || { annotations: [] });
    })();
    return true;
  }

  if (msg.action === 'update-youtube-annotation') {
    (async function () {
      await ensureConfig();
      if (!API_CONFIG.enabled) {
        reply({ ok: false, error: 'Backend sync is disabled' });
        return;
      }
      if (!API_CONFIG.apiKey || !API_CONFIG.baseUrl) {
        reply({ ok: false, error: 'Backend URL or API key is missing' });
        return;
      }
      try {
        var resp = await fetch(`${API_CONFIG.baseUrl}/api/youtube-annotation/${encodeURIComponent(msg.annotationId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_CONFIG.apiKey
          },
          body: JSON.stringify({ annotation: msg.annotation })
        });
        if (!resp.ok) {
          reply({ ok: false, error: await apiErrorMessage(resp) });
          return;
        }
        reply({ ok: true, annotation: await resp.json() });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'delete-youtube-annotation') {
    (async function () {
      await ensureConfig();
      if (!API_CONFIG.enabled) {
        reply({ ok: false, error: 'Backend sync is disabled' });
        return;
      }
      if (!API_CONFIG.apiKey || !API_CONFIG.baseUrl) {
        reply({ ok: false, error: 'Backend URL or API key is missing' });
        return;
      }
      try {
        var resp = await fetch(`${API_CONFIG.baseUrl}/api/timeline/youtube_annotations/${encodeURIComponent(msg.annotationId)}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': API_CONFIG.apiKey }
        });
        if (!resp.ok) {
          reply({ ok: false, error: await apiErrorMessage(resp) });
          return;
        }
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'paste-image') {
    (async function () {
      try {
        await apiRequest('/api/image', {
          client_image_id: msg.clientImageId,
          client_highlight_id: null,
          base64: msg.base64,
          mime_type: msg.mimeType || 'image/jpeg',
          url: '',
          page_url: '',
          page_title: 'Clipboard paste',
          width: msg.width || null,
          height: msg.height || null,
          context_text: ''
        });
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.action === 'save-read-later') {
    (async () => {
      try {
        await ensureConfig();
        if (!API_CONFIG.enabled || !API_CONFIG.baseUrl || !API_CONFIG.apiKey) {
          reply({ ok: false, error: 'Backend sync is not configured' });
          return;
        }
        const resp = await fetch(`${API_CONFIG.baseUrl}/api/read-later`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': API_CONFIG.apiKey },
          body: JSON.stringify({ url: msg.url, title: msg.title, domain: msg.domain, preview_image: msg.preview_image })
        });
        const data = await resp.json();
        reply(resp.ok ? { ok: true, item: data.item } : { ok: false, error: data.error });
      } catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  }

  if (msg.action === 'check-read-later') {
    (async () => {
      try {
        const data = await apiGet('/api/read-later/check?url=' + encodeURIComponent(msg.url));
        reply(data || { found: false });
      } catch (e) { reply({ found: false }); }
    })();
    return true;
  }

  if (msg.action === 'delete-read-later') {
    (async () => {
      try {
        await ensureConfig();
        if (!API_CONFIG.enabled || !API_CONFIG.baseUrl || !API_CONFIG.apiKey) {
          reply({ ok: false, error: 'Backend sync is not configured' });
          return;
        }
        const resp = await fetch(`${API_CONFIG.baseUrl}/api/read-later/${msg.id}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': API_CONFIG.apiKey }
        });
        reply({ ok: resp.ok });
      } catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  }

  if (msg.action === 'reload-config') {
    chrome.storage.local.get(['machineId', 'apiEnabled', 'apiBaseUrl', 'apiKey'], (result) => {
      if (result.machineId) API_CONFIG.machineId = result.machineId;
      API_CONFIG.enabled = result.apiEnabled === true;
      API_CONFIG.baseUrl = result.apiBaseUrl || '';
      API_CONFIG.apiKey = result.apiKey || '';
      reply({ ok: true });
      syncPendingSocialCaptures();
    });
    return true;
  }

  return false;
});
