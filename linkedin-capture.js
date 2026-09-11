// LinkedIn Post Reflection capture for Reflect.
// Nothing is collected until the user starts selection, chooses a card, reviews
// the extracted fields, writes a reflection, and confirms the save.
(function () {
  'use strict';

  if (window.__reflectLinkedInCaptureLoaded) return;
  window.__reflectLinkedInCaptureLoaded = true;

  var PARSER_VERSION = 'linkedin-v1';
  var active = false;
  var selectedRoot = null;
  var uiHost = null;
  var shadow = null;

  function absoluteUrl(href) {
    try { return new URL(href, location.href).href; } catch (_) { return ''; }
  }

  function currentPageUrlWithoutTracking() {
    try {
      var url = new URL(location.href);
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return location.origin + location.pathname;
    }
  }

  function normalizeLinkedInProfileUrl(value) {
    if (!value) return '';
    try {
      var url = new URL(value, location.origin);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return '';
      var match = url.pathname.match(/^\/(in|company)\/[^/?#]+/i);
      return match ? 'https://www.linkedin.com' + match[0].replace(/\/$/, '').toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  function activityIdFromString(value) {
    if (!value) return '';
    var text = String(value);
    var urn = text.match(/urn:li:activity:(\d{10,})/i);
    if (urn) return urn[1];
    var postPath = text.match(/activity[-:](\d{10,})/i);
    return postPath ? postPath[1] : '';
  }

  function directActivityId(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    var attributes = ['data-urn', 'data-id', 'data-activity-urn', 'id'];
    for (var i = 0; i < attributes.length; i++) {
      var id = activityIdFromString(element.getAttribute(attributes[i]));
      if (id) return id;
    }
    return '';
  }

  function postLinks(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('a[href]')).filter(function (link) {
      return !!activityIdFromString(link.href || link.getAttribute('href'));
    });
  }

  function actionScore(root) {
    if (!root) return 0;
    var values = Array.from(root.querySelectorAll('button, a[role="button"]')).map(function (element) {
      return [element.getAttribute('aria-label'), element.getAttribute('title'), element.innerText]
        .filter(Boolean).join(' ').toLowerCase();
    });
    var score = 0;
    if (values.some(function (value) { return /\blike\b|\breaction/.test(value); })) score++;
    if (values.some(function (value) { return /\bcomment/.test(value); })) score++;
    if (values.some(function (value) { return /\brepost|\bshare\b/.test(value); })) score++;
    if (values.some(function (value) { return /\bsend\b/.test(value); })) score++;
    return score;
  }

  function looksLikePostRoot(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    var hasIdentity = !!directActivityId(element) || postLinks(element).length > 0;
    if (!hasIdentity) return false;
    if (actionScore(element) >= 2) return true;
    return element.matches('article, [role="article"], [data-view-name="feed-full-update"], .feed-shared-update-v2, .occludable-update');
  }

  function findPostRoot(target) {
    var element = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    var fallback = null;
    while (element && element !== document.body) {
      if (looksLikePostRoot(element)) {
        if (actionScore(element) >= 2) return element;
        if (!fallback) fallback = element;
      }
      element = element.parentElement;
    }
    return fallback;
  }

  function resolveIdentity(root) {
    var platformPostId = directActivityId(root);
    var links = postLinks(root);
    var distinctLinkedIds = Array.from(new Set(links.map(function (link) {
      return activityIdFromString(link.href || link.getAttribute('href'));
    }).filter(Boolean)));
    var ambiguous = false;
    var permalink = '';

    if (platformPostId) {
      var matching = links.find(function (link) {
        return activityIdFromString(link.href || link.getAttribute('href')) === platformPostId;
      });
      if (matching) permalink = absoluteUrl(matching.href || matching.getAttribute('href'));
    } else if (distinctLinkedIds.length === 1) {
      platformPostId = distinctLinkedIds[0];
      var onlyMatch = links.find(function (link) {
        return activityIdFromString(link.href || link.getAttribute('href')) === platformPostId;
      });
      if (onlyMatch) permalink = absoluteUrl(onlyMatch.href || onlyMatch.getAttribute('href'));
    } else if (distinctLinkedIds.length > 1) {
      ambiguous = true;
    }

    if (!permalink && platformPostId) {
      permalink = 'https://www.linkedin.com/feed/update/urn:li:activity:' + platformPostId + '/';
    }

    try {
      if (permalink) {
        var url = new URL(permalink);
        url.search = '';
        url.hash = '';
        permalink = url.href;
      }
    } catch (_) {}

    return {
      platformPostId: platformPostId,
      permalink: permalink,
      links: links,
      linkedActivityIds: distinctLinkedIds,
      ambiguous: ambiguous
    };
  }

  function textFromElement(element) {
    return element ? String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  var NESTED_POST_ROOT_SELECTORS = [
    '[data-urn]',
    '[data-id]',
    'article',
    '[role="article"]',
    '[data-view-name*="reshared"]',
    '[data-view-name*="mini-update"]',
    '.update-components-mini-update-v2',
    '.feed-shared-mini-update-v2',
    '.feed-shared-update-v2__update-content-wrapper'
  ].join(', ');

  function activityIdsWithin(element) {
    var ids = [];
    var ownId = directActivityId(element);
    if (ownId) ids.push(ownId);
    Array.from(element.querySelectorAll('[data-urn], [data-id], [data-activity-urn], a[href]')).forEach(function (candidate) {
      var id = directActivityId(candidate) || activityIdFromString(candidate.getAttribute('href'));
      if (id) ids.push(id);
    });
    return Array.from(new Set(ids));
  }

  function nestedBoundaryForMarker(marker, nestedId, root, outerId) {
    var current = marker;
    while (current && current !== root) {
      if (current.matches && current.matches(NESTED_POST_ROOT_SELECTORS)) {
        var ids = activityIdsWithin(current);
        if (ids.indexOf(nestedId) >= 0 && ids.indexOf(outerId) < 0) return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function resolveNestedPosts(root, outerId) {
    if (!outerId) return { items: [], boundaries: [], unresolvedIds: [], isolationComplete: false };
    var byId = new Map();
    Array.from(root.querySelectorAll('[data-urn], [data-id], [data-activity-urn], a[href]')).forEach(function (marker) {
      var id = directActivityId(marker) || activityIdFromString(marker.getAttribute('href'));
      if (!id || id === outerId) return;
      var entry = byId.get(id) || { id: id, markers: [], links: [] };
      entry.markers.push(marker);
      if (marker.matches('a[href]') && activityIdFromString(marker.getAttribute('href')) === id) entry.links.push(marker);
      byId.set(id, entry);
    });

    var items = [];
    var unresolvedIds = [];
    byId.forEach(function (entry) {
      var boundary = null;
      for (var i = 0; i < entry.markers.length && !boundary; i++) {
        boundary = nestedBoundaryForMarker(entry.markers[i], entry.id, root, outerId);
      }
      if (!boundary) {
        unresolvedIds.push(entry.id);
        return;
      }
      var matchingLink = entry.links.find(function (link) { return boundary.contains(link); }) || null;
      items.push({ id: entry.id, boundary: boundary, link: matchingLink });
    });

    return {
      items: items,
      boundaries: Array.from(new Set(items.map(function (item) { return item.boundary; }))),
      unresolvedIds: unresolvedIds,
      isolationComplete: unresolvedIds.length === 0
    };
  }

  function extractAuthor(root, outerId, nestedBoundaries) {
    var selectors = [
      'a.update-components-actor__meta-link[href*="linkedin.com/in/"]',
      'a.update-components-actor__meta-link[href*="linkedin.com/company/"]',
      'a.feed-shared-actor__container-link[href*="/in/"]',
      'a.feed-shared-actor__container-link[href*="/company/"]',
      'a[href*="linkedin.com/in/"]',
      'a[href*="linkedin.com/company/"]',
      'a[href^="/in/"]',
      'a[href^="/company/"]'
    ];
    outerId = outerId || directActivityId(root) || resolveIdentity(root).platformPostId;
    nestedBoundaries = nestedBoundaries || [];
    var link = null;
    for (var i = 0; i < selectors.length && !link; i++) {
      link = Array.from(root.querySelectorAll(selectors[i])).find(function (candidate) {
        return belongsToOuterPost(candidate, root, outerId, nestedBoundaries);
      }) || null;
    }
    if (!link) return { name: '', profileUrl: '' };

    var nameElement = link.querySelector('[aria-hidden="true"]') || link.querySelector('span') || link;
    var name = textFromElement(nameElement).split(/\s{2,}|\n/)[0].trim();
    return { name: name, profileUrl: normalizeLinkedInProfileUrl(absoluteUrl(link.getAttribute('href'))) };
  }

  function extractContent(root, outerId, nestedBoundaries) {
    nestedBoundaries = nestedBoundaries || [];
    var selectors = [
      '[data-test-id="main-feed-activity-card__commentary"]',
      '.update-components-text',
      '.feed-shared-inline-show-more-text',
      '[data-view-name="feed-commentary"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var element = Array.from(root.querySelectorAll(selectors[i])).find(function (candidate) {
        return belongsToOuterPost(candidate, root, outerId, nestedBoundaries);
      });
      var text = textFromElement(element);
      if (text) return { text: text, selector: selectors[i] };
    }

    var candidates = Array.from(root.querySelectorAll('div[dir="ltr"], span[dir="ltr"]'))
      .map(function (element) { return { element: element, text: textFromElement(element) }; })
      .filter(function (item) {
        return item.text.length >= 40 &&
          belongsToOuterPost(item.element, root, outerId, nestedBoundaries) &&
          !item.element.closest('button, nav, [role="navigation"]');
      })
      .sort(function (a, b) { return b.text.length - a.text.length; });

    return candidates.length
      ? { text: candidates[0].text, selector: 'dir-fallback' }
      : { text: '', selector: '' };
  }

  function derivePublishedAt(activityId) {
    if (!activityId || typeof BigInt === 'undefined') return null;
    try {
      var milliseconds = Number(BigInt(activityId) >> 22n);
      var date = new Date(milliseconds);
      if (date.getUTCFullYear() < 2010 || date.getTime() > Date.now() + 86400000) return null;
      return date.toISOString();
    } catch (_) {
      return null;
    }
  }

  function extractPublishedAt(root, identity, nestedBoundaries) {
    nestedBoundaries = nestedBoundaries || [];
    var time = Array.from(root.querySelectorAll('time[datetime]')).find(function (candidate) {
      return belongsToOuterPost(candidate, root, identity.platformPostId, nestedBoundaries);
    });
    if (time && !Number.isNaN(Date.parse(time.getAttribute('datetime')))) {
      return {
        value: new Date(time.getAttribute('datetime')).toISOString(),
        raw: textFromElement(time) || time.getAttribute('datetime'),
        source: 'time_element'
      };
    }

    var postLink = identity.links.find(function (link) {
      return activityIdFromString(link.href || link.getAttribute('href')) === identity.platformPostId;
    });
    var raw = postLink
      ? [postLink.getAttribute('aria-label'), postLink.getAttribute('title'), textFromElement(postLink)].filter(Boolean).join(' · ')
      : '';
    var derived = derivePublishedAt(identity.platformPostId);
    return { value: derived, raw: raw, source: derived ? 'linkedin_activity_id' : 'unknown' };
  }

  function parseCount(raw) {
    if (!raw) return null;
    var compact = String(raw).replace(/\s/g, '').replace(/,/g, '');
    var match = compact.match(/(\d+(?:\.\d+)?)([KMB])?/i);
    if (!match) return null;
    var multiplier = { K: 1000, M: 1000000, B: 1000000000 }[(match[2] || '').toUpperCase()] || 1;
    var value = Math.round(parseFloat(match[1]) * multiplier);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function metricFromText(text, expressions) {
    for (var i = 0; i < expressions.length; i++) {
      var match = text.match(expressions[i]);
      if (match) return { value: parseCount(match[1]), raw: match[0].trim() };
    }
    return { value: null, raw: '' };
  }

  function belongsToOuterPost(element, root, outerId, nestedBoundaries) {
    nestedBoundaries = nestedBoundaries || [];
    if (nestedBoundaries.some(function (boundary) { return boundary === element || boundary.contains(element); })) return false;
    var current = element;
    while (current && current !== root) {
      var nestedId = directActivityId(current) || activityIdFromString(current.getAttribute && current.getAttribute('href'));
      if (nestedId && outerId && nestedId !== outerId) return false;
      current = current.parentElement;
    }
    return true;
  }

  function extractMetrics(root, outerId, nestedBoundaries) {
    var snippets = Array.from(root.querySelectorAll('button, a, span, [aria-label], [title]'))
      .filter(function (element) { return belongsToOuterPost(element, root, outerId, nestedBoundaries); })
      .map(function (element) {
        var labelText = [element.getAttribute('aria-label'), element.getAttribute('title')].filter(Boolean).join(' ');
        var visibleText = textFromElement(element);
        var combined = [labelText, visibleText].filter(Boolean).join(' ').trim();
        if (!/reaction|like|comment|repost|share|impression/i.test(combined)) return '';
        // Long descendants are usually the post body or a container spanning nested content.
        return combined.length <= 160 ? combined : labelText;
      })
      .filter(Boolean);
    var text = snippets.join('\n');

    var reactions = metricFromText(text, [
      /([\d,.]+\s*[KMB]?)\s+(?:reactions?|likes?)/i,
      /(?:reactions?|likes?)\s*[:·]?\s*([\d,.]+\s*[KMB]?)/i
    ]);
    var comments = metricFromText(text, [
      /([\d,.]+\s*[KMB]?)\s+comments?/i,
      /comments?\s*[:·]?\s*([\d,.]+\s*[KMB]?)/i
    ]);
    var reposts = metricFromText(text, [
      /([\d,.]+\s*[KMB]?)\s+(?:reposts?|shares?)/i,
      /(?:reposts?|shares?)\s*[:·]?\s*([\d,.]+\s*[KMB]?)/i
    ]);
    var impressions = metricFromText(text, [
      /([\d,.]+\s*[KMB]?)\s+impressions?/i,
      /impressions?\s*[:·]?\s*([\d,.]+\s*[KMB]?)/i
    ]);

    return {
      values: {
        reactions: reactions.value,
        comments: comments.value,
        reposts: reposts.value,
        impressions: impressions.value
      },
      raw: {
        reactions: reactions.raw,
        comments: comments.raw,
        reposts: reposts.raw,
        impressions: impressions.raw
      }
    };
  }

  function extractMedia(root, author, outerId, nestedBoundaries) {
    var videos = Array.from(root.querySelectorAll('video')).filter(function (video) {
      return belongsToOuterPost(video, root, outerId, nestedBoundaries);
    }).length;
    var images = Array.from(root.querySelectorAll('img')).filter(function (image) {
      if (!belongsToOuterPost(image, root, outerId, nestedBoundaries)) return false;
      var src = image.currentSrc || image.src || '';
      var alt = (image.alt || '').toLowerCase();
      var rect = image.getBoundingClientRect();
      if (!src || /profile|avatar|logo/.test(alt)) return false;
      if (author.name && alt === author.name.toLowerCase()) return false;
      return rect.width >= 180 || rect.height >= 180 || image.naturalWidth >= 300 || image.naturalHeight >= 300;
    });
    var documentLink = Array.from(root.querySelectorAll('a')).some(function (link) {
      return belongsToOuterPost(link, root, outerId, nestedBoundaries) &&
        /document|carousel|slide\s+\d+/i.test([link.getAttribute('aria-label'), link.getAttribute('title')].filter(Boolean).join(' '));
    });

    var type = 'none';
    if (videos) type = 'video';
    else if (documentLink) type = 'document';
    else if (images.length > 1) type = 'image_gallery';
    else if (images.length === 1) type = 'image';

    return {
      type: type,
      image_count: images.length,
      video_count: videos,
      image_alt_texts: images.map(function (image) { return image.alt || ''; }).filter(Boolean).slice(0, 10)
    };
  }

  function extractEmbeddedPost(nestedContext) {
    if (!nestedContext.items.length) return null;
    var item = nestedContext.items[0];
    var nestedRoot = item.boundary;
    var nestedAuthor = extractAuthor(nestedRoot, item.id, []);
    var nestedContent = extractContent(nestedRoot, item.id, []);
    var permalink = item.link ? absoluteUrl(item.link.getAttribute('href')) : null;
    if (permalink && activityIdFromString(permalink) !== item.id) permalink = null;
    return {
      platform_post_id: item.id,
      permalink: permalink,
      author_name: nestedAuthor.name || null,
      author_profile_url: nestedAuthor.profileUrl || null,
      content_text: nestedContent.text || null
    };
  }

  function extractionConfidence(identity, author, content, root, nestedContext) {
    if (identity.ambiguous || !nestedContext.isolationComplete) return 'low';
    var score = 0;
    if (identity.platformPostId) score += 2;
    if (identity.permalink) score += 2;
    if (author.profileUrl) score++;
    if (content.text) score++;
    if (actionScore(root) >= 2) score++;
    if (identity.linkedActivityIds.length > 1 && score >= 6) return 'medium';
    if (score >= 6) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  function extractPost(root) {
    var identity = resolveIdentity(root);
    var nestedContext = resolveNestedPosts(root, identity.platformPostId);
    var author = extractAuthor(root, identity.platformPostId, nestedContext.boundaries);
    var content = extractContent(root, identity.platformPostId, nestedContext.boundaries);
    var published = extractPublishedAt(root, identity, nestedContext.boundaries);
    var metrics = extractMetrics(root, identity.platformPostId, nestedContext.boundaries);
    var media = extractMedia(root, author, identity.platformPostId, nestedContext.boundaries);
    var surface = /\/feed\/update\/|\/posts\//i.test(location.pathname) ? 'detail' : 'feed';

    return {
      identity: identity,
      nestedContext: nestedContext,
      author: author,
      content: content,
      published: published,
      metrics: metrics,
      media: media,
      embeddedPost: extractEmbeddedPost(nestedContext),
      surface: surface,
      observedAt: new Date().toISOString(),
      confidence: extractionConfidence(identity, author, content, root, nestedContext)
    };
  }

  function ensureUi() {
    if (uiHost) return;
    uiHost = document.createElement('div');
    uiHost.id = 'reflect-social-post-capture-host';
    uiHost.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(uiHost);
    shadow = uiHost.attachShadow({ mode: 'closed' });
  }

  function clearUi() {
    if (uiHost) uiHost.remove();
    uiHost = null;
    shadow = null;
    selectedRoot = null;
  }

  function showPickerUi() {
    ensureUi();
    shadow.innerHTML = '<style>' +
      '.banner{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#172e42;color:#fff;padding:10px 16px;border-radius:999px;font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.24)}' +
      '.outline{position:fixed;border:3px solid #0a66c2;border-radius:10px;background:rgba(10,102,194,.06);box-sizing:border-box;display:none}' +
      '</style><div class="banner">Select a LinkedIn post · Esc to cancel</div><div class="outline"></div>';
  }

  function updateOutline(root) {
    if (!shadow) return;
    var outline = shadow.querySelector('.outline');
    if (!root) {
      outline.style.display = 'none';
      return;
    }
    var rect = root.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = Math.max(0, rect.left) + 'px';
    outline.style.top = Math.max(0, rect.top) + 'px';
    outline.style.width = Math.min(innerWidth - Math.max(0, rect.left), rect.width) + 'px';
    outline.style.height = Math.min(innerHeight - Math.max(0, rect.top), rect.height) + 'px';
  }

  function onPointerMove(event) {
    if (!active || (uiHost && event.target === uiHost)) return;
    selectedRoot = findPostRoot(event.target);
    updateOutline(selectedRoot);
  }

  function removePickerListeners() {
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKeydown, true);
    window.removeEventListener('scroll', onPickerScroll, true);
    window.removeEventListener('resize', onPickerScroll, true);
  }

  function cancelPicker() {
    active = false;
    removePickerListeners();
    clearUi();
  }

  function onPickerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelPicker();
    }
  }

  function onPickerScroll() {
    updateOutline(selectedRoot);
  }

  function onPickerClick(event) {
    if (!active) return;
    var root = findPostRoot(event.target) || selectedRoot;
    if (!root) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    active = false;
    removePickerListeners();
    var extracted = extractPost(root);
    chrome.storage.local.get(['linkedinProfileUrl'], function (settings) {
      showConfirmation(extracted, settings.linkedinProfileUrl || '');
    });
  }

  function startPicker() {
    if (!/https?:\/\/(?:[^/]+\.)?linkedin\.com\//i.test(location.href)) return;
    if (active) {
      cancelPicker();
      return;
    }
    clearUi();
    active = true;
    showPickerUi();
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKeydown, true);
    window.addEventListener('scroll', onPickerScroll, true);
    window.addEventListener('resize', onPickerScroll, true);
  }

  function toDateTimeLocal(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    var offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 19);
  }

  function fromDateTimeLocal(value) {
    if (!value) return null;
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function safeMetricValue(value) {
    var number = Number(value);
    return value !== '' && Number.isInteger(number) && number >= 0 ? number : null;
  }

  function inferOwnership(configuredProfileUrl, authorProfileUrl) {
    var configured = normalizeLinkedInProfileUrl(configuredProfileUrl);
    var author = normalizeLinkedInProfileUrl(authorProfileUrl);
    if (!configured || !author) return 'unknown';
    return configured === author ? 'own' : 'external';
  }

  function captureId() {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'social-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function showConfirmation(extracted, configuredProfileUrl) {
    ensureUi();
    uiHost.style.pointerEvents = 'auto';

    var normalizedConfiguredProfile = normalizeLinkedInProfileUrl(configuredProfileUrl);
    var normalizedAuthorProfile = normalizeLinkedInProfileUrl(extracted.author.profileUrl);
    var ownership = inferOwnership(normalizedConfiguredProfile, normalizedAuthorProfile);
    var confidenceWarning = extracted.identity.ambiguous
      ? 'This card contains multiple post identities and no unambiguous outer identity. Open the intended post detail view and try again.'
      : !extracted.nestedContext.isolationComplete
        ? 'Reflect cannot safely isolate embedded post content from the outer post. Open the intended post detail view and try again.'
        : extracted.confidence === 'high'
        ? ''
        : 'Reflect is not fully confident in this extraction. Please correct every field before saving.';

    shadow.innerHTML = '<style>' +
      ':host{all:initial}.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:24px;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2933}' +
      '.modal{width:min(680px,calc(100vw - 40px));max-height:calc(100vh - 48px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.36);padding:22px;box-sizing:border-box}' +
      'h2{font-size:20px;margin:0 0 4px}.sub{color:#667085;font-size:12px;margin-bottom:18px}.warning{background:#fff7df;color:#7a5400;padding:10px 12px;border-radius:8px;margin-bottom:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}label{display:block;font-size:12px;font-weight:650;color:#475467;margin-bottom:12px}input,textarea,select{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #d0d5dd;border-radius:7px;padding:9px 10px;background:#fff;color:#101828;font:14px inherit}textarea{min-height:84px;resize:vertical}.posttext{min-height:130px}.meta{background:#f7f8fa;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5;margin-bottom:14px;overflow-wrap:anywhere}.tags{display:flex;flex-wrap:wrap;gap:7px;margin:4px 0 16px}.tags label{margin:0;padding:6px 9px;border:1px solid #d0d5dd;border-radius:999px;font-weight:500;color:#344054}.tags input{display:inline;width:auto;margin:0 5px 0 0}.actions{display:flex;justify-content:flex-end;gap:9px;align-items:center}.status{margin-right:auto;color:#475467;font-size:12px}.error{color:#b42318}.success{color:#067647}button{border:0;border-radius:8px;padding:9px 14px;font:600 14px inherit;cursor:pointer}.cancel{background:#eef0f3;color:#344054}.save{background:#0a66c2;color:#fff}.save:disabled{opacity:.55;cursor:wait}@media(max-width:620px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}}' +
      '</style><div class="backdrop"><form class="modal"><h2>Reflect on this post</h2>' +
      '<div class="sub">Review the extracted post before saving. Observed ' + new Date(extracted.observedAt).toLocaleString() + '.</div>' +
      (confidenceWarning ? '<div class="warning"></div>' : '') +
      '<div class="meta"><strong>Post identity:</strong> <span class="identity"></span><br><strong>Media:</strong> <span class="media"></span><br><strong>Published source:</strong> <span class="published-source"></span></div>' +
      '<div class="grid"><label>Author<input name="author" type="text"></label><label>Author profile URL<input name="authorProfile" type="url"></label></div>' +
      '<label>Post text<textarea class="posttext" name="content"></textarea></label>' +
      '<div class="grid"><label>Published at<input name="publishedAt" type="datetime-local" step="1"></label><label>Whose post?<select name="ownership"><option value="own">Mine</option><option value="external">Someone else’s</option><option value="unknown">Unknown</option></select></label></div>' +
      '<div class="metrics"><label>Reactions<input name="reactions" type="number" min="0"></label><label>Comments<input name="comments" type="number" min="0"></label><label>Reposts<input name="reposts" type="number" min="0"></label><label>Impressions<input name="impressions" type="number" min="0"></label></div>' +
      '<label>Visible performance<select name="performance"><option value="too_early_or_unknown">Too early or unknown</option><option value="doing_well">Doing well</option><option value="underperforming">Underperforming</option></select></label>' +
      '<label class="reflection-label">Your interpretation<textarea name="reflection" required placeholder="What does this post or result suggest?"></textarea></label>' +
      '<div class="tags"></div><div class="actions"><span class="status"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="save">Save reflection</button></div></form></div>';

    var form = shadow.querySelector('form');
    var warning = shadow.querySelector('.warning');
    if (warning) warning.textContent = confidenceWarning;
    shadow.querySelector('.identity').textContent = extracted.identity.platformPostId + ' · ' + extracted.identity.permalink;
    shadow.querySelector('.media').textContent = extracted.media.type + (extracted.media.image_count ? ' · ' + extracted.media.image_count + ' image(s)' : '');
    shadow.querySelector('.published-source').textContent = extracted.published.source + (extracted.published.raw ? ' · ' + extracted.published.raw : '');
    form.elements.author.value = extracted.author.name;
    form.elements.author.dataset.originalValue = extracted.author.name;
    form.elements.authorProfile.value = extracted.author.profileUrl;
    form.elements.authorProfile.dataset.originalValue = normalizeLinkedInProfileUrl(extracted.author.profileUrl);
    form.elements.content.value = extracted.content.text;
    form.elements.content.dataset.originalValue = extracted.content.text;
    form.elements.publishedAt.value = toDateTimeLocal(extracted.published.value);
    form.elements.publishedAt.dataset.originalValue = form.elements.publishedAt.value;
    form.elements.ownership.value = ownership;
    ['reactions', 'comments', 'reposts', 'impressions'].forEach(function (key) {
      var value = extracted.metrics.values[key];
      form.elements[key].value = value === null ? '' : value;
    });

    var tagNames = ['hook', 'topic', 'specificity', 'emotion', 'professional relevance', 'credibility', 'format', 'visual', 'call to action'];
    var tags = shadow.querySelector('.tags');
    tagNames.forEach(function (tag) {
      var label = document.createElement('label');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = tag;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(tag));
      tags.appendChild(label);
    });

    form.elements.ownership.addEventListener('change', function () {
      form.elements.reflection.placeholder = form.elements.ownership.value === 'own'
        ? 'What does this result suggest?'
        : 'Why did this stand out to you?';
    });
    form.elements.ownership.dispatchEvent(new Event('change'));

    shadow.querySelector('.cancel').addEventListener('click', clearUi);
    shadow.querySelector('.backdrop').addEventListener('click', function (event) {
      if (event.target === event.currentTarget) clearUi();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var status = shadow.querySelector('.status');
      var save = shadow.querySelector('.save');
      var reflectionText = form.elements.reflection.value.trim();
      if (!reflectionText) {
        status.textContent = 'Write a short interpretation first.';
        status.className = 'status error';
        return;
      }
      if (extracted.identity.ambiguous || !extracted.nestedContext.isolationComplete || !extracted.identity.platformPostId || !extracted.identity.permalink) {
        status.textContent = 'Reflect cannot isolate a unique post safely. Open its detail view and try again.';
        status.className = 'status error';
        return;
      }

      save.disabled = true;
      status.textContent = 'Saving…';
      status.className = 'status';
      var selectedTags = Array.from(tags.querySelectorAll('input:checked')).map(function (input) { return input.value; });
      var publishedInputUnchanged = form.elements.publishedAt.value === form.elements.publishedAt.dataset.originalValue;
      var publishedAt = publishedInputUnchanged
        ? extracted.published.value
        : fromDateTimeLocal(form.elements.publishedAt.value);
      var capture = {
        contract_version: 1,
        client_capture_id: captureId(),
        post: {
          platform: 'linkedin',
          platform_post_id: extracted.identity.platformPostId,
          permalink: extracted.identity.permalink,
          author_name: form.elements.author.value.trim() || null,
          author_profile_url: normalizeLinkedInProfileUrl(form.elements.authorProfile.value) || null,
          content_text: form.elements.content.value.trim() || null,
          published_at: publishedAt,
          published_at_raw: extracted.published.raw || null,
          published_at_source: publishedAt
            ? (publishedInputUnchanged ? extracted.published.source : 'user_corrected')
            : 'unknown',
          media: extracted.media,
          embedded_post: extracted.embeddedPost,
          corrections: {
            author_name: form.elements.author.value.trim() !== form.elements.author.dataset.originalValue,
            author_profile_url: normalizeLinkedInProfileUrl(form.elements.authorProfile.value) !== form.elements.authorProfile.dataset.originalValue,
            content_text: form.elements.content.value.trim() !== form.elements.content.dataset.originalValue,
            published_at: !publishedInputUnchanged
          }
        },
        snapshot: {
          observed_at: extracted.observedAt,
          surface: extracted.surface,
          metrics: {
            reactions: safeMetricValue(form.elements.reactions.value),
            comments: safeMetricValue(form.elements.comments.value),
            reposts: safeMetricValue(form.elements.reposts.value),
            impressions: safeMetricValue(form.elements.impressions.value)
          },
          metrics_raw: extracted.metrics.raw,
          parser_version: PARSER_VERSION,
          extraction_confidence: extracted.confidence,
          capture_context: {
            page_url: currentPageUrlWithoutTracking(),
            content_selector: extracted.content.selector,
            nested_post_count: extracted.nestedContext.items.length,
            nested_isolation_complete: extracted.nestedContext.isolationComplete,
            configured_profile_match: normalizedConfiguredProfile && normalizedAuthorProfile
              ? normalizedConfiguredProfile === normalizedAuthorProfile
              : null
          }
        },
        reflection: {
          ownership: form.elements.ownership.value,
          performance_assessment: form.elements.performance.value,
          text: reflectionText,
          tags: selectedTags
        }
      };

      chrome.runtime.sendMessage({ action: 'save-social-post-capture', capture: capture }, function (response) {
        if (chrome.runtime.lastError) {
          save.disabled = false;
          status.textContent = chrome.runtime.lastError.message;
          status.className = 'status error';
          return;
        }
        if (!response || !response.ok) {
          save.disabled = false;
          status.textContent = response && response.error ? response.error : 'Could not save reflection.';
          status.className = 'status error';
          return;
        }
        status.textContent = response.synced
          ? 'Saved and synced.'
          : 'Saved locally; backend sync is pending' + (response.error ? ': ' + response.error : '.');
        status.className = 'status success';
        setTimeout(clearUi, 1200);
      });
    });
  }

  // Content scripts run in an isolated world. Exposing pure parser entry points
  // here enables fixture tests without exposing them to the LinkedIn page.
  window.__reflectLinkedInParserForTests = {
    activityIdFromString: activityIdFromString,
    normalizeLinkedInProfileUrl: normalizeLinkedInProfileUrl,
    inferOwnership: inferOwnership,
    findPostRoot: findPostRoot,
    extractPost: extractPost
  };

  // Exposed only in the content script's isolated world so fixture tests can
  // exercise the same parser shipped to Chrome.
  window.__reflectLinkedInParserForTests = {
    findPostRoot: findPostRoot,
    extractPost: extractPost,
    inferOwnership: inferOwnership,
    normalizeLinkedInProfileUrl: normalizeLinkedInProfileUrl
  };

  chrome.runtime.onMessage.addListener(function (message, sender, reply) {
    if (message.action === 'start-social-post-capture') {
      startPicker();
      reply({ ok: true });
    }
    return false;
  });
})();
