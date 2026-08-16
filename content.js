(function () {
  'use strict';

  const CLS = 'hltr-mark';

  function pageKey() {
    const u = new URL(location.href);
    return u.origin + u.pathname;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function cleanTitleValue(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function isUsefulTitle(value) {
    var title = cleanTitleValue(value);
    if (!title) return false;
    if (title.length < 3) return false;

    var lower = title.toLowerCase();
    var host = location.hostname.replace(/^www\./, '').toLowerCase();

    if (lower === host) return false;
    if (lower === location.href.toLowerCase()) return false;
    if (lower === 'untitled') return false;
    if (lower === 'new tab') return false;
    if (lower === 'about:blank') return false;

    return true;
  }

  function firstMetaContent(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      var value = cleanTitleValue(el && el.getAttribute('content'));
      if (isUsefulTitle(value)) return value;
    }
    return '';
  }

  function firstHeadingText() {
    var heading = document.querySelector('main h1, article h1, h1');
    var value = cleanTitleValue(heading && heading.textContent);
    return isUsefulTitle(value) ? value : '';
  }

  function extractBestPageTitle() {
    var docTitle = cleanTitleValue(document.title);
    var ogTitle = firstMetaContent([
      'meta[property="og:title"]',
      'meta[name="og:title"]'
    ]);
    var twitterTitle = firstMetaContent([
      'meta[name="twitter:title"]',
      'meta[property="twitter:title"]'
    ]);
    var headingTitle = firstHeadingText();

    if (isUsefulTitle(docTitle)) return docTitle;
    if (ogTitle) return ogTitle;
    if (twitterTitle) return twitterTitle;
    if (headingTitle) return headingTitle;
    return docTitle || ogTitle || twitterTitle || headingTitle || '';
  }

  // -- Styles --
  var DEL_CLS = 'hltr-del';
  const css = document.createElement('style');
  css.textContent = [
    '.' + CLS + '{',
    'background-color:#fef9c3!important;',
    'padding:0 1px!important;',
    'border-radius:2px!important;',
    'box-decoration-break:clone;',
    '-webkit-box-decoration-break:clone;',
    '}',
    '.' + CLS + '{ cursor: pointer; }',
    '.' + CLS + '[data-note]{ cursor: help; }',
    '.' + DEL_CLS + '{',
    'position:fixed;',
    'width:15px;height:15px;',
    'background:#888;color:#fff;',
    'border-radius:50%;',
    'font-size:11px;line-height:15px;text-align:center;',
    'cursor:pointer;z-index:999999;',
    'font-family:sans-serif;font-style:normal;font-weight:400;',
    'pointer-events:auto;user-select:none;',
    '}',
    '.' + DEL_CLS + ':hover{background:#e74c3c;}',
    // Annotation tooltip on hover
    '.hltr-note-tip {',
    '  position: fixed; pointer-events: none; z-index: 999998;',
    '  background: rgba(26, 26, 46, 0.92); color: #fff; border-radius: 10px;',
    '  padding: 10px 14px; max-width: 400px; min-width: 120px;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  font-size: 13px; line-height: 1.4; word-wrap: break-word;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,0.35);',
    '  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);',
    '  opacity: 0; transition: opacity 0.15s ease;',
    '  display: none;',
    '}',
    '.hltr-note-tip.hltr-tip-visible { opacity: 1; display: block; }',
    '.hltr-note-tip .hltr-tip-label {',
    '  color: #fbbf24; font-weight: 600; font-size: 11px; text-transform: uppercase;',
    '  letter-spacing: 0.5px; margin-bottom: 4px;',
    '}',
    '.hltr-note-tip .hltr-tip-text { white-space: pre-wrap; }',
    '.hltr-note-tip.hltr-tip-editing { pointer-events: auto; }',
    '.hltr-note-tip.hltr-tip-editing .hltr-tip-text {',
    '  outline: none; min-width: 100px; cursor: text;',
    '  border-bottom: 1px solid rgba(251,191,36,0.4);',
    '  padding-bottom: 2px;',
    '}',
    '.hltr-note-connector {',
    '  position: fixed; width: 1px; background: rgba(251,191,36,0.5);',
    '  pointer-events: none; z-index: 999997;',
    '  opacity: 0; transition: opacity 0.15s ease;',
    '  display: none;',
    '}',
    '.hltr-note-connector.hltr-connector-visible { opacity: 1; display: block; }'
  ].join('');
  (document.head || document.documentElement).appendChild(css);

  // -- Adaptive highlight for light/dark backgrounds --
  // Uses ITU-R BT.601 perceived luminance of the parent background.
  // Light pages: soft pastel yellow bg, inherit text (dark).
  // Dark pages:  warm amber-tinted bg, keep text light for contrast.
  function adaptHighlightStyle(span) {
    // Walk up the DOM to find the first ancestor with a non-transparent background
    var el = span.parentElement;
    var bgRgb = null;
    while (el) {
      var bg = window.getComputedStyle(el).backgroundColor;
      var match = bg.match(/\d+/g);
      if (match && match.length >= 4 && parseInt(match[3]) === 0) {
        // Fully transparent (rgba with alpha=0), keep walking
        el = el.parentElement;
        continue;
      }
      if (match && match.length >= 3) {
        bgRgb = match;
        break;
      }
      el = el.parentElement;
    }
    // If nothing found, assume light background (most pages are white)
    var isDark = false;
    if (bgRgb && bgRgb.length >= 3) {
      var lum = (bgRgb[0] * 299 + bgRgb[1] * 587 + bgRgb[2] * 114) / 255000;
      isDark = lum < 0.45;
    }
    if (isDark) {
      // Dark background: warm amber tint, light readable text
      span.style.setProperty('background-color', '#423311', 'important');
      span.style.setProperty('color', '#fde68a', 'important');
    } else {
      // Light background: soft pastel yellow, ensure dark text
      span.style.setProperty('background-color', '#fef9c3', 'important');
      var textRgb = window.getComputedStyle(span).color.match(/\d+/g);
      if (textRgb) {
        var textLum = (textRgb[0] * 299 + textRgb[1] * 587 + textRgb[2] * 114) / 255000;
        if (textLum > 0.5) span.style.setProperty('color', '#1a1a1a', 'important');
      }
    }
  }

  // -- Note prompt --
  var NOTE_DISMISS = 30000;
  var noteEl = null;
  var noteTimer = null;
  var noteBar = null;
  var noteTyping = false;
  var noteHighlightId = null;
  var notePageKeyRef = null;

  // -- Toast notifications --
  var toastEl = null;
  var toastTimer = null;

  (function injectToastStyles() {
    var s = document.createElement('style');
    s.textContent = [
      '.hltr-toast {',
      '  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);',
      '  padding: 8px 16px; border-radius: 8px; z-index: 9999999;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  font-size: 13px; font-weight: 500;',
      '  box-shadow: 0 2px 12px rgba(0,0,0,0.2);',
      '  animation: hltr-toast-in 0.2s ease-out;',
      '  pointer-events: none;',
      '}',
      '@keyframes hltr-toast-in {',
      '  from { transform: translateX(-50%) translateY(10px); opacity: 0; }',
      '  to { transform: translateX(-50%) translateY(0); opacity: 1; }',
      '}',
      '.hltr-toast--success { background: #065f46; color: #d1fae5; }',
      '.hltr-toast--error { background: #991b1b; color: #fecaca; }',
      '.hltr-toast--offline { background: #92400e; color: #fef3c7; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  })();

  function showToast(message, type, duration) {
    if (toastTimer) clearTimeout(toastTimer);
    if (toastEl && toastEl.parentNode) toastEl.remove();
    toastEl = document.createElement('div');
    toastEl.className = 'hltr-toast hltr-toast--' + (type || 'success');
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(function () {
      if (toastEl && toastEl.parentNode) toastEl.remove();
      toastEl = null;
    }, duration || 2000);
  }

  (function injectNoteStyles() {
    var s = document.createElement('style');
    s.textContent = [
      '.hltr-note-prompt {',
      '  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);',
      '  background: #1a1a2e; color: #fff; border-radius: 12px;',
      '  padding: 12px 16px; z-index: 999999;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  font-size: 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);',
      '  display: flex; align-items: center; gap: 10px;',
      '  max-width: 480px; width: calc(100% - 40px);',
      '  animation: hltr-slide-up 0.25s ease-out;',
      '}',
      '@keyframes hltr-slide-up {',
      '  from { transform: translateX(-50%) translateY(20px); opacity: 0; }',
      '  to { transform: translateX(-50%) translateY(0); opacity: 1; }',
      '}',
      '.hltr-note-prompt label { white-space: nowrap; font-weight: 500; }',
      '.hltr-note-prompt input {',
      '  flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);',
      '  border-radius: 6px; padding: 6px 10px; color: #fff; font-size: 13px;',
      '  outline: none; min-width: 0;',
      '}',
      '.hltr-note-prompt input::placeholder { color: rgba(255,255,255,0.4); }',
      '.hltr-note-prompt input:focus { border-color: rgba(255,255,255,0.5); }',
      '.hltr-note-prompt .hltr-note-dismiss {',
      '  background: none; border: none; color: rgba(255,255,255,0.4);',
      '  cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1;',
      '}',
      '.hltr-note-prompt .hltr-note-dismiss:hover { color: rgba(255,255,255,0.7); }',
      '.hltr-note-track {',
      '  position: absolute; bottom: 0; left: 12px; right: 12px; height: 3px;',
      '  background: rgba(255,255,255,0.1); border-radius: 0 0 10px 10px; overflow: hidden;',
      '}',
      '.hltr-note-bar {',
      '  height: 100%; background: rgba(255,255,255,0.35); border-radius: 0 0 10px 10px;',
      '  width: 100%; transform-origin: left;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  })();

  function startNoteCountdown() {
    noteTyping = false;
    if (noteBar) {
      noteBar.style.transition = 'none';
      noteBar.style.transform = 'scaleX(1)';
      noteBar.offsetWidth;
      noteBar.style.transition = 'transform ' + NOTE_DISMISS + 'ms linear';
      noteBar.style.transform = 'scaleX(0)';
    }
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { hideNotePrompt(); }, NOTE_DISMISS);
  }

  function pauseNoteCountdown() {
    noteTyping = true;
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    if (noteBar) {
      var computed = window.getComputedStyle(noteBar);
      var current = computed.transform;
      noteBar.style.transition = 'none';
      noteBar.style.transform = current;
    }
  }

  function showNotePrompt(id, pk) {
    hideNotePrompt();
    noteHighlightId = id;
    notePageKeyRef = pk;

    noteEl = document.createElement('div');
    noteEl.className = 'hltr-note-prompt';

    var label = document.createElement('label');
    label.textContent = 'Note';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Why did this stand out?';

    var dismiss = document.createElement('button');
    dismiss.className = 'hltr-note-dismiss';
    dismiss.textContent = '\u00d7';
    dismiss.title = 'Dismiss';

    var track = document.createElement('div');
    track.className = 'hltr-note-track';
    noteBar = document.createElement('div');
    noteBar.className = 'hltr-note-bar';
    track.appendChild(noteBar);

    noteEl.appendChild(label);
    noteEl.appendChild(input);
    noteEl.appendChild(dismiss);
    noteEl.appendChild(track);
    document.body.appendChild(noteEl);

    setTimeout(function () { input.focus(); }, 100);

    var noteCommitted = false;
    input.addEventListener('input', function () {
      if (input.value.length > 0 && !noteCommitted) {
        noteCommitted = true;
        pauseNoteCountdown();
      }
    });

    input.addEventListener('focus', function () {
      if (input.value.length > 0 && !noteCommitted) {
        noteCommitted = true;
        pauseNoteCountdown();
      }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && input.value.trim()) {
        saveHighlightNote(noteHighlightId, notePageKeyRef, input.value.trim());
        hideNotePrompt();
        showToast('Saved', 'success', 1500);
      } else if (e.key === 'Escape') {
        hideNotePrompt();
      }
    });

    dismiss.addEventListener('click', function () {
      hideNotePrompt();
    });

    startNoteCountdown();
  }

  function hideNotePrompt() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    if (noteEl && noteEl.parentNode) noteEl.parentNode.removeChild(noteEl);
    noteEl = null;
    noteBar = null;
    noteHighlightId = null;
    notePageKeyRef = null;
    noteTyping = false;
  }

  function saveHighlightNote(id, pk, note) {
    chrome.storage.local.get([pk], function (res) {
      var arr = res[pk] || [];
      var highlight = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) {
          arr[i].note = note;
          highlight = arr[i];
          break;
        }
      }
      chrome.storage.local.set({ [pk]: arr });
      // Update data-note on all spans for this highlight
      var noteSpans = document.querySelectorAll('.' + CLS + '[data-hid="' + id + '"]');
      for (var j = 0; j < noteSpans.length; j++) noteSpans[j].dataset.note = note;
      if (highlight) {
        chrome.runtime.sendMessage({
          action: 'highlight-created',
          highlight: {
            id: highlight.id,
            text: highlight.text,
            url: location.href,
            xpath: highlight.xpath,
            contextBefore: highlight.ctxBefore,
            contextAfter: highlight.ctxAfter,
            annotation: note
          }
        });
      }
    });
  }

  // -- XPath --
  function xpath(node) {
    if (!node || node === document) return '';
    if (node === document.body) return '/html/body';
    if (node === document.documentElement) return '/html';
    if (node.id) return '//*[@id="' + node.id + '"]';
    var parent = node.parentNode;
    if (!parent || !parent.children) return '';
    var nodeTag = typeof node.tagName === 'string' ? node.tagName : '';
    if (!nodeTag) return xpath(parent);
    var sibs = Array.from(parent.children).filter(function (c) { return c && c.tagName === nodeTag; });
    return xpath(parent) + '/' + nodeTag.toLowerCase() + '[' + (sibs.indexOf(node) + 1) + ']';
  }

  function fromXPath(xp) {
    try {
      return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (e) { return null; }
  }

  // -- Text node helpers --
  function closestBlock(node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (el && el !== document.body && el !== document.documentElement) {
      try {
        var d = window.getComputedStyle(el).display;
        if (d !== 'inline' && d !== 'inline-block' && d !== 'inline-flex'
            && d !== 'inline-grid' && d !== 'inline-table') return el;
      } catch (e) { return el; }
      el = el.parentNode;
    }
    return el || document.body;
  }

  function collectTextNodes(root) {
    var entries = [];
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, off = 0, lastBlock = null;
    while ((n = w.nextNode())) {
      var block = closestBlock(n);
      if (lastBlock && block !== lastBlock) {
        off += 1;
      }
      entries.push({ node: n, offset: off });
      off += n.textContent.length;
      lastBlock = block;
    }
    var full = '';
    for (var i = 0; i < entries.length; i++) {
      while (full.length < entries[i].offset) full += '\n';
      full += entries[i].node.textContent;
    }
    return { entries: entries, full: full };
  }

  // -- Check if selection is already fully highlighted --
  function isAlreadyHighlighted(range) {
    var container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;
    if (container.closest && container.closest('.' + CLS)) return true;
    var walker = document.createTreeWalker(
      container, NodeFilter.SHOW_TEXT, null
    );
    var tn, found = false;
    while ((tn = walker.nextNode())) {
      if (!range.intersectsNode(tn)) continue;
      var r = document.createRange();
      r.setStart(tn, tn === range.startContainer ? range.startOffset : 0);
      r.setEnd(tn, tn === range.endContainer ? range.endOffset : tn.textContent.length);
      if (r.toString().length === 0) continue;
      found = true;
      if (!tn.parentNode.closest('.' + CLS)) return false;
    }
    return found;
  }

  // -- Extract images from a selection range --
  async function extractImagesFromRange(range) {
    var images = [];
    var container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;

    // Find all <img> elements within the range
    var allImgs = container.querySelectorAll('img');
    for (var i = 0; i < allImgs.length; i++) {
      var img = allImgs[i];
      if (!range.intersectsNode(img)) continue;
      if (!img.src || img.src.startsWith('data:')) continue;

      try {
        var resp = await fetch(img.src, { credentials: 'include' });
        if (!resp.ok) continue;
        var blob = await resp.blob();

        // Compress to JPEG via offscreen canvas
        var bmp = await createImageBitmap(blob);
        var canvas = new OffscreenCanvas(bmp.width, bmp.height);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        var jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });

        // Convert to base64
        var reader = new FileReader();
        var base64 = await new Promise(function (resolve) {
          reader.onloadend = function () { resolve(reader.result); };
          reader.readAsDataURL(jpegBlob);
        });

        images.push({
          base64: base64,
          mimeType: 'image/jpeg',
          originalUrl: img.src,
          width: bmp.width,
          height: bmp.height,
          clientImageId: uid()
        });
      } catch (e) {
        console.warn('Failed to extract image:', img.src, e.message);
      }
    }
    return images;
  }

  // -- Create highlight from current selection --
  function highlightSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    var range = sel.getRangeAt(0);
    var text = sel.toString();

    // Check if selection contains images even if no text
    var rangeContainer = range.commonAncestorContainer;
    if (rangeContainer.nodeType === Node.TEXT_NODE) rangeContainer = rangeContainer.parentNode;
    var hasImages = rangeContainer.querySelectorAll ? Array.from(rangeContainer.querySelectorAll('img')).some(function(img) { return range.intersectsNode(img); }) : false;
    if (!text.trim() && !hasImages) return;

    if (isAlreadyHighlighted(range)) {
      sel.removeAllRanges();
      return;
    }
    var id = uid();

    var ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode;

    var aXPath = xpath(ancestor);
    var col = collectTextNodes(ancestor);
    var full = col.full;
    var idx = full.indexOf(text);
    if (idx === -1) {
      var normText = text.replace(/\s+/g, ' ').trim();
      var normFull = full.replace(/\s+/g, ' ');
      var ni = normFull.indexOf(normText);
      if (ni >= 0) idx = ni;
    }
    var ctxBefore = idx >= 0 ? full.substring(Math.max(0, idx - 50), idx) : '';
    var ctxAfter = idx >= 0 ? full.substring(idx + text.length, idx + text.length + 50) : '';

    var container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var tns = [];
    var tn;
    while ((tn = walker.nextNode())) {
      if (range.intersectsNode(tn)) tns.push(tn);
    }

    for (var i = 0; i < tns.length; i++) {
      var t = tns[i];
      var r = document.createRange();
      r.setStart(t, t === range.startContainer ? range.startOffset : 0);
      r.setEnd(t, t === range.endContainer ? range.endOffset : t.textContent.length);
      if (r.toString().length === 0) continue;
      // Skip whitespace-only text nodes (e.g. newlines between <p> tags)
      // — wrapping these adds visible spacing between paragraphs
      if (/^\s+$/.test(r.toString())) continue;

      var span = document.createElement('span');
      span.className = CLS;
      span.dataset.hid = id;
      try { r.surroundContents(span); }
      catch (e) {
        var frag = r.extractContents();
        span.appendChild(frag);
        r.insertNode(span);
      }
      adaptHighlightStyle(span);
    }

    sel.removeAllRanges();

    var data = {
      id: id,
      text: text,
      xpath: aXPath,
      ctxBefore: ctxBefore,
      ctxAfter: ctxAfter,
      note: '',
      createdAt: new Date().toISOString()
    };
    var key = pageKey();
    // Show note prompt immediately (don't wait for async storage)
    showNotePrompt(id, key);
    try {
      chrome.storage.local.get([key], function (res) {
        if (chrome.runtime.lastError) return;
        var arr = res[key] || [];
        arr.push(data);
        chrome.storage.local.set({ [key]: arr }, function () {
          if (chrome.runtime.lastError) return;
          try {
            chrome.runtime.sendMessage({
              action: 'highlight-created',
              highlight: {
                id: id,
                text: text,
                url: location.href,
                xpath: aXPath,
                contextBefore: ctxBefore,
                contextAfter: ctxAfter,
                annotation: ''
              }
            });
          } catch (e) { /* extension context invalidated */ }
          // Extract and send images from the selection (async)
          extractImagesFromRange(range).then(function (images) {
            if (images.length === 0) return;
            try {
              if (chrome && chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage({
                  action: 'images-captured',
                  clientHighlightId: id,
                  pageUrl: location.href,
                  pageTitle: document.title,
                  contextText: text,
                  images: images
                });
              }
            } catch (e) { /* extension context invalidated */ }
          });
        });
      });
    } catch (e) { /* extension context invalidated */ }
  }

  // -- Re-apply a stored highlight --
  function applyStored(data) {
    var el = fromXPath(data.xpath);
    if (el && tryApply(el, data)) return true;
    return tryApply(document.body, data);
  }

  function tryApply(root, data) {
    var col = collectTextNodes(root);
    var entries = col.entries;
    var full = col.full;

    var best = -1;
    var endPos;

    var search = 0;
    while (true) {
      var idx = full.indexOf(data.text, search);
      if (idx === -1) break;
      var before = full.substring(Math.max(0, idx - 50), idx);
      var after = full.substring(idx + data.text.length, idx + data.text.length + 50);
      if (best === -1) best = idx;
      if (ctxOk(before, data.ctxBefore) && ctxOk(after, data.ctxAfter)) { best = idx; break; }
      search = idx + 1;
    }
    if (best >= 0) {
      endPos = best + data.text.length;
    }

    if (best === -1) {
      var normText = data.text.replace(/\s+/g, ' ').trim();
      if (normText) {
        var normFull = '';
        var toOrig = [];
        var ws = false;
        for (var c = 0; c < full.length; c++) {
          if (/\s/.test(full[c])) {
            if (!ws && normFull.length > 0) {
              normFull += ' ';
              toOrig.push(c);
            }
            ws = true;
          } else {
            normFull += full[c];
            toOrig.push(c);
            ws = false;
          }
        }
        var ni = normFull.indexOf(normText);
        if (ni >= 0) {
          best = toOrig[ni];
          var lastNorm = ni + normText.length - 1;
          if (lastNorm + 1 < toOrig.length) {
            endPos = toOrig[lastNorm + 1];
          } else {
            endPos = full.length;
          }
        }
      }
    }

    if (best === -1) return false;

    var toWrap = [];
    for (var j = 0; j < entries.length; j++) {
      var nd = entries[j];
      var nEnd = nd.offset + nd.node.textContent.length;
      if (nEnd <= best || nd.offset >= endPos) continue;
      toWrap.push({
        node: nd.node,
        start: Math.max(0, best - nd.offset),
        end: Math.min(nd.node.textContent.length, endPos - nd.offset)
      });
    }

    for (var k = toWrap.length - 1; k >= 0; k--) {
      var wr = toWrap[k];
      var target = wr.node;
      // Skip whitespace-only text nodes to avoid adding spacing between paragraphs
      var wrText = target.textContent.substring(wr.start, wr.end);
      if (/^\s*$/.test(wrText)) continue;
      if (wr.start > 0) target = target.splitText(wr.start);
      if (wr.end - wr.start < target.textContent.length) target.splitText(wr.end - wr.start);
      var span = document.createElement('span');
      span.className = CLS;
      span.dataset.hid = data.id;
      if (data.note) span.dataset.note = data.note;
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
      adaptHighlightStyle(span);
    }

    return toWrap.length > 0;
  }

  function ctxOk(actual, expected) {
    if (!expected || expected.length < 5) return true;
    var snip = expected.slice(-15);
    return actual.includes(snip);
  }

  // -- Remove highlight from DOM --
  function removeFromDOM(id) {
    var spans = document.querySelectorAll('.' + CLS + '[data-hid="' + id + '"]');
    spans.forEach(function (span) {
      var p = span.parentNode;
      while (span.firstChild) p.insertBefore(span.firstChild, span);
      span.remove();
      p.normalize();
    });
  }

  function removeHighlight(id) {
    removeFromDOM(id);
    var key = pageKey();
    try {
      chrome.storage.local.get([key], function (res) {
        if (chrome.runtime.lastError) return;
        var arr = (res[key] || []).filter(function (h) { return h.id !== id; });
        chrome.storage.local.set({ [key]: arr });
      });
    } catch (e) { /* extension context invalidated */ }
    // Delete from backend
    try {
      if (chrome && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: 'delete-highlight', clientHighlightId: id }, function (resp) {
          if (chrome.runtime.lastError) return;
          if (resp && resp.error) showToast('Delete failed: ' + resp.error, 'error');
        });
      }
    } catch (e) { /* extension context invalidated */ }
  }

  // -- Hover delete button --
  var activeDelBtn = null;
  var activeDelHid = null;

  function showDelete(hid) {
    if (activeDelHid === hid) return;
    hideDelete();
    var spans = document.querySelectorAll('.' + CLS + '[data-hid="' + hid + '"]');
    if (!spans.length) return;
    // Use client rects (one per visual line) to find the true last character position
    var bestRight = -Infinity;
    var bestBottom = -Infinity;
    for (var i = 0; i < spans.length; i++) {
      var rects = spans[i].getClientRects();
      for (var j = 0; j < rects.length; j++) {
        var cr = rects[j];
        if (cr.width === 0 && cr.height === 0) continue;
        if (cr.bottom > bestBottom + 2 || (Math.abs(cr.bottom - bestBottom) <= 2 && cr.right > bestRight)) {
          bestRight = cr.right;
          bestBottom = cr.bottom;
        }
      }
    }
    if (bestRight === -Infinity) return;
    var btn = document.createElement('span');
    btn.className = DEL_CLS;
    btn.textContent = '\u00d7';
    btn.style.left = (bestRight - 7) + 'px';
    btn.style.top = (bestBottom - 22) + 'px';
    document.body.appendChild(btn);
    activeDelBtn = btn;
    activeDelHid = hid;
  }

  function hideDelete() {
    if (activeDelBtn && activeDelBtn.parentNode) {
      activeDelBtn.parentNode.removeChild(activeDelBtn);
    }
    activeDelBtn = null;
    activeDelHid = null;
  }

  // -- Annotation tooltip on hover --
  var noteTipEl = null;
  var noteConnectorEl = null;

  function ensureNoteTip() {
    if (!noteTipEl) {
      noteTipEl = document.createElement('div');
      noteTipEl.className = 'hltr-note-tip';
      var label = document.createElement('div');
      label.className = 'hltr-tip-label';
      label.textContent = 'Note';
      var text = document.createElement('div');
      text.className = 'hltr-tip-text';
      noteTipEl.appendChild(label);
      noteTipEl.appendChild(text);
      document.body.appendChild(noteTipEl);
    }
    if (!noteConnectorEl) {
      noteConnectorEl = document.createElement('div');
      noteConnectorEl.className = 'hltr-note-connector';
      document.body.appendChild(noteConnectorEl);
    }
  }

  function showNoteTip(hid) {
    var spans = document.querySelectorAll('.' + CLS + '[data-hid="' + hid + '"]');
    if (!spans.length) return;
    // Find the note from any span with this hid
    var note = '';
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].dataset.note) { note = spans[i].dataset.note; break; }
    }
    if (!note) return;

    ensureNoteTip();
    noteTipEl.querySelector('.hltr-tip-text').textContent = note;

    // Position above the first span of the highlight
    var firstRect = spans[0].getBoundingClientRect();
    noteTipEl.classList.add('hltr-tip-visible');

    // Measure tooltip to position it
    var tipHeight = noteTipEl.offsetHeight;
    var tipWidth = noteTipEl.offsetWidth;

    // Center tooltip horizontally over the highlight, clamped to viewport
    var highlightCenter = firstRect.left + firstRect.width / 2;
    var tipLeft = Math.max(8, Math.min(highlightCenter - tipWidth / 2, window.innerWidth - tipWidth - 8));
    var tipTop = firstRect.top - tipHeight - 8;

    // If no room above, show below the highlight
    if (tipTop < 8) {
      var lastRect = spans[spans.length - 1].getBoundingClientRect();
      tipTop = lastRect.bottom + 8;
    }

    noteTipEl.style.left = tipLeft + 'px';
    noteTipEl.style.top = tipTop + 'px';

    // Connector line from tooltip to highlight
    var connectorTop, connectorHeight;
    if (tipTop < firstRect.top) {
      // Tooltip above: line from bottom of tooltip to top of highlight
      connectorTop = tipTop + tipHeight;
      connectorHeight = firstRect.top - connectorTop;
    } else {
      // Tooltip below: line from bottom of highlight to top of tooltip
      var lastRect2 = spans[spans.length - 1].getBoundingClientRect();
      connectorTop = lastRect2.bottom;
      connectorHeight = tipTop - connectorTop;
    }

    if (connectorHeight > 2) {
      noteConnectorEl.style.left = highlightCenter + 'px';
      noteConnectorEl.style.top = connectorTop + 'px';
      noteConnectorEl.style.height = connectorHeight + 'px';
      noteConnectorEl.classList.add('hltr-connector-visible');
    }
  }

  var noteTipEditing = false;
  var noteTipEditHid = null;

  function hideNoteTip() {
    if (noteTipEditing) return; // don't hide while editing
    if (noteTipEl) noteTipEl.classList.remove('hltr-tip-visible');
    if (noteConnectorEl) noteConnectorEl.classList.remove('hltr-connector-visible');
  }

  function editNoteTip(hid) {
    var spans = document.querySelectorAll('.' + CLS + '[data-hid="' + hid + '"]');
    if (!spans.length) return;
    var note = '';
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].dataset.note) { note = spans[i].dataset.note; break; }
    }

    ensureNoteTip();
    noteTipEditing = true;
    noteTipEditHid = hid;
    noteTipEl.classList.add('hltr-tip-editing');

    // Show the tooltip if not already visible (for highlights without notes)
    if (!noteTipEl.classList.contains('hltr-tip-visible')) {
      showNoteTip(hid);
      // If showNoteTip bailed because no note, manually position it
      if (!noteTipEl.classList.contains('hltr-tip-visible')) {
        var firstRect = spans[0].getBoundingClientRect();
        noteTipEl.classList.add('hltr-tip-visible');
        var highlightCenter = firstRect.left + firstRect.width / 2;
        var tipLeft = Math.max(8, Math.min(highlightCenter - 150, window.innerWidth - 308));
        var tipTop = firstRect.top - 60;
        if (tipTop < 8) {
          var lastRect = spans[spans.length - 1].getBoundingClientRect();
          tipTop = lastRect.bottom + 8;
        }
        noteTipEl.style.left = tipLeft + 'px';
        noteTipEl.style.top = tipTop + 'px';
      }
    }

    // Make the text div contenteditable — same look, just editable
    // Clone to remove old listeners, then make editable
    var textEl = noteTipEl.querySelector('.hltr-tip-text');
    var newTextEl = textEl.cloneNode(true);
    newTextEl.contentEditable = 'true';
    if (!note) newTextEl.textContent = '';
    textEl.parentNode.replaceChild(newTextEl, textEl);

    setTimeout(function () {
      newTextEl.focus();
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(newTextEl);
      sel.removeAllRanges();
      sel.addRange(range);
    }, 30);

    newTextEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var newText = newTextEl.textContent.trim();
        if (newText) saveHighlightNote(hid, pageKey(), newText);
        exitEditNoteTip(newText || note);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exitEditNoteTip(note);
      }
    });
  }

  function exitEditNoteTip(finalNote) {
    noteTipEditing = false;
    noteTipEditHid = null;
    if (!noteTipEl) return;
    noteTipEl.classList.remove('hltr-tip-editing');
    var textEl = noteTipEl.querySelector('.hltr-tip-text');
    if (textEl) {
      textEl.contentEditable = 'false';
      if (finalNote) textEl.textContent = finalNote;
    }
    hideNoteTip();
  }

  // -- Click on highlight to edit annotation (distinguish from drag) --
  var hltrMouseDownPos = null;
  var hltrMouseDownHid = null;

  document.addEventListener('mousedown', function (e) {
    // Dismiss edit mode if clicking outside tooltip and highlight
    if (noteTipEditing && !e.target.closest('.hltr-note-tip') && !e.target.closest('.' + CLS)) {
      exitEditNoteTip(null);
    }
    var mark = e.target.closest('.' + CLS);
    if (mark && !e.target.closest('.' + DEL_CLS) && !e.target.closest('.hltr-note-tip')) {
      hltrMouseDownPos = { x: e.clientX, y: e.clientY };
      hltrMouseDownHid = mark.dataset.hid;
    } else {
      hltrMouseDownPos = null;
      hltrMouseDownHid = null;
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (!hltrMouseDownPos || !hltrMouseDownHid) return;
    var dx = e.clientX - hltrMouseDownPos.x;
    var dy = e.clientY - hltrMouseDownPos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var hid = hltrMouseDownHid;
    hltrMouseDownPos = null;
    hltrMouseDownHid = null;
    // Only treat as click if mouse barely moved (not a text selection drag)
    if (dist > 5) return;
    // Don't re-enter edit if already editing this highlight
    if (noteTipEditing && noteTipEditHid === hid) return;
    editNoteTip(hid);
  });

  document.addEventListener('mouseover', function (e) {
    var mark = e.target.closest('.' + CLS);
    if (mark) {
      showDelete(mark.dataset.hid);
      if (!noteTipEditing) showNoteTip(mark.dataset.hid);
      return;
    }
    if (e.target.closest('.' + DEL_CLS)) return;
    if (e.target.closest('.hltr-note-tip')) return; // don't hide while interacting with tooltip
    hideDelete();
    hideNoteTip();
  });

  document.addEventListener('click', function (e) {
    var del = e.target.closest('.' + DEL_CLS);
    if (!del) return;
    e.preventDefault();
    e.stopPropagation();
    var hid = activeDelHid;
    hideDelete();
    if (hid) removeHighlight(hid);
  }, true);

  // -- Cross-machine sync TTL (10 minutes) --
  var SYNC_TTL_MS = 10 * 60 * 1000;

  function syncFromBackend(key) {
    var syncKey = '_hltr_sync_' + key;
    chrome.storage.local.get([syncKey], function (syncRes) {
      var lastSync = syncRes[syncKey] || 0;
      if (Date.now() - lastSync < SYNC_TTL_MS) return;

      try {
        if (!(chrome && chrome.runtime && chrome.runtime.id)) return;
        chrome.runtime.sendMessage(
          { action: 'get-highlights-for-url', pageUrl: key },
          function (response) {
            if (chrome.runtime.lastError || !response || !response.highlights) return;

            // Mark this page as synced now
            chrome.storage.local.set({ [syncKey]: Date.now() });

            var remoteHighlights = response.highlights;
            if (remoteHighlights.length === 0) return;

            // Re-read local storage to get the freshest state
            chrome.storage.local.get([key], function (res2) {
              var localArr = res2[key] || [];
              var localIds = {};
              for (var j = 0; j < localArr.length; j++) {
                localIds[localArr[j].id] = true;
              }

              var newHighlights = [];
              for (var k = 0; k < remoteHighlights.length; k++) {
                var rh = remoteHighlights[k];
                if (!rh.client_highlight_id) continue;
                if (localIds[rh.client_highlight_id]) continue;

                // Convert backend format to local format
                var localData = {
                  id: rh.client_highlight_id,
                  text: rh.text,
                  xpath: rh.xpath || '',
                  ctxBefore: rh.context_before || '',
                  ctxAfter: rh.context_after || '',
                  note: rh.annotation || '',
                  createdAt: rh.created_at,
                  originMachineId: rh.machine_id || ''
                };
                newHighlights.push(localData);
              }

              if (newHighlights.length === 0) return;

              // Store merged highlights locally
              var merged = localArr.concat(newHighlights);
              chrome.storage.local.set({ [key]: merged });

              // Render newly synced highlights
              var currentApplied = new Set(
                Array.from(document.querySelectorAll('.' + CLS)).map(function (el) { return el.dataset.hid; })
              );
              for (var m = 0; m < newHighlights.length; m++) {
                if (!currentApplied.has(newHighlights[m].id)) {
                  applyStored(newHighlights[m]);
                }
              }
            });
          }
        );
      } catch (e) { /* extension context invalidated */ }
    });
  }

  // -- Load stored highlights --
  function load() {
    var key = pageKey();
    chrome.storage.local.get([key], function (res) {
      var arr = res[key] || [];
      var applied = new Set(
        Array.from(document.querySelectorAll('.' + CLS)).map(function (el) { return el.dataset.hid; })
      );
      for (var i = 0; i < arr.length; i++) {
        if (!applied.has(arr[i].id)) applyStored(arr[i]);
      }

      // Fetch highlights from backend for cross-machine sync (throttled by TTL)
      syncFromBackend(key);
    });
  }

  // -- Message listener --
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (msg.action === 'highlight') {
      highlightSelection();
      reply({ ok: true });
    } else if (msg.action === 'remove') {
      removeFromDOM(msg.id);
      reply({ ok: true });
    }
    return false;
  });

  // -- Keyboard shortcut --
  var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  var SHORTCUT_ENABLED = true;
  function normalizeShortcut(raw) {
    var base = { key: 'e', ctrlKey: !isMac, shiftKey: true, altKey: false, metaKey: isMac };
    if (!raw || typeof raw !== 'object') return base;
    return {
      key: typeof raw.key === 'string' && raw.key.length > 0 ? raw.key : base.key,
      ctrlKey: typeof raw.ctrlKey === 'boolean' ? raw.ctrlKey : base.ctrlKey,
      shiftKey: typeof raw.shiftKey === 'boolean' ? raw.shiftKey : base.shiftKey,
      altKey: typeof raw.altKey === 'boolean' ? raw.altKey : base.altKey,
      metaKey: typeof raw.metaKey === 'boolean' ? raw.metaKey : base.metaKey
    };
  }

  var shortcut = normalizeShortcut(null);

  function matchesShortcut(e) {
    if (!SHORTCUT_ENABLED) return false;
    if (!e) return false;
    var eventKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    var shortcutKey = typeof shortcut.key === 'string' ? shortcut.key.toLowerCase() : '';
    if (!eventKey || !shortcutKey) return false;
    return eventKey === shortcutKey
      && e.ctrlKey === shortcut.ctrlKey
      && e.shiftKey === shortcut.shiftKey
      && e.altKey === shortcut.altKey
      && e.metaKey === shortcut.metaKey;
  }

  document.addEventListener('keydown', function (e) {
    if (matchesShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      highlightSelection();
    }
  }, true);

  chrome.storage.local.get(['hltr_shortcut'], function (r) {
    if (r.hltr_shortcut) shortcut = normalizeShortcut(r.hltr_shortcut);
  });

  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.hltr_shortcut) shortcut = normalizeShortcut(changes.hltr_shortcut.newValue);
  });

  // -- YouTube specific --
  (function () {
    function safeSend(msg, callback) {
      try {
        if (chrome && chrome.runtime && chrome.runtime.id) {
          if (callback) chrome.runtime.sendMessage(msg, callback);
          else chrome.runtime.sendMessage(msg);
        }
      } catch (e) { /* extension context invalidated, ignore */ }
    }

    var domain = location.hostname.replace(/^www\./, '');

    if (domain === 'youtube.com') {
      var ytPollInterval = null;
      var ytVisitId = null;

      // -- Annotation markers styles --
      (function injectAnnotationMarkerStyles() {
        var s = document.createElement('style');
        s.textContent = [
          // Dots on the progress bar
          '.reflect-marker-container {',
          '  position: absolute; top: 0; left: 0; right: 0; bottom: 0;',
          '  pointer-events: none; z-index: 40;',
          '}',
          '.reflect-marker-dot {',
          '  position: absolute; top: 50%; transform: translate(-50%, -50%);',
          '  width: 8px; height: 8px; border-radius: 50%;',
          '  background: #fbbf24; border: 1.5px solid rgba(0,0,0,0.4);',
          '  pointer-events: auto; cursor: pointer;',
          '  transition: transform 0.15s ease, box-shadow 0.15s ease;',
          '  z-index: 41;',
          '}',
          '.reflect-marker-dot:hover {',
          '  transform: translate(-50%, -50%) scale(1.5);',
          '  box-shadow: 0 0 6px rgba(251,191,36,0.6);',
          '}',
          // Tooltip on hover
          '.reflect-marker-tooltip {',
          '  position: fixed; pointer-events: none; z-index: 99999;',
          '  background: #1a1a2e; color: #fff; padding: 8px 12px; border-radius: 8px;',
          '  font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
          '  white-space: normal; max-width: 400px; word-wrap: break-word;',
          '  box-shadow: 0 2px 12px rgba(0,0,0,0.4);',
          '  opacity: 0; transition: opacity 0.15s ease;',
          '  display: none;',
          '}',
          '.reflect-marker-tooltip.reflect-tooltip-visible { opacity: 1; display: block; }',
          '.reflect-marker-connector {',
          '  position: fixed; width: 1px; background: rgba(251,191,36,0.5);',
          '  pointer-events: none; z-index: 99998;',
          '  opacity: 0; transition: opacity 0.15s ease;',
          '  display: none;',
          '}',
          '.reflect-marker-connector.reflect-connector-visible { opacity: 1; display: block; }',
          // Floating overlay during playback
          '.reflect-annotation-overlay {',
          '  position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);',
          '  background: rgba(26, 26, 46, 0.92); color: #fff; border-radius: 10px;',
          '  padding: 10px 14px; z-index: 50;',
          '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
          '  font-size: 13px; max-width: 560px; min-width: 200px;',
          '  box-shadow: 0 4px 16px rgba(0,0,0,0.35);',
          '  display: flex; align-items: center; gap: 8px;',
          '  animation: reflect-fade-in 0.25s ease-out;',
          '  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);',
          '}',
          '@keyframes reflect-fade-in {',
          '  from { opacity: 0; transform: translateX(-50%) translateY(6px); }',
          '  to { opacity: 1; transform: translateX(-50%) translateY(0); }',
          '}',
          '.reflect-annotation-overlay .reflect-ts {',
          '  color: #fbbf24; font-weight: 600; white-space: nowrap; font-size: 12px;',
          '}',
          '.reflect-annotation-overlay .reflect-text {',
          '  flex: 1; min-width: 0; line-height: 1.4;',
          '  max-height: 80px; overflow-y: auto; word-wrap: break-word;',
          '}',
          '.reflect-annotation-overlay .reflect-edit-btn,',
          '.reflect-annotation-overlay .reflect-delete-btn,',
          '.reflect-annotation-overlay .reflect-close-btn {',
          '  background: none; border: none; color: rgba(255,255,255,0.45);',
          '  cursor: pointer; padding: 2px 4px; font-size: 14px; line-height: 1;',
          '  flex-shrink: 0;',
          '}',
          '.reflect-annotation-overlay .reflect-edit-btn:hover,',
          '.reflect-annotation-overlay .reflect-delete-btn:hover,',
          '.reflect-annotation-overlay .reflect-close-btn:hover {',
          '  color: rgba(255,255,255,0.85);',
          '}',
          // Edit mode
          '.reflect-annotation-overlay .reflect-edit-input {',
          '  flex: 1; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25);',
          '  border-radius: 5px; padding: 4px 8px; color: #fff; font-size: 13px;',
          '  font-family: inherit; outline: none; min-width: 180px;',
          '}',
          '.reflect-annotation-overlay .reflect-edit-input:focus {',
          '  border-color: #fbbf24;',
          '}',
          '.reflect-annotation-overlay .reflect-save-btn {',
          '  background: #fbbf24; color: #1a1a2e; border: none; border-radius: 5px;',
          '  padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer;',
          '  flex-shrink: 0;',
          '}',
          '.reflect-annotation-overlay .reflect-save-btn:hover { background: #f59e0b; }',
          '.reflect-annotation-overlay .reflect-cancel-btn {',
          '  background: none; border: none; color: rgba(255,255,255,0.5);',
          '  cursor: pointer; font-size: 12px; padding: 3px 6px; flex-shrink: 0;',
          '}',
          '.reflect-annotation-overlay .reflect-cancel-btn:hover { color: #fff; }',
          // Watched-before badge (overlays top-left of video player)
          '.reflect-watched-badge {',
          '  position: absolute; top: 12px; left: 12px; z-index: 60;',
          '  display: inline-flex; align-items: center; white-space: nowrap;',
          '  background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);',
          '  border-radius: 6px; padding: 6px 12px;',
          '  font-size: 13px; color: #fff;',
          '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
          '  font-weight: 500; line-height: 1; pointer-events: none;',
          '  opacity: 1; transition: opacity 0.5s ease;',
          '}',
          '.reflect-watched-badge.reflect-badge-hidden { opacity: 0; }',
          '.reflect-watched-badge .reflect-badge-count {',
          '  color: #fbbf24; font-weight: 600;',
          '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
      })();

      function initYouTubeTracking() {
        if (location.pathname !== '/watch') return;

        // Generate a fresh visit ID for this video
        ytVisitId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var ytAnnotationShown = false;

        if (ytPollInterval) clearInterval(ytPollInterval);

        // Clean up previous annotation markers and reset state
        hideAnnotationOverlay();
        reflectAnnotations = [];
        reflectLastShownId = null;
        if (reflectMarkerContainer && reflectMarkerContainer.parentNode) {
          reflectMarkerContainer.remove();
          reflectMarkerContainer = null;
        }

        // Fetch and render annotation markers for this video (delayed to let video load)
        setTimeout(fetchAndRenderMarkers, 3000);

        // Show "watched before" badge if we have a prior visit
        setTimeout(showWatchedBadge, 2000);

        ytPollInterval = setInterval(function () {
          if (ytAnnotationShown) { clearInterval(ytPollInterval); return; }
          var video = document.querySelector('video');
          if (!video || !video.duration || video.duration < 30) return;
          if (video.currentTime / video.duration >= 0.95) {
            ytAnnotationShown = true;
            clearInterval(ytPollInterval);
            showYtPrompt(ytVisitId, video);
          }
        }, 2000);
      }

      // -- "Watched before" badge --
      var reflectWatchedBadge = null;

      function showWatchedBadge() {
        if (location.pathname !== '/watch') return;

        var urlObj = new URL(location.href);
        var videoUrl = urlObj.origin + urlObj.pathname + '?v=' + urlObj.searchParams.get('v');

        try {
          if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
          chrome.runtime.sendMessage({
            action: 'check-video-watched',
            videoUrl: videoUrl
          }, function(response) {
            if (chrome.runtime.lastError) return;
            if (!response || !response.watched) return;

            var annotationCount = response.annotation_count || 0;

            // Remove previous badge right before inserting new one
            if (reflectWatchedBadge && reflectWatchedBadge.parentNode) {
              reflectWatchedBadge.remove();
              reflectWatchedBadge = null;
            }

            // Place badge inside the video player container
            var playerEl = document.querySelector('#movie_player') ||
                           document.querySelector('.html5-video-player');
            if (!playerEl) return;

            reflectWatchedBadge = document.createElement('div');
            reflectWatchedBadge.className = 'reflect-watched-badge';

            var label = document.createTextNode('Watched before\u00a0');
            reflectWatchedBadge.appendChild(label);

            var countSpan = document.createElement('span');
            countSpan.className = 'reflect-badge-count';
            countSpan.textContent = '(' + annotationCount + ' annotation' + (annotationCount !== 1 ? 's' : '') + ')';
            reflectWatchedBadge.appendChild(countSpan);

            playerEl.appendChild(reflectWatchedBadge);

            // Auto-hide after 3 seconds
            setTimeout(function() {
              if (reflectWatchedBadge) reflectWatchedBadge.classList.add('reflect-badge-hidden');
            }, 3000);
            setTimeout(function() {
              if (reflectWatchedBadge && reflectWatchedBadge.parentNode) {
                reflectWatchedBadge.remove();
                reflectWatchedBadge = null;
              }
            }, 3500);
          });
        } catch (e) { /* extension context invalidated */ }
      }

      // -- Annotation markers on YouTube timeline --
      var reflectMarkerContainer = null;
      var reflectOverlayEl = null;
      var reflectDrawOverlayEl = null;
      var reflectOverlayTimer = null;
      var reflectAnnotations = [];
      var reflectLastShownId = null;
      var reflectResizeObserver = null;

      function fetchAndRenderMarkers() {
        if (location.pathname !== '/watch') return;

        var video = document.querySelector('video');
        if (!video) { setTimeout(fetchAndRenderMarkers, 2000); return; }

        function onReady() {
          if (!video.duration || video.duration < 1) return;

          var urlObj = new URL(location.href);
          var videoUrl = urlObj.origin + urlObj.pathname + '?v=' + urlObj.searchParams.get('v');

          try {
            if (chrome && chrome.runtime && chrome.runtime.id) {
              chrome.runtime.sendMessage({
                action: 'get-youtube-annotations',
                videoUrl: videoUrl
              }, function (response) {
                if (chrome.runtime.lastError) return;
                if (!response || !response.annotations) return;
                reflectAnnotations = response.annotations;
                if (reflectAnnotations.length > 0) {
                  renderMarkerDots(video);
                  startPlaybackListener(video);
                }
              });
            }
          } catch (e) { /* extension context invalidated */ }
        }

        if (video.duration && video.duration > 0) {
          onReady();
        } else {
          video.addEventListener('loadedmetadata', onReady, { once: true });
          setTimeout(onReady, 3000);
        }
      }

      // Shared tooltip + connector line (appended to body, positioned via JS)
      var reflectTooltipEl = null;
      var reflectConnectorEl = null;

      function showMarkerTooltip(ann, dotEl) {
        if (!reflectTooltipEl) {
          reflectTooltipEl = document.createElement('div');
          reflectTooltipEl.className = 'reflect-marker-tooltip';
          document.body.appendChild(reflectTooltipEl);
        }
        if (!reflectConnectorEl) {
          reflectConnectorEl = document.createElement('div');
          reflectConnectorEl.className = 'reflect-marker-connector';
          document.body.appendChild(reflectConnectorEl);
        }
        reflectTooltipEl.textContent = formatTimestamp(ann.timestamp_seconds) + ' \u2014 ' + ann.annotation;

        var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (!player) return;
        var playerRect = player.getBoundingClientRect();
        var dotRect = dotEl.getBoundingClientRect();

        var tooltipTop = playerRect.top + 20;
        var dotCenterX = dotRect.left + dotRect.width / 2;

        reflectTooltipEl.style.left = dotRect.left + 'px';
        reflectTooltipEl.style.top = tooltipTop + 'px';
        reflectTooltipEl.classList.add('reflect-tooltip-visible');

        // Measure tooltip height after making it visible
        var tooltipBottom = tooltipTop + reflectTooltipEl.offsetHeight;
        var lineTop = tooltipBottom + 2;
        var lineBottom = dotRect.top + dotRect.height / 2;
        var lineHeight = Math.max(0, lineBottom - lineTop);

        reflectConnectorEl.style.left = (dotCenterX - 0.5) + 'px';
        reflectConnectorEl.style.top = lineTop + 'px';
        reflectConnectorEl.style.height = lineHeight + 'px';
        reflectConnectorEl.classList.add('reflect-connector-visible');
      }

      function hideMarkerTooltip() {
        if (reflectTooltipEl) {
          reflectTooltipEl.classList.remove('reflect-tooltip-visible');
        }
        if (reflectConnectorEl) {
          reflectConnectorEl.classList.remove('reflect-connector-visible');
        }
      }

      function renderMarkerDots(video) {
        if (reflectMarkerContainer && reflectMarkerContainer.parentNode) {
          reflectMarkerContainer.remove();
        }
        if (reflectResizeObserver) {
          reflectResizeObserver.disconnect();
        }

        var progressBar = document.querySelector('.ytp-progress-bar');
        if (!progressBar) return;

        reflectMarkerContainer = document.createElement('div');
        reflectMarkerContainer.className = 'reflect-marker-container';

        reflectAnnotations.forEach(function (ann) {
          var pct = (ann.timestamp_seconds / video.duration) * 100;
          if (pct > 100) return;

          var dot = document.createElement('div');
          dot.className = 'reflect-marker-dot';
          dot.style.left = pct + '%';
          dot.dataset.annotationId = ann.id;

          dot.addEventListener('mouseenter', function () {
            showMarkerTooltip(ann, dot);
          });
          dot.addEventListener('mouseleave', function () {
            hideMarkerTooltip();
          });

          dot.addEventListener('click', function (e) {
            e.stopPropagation();
            hideMarkerTooltip();
            video.currentTime = ann.timestamp_seconds;
            showAnnotationOverlay(ann, video);
          });

          reflectMarkerContainer.appendChild(dot);
        });

        progressBar.style.position = 'relative';
        progressBar.appendChild(reflectMarkerContainer);

        reflectResizeObserver = new ResizeObserver(function () {
          if (!reflectMarkerContainer.parentNode) {
            var pb = document.querySelector('.ytp-progress-bar');
            if (pb) pb.appendChild(reflectMarkerContainer);
          }
        });
        reflectResizeObserver.observe(progressBar);
      }

      function showAnnotationOverlay(ann, video) {
        hideAnnotationOverlay();
        reflectLastShownId = ann.id;

        var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (!player) return;

        reflectOverlayEl = document.createElement('div');
        reflectOverlayEl.className = 'reflect-annotation-overlay';

        var ts = document.createElement('span');
        ts.className = 'reflect-ts';
        ts.textContent = formatTimestamp(ann.timestamp_seconds);

        var text = document.createElement('span');
        text.className = 'reflect-text';
        text.textContent = ann.annotation;

        var editBtn = document.createElement('button');
        editBtn.className = 'reflect-edit-btn';
        editBtn.title = 'Edit';
        editBtn.textContent = '\u270E';

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'reflect-delete-btn';
        deleteBtn.title = 'Delete';
        deleteBtn.textContent = '\u2715';

        var closeBtn = document.createElement('button');
        closeBtn.className = 'reflect-close-btn';
        closeBtn.title = 'Close';
        closeBtn.textContent = '\u00D7';

        editBtn.addEventListener('click', function () {
          enterEditMode(ann, video);
        });

        deleteBtn.addEventListener('click', function () {
          deleteAnnotation(ann, video);
        });

        closeBtn.addEventListener('click', function () {
          hideAnnotationOverlay();
        });

        reflectOverlayEl.appendChild(ts);
        reflectOverlayEl.appendChild(text);
        reflectOverlayEl.appendChild(editBtn);
        reflectOverlayEl.appendChild(deleteBtn);
        reflectOverlayEl.appendChild(closeBtn);

        player.style.position = 'relative';
        player.appendChild(reflectOverlayEl);

        // Render drawing data if present
        if (ann.draw_data && ann.draw_data.length > 0) {
          reflectDrawOverlayEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          reflectDrawOverlayEl.style.position = 'absolute';
          reflectDrawOverlayEl.style.top = '0';
          reflectDrawOverlayEl.style.left = '0';
          reflectDrawOverlayEl.style.width = '100%';
          reflectDrawOverlayEl.style.height = '100%';
          reflectDrawOverlayEl.style.pointerEvents = 'none'; // pass clicks through
          reflectDrawOverlayEl.style.zIndex = '9999997'; // just below text overlay
          
          reflectDrawOverlayEl.setAttribute('viewBox', '0 0 10000 10000');
          reflectDrawOverlayEl.setAttribute('preserveAspectRatio', 'none');

          ann.draw_data.forEach(function (stroke) {
            if (stroke.length > 0) {
              var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              var d = '';
              stroke.forEach(function (pt, i) {
                // pt[0] and pt[1] are normalized coordinates (0 to 1)
                var px = pt[0] * 10000;
                var py = pt[1] * 10000;
                if (i === 0) d += 'M ' + px + ' ' + py + ' ';
                else d += 'L ' + px + ' ' + py + ' ';
              });
              path.setAttribute('d', d.trim());
              path.setAttribute('stroke', '#fbbf24');
              path.setAttribute('stroke-width', '3');
              path.setAttribute('fill', 'none');
              path.setAttribute('stroke-linecap', 'round');
              path.setAttribute('stroke-linejoin', 'round');
              path.setAttribute('vector-effect', 'non-scaling-stroke'); // Keeps line width consistent
              reflectDrawOverlayEl.appendChild(path);
            }
          });
          player.appendChild(reflectDrawOverlayEl);
        }

        if (reflectOverlayTimer) clearTimeout(reflectOverlayTimer);
        reflectOverlayTimer = setTimeout(hideAnnotationOverlay, 6000);
      }

      function hideAnnotationOverlay() {
        if (reflectOverlayTimer) { clearTimeout(reflectOverlayTimer); reflectOverlayTimer = null; }
        if (reflectOverlayEl && reflectOverlayEl.parentNode) {
          reflectOverlayEl.remove();
        }
        reflectOverlayEl = null;
        if (reflectDrawOverlayEl && reflectDrawOverlayEl.parentNode) {
          reflectDrawOverlayEl.remove();
        }
        reflectDrawOverlayEl = null;
      }

      function enterEditMode(ann, video) {
        if (!reflectOverlayEl) return;
        if (reflectOverlayTimer) { clearTimeout(reflectOverlayTimer); reflectOverlayTimer = null; }

        // Clear overlay content safely
        while (reflectOverlayEl.firstChild) {
          reflectOverlayEl.removeChild(reflectOverlayEl.firstChild);
        }

        var ts = document.createElement('span');
        ts.className = 'reflect-ts';
        ts.textContent = formatTimestamp(ann.timestamp_seconds);

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'reflect-edit-input';
        input.value = ann.annotation;

        var saveBtn = document.createElement('button');
        saveBtn.className = 'reflect-save-btn';
        saveBtn.textContent = 'Save';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'reflect-cancel-btn';
        cancelBtn.textContent = 'Cancel';

        function save() {
          var newText = input.value.trim();
          if (!newText || newText === ann.annotation) {
            showAnnotationOverlay(ann, video);
            return;
          }
          try {
            if (chrome && chrome.runtime && chrome.runtime.id) {
              chrome.runtime.sendMessage({
                action: 'update-youtube-annotation',
                annotationId: ann.id,
                annotation: newText
              }, function (resp) {
                if (chrome.runtime.lastError) return;
                if (resp && resp.ok) {
                  ann.annotation = newText;
                  showAnnotationOverlay(ann, video);
                  showToast('Annotation updated', 'success', 1500);
                } else {
                  showToast('Failed to update', 'error', 2000);
                }
              });
            }
          } catch (e) { showToast('Failed to update', 'error', 2000); }
        }

        saveBtn.addEventListener('click', save);
        cancelBtn.addEventListener('click', function () {
          showAnnotationOverlay(ann, video);
        });
        input.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') showAnnotationOverlay(ann, video);
        });
        input.addEventListener('keyup', function (e) { e.stopPropagation(); });
        input.addEventListener('keypress', function (e) { e.stopPropagation(); });

        reflectOverlayEl.appendChild(ts);
        reflectOverlayEl.appendChild(input);
        reflectOverlayEl.appendChild(saveBtn);
        reflectOverlayEl.appendChild(cancelBtn);

        setTimeout(function () { input.focus(); input.select(); }, 50);
      }

      function deleteAnnotation(ann, video) {
        try {
          if (chrome && chrome.runtime && chrome.runtime.id) {
            chrome.runtime.sendMessage({
              action: 'delete-youtube-annotation',
              annotationId: ann.id
            }, function (resp) {
              if (chrome.runtime.lastError) return;
              if (resp && resp.ok) {
                reflectAnnotations = reflectAnnotations.filter(function (a) { return a.id !== ann.id; });
                if (reflectMarkerContainer) {
                  var dot = reflectMarkerContainer.querySelector('[data-annotation-id="' + ann.id + '"]');
                  if (dot) dot.remove();
                }
                hideAnnotationOverlay();
                showToast('Annotation deleted', 'success', 1500);
              } else {
                showToast('Failed to delete', 'error', 2000);
              }
            });
          }
        } catch (e) { showToast('Failed to delete', 'error', 2000); }
      }

      function startPlaybackListener(video) {
        video.addEventListener('timeupdate', function () {
          if (!reflectAnnotations.length) return;
          var t = video.currentTime;

          for (var i = 0; i < reflectAnnotations.length; i++) {
            var ann = reflectAnnotations[i];
            var diff = t - ann.timestamp_seconds;
            if (diff >= 0 && diff < 2) {
              if (reflectLastShownId !== ann.id) {
                showAnnotationOverlay(ann, video);
              }
              return;
            }
          }
        });
      }

      function showYtPrompt(ytVisitId, video) {
        // Pause autoplay so user can finish reflecting
        if (video && !video.paused) video.pause();

        var el = document.createElement('div');
        el.className = 'hltr-note-prompt';
        el.style.zIndex = '9999999';

        var label = document.createElement('label');
        label.textContent = 'Reflect';

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'What did you learn from this video?';

        var dismiss = document.createElement('button');
        dismiss.className = 'hltr-note-dismiss';
        dismiss.textContent = '\u00d7';

        el.appendChild(label);
        el.appendChild(input);
        el.appendChild(dismiss);
        document.body.appendChild(el);
        setTimeout(function () { input.focus(); }, 100);

        var autoClose = setTimeout(function () { close(); }, 30000);
        input.addEventListener('input', function () {
          if (input.value.length > 0 && autoClose) {
            clearTimeout(autoClose);
            autoClose = null;
          }
        });

        function submit() {
          if (autoClose) clearTimeout(autoClose);
          var note = input.value.trim();
          if (note) {
            var urlObj = new URL(location.href);
            var vParam = urlObj.searchParams.get('v');
            var cleanVideoUrl = urlObj.origin + urlObj.pathname + (vParam ? '?v=' + vParam : '');
            safeSend({
              action: 'youtube-annotation',
              visitId: ytVisitId,
              url: cleanVideoUrl,
              annotation: note
            });
          }
          el.remove();
          if (video && video.paused) video.play();
        }

        function close() {
          if (autoClose) clearTimeout(autoClose);
          el.remove();
          if (video && video.paused) video.play();
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') submit();
          else if (e.key === 'Escape') close();
        });
        dismiss.addEventListener('click', close);
      }

      // -- Mid-stream YouTube annotation (Cmd+Shift+A) --
      function formatTimestamp(seconds) {
        var s = Math.floor(seconds);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        return m + ':' + String(sec).padStart(2, '0');
      }

      function showYtAnnotationPrompt() {
        if (location.pathname !== '/watch') return;
        var video = document.querySelector('video');
        if (!video || !video.duration) return;

        var timestampSec = Math.floor(video.currentTime);
        var wasPaused = video.paused;
        if (!wasPaused) video.pause();

        var el = document.createElement('div');
        el.className = 'hltr-note-prompt';
        el.style.zIndex = '9999999';

        var label = document.createElement('label');
        label.textContent = formatTimestamp(timestampSec);
        label.style.color = '#fbbf24';

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Annotate this moment (draw on video)...';

        var dismiss = document.createElement('button');
        dismiss.className = 'hltr-note-dismiss';
        dismiss.textContent = '\u00d7';

        el.appendChild(label);
        el.appendChild(input);
        el.appendChild(dismiss);
        document.body.appendChild(el);
        setTimeout(function () { input.focus(); }, 100);

        // -- Setup Drawing Canvas --
        var strokes = [];
        var currentStroke = null;
        var canvas = document.createElement('canvas');
        var player = document.querySelector('.html5-video-player') || video.parentElement;
        var ctx = canvas.getContext('2d');
        var isDrawing = false;

        if (player) {
          canvas.className = 'reflect-draw-canvas';
          canvas.style.position = 'absolute';
          canvas.style.top = '0';
          canvas.style.left = '0';
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.zIndex = '9999998'; // Just below prompt
          canvas.style.cursor = 'crosshair';
          
          var rect = player.getBoundingClientRect();
          canvas.width = rect.width;
          canvas.height = rect.height;
          
          ctx.strokeStyle = '#fbbf24'; // Yellow
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          player.appendChild(canvas);

          canvas.addEventListener('mousedown', function (e) {
            isDrawing = true;
            var rect = canvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            currentStroke = [[x / canvas.width, y / canvas.height]];
            
            ctx.beginPath();
            ctx.moveTo(x, y);
          });

          canvas.addEventListener('mousemove', function (e) {
            if (!isDrawing) return;
            var rect = canvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            currentStroke.push([x / canvas.width, y / canvas.height]);
            
            ctx.lineTo(x, y);
            ctx.stroke();
          });

          canvas.addEventListener('mouseup', function () {
            if (isDrawing) {
              isDrawing = false;
              if (currentStroke && currentStroke.length > 0) {
                strokes.push(currentStroke);
              }
              currentStroke = null;
            }
          });

          canvas.addEventListener('mouseleave', function () {
            if (isDrawing) {
              isDrawing = false;
              if (currentStroke && currentStroke.length > 0) {
                strokes.push(currentStroke);
              }
              currentStroke = null;
            }
          });
        }

        function submit() {
          var note = input.value.trim();
          if (!note) { close(); return; }

          var annotationId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          var urlObj = new URL(location.href);
          var vParam = urlObj.searchParams.get('v');
          var urlWithTs = urlObj.origin + urlObj.pathname + (vParam ? '?v=' + vParam + '&t=' + timestampSec : '?t=' + timestampSec);

          el.remove();
          if (canvas && canvas.parentNode) canvas.remove();

          var payload = {
            action: 'youtube-timestamp-annotation',
            annotationId: annotationId,
            visitId: ytVisitId,
            url: urlWithTs,
            timestampSeconds: timestampSec,
            annotation: note
          };
          
          if (strokes.length > 0) {
            payload.drawData = strokes;
          }

          safeSend(payload, function (response) {
            if (response && response.synced) {
              showToast('Saved @ ' + formatTimestamp(timestampSec), 'success', 1500);
              // Add dot to timeline immediately
              var newAnn = {
                id: response.id || annotationId,
                timestamp_seconds: timestampSec,
                annotation: note
              };
              if (strokes.length > 0) newAnn.draw_data = strokes;
              reflectAnnotations.push(newAnn);
              reflectAnnotations.sort(function (a, b) { return a.timestamp_seconds - b.timestamp_seconds; });
              renderMarkerDots(video);
              if (!reflectAnnotations.length || reflectAnnotations.length === 1) {
                startPlaybackListener(video);
              }
            } else if (response && response.offline) {
              showToast('Offline - will sync later', 'offline', 3000);
            } else {
              showToast('Failed to save annotation', 'error', 3000);
            }
          });

          if (!wasPaused) video.play();
        }

        function close() {
          el.remove();
          if (canvas && canvas.parentNode) canvas.remove();
          if (!wasPaused) video.play();
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') submit();
          else if (e.key === 'Escape') close();
        });
        dismiss.addEventListener('click', close);
      }

      // Listen for annotate-youtube command from background
      chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
        if (msg.action === 'annotate-youtube') {
          showYtAnnotationPrompt();
          reply({ ok: true });
        }
        return false;
      });

      // Configurable YouTube annotation shortcut (default: Cmd+Shift+.)
      var ytShortcut = { key: '.', ctrlKey: !isMac, shiftKey: true, altKey: false, metaKey: isMac };

      function matchesYtShortcut(e) {
        var eventKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';
        var scKey = typeof ytShortcut.key === 'string' ? ytShortcut.key.toLowerCase() : '';
        if (!eventKey || !scKey) return false;
        return eventKey === scKey
          && e.ctrlKey === ytShortcut.ctrlKey
          && e.shiftKey === ytShortcut.shiftKey
          && e.altKey === ytShortcut.altKey
          && e.metaKey === ytShortcut.metaKey;
      }

      chrome.storage.local.get(['hltr_yt_shortcut'], function (r) {
        if (r.hltr_yt_shortcut) ytShortcut = r.hltr_yt_shortcut;
      });

      chrome.storage.onChanged.addListener(function (changes) {
        if (changes.hltr_yt_shortcut) ytShortcut = changes.hltr_yt_shortcut.newValue;
      });

      document.addEventListener('keydown', function (e) {
        if (matchesYtShortcut(e) && location.hostname === 'www.youtube.com') {
          e.preventDefault();
          e.stopPropagation();
          showYtAnnotationPrompt();
        }
      }, true);

      // Run on initial load (direct navigation to /watch)
      initYouTubeTracking();

      // Re-run on YouTube SPA navigation
      document.addEventListener('yt-navigate-finish', function () {
        // Small delay to let YouTube update location.pathname
        setTimeout(initYouTubeTracking, 1500);
      });
    }
  })();

  // -- Init --
  load();
})();
