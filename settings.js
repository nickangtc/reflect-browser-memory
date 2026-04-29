// Settings page logic

// Load current settings
document.addEventListener('DOMContentLoaded', function() {
  loadSettings();

  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
});

function loadSettings() {
  chrome.storage.local.get(['machineId', 'apiEnabled', 'apiBaseUrl', 'apiKey'], function(result) {
    // Machine ID
    document.getElementById('machineId').textContent = result.machineId || 'Not set';

    // API enabled toggle
    document.getElementById('apiEnabled').checked = result.apiEnabled === true;

    // Backend URL
    document.getElementById('apiBaseUrl').value = result.apiBaseUrl || '';
    document.getElementById('apiKey').value = result.apiKey || '';
  });
}


function saveSettings() {
  const apiEnabled = document.getElementById('apiEnabled').checked;
  const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();

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

  chrome.storage.local.set({
    apiEnabled: apiEnabled,
    apiBaseUrl: apiBaseUrl,
    apiKey: apiKey
  }, function() {
    showStatus('Settings saved successfully!', 'success');

    // Notify background script to reload config
    chrome.runtime.sendMessage({ action: 'reload-config' });
  });
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
