(function () {
  // -- DOM refs --
  var shortcutDisplay = document.getElementById('shortcut-display');
  var shortcutChangeBtn = document.getElementById('shortcut-change');
  var shortcutRecorder = document.getElementById('shortcut-recorder');
  var ytShortcutDisplay = document.getElementById('yt-shortcut-display');
  var ytShortcutChangeBtn = document.getElementById('yt-shortcut-change');
  var ytShortcutRecorder = document.getElementById('yt-shortcut-recorder');
  var readLaterBtn = document.getElementById('read-later-btn');
  var readLaterLabel = document.getElementById('read-later-label');
  var readLaterStatus = document.getElementById('read-later-status');

  var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  var SHORTCUT_KEY = 'hltr_shortcut';
  var YT_SHORTCUT_KEY = 'hltr_yt_shortcut';

  // Track current page's read-later state
  var currentTabUrl = null;
  var currentReadLaterId = null;

  // ========== Shortcut config ==========
  function defaultShortcut() {
    return { key: 'e', ctrlKey: !isMac, shiftKey: true, altKey: false, metaKey: isMac };
  }

  function formatShortcut(sc) {
    var parts = [];
    if (isMac) {
      if (sc.ctrlKey) parts.push('\u2303');
      if (sc.altKey) parts.push('\u2325');
      if (sc.shiftKey) parts.push('\u21E7');
      if (sc.metaKey) parts.push('\u2318');
    } else {
      if (sc.ctrlKey) parts.push('Ctrl');
      if (sc.altKey) parts.push('Alt');
      if (sc.shiftKey) parts.push('Shift');
      if (sc.metaKey) parts.push('Meta');
    }
    parts.push(sc.key.toUpperCase());
    return parts.join(isMac ? '' : '+');
  }

  function loadShortcut() {
    chrome.storage.local.get([SHORTCUT_KEY], function (r) {
      var sc = r[SHORTCUT_KEY] || defaultShortcut();
      shortcutDisplay.textContent = formatShortcut(sc);
    });
  }

  var recording = false;

  shortcutChangeBtn.addEventListener('click', function () {
    if (recording) { stopRecording(); } else { startRecording(); }
  });

  function startRecording() {
    recording = true;
    shortcutChangeBtn.textContent = 'Cancel';
    shortcutRecorder.style.display = '';
    document.addEventListener('keydown', recordKey, true);
  }

  function stopRecording() {
    recording = false;
    shortcutChangeBtn.textContent = 'Change';
    shortcutRecorder.style.display = 'none';
    document.removeEventListener('keydown', recordKey, true);
  }

  function recordKey(e) {
    e.preventDefault();
    e.stopPropagation();
    var modOnly = ['Control', 'Shift', 'Alt', 'Meta'].indexOf(e.key) >= 0;
    if (modOnly) return;
    if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
    var sc = {
      key: e.key.toLowerCase(),
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    };
    chrome.storage.local.set({ [SHORTCUT_KEY]: sc }, function () {
      shortcutDisplay.textContent = formatShortcut(sc);
      stopRecording();
    });
  }

  loadShortcut();

  // ========== YouTube Annotation Shortcut ==========
  function defaultYtShortcut() {
    return { key: '.', ctrlKey: !isMac, shiftKey: true, altKey: false, metaKey: isMac };
  }

  function loadYtShortcut() {
    chrome.storage.local.get([YT_SHORTCUT_KEY], function (r) {
      var sc = r[YT_SHORTCUT_KEY] || defaultYtShortcut();
      ytShortcutDisplay.textContent = formatShortcut(sc);
    });
  }

  var ytRecording = false;

  ytShortcutChangeBtn.addEventListener('click', function () {
    if (ytRecording) { stopYtRecording(); } else { startYtRecording(); }
  });

  function startYtRecording() {
    ytRecording = true;
    ytShortcutChangeBtn.textContent = 'Cancel';
    ytShortcutRecorder.style.display = '';
    document.addEventListener('keydown', recordYtKey, true);
  }

  function stopYtRecording() {
    ytRecording = false;
    ytShortcutChangeBtn.textContent = 'Change';
    ytShortcutRecorder.style.display = 'none';
    document.removeEventListener('keydown', recordYtKey, true);
  }

  function recordYtKey(e) {
    e.preventDefault();
    e.stopPropagation();
    var modOnly = ['Control', 'Shift', 'Alt', 'Meta'].indexOf(e.key) >= 0;
    if (modOnly) return;
    if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
    var sc = {
      key: e.key.toLowerCase(),
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    };
    chrome.storage.local.set({ [YT_SHORTCUT_KEY]: sc }, function () {
      ytShortcutDisplay.textContent = formatShortcut(sc);
      stopYtRecording();
    });
  }

  loadYtShortcut();

  // ========== Read Later ==========
  function initReadLater() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0] || !tabs[0].url) return;
      var tab = tabs[0];
      currentTabUrl = tab.url;

      // Skip non-http pages
      if (!/^https?:\/\//.test(currentTabUrl)) {
        readLaterBtn.disabled = true;
        readLaterLabel.textContent = 'Read Later';
        readLaterStatus.textContent = 'Not available on this page';
        return;
      }

      readLaterBtn.disabled = false;

      // Check if already saved
      chrome.runtime.sendMessage({ action: 'check-read-later', url: currentTabUrl }, function (resp) {
        if (resp && resp.found) {
          currentReadLaterId = resp.item.id;
          setButtonSaved();
        } else {
          currentReadLaterId = null;
          setButtonUnsaved();
        }
      });

      readLaterBtn.addEventListener('click', function () {
        if (readLaterBtn.disabled) return;
        readLaterBtn.disabled = true;

        if (currentReadLaterId) {
          // Unsave
          chrome.runtime.sendMessage({ action: 'delete-read-later', id: currentReadLaterId }, function (resp) {
            readLaterBtn.disabled = false;
            if (resp && resp.ok) {
              currentReadLaterId = null;
              setButtonUnsaved();
            } else {
              readLaterStatus.textContent = (resp && resp.error) || 'Could not remove Read Later item';
            }
          });
        } else {
          // Save
          var domain = '';
          try { domain = new URL(currentTabUrl).hostname.replace(/^www\./, ''); } catch (e) {}

          // Get og:image from the page
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function () {
              var og = document.querySelector('meta[property="og:image"]');
              return og ? og.content : null;
            }
          }, function (results) {
            var previewImage = (results && results[0] && results[0].result) || null;

            chrome.runtime.sendMessage({
              action: 'save-read-later',
              url: currentTabUrl,
              title: tab.title || '',
              domain: domain,
              preview_image: previewImage
            }, function (resp) {
              readLaterBtn.disabled = false;
              if (resp && resp.ok) {
                currentReadLaterId = resp.item.id;
                setButtonSaved();
              } else {
                readLaterStatus.textContent = (resp && resp.error) || 'Configure backend sync to use Read Later';
              }
            });
          });
        }
      });
    });
  }

  function setButtonSaved() {
    readLaterBtn.classList.add('saved');
    readLaterLabel.textContent = 'Saved';
    readLaterStatus.textContent = '';
  }

  function setButtonUnsaved() {
    readLaterBtn.classList.remove('saved');
    readLaterLabel.textContent = 'Read Later';
    readLaterStatus.textContent = '';
  }

  initReadLater();
})();
