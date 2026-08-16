// Background service worker for Reflect.
// Sync is optional and configured from the extension settings page.

var HIGHLIGHT_KEY = 'xr_highlights';

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

async function apiPut(endpoint, data) {
  await ensureConfig();
  if (!API_CONFIG.enabled) return null;
  if (!API_CONFIG.apiKey || !API_CONFIG.baseUrl) return null;

  try {
    const response = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_CONFIG.apiKey
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('API PUT failed:', endpoint, error.message);
    return null;
  }
}

async function apiRequest(endpoint, data, retries = 3) {
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
        queueFailedRequest(endpoint, data);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

function queueFailedRequest(endpoint, data) {
  chrome.storage.local.get(['failedRequests'], (result) => {
    const queue = result.failedRequests || [];
    queue.push({ endpoint, data, timestamp: Date.now() });
    chrome.storage.local.set({ failedRequests: queue.slice(-100) });
  });
}

async function retryFailedRequests() {
  chrome.storage.local.get(['failedRequests'], async (result) => {
    const queue = result.failedRequests || [];
    if (queue.length === 0) return;

    console.log(`Retrying ${queue.length} failed requests...`);
    const remaining = [];
    for (const item of queue) {
      const success = await apiRequest(item.endpoint, item.data, 1);
      if (!success) {
        const age = Date.now() - item.timestamp;
        if (age < 7 * 24 * 60 * 60 * 1000) remaining.push(item);
      }
    }
    chrome.storage.local.set({ failedRequests: remaining });
  });
}

setInterval(retryFailedRequests, 5 * 60 * 1000);
self.addEventListener('online', retryFailedRequests);

chrome.commands.onCommand.addListener(function (command) {
  if (command === 'highlight-selection' || command === 'annotate-youtube') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        action: command === 'highlight-selection' ? 'highlight' : 'annotate-youtube'
      });
    });
  }
});

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
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
      var result = await apiGet('/api/video-watched?video_url=' + encodeURIComponent(msg.videoUrl));
      reply(result || { watched: false });
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
      var result = await apiPut('/api/youtube-annotation/' + encodeURIComponent(msg.annotationId), {
        annotation: msg.annotation
      });
      reply({ ok: !!result });
    })();
    return true;
  }

  if (msg.action === 'delete-youtube-annotation') {
    (async function () {
      await ensureConfig();
      try {
        var resp = await fetch(`${API_CONFIG.baseUrl}/api/timeline/youtube_annotations/${encodeURIComponent(msg.annotationId)}`, {
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
    });
    return true;
  }

  return false;
});
