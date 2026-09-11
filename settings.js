// Settings page logic

// Load current settings
document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadSocialOutbox();

  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
});

function loadSettings() {
  chrome.storage.local.get(['machineId', 'apiEnabled', 'apiBaseUrl', 'apiKey', 'linkedinProfileUrl', 'unsplashAccessKey'], function(result) {
    // Machine ID
    document.getElementById('machineId').textContent = result.machineId || 'Not set';

    // API enabled toggle
    document.getElementById('apiEnabled').checked = result.apiEnabled === true;

    // Backend URL
    document.getElementById('apiBaseUrl').value = result.apiBaseUrl || '';
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('linkedinProfileUrl').value = result.linkedinProfileUrl || '';
    document.getElementById('unsplashAccessKey').value = result.unsplashAccessKey || '';
  });
}


function saveSettings() {
  const apiEnabled = document.getElementById('apiEnabled').checked;
  const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const linkedinProfileUrl = document.getElementById('linkedinProfileUrl').value.trim();
  const unsplashAccessKey = document.getElementById('unsplashAccessKey').value.trim();

  // Validate URL
  if (apiBaseUrl && !isValidUrl(apiBaseUrl)) {
    showStatus('Please enter a valid URL', 'error');
    return;
  }

  if (apiEnabled && !apiBaseUrl) {
    showStatus('Backend URL is required when backend sync is enabled', 'error');
    return;
  }

  if (apiEnabled && !apiKey) {
    showStatus('API key is required when backend sync is enabled', 'error');
    return;
  }

  if (linkedinProfileUrl && !isValidLinkedInProfileUrl(linkedinProfileUrl)) {
    showStatus('Please enter a LinkedIn /in/ or /company/ profile URL', 'error');
    return;
  }

  chrome.storage.local.set({
    apiEnabled: apiEnabled,
    apiBaseUrl: apiBaseUrl,
    apiKey: apiKey,
    linkedinProfileUrl: linkedinProfileUrl,
    unsplashAccessKey: unsplashAccessKey
  }, function() {
    showStatus('Settings saved successfully!', 'success');

    // Notify background script to reload config
    chrome.runtime.sendMessage({ action: 'reload-config' });
  });
}

function loadSocialOutbox() {
  const container = document.getElementById('socialOutbox');
  chrome.runtime.sendMessage({ action: 'get-social-post-outbox' }, function(response) {
    container.textContent = '';
    if (chrome.runtime.lastError || !response || !response.ok) {
      const error = document.createElement('div');
      error.className = 'outbox-empty';
      error.textContent = 'Could not load the local outbox.';
      container.appendChild(error);
      return;
    }

    const captures = (response.captures || []).slice().sort(function(a, b) {
      return String(b.snapshot && b.snapshot.observed_at || '').localeCompare(String(a.snapshot && a.snapshot.observed_at || ''));
    });
    if (captures.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'outbox-empty';
      empty.textContent = 'No pending or failed social-post captures.';
      container.appendChild(empty);
      return;
    }

    captures.forEach(function(capture) {
      const item = document.createElement('div');
      item.className = 'outbox-item';

      const header = document.createElement('div');
      header.className = 'outbox-item-header';
      const title = document.createElement('span');
      title.textContent = capture.post && capture.post.author_name || 'Unknown author';
      const state = document.createElement('span');
      state.className = 'outbox-state ' + (capture.sync_status || 'pending');
      state.textContent = capture.sync_status || 'pending';
      header.append(title, state);
      item.appendChild(header);

      const detail = document.createElement('div');
      detail.className = 'outbox-detail';
      const observedAt = capture.snapshot && capture.snapshot.observed_at;
      const reflection = capture.reflection && capture.reflection.text || '';
      detail.textContent = (observedAt ? new Date(observedAt).toLocaleString() + ' · ' : '') +
        (reflection.length > 180 ? reflection.slice(0, 177) + '…' : reflection);
      item.appendChild(detail);

      const failure = capture.backend_result && capture.backend_result.error;
      if (failure) {
        const error = document.createElement('div');
        error.className = 'outbox-error';
        error.textContent = failure;
        item.appendChild(error);
      }

      const actions = document.createElement('div');
      actions.className = 'outbox-actions';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', function() {
        retry.disabled = true;
        chrome.runtime.sendMessage({
          action: 'retry-social-post-capture',
          client_capture_id: capture.client_capture_id
        }, function(result) {
          if (chrome.runtime.lastError || !result || !result.ok) {
            showOutboxStatus(result && result.error || 'Retry failed', 'error');
          } else {
            showOutboxStatus(result.synced ? 'Capture synced.' : 'Capture remains pending.', 'success');
          }
          loadSocialOutbox();
        });
      });

      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'discard';
      discard.textContent = 'Discard local copy';
      discard.addEventListener('click', function() {
        if (!confirm('Discard this unsynced social-post reflection? This cannot be undone.')) return;
        chrome.runtime.sendMessage({
          action: 'discard-social-post-capture',
          client_capture_id: capture.client_capture_id
        }, function(result) {
          if (chrome.runtime.lastError || !result || !result.ok) {
            showOutboxStatus(result && result.error || 'Could not discard capture', 'error');
          } else {
            showOutboxStatus('Local capture discarded.', 'success');
          }
          loadSocialOutbox();
        });
      });
      actions.append(retry, discard);
      item.appendChild(actions);
      container.appendChild(item);
    });
  });
}

function showOutboxStatus(message, type) {
  const statusEl = document.getElementById('outboxStatus');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  setTimeout(() => { statusEl.className = 'status'; }, 4000);
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;

  setTimeout(() => {
    statusEl.className = 'status';
  }, 3000);
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isValidLinkedInProfileUrl(string) {
  try {
    const url = new URL(string);
    return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/(in|company)\/[^/?#]+\/?$/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}
