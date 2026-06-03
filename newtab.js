(function() {
  var API_BASE = '';
  var apiKey = '';
  var apiEnabled = false;

  // ---- Config ----
  function loadConfig(cb) {
    chrome.storage.local.get(['apiKey', 'apiBaseUrl', 'apiEnabled'], function(r) {
      apiKey = r.apiKey || '';
      API_BASE = r.apiBaseUrl || '';
      apiEnabled = r.apiEnabled === true;
      cb();
    });
  }

  // ---- API helpers ----
  function isBackendConfigured() {
    return apiEnabled && API_BASE && apiKey;
  }

  function apiFetch(path) {
    if (!isBackendConfigured()) return Promise.reject(new Error('Backend sync is not configured'));
    return fetch(API_BASE + path, {
      headers: { 'X-API-Key': apiKey }
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiPut(path, data) {
    if (!isBackendConfigured()) return Promise.reject(new Error('Backend sync is not configured'));
    return fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(data)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiPost(path, data) {
    if (!isBackendConfigured()) return Promise.reject(new Error('Backend sync is not configured'));
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(data)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiDelete(path) {
    if (!isBackendConfigured()) return Promise.reject(new Error('Backend sync is not configured'));
    return fetch(API_BASE + path, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey }
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ---- Tab switching ----
  var tabBtns = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.tab-panel');
  var loaded = { library: false, read: false, activity: false, analytics: false };

  var TAB_KEY = 'reflect_newtab_active';

  function switchTab(name) {
    tabBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.tab === name); });
    panels.forEach(function(p) { p.classList.toggle('active', p.id === 'panel-' + name); });
    localStorage.setItem(TAB_KEY, name);

    if (!loaded[name]) {
      loaded[name] = true;
      if (name === 'library') loadLibrary();
      else if (name === 'read') loadReadLater();
      else if (name === 'activity') loadActivity();
      else if (name === 'analytics') loadAnalytics();
    }
  }

  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
  });

  // ---- Utilities ----
  function extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch(e) { return url; }
  }

  function formatRelative(iso) {
    var d = new Date(iso);
    var now = new Date();
    var diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 30) return diffDays + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '\u2026' : s;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---- LIBRARY ----
  var libraryItems = [];
  var activeFilter = 'all';
  var feedOffset = 0;
  var feedLimit = 40;
  var feedLoading = false;
  var feedExhausted = false;
  var feedTotal = null;
  var feedCounts = {};
  var libraryReadLaterPreviewItems = [];
  var searchQuery = '';
  var searchDebounce = null;
  var searchBound = false;

  function loadLibrary() {
    var content = document.getElementById('library-content');
    if (!isBackendConfigured()) {
      clearChildren(content);
      content.appendChild(el('div', 'state-msg', 'Configure Railway backend sync in extension settings to load your library.'));
      return;
    }

    feedOffset = 0;
    feedExhausted = false;
    feedTotal = null;
    feedCounts = {};
    libraryItems = [];

    fetchFeedPage(content, true);
    setupFilters();
    setupLibrarySearch();
    setupInfiniteScroll();
    loadLibraryReadLaterPreview();
    loadSparkline();
  }

  function isSearchActive() {
    return searchQuery.trim().length > 0;
  }

  function resetLibraryFeed() {
    feedOffset = 0;
    feedExhausted = false;
    feedTotal = null;
    libraryItems = [];
    fetchFeedPage(document.getElementById('library-content'), true);
  }

  function fetchFeedPage(content, initial) {
    if (feedLoading || feedExhausted) return;
    feedLoading = true;

    var url;
    if (isSearchActive()) {
      url = '/api/search?q=' + encodeURIComponent(searchQuery.trim()) + '&limit=' + feedLimit + '&offset=' + feedOffset;
    } else {
      url = '/api/feed?limit=' + feedLimit + '&offset=' + feedOffset;
    }
    if (activeFilter !== 'all') url += '&type=' + activeFilter;

    apiFetch(url)
      .then(function(data) {
        var newItems = data.items || [];
        if (data.total != null) feedTotal = data.total;
        if (data.counts) feedCounts = data.counts;
        if (newItems.length < feedLimit) feedExhausted = true;
        libraryItems = libraryItems.concat(newItems);
        feedOffset += newItems.length;
        updateLibraryCount();
        if (initial) {
          renderLibrary(content);
        } else {
          appendToLibrary(content, newItems);
        }
        feedLoading = false;
      })
      .catch(function() {
        feedLoading = false;
        if (initial) {
          clearChildren(content);
          content.appendChild(el('div', 'state-msg error', 'Failed to load library.'));
        }
      });
  }

  function setupInfiniteScroll() {
    window.addEventListener('scroll', function() {
      if (feedLoading || feedExhausted) return;
      var panel = document.getElementById('panel-library');
      if (!panel.classList.contains('active')) return;
      if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 400)) {
        fetchFeedPage(document.getElementById('library-content'), false);
      }
    });
  }

  function updateLibraryCount() {
    var countEl = document.getElementById('library-count');
    var count = feedTotal != null ? feedTotal : libraryItems.length;
    countEl.textContent = count + (isSearchActive() ? ' result' : ' item') + (count === 1 ? '' : 's');
  }

  function loadSparkline() {
    apiFetch('/api/feed-sparkline')
      .then(function(data) {
        var container = document.getElementById('library-sparkline');
        if (!container || !data.days) return;
        var counts = data.days.map(function(d) { return d.count; });
        var max = Math.max.apply(null, counts) || 1;
        while (container.firstChild) container.removeChild(container.firstChild);
        counts.forEach(function(c) {
          var bar = document.createElement('div');
          bar.className = 'sparkline-bar';
          bar.style.height = Math.round((c / max) * 22 + 2) + 'px';
          container.appendChild(bar);
        });
      })
      .catch(function() {});
  }

  function extractYouTubeId(url) {
    if (!url) return null;
    var match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function makeFooter(url, timestamp) {
    var footer = el('div', 'card-footer');
    footer.appendChild(el('span', '', url ? extractDomain(url) : ''));
    footer.appendChild(el('span', '', timestamp ? formatRelative(timestamp) : ''));
    return footer;
  }

  function renderCard(item) {
    var card = el('div', 'feed-card type-' + item.type + ' fade-up');

    switch (item.type) {
      case 'image':
        var img = el('img');
        img.src = item.r2_url;
        img.alt = item.page_title || 'Captured image';
        img.loading = 'lazy';
        if (item.width && item.height) {
          img.style.aspectRatio = item.width + '/' + item.height;
        }
        card.appendChild(img);
        if (item.context_text && item.context_text.trim()) {
          var textArea = el('div', 'card-text-area');
          textArea.appendChild(el('div', 'card-text', truncate(item.context_text, 150)));
          card.appendChild(textArea);
        }
        card.appendChild(makeFooter(item.page_url, item.created_at));
        break;

      case 'video':
        var videoId = extractYouTubeId(item.base_url);
        if (videoId) {
          var thumb = el('img', 'card-thumb');
          thumb.src = 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';
          thumb.alt = item.youtube_title || 'Video';
          thumb.loading = 'lazy';
          card.appendChild(thumb);
        }
        var body = el('div', 'card-body');
        if (item.youtube_title) body.appendChild(el('div', 'card-title', item.youtube_title));
        if (item.youtube_channel) body.appendChild(el('div', 'card-meta', item.youtube_channel));
        if (item.annotation_count > 0) {
          body.appendChild(el('span', 'card-badge badge-yt_annotation', item.annotation_count + ' note' + (item.annotation_count != 1 ? 's' : '')));
        }
        if (item.youtube_annotation) {
          body.appendChild(el('div', 'card-reflection', item.youtube_annotation));
        }
        if (item.previews && item.previews.length > 0) {
          var previewList = el('div', 'card-previews');
          item.previews.forEach(function(p) {
            var row = el('div', 'card-preview-item');
            row.appendChild(el('span', 'card-preview-ts', formatTimestamp(p.timestamp_seconds)));
            row.appendChild(el('span', 'card-preview-text', truncate(p.annotation, 200)));
            previewList.appendChild(row);
          });
          body.appendChild(previewList);
        }
        card.appendChild(body);
        card.appendChild(makeFooter(item.base_url, item.last_activity || item.created_at));
        break;

      case 'article':
        if (item.preview_image) {
          var thumbImg = el('img', 'card-thumb article-thumb');
          thumbImg.src = item.preview_image.r2_url;
          thumbImg.alt = item.title || 'Article image';
          thumbImg.loading = 'lazy';
          card.appendChild(thumbImg);
        }
        var body = el('div', 'card-body');
        body.appendChild(el('div', 'card-title', item.title || extractDomain(item.base_url)));
        body.appendChild(el('div', 'card-meta', extractDomain(item.base_url)));
        if (item.highlight_count > 0) {
          body.appendChild(el('span', 'card-badge badge-highlight', item.highlight_count + ' highlight' + (item.highlight_count != 1 ? 's' : '')));
        }
        if (item.previews && item.previews.length > 0) {
          var previewList = el('div', 'card-previews');
          item.previews.forEach(function(p) {
            var row = el('div', 'card-preview-item');
            var highlighted = el('span', 'highlight-marker');
            highlighted.textContent = truncate(p.text, 200);
            var textSpan = el('span', 'card-preview-text');
            textSpan.appendChild(highlighted);
            row.appendChild(textSpan);
            if (p.annotation) {
              row.appendChild(el('div', 'card-preview-annotation', '\u201C' + truncate(p.annotation, 150) + '\u201D'));
            }
            previewList.appendChild(row);
          });
          body.appendChild(previewList);
        }
        card.appendChild(body);
        card.appendChild(makeFooter(item.base_url, item.last_activity || item.created_at));
        break;

      case 'highlight':
        // Source-aware styling: highlights from x.com get dark card treatment
        var isFromX = item.url && (item.url.indexOf('x.com') !== -1 || item.url.indexOf('twitter.com') !== -1);
        if (isFromX) {
          card.classList.remove('type-highlight');
          card.classList.add('type-x_highlight');
        }
        var body = el('div', 'card-body');
        var highlightedText = el('span', 'highlight-marker');
        highlightedText.textContent = truncate(item.text, 500);
        var textWrap = el('div', 'card-text');
        textWrap.appendChild(highlightedText);
        body.appendChild(textWrap);
        if (item.annotation) {
          body.appendChild(el('div', 'card-annotation', '\u201C' + truncate(item.annotation, 200) + '\u201D'));
        }
        card.appendChild(body);
        card.appendChild(makeFooter(item.url, item.created_at));
        break;

    }

    card.style.cursor = 'pointer';
    card.addEventListener('click', function() { openModal(item); });

    return card;
  }

  function getColumnCount() {
    var containerWidth = document.getElementById('library-content').offsetWidth;
    return Math.max(1, Math.floor((containerWidth + 16) / (300 + 16)));
  }

  function renderLibrary(container) {
    clearChildren(container);

    if (!libraryItems.length) {
      container.appendChild(el('div', 'state-msg', isSearchActive() ? 'No results found.' : 'No ' + (activeFilter === 'all' ? 'items' : activeFilter + 's') + ' yet.'));
      if (!isSearchActive()) renderLibraryReadLaterPreview(libraryReadLaterPreviewItems);
      return;
    }

    var numCols = getColumnCount();
    var masonry = el('div', 'feed-masonry');
    masonry.id = 'feed-masonry';

    var cols = [];
    for (var c = 0; c < numCols; c++) {
      var col = el('div', 'feed-masonry-col');
      cols.push(col);
      masonry.appendChild(col);
    }

    libraryItems.forEach(function(item, idx) {
      var card = renderCard(item);
      card.style.animationDelay = Math.min(idx * 0.03, 0.6) + 's';
      cols[idx % numCols].appendChild(card);
    });

    container.appendChild(masonry);
    if (!isSearchActive()) renderLibraryReadLaterPreview(libraryReadLaterPreviewItems);
  }

  function appendToLibrary(container, newItems) {
    var cols = document.querySelectorAll('.feed-masonry-col');
    if (!cols.length) return;

    // Find shortest column to continue appending
    var startIdx = 0;
    var minHeight = Infinity;
    cols.forEach(function(col, i) {
      if (col.offsetHeight < minHeight) {
        minHeight = col.offsetHeight;
        startIdx = i;
      }
    });

    newItems.forEach(function(item, idx) {
      var card = renderCard(item);
      var colIdx = (startIdx + idx) % cols.length;
      cols[colIdx].appendChild(card);
    });
  }

  function setupFilters() {
    var filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        filterBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        resetLibraryFeed();
      });
    });
  }

  function setupLibrarySearch() {
    if (searchBound) return;
    searchBound = true;

    var form = document.getElementById('library-search-form');
    var input = document.getElementById('library-search-input');
    var clearBtn = document.getElementById('library-search-clear');
    if (!form || !input || !clearBtn) return;

    function setQuery(value) {
      var nextQuery = (value || '').trim();
      form.classList.toggle('has-query', nextQuery.length > 0);
      if (nextQuery === searchQuery) return;
      searchQuery = nextQuery;
      resetLibraryFeed();
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (searchDebounce) clearTimeout(searchDebounce);
      setQuery(input.value);
    });

    input.addEventListener('input', function() {
      form.classList.toggle('has-query', input.value.trim().length > 0);
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function() {
        setQuery(input.value);
      }, 300);
    });

    clearBtn.addEventListener('click', function() {
      input.value = '';
      if (searchDebounce) clearTimeout(searchDebounce);
      setQuery('');
      input.focus();
    });
  }

  // ---- READ LATER ----
  function loadReadLater() {
    var content = document.getElementById('read-content');
    var countEl = document.getElementById('read-count');

    if (!isBackendConfigured()) {
      clearChildren(content);
      content.appendChild(el('div', 'state-msg', 'Configure Railway backend sync in extension settings to load Read Later.'));
      return;
    }

    apiFetch('/api/read-later')
      .then(function(data) {
        var items = data.items || [];
        clearChildren(content);

        if (!items.length) {
          content.appendChild(el('div', 'state-msg', 'No saved articles yet. Use the popup to save pages for later.'));
          countEl.textContent = '';
          return;
        }

        var unread = items.filter(function(i) { return !i.is_read; });
        var read = items.filter(function(i) { return i.is_read; });

        countEl.textContent = unread.length + ' unread';

        // Unread section
        if (unread.length) {
          var grid = el('div', 'rl-grid');
          unread.forEach(function(item) {
            grid.appendChild(renderRlCard(item, content));
          });
          content.appendChild(grid);
        } else {
          content.appendChild(el('div', 'state-msg', 'All caught up!'));
        }

        // Read section
        if (read.length) {
          var label = el('div', 'read-section-label', 'Already read (' + read.length + ')');
          var readGrid = el('div', 'rl-grid');
          readGrid.style.display = 'none';
          var expanded = false;

          label.addEventListener('click', function() {
            expanded = !expanded;
            readGrid.style.display = expanded ? 'grid' : 'none';
            label.textContent = (expanded ? 'Hide' : 'Already read') + ' (' + read.length + ')';
          });

          read.forEach(function(item) {
            var card = renderRlCard(item, content);
            card.classList.add('is-read');
            readGrid.appendChild(card);
          });

          content.appendChild(label);
          content.appendChild(readGrid);
        }

      })
      .catch(function() {
        clearChildren(content);
        content.appendChild(el('div', 'state-msg error', 'Failed to load reading list.'));
      });
  }


  function renderRlCard(item, container) {
    var card = el('div', 'rl-card');

    // Image or placeholder
    if (item.preview_image) {
      var img = el('img', 'rl-card-image');
      img.src = item.preview_image;
      img.alt = '';
      img.onerror = function() {
        var ph = el('div', 'rl-card-image-placeholder');
        ph.textContent = item.domain ? item.domain.charAt(0).toUpperCase() : '?';
        card.replaceChild(ph, img);
      };
      card.appendChild(img);
    } else {
      var ph = el('div', 'rl-card-image-placeholder');
      ph.textContent = item.domain ? item.domain.charAt(0).toUpperCase() : '?';
      card.appendChild(ph);
    }

    // Body
    var body = el('div', 'rl-card-body');
    body.appendChild(el('div', 'rl-card-title', item.title || item.url));
    body.appendChild(el('div', 'rl-card-domain', item.domain || ''));


    body.addEventListener('click', function() {
      window.open(item.url, '_blank');
    });
    card.appendChild(body);

    // Actions
    var actions = el('div', 'rl-card-actions');

    if (!item.is_read) {
      var markBtn = el('button', 'rl-action-btn mark-read', 'Mark as read');
      markBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        apiPut('/api/read-later/' + item.id, { is_read: true }).then(function() {
          loaded.read = false;
          loadReadLater();
          // Also refresh library preview if loaded
          refreshLibraryReadLaterPreview();
        });
      });
      actions.appendChild(markBtn);
    } else {
      var unmarkBtn = el('button', 'rl-action-btn', 'Mark unread');
      unmarkBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        apiPut('/api/read-later/' + item.id, { is_read: false }).then(function() {
          loaded.read = false;
          loadReadLater();
          refreshLibraryReadLaterPreview();
        });
      });
      actions.appendChild(unmarkBtn);
    }

    var delBtn = el('button', 'rl-action-btn delete-rl', 'Remove');
    delBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      apiDelete('/api/read-later/' + item.id).then(function() {
        card.style.transition = 'opacity 0.2s';
        card.style.opacity = '0';
        setTimeout(function() {
          card.remove();
          loaded.read = false;
          refreshLibraryReadLaterPreview();
        }, 200);
      });
    });
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
  }

  // ---- LIBRARY: Read Later Preview ----
  function loadLibraryReadLaterPreview() {
    if (!isBackendConfigured()) return;

    apiFetch('/api/read-later?is_read=false')
      .then(function(data) {
        var items = (data.items || []).slice(0, 3);
        libraryReadLaterPreviewItems = items;
        renderLibraryReadLaterPreview(items);
      })
      .catch(function() {});
  }

  function refreshLibraryReadLaterPreview() {
    if (!isBackendConfigured()) return;
    apiFetch('/api/read-later?is_read=false')
      .then(function(data) {
        var items = (data.items || []).slice(0, 3);
        libraryReadLaterPreviewItems = items;
        renderLibraryReadLaterPreview(items);
      })
      .catch(function() {});
  }

  function renderLibraryReadLaterPreview(items) {
    var existing = document.getElementById('rl-preview-section');
    if (existing) existing.remove();

    if (!items.length) return;

    var container = document.getElementById('library-content');
    if (!container) return;
    var section = el('div', 'read-later-preview');
    section.id = 'rl-preview-section';

    // Header
    var header = el('div', 'read-later-preview-header');
    header.appendChild(el('div', 'read-later-preview-title', 'Reading List'));
    var seeAll = el('a', 'read-later-preview-link', 'See all');
    seeAll.addEventListener('click', function() { switchTab('read'); });
    header.appendChild(seeAll);
    section.appendChild(header);

    // Cards row
    var row = el('div', 'read-later-row');
    items.forEach(function(item) {
      var card = el('div', 'rl-card');

      if (item.preview_image) {
        var img = el('img', 'rl-card-image');
        img.src = item.preview_image;
        img.alt = '';
        img.onerror = function() {
          var ph = el('div', 'rl-card-image-placeholder');
          ph.textContent = item.domain ? item.domain.charAt(0).toUpperCase() : '?';
          card.replaceChild(ph, img);
        };
        card.appendChild(img);
      } else {
        var ph = el('div', 'rl-card-image-placeholder');
        ph.textContent = item.domain ? item.domain.charAt(0).toUpperCase() : '?';
        card.appendChild(ph);
      }

      var body = el('div', 'rl-card-body');
      body.appendChild(el('div', 'rl-card-title', item.title || item.url));
      body.appendChild(el('div', 'rl-card-domain', item.domain || ''));
      card.appendChild(body);

      card.addEventListener('click', function() {
        window.open(item.url, '_blank');
      });
      card.style.cursor = 'pointer';

      row.appendChild(card);
    });

    section.appendChild(row);

    // Insert at top of library content (before masonry)
    container.insertBefore(section, container.firstChild);
  }

  // ---- ACTIVITY ----
  function loadActivity() {
    var content = document.getElementById('activity-content');
    var scope = document.getElementById('activity-scope');

    if (!isBackendConfigured()) {
      clearChildren(content);
      content.appendChild(el('div', 'state-msg', 'Configure Railway backend sync in extension settings to load activity.'));
      return;
    }

    fetchActivity(parseInt(scope.value), content);
    scope.addEventListener('change', function() {
      clearChildren(content);
      content.appendChild(el('div', 'state-msg', 'Loading...'));
      fetchActivity(parseInt(scope.value), content);
    });
  }

  function fetchActivity(days, container) {
    apiFetch('/api/timeline?days=' + days)
      .then(function(data) {
        renderActivity(data, container);
      })
      .catch(function() {
        clearChildren(container);
        container.appendChild(el('div', 'state-msg error', 'Failed to load activity.'));
      });
  }

  function badgeLabel(type) {
    var map = {
      highlight: 'Highlight',
      yt_annotation: 'Annotated', yt_reflection: 'Reflected'
    };
    return map[type] || type;
  }

  function badgeClass(type) {
    return 'badge-' + type;
  }

  function renderActivity(data, container) {
    var items = [];

    (data.highlights || []).forEach(function(h) {
      items.push({ type: 'highlight', timestamp: h.created_at, text: h.text, annotation: h.annotation, url: h.url });
    });
    (data.youtube_annotations || []).forEach(function(y) {
      items.push({ type: 'yt_annotation', timestamp: y.created_at, text: y.annotation, url: y.url });
    });
    (data.youtube_reflections || []).forEach(function(r) {
      items.push({ type: 'yt_reflection', timestamp: r.visited_at || r.created_at, text: r.youtube_annotation, url: r.url, author: r.youtube_channel });
    });

    items.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

    clearChildren(container);

    if (!items.length) {
      container.appendChild(el('div', 'state-msg', 'No activity in this period.'));
      return;
    }

    // Group by date
    var groups = {};
    var groupOrder = [];
    items.forEach(function(item) {
      var d = new Date(item.timestamp);
      var key = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      groups[key].push(item);
    });

    var groupIdx = 0;
    groupOrder.forEach(function(dateKey) {
      var group = el('div', 'activity-day-group fade-up');
      group.style.animationDelay = Math.min(groupIdx * 0.08, 0.4) + 's';
      group.appendChild(el('div', 'activity-date', dateKey));

      groups[dateKey].forEach(function(item) {
        var row = el('div', 'activity-item');

        row.appendChild(el('span', 'activity-badge ' + badgeClass(item.type), badgeLabel(item.type)));

        var contentDiv = el('div', 'activity-content');
        if (item.text) {
          var textEl;
          if (item.url) {
            textEl = el('a', 'activity-text');
            textEl.href = item.url;
            textEl.target = '_blank';
          } else {
            textEl = el('div', 'activity-text');
          }
          textEl.textContent = truncate(item.text, 200);
          contentDiv.appendChild(textEl);
        }
        if (item.reason) {
          contentDiv.appendChild(el('div', 'activity-reason', '\u201C' + item.reason + '\u201D'));
        }
        if (item.author) {
          contentDiv.appendChild(el('div', 'activity-author', item.author));
        }
        row.appendChild(contentDiv);

        var d = new Date(item.timestamp);
        row.appendChild(el('div', 'activity-time', d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));

        group.appendChild(row);
      });

      container.appendChild(group);
      groupIdx++;
    });
  }

  // ---- DETAIL MODAL ----
  var modalOverlay = null;
  var modalBody = null;
  var modalFooter = null;
  var currentModalItem = null;
  var currentNotesReload = null;
  var currentNotesSetImage = null;

  function initModal() {
    modalOverlay = document.getElementById('modal-overlay');
    modalBody = document.getElementById('modal-body');
    modalFooter = document.getElementById('modal-footer');

    document.getElementById('modal-close').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
      if (e.target === modalOverlay) closeModal();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
    });

    document.addEventListener('paste', function(e) {
      if (!modalOverlay.classList.contains('open')) return;
      if (!currentModalItem) return;
      // Don't intercept paste when user is editing a text field
      var active = document.activeElement;
      if (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      var itemType = currentModalItem.type;
      if (itemType !== 'article' && itemType !== 'video') return;

      var url = currentModalItem.base_url || currentModalItem.url;
      if (!url) return;

      // Check for image paste
      var items = e.clipboardData && e.clipboardData.items;
      if (items) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image/') === 0) {
            e.preventDefault();
            var blob = items[i].getAsFile();
            var reader = new FileReader();
            reader.onload = function() {
              apiPost('/api/note', { url: url, base64: reader.result, mime_type: blob.type })
                .then(function() {
                  showToast('Image note saved');
                  if (currentNotesReload) currentNotesReload();
                })
                .catch(function() { showToast('Failed to save image'); });
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }

      // Check for text paste
      var text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        apiPost('/api/note', { url: url, text: text.trim() })
          .then(function() {
            showToast('Note saved');
            if (currentNotesReload) currentNotesReload();
          })
          .catch(function() { showToast('Failed to save note'); });
      }
    });

    // Drag & drop images onto modal
    var modalContainer = document.getElementById('modal-container');
    var dragCounter = 0;

    modalContainer.addEventListener('dragenter', function(e) {
      e.preventDefault();
      if (!currentModalItem) return;
      var t = currentModalItem.type;
      if (t !== 'article' && t !== 'video') return;
      dragCounter++;
      modalContainer.classList.add('drag-over');
    });

    modalContainer.addEventListener('dragleave', function(e) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        modalContainer.classList.remove('drag-over');
      }
    });

    modalContainer.addEventListener('dragover', function(e) {
      e.preventDefault();
    });

    modalContainer.addEventListener('drop', function(e) {
      e.preventDefault();
      dragCounter = 0;
      modalContainer.classList.remove('drag-over');

      if (!currentModalItem || !currentNotesSetImage) return;
      var t = currentModalItem.type;
      if (t !== 'article' && t !== 'video') return;

      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || files.length === 0) return;

      var file = files[0];
      if (file.type.indexOf('image/') !== 0) return;

      var reader = new FileReader();
      reader.onload = function() {
        currentNotesSetImage(reader.result, file.type);
      };
      reader.readAsDataURL(file);
    });
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    currentModalItem = null;
    currentNotesReload = null;
    currentNotesSetImage = null;
  }

  function openModal(item) {
    currentModalItem = item;
    clearChildren(modalBody);
    clearChildren(modalFooter);

    switch (item.type) {
      case 'image': renderImageModal(item); break;
      case 'highlight': renderHighlightModal(item); break;
      case 'video': renderVideoModal(item); break;
      case 'article': renderArticleModal(item); break;
    }

    modalOverlay.classList.add('open');
  }

  function formatTimestamp(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // -- Image modal --
  function renderImageModal(item) {
    var img = el('img');
    img.src = item.r2_url;
    img.alt = item.page_title || 'Captured image';
    modalBody.appendChild(img);

    var meta = el('div', 'modal-meta');
    if (item.page_url) {
      var link = el('a', '', extractDomain(item.page_url));
      link.href = item.page_url;
      link.target = '_blank';
      meta.appendChild(link);
    }
    meta.appendChild(el('span', '', ' \u00B7 ' + formatRelative(item.created_at)));
    modalBody.appendChild(meta);

    if (item.context_text) {
      modalBody.appendChild(el('div', 'modal-text', item.context_text));
    }

    addDeleteButton('image', item.id);
  }

  // -- Highlight modal --
  function renderHighlightModal(item) {
    modalBody.appendChild(el('div', 'modal-title', 'Highlight'));

    var meta = el('div', 'modal-meta');
    if (item.url) {
      var link = el('a', '', extractDomain(item.url));
      link.href = item.url;
      link.target = '_blank';
      meta.appendChild(link);
    }
    meta.appendChild(el('span', '', ' \u00B7 ' + formatRelative(item.created_at)));
    modalBody.appendChild(meta);

    makeEditableText(modalBody, item.text, function(val) {
      item.text = val;
      apiPut('/api/highlight/' + item.id, { text: val });
    });

    makeEditable(modalBody, item.annotation, 'Add a note...', function(val) {
      item.annotation = val;
      apiPut('/api/highlight/' + item.id, { annotation: val });
    });

    addDeleteButton('highlights', item.id);
  }

  // -- Video modal --
  function renderVideoModal(item) {
    var videoId = extractYouTubeId(item.base_url);

    // Clickable thumbnail (YouTube embeds don't work in extension pages)
    if (videoId) {
      var wrapper = el('a', 'modal-video-thumb');
      wrapper.href = item.base_url;
      wrapper.target = '_blank';
      wrapper.title = 'Watch on YouTube';
      var img = el('img');
      img.src = 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg';
      img.alt = item.youtube_title || 'Video';
      img.style.width = '100%';
      img.style.display = 'block';
      img.style.borderRadius = '8px 8px 0 0';
      wrapper.appendChild(img);
      // Play button overlay
      var playBtn = el('div', 'modal-play-overlay', '\u25B6');
      wrapper.appendChild(playBtn);
      modalBody.appendChild(wrapper);
    }

    var body = el('div', 'card-body');
    if (item.youtube_title) body.appendChild(el('div', 'modal-title', item.youtube_title));

    var meta = el('div', 'modal-meta');
    if (item.youtube_channel) meta.appendChild(el('span', '', item.youtube_channel + ' \u00B7 '));
    var link = el('a', '', 'Watch on YouTube');
    link.href = item.base_url;
    link.target = '_blank';
    meta.appendChild(link);
    meta.appendChild(el('span', '', ' \u00B7 ' + formatRelative(item.last_activity || item.created_at)));
    body.appendChild(meta);
    modalBody.appendChild(body);

    // Fetch annotations
    var section = el('div', 'modal-section');
    section.appendChild(el('div', 'modal-section-title', 'Annotations'));
    var listContainer = el('div');
    listContainer.appendChild(el('div', '', 'Loading annotations...'));
    section.appendChild(listContainer);
    modalBody.appendChild(section);

    apiFetch('/api/youtube-annotations?video_url=' + encodeURIComponent(item.base_url))
      .then(function(data) {
        var annotations = data.annotations || [];
        clearChildren(listContainer);
        if (annotations.length === 0) {
          listContainer.appendChild(el('div', 'modal-meta', 'No annotations yet.'));
          return;
        }
        annotations.forEach(function(ann) {
          var row = el('div', 'modal-annotation-item');

          var tsBtn = el('span', 'annotation-timestamp annotation-ts-btn', formatTimestamp(ann.timestamp_seconds));
          tsBtn.title = 'Jump to ' + formatTimestamp(ann.timestamp_seconds);
          tsBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            window.open(item.base_url + '&t=' + Math.floor(ann.timestamp_seconds), '_blank');
          });
          row.appendChild(tsBtn);

          var textSpan = el('span', 'annotation-text modal-editable');
          textSpan.textContent = ann.annotation;
          textSpan.contentEditable = 'true';
          textSpan.dataset.original = ann.annotation;
          textSpan.addEventListener('blur', function() {
            var val = this.textContent.trim();
            if (val !== this.dataset.original) {
              this.dataset.original = val;
              apiPut('/api/youtube-annotation/' + ann.id, { annotation: val });
              showToast('Saved');
            }
          });
          row.appendChild(textSpan);

          listContainer.appendChild(row);
        });
      })
      .catch(function(error) {
        clearChildren(listContainer);
        listContainer.appendChild(el('div', 'modal-meta', 'Failed to load annotations. Please try again.'));
        console.error('Failed to load annotations:', error);
      });

    var notesResult = renderNotesSection(item.base_url);
    modalBody.appendChild(notesResult.section);
    currentNotesReload = notesResult.reload;
    currentNotesSetImage = notesResult.setImage;

    addShareButton(item.base_url, item);
  }

  // -- Article modal --
  function renderArticleModal(item) {
    modalBody.appendChild(el('div', 'modal-title', item.title || extractDomain(item.base_url)));

    var meta = el('div', 'modal-meta');
    var link = el('a', '', extractDomain(item.base_url));
    link.href = item.base_url;
    link.target = '_blank';
    meta.appendChild(link);
    meta.appendChild(el('span', '', ' \u00B7 ' + formatRelative(item.last_activity || item.created_at)));
    modalBody.appendChild(meta);

    var section = el('div', 'modal-section');
    section.appendChild(el('div', 'modal-section-title', 'Highlights'));
    var listContainer = el('div');
    listContainer.appendChild(el('div', '', 'Loading highlights...'));
    section.appendChild(listContainer);
    modalBody.appendChild(section);

    apiFetch('/api/article-highlights?url=' + encodeURIComponent(item.base_url))
      .then(function(data) {
        var highlights = data.highlights || [];
        clearChildren(listContainer);
        if (highlights.length === 0) {
          listContainer.appendChild(el('div', 'modal-meta', 'No highlights yet.'));
          return;
        }
        highlights.forEach(function(h) {
          var row = el('div', 'modal-highlight-item');

          // Show associated images inline above the highlight text
          if (h.images && h.images.length > 0) {
            h.images.forEach(function(img) {
              var imgContainer = el('div', 'modal-highlight-image');
              var imgEl = el('img');
              imgEl.src = img.r2_url;
              imgEl.alt = img.annotation || 'Captured image';
              imgEl.loading = 'lazy';
              imgEl.style.width = '100%';
              imgEl.style.borderRadius = '6px';
              imgEl.style.marginBottom = '8px';
              if (img.width && img.height) {
                imgEl.style.aspectRatio = img.width + '/' + img.height;
              }
              imgContainer.appendChild(imgEl);
              row.appendChild(imgContainer);
            });
          }

          makeEditableText(row, h.text, function(val) {
            apiPut('/api/highlight/' + h.id, { text: val });
          });

          makeEditable(row, h.annotation, 'Add a note...', function(val) {
            apiPut('/api/highlight/' + h.id, { annotation: val });
          });

          listContainer.appendChild(row);
        });
      })
      .catch(function(error) {
        clearChildren(listContainer);
        listContainer.appendChild(el('div', 'modal-meta', 'Failed to load highlights. Please try again.'));
        console.error('Failed to load highlights:', error);
      });

    var notesResult = renderNotesSection(item.base_url);
    modalBody.appendChild(notesResult.section);
    currentNotesReload = notesResult.reload;
    currentNotesSetImage = notesResult.setImage;

    addShareButton(item.base_url, item);
  }

  // -- Modal helpers --
  function showToast(msg) {
    var existing = document.querySelector('.modal-toast');
    if (existing) existing.remove();
    var toast = el('div', 'modal-toast', msg);
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add('visible'); }, 10);
    setTimeout(function() {
      toast.classList.remove('visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 2000);
  }

  function makeEditable(container, text, placeholder, onSave) {
    var div = el('div', 'modal-annotation modal-editable');
    var hasValue = text && text.trim();
    div.textContent = hasValue ? text : placeholder;
    div.contentEditable = 'true';
    div.dataset.original = text || '';
    if (!hasValue) div.style.color = 'var(--text-tertiary)';
    div.addEventListener('focus', function() {
      if (this.textContent === placeholder) { this.textContent = ''; this.style.color = ''; }
    });
    div.addEventListener('blur', function() {
      var val = this.textContent.trim();
      if (!val) {
        this.textContent = placeholder;
        this.style.color = 'var(--text-tertiary)';
        val = '';
      }
      if (val !== this.dataset.original) {
        this.dataset.original = val;
        onSave(val);
        showToast('Saved');
      }
    });
    container.appendChild(div);
    return div;
  }

  function makeEditableText(container, text, onSave) {
    var div = el('div', 'modal-text modal-editable');
    div.textContent = text;
    div.contentEditable = 'true';
    div.dataset.original = text || '';
    div.addEventListener('blur', function() {
      var val = this.textContent.trim();
      if (val !== this.dataset.original) {
        this.dataset.original = val;
        onSave(val);
        showToast('Saved');
      }
    });
    container.appendChild(div);
    return div;
  }

  function renderNotesSection(url) {
    var section = el('div', 'modal-section');
    section.appendChild(el('div', 'modal-section-title', 'Notes'));
    var listContainer = el('div');
    listContainer.appendChild(el('div', '', 'Loading notes...'));
    section.appendChild(listContainer);

    // -- Composer: persistent input box for creating notes --
    var composer = el('div', 'note-composer');
    var composerPreview = el('div', 'note-composer-preview');
    composerPreview.style.display = 'none';
    var composerImg = el('img');
    composerImg.style.width = '100%';
    composerImg.style.borderRadius = '6px';
    composerPreview.appendChild(composerImg);
    var composerRemoveImg = el('button', 'note-composer-remove-img', '\u00D7');
    composerPreview.appendChild(composerRemoveImg);
    composer.appendChild(composerPreview);

    var composerInput = el('div', 'note-composer-input');
    composerInput.contentEditable = 'true';
    composerInput.dataset.placeholder = 'Add a note... (paste images here too)';
    composer.appendChild(composerInput);

    var pendingImageBase64 = null;
    var pendingImageMime = null;

    composerRemoveImg.addEventListener('click', function() {
      pendingImageBase64 = null;
      pendingImageMime = null;
      composerPreview.style.display = 'none';
    });

    // Handle image paste inside the composer
    composerInput.addEventListener('paste', function(e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (items) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image/') === 0) {
            e.preventDefault();
            var blob = items[i].getAsFile();
            pendingImageMime = blob.type;
            var reader = new FileReader();
            reader.onload = function() {
              pendingImageBase64 = reader.result;
              composerImg.src = reader.result;
              composerPreview.style.display = 'block';
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
    });

    // Save on Cmd+Enter / Ctrl+Enter
    composerInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveComposer();
      }
    });

    var composerSaving = false;

    function saveComposer() {
      var text = composerInput.textContent.trim();
      if (!text && !pendingImageBase64) return;
      if (composerSaving) return;

      composerSaving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      composerInput.contentEditable = 'false';

      var payload = { url: url };
      if (text) payload.text = text;
      if (pendingImageBase64) {
        payload.base64 = pendingImageBase64;
        payload.mime_type = pendingImageMime;
      }

      apiPost('/api/note', payload)
        .then(function() {
          showToast('Note saved');
          composerInput.textContent = '';
          pendingImageBase64 = null;
          pendingImageMime = null;
          composerPreview.style.display = 'none';
          composerInput.contentEditable = 'true';
          composerSaving = false;
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          loadNotes();
        })
        .catch(function() {
          showToast('Failed to save note');
          composerInput.contentEditable = 'true';
          composerSaving = false;
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        });
    }

    var composerActions = el('div', 'note-composer-actions');
    var saveBtn = el('button', 'note-composer-save', 'Save');
    saveBtn.addEventListener('click', saveComposer);
    var hint = el('span', 'note-composer-hint', '\u2318+Enter');
    composerActions.appendChild(hint);
    composerActions.appendChild(saveBtn);
    composer.appendChild(composerActions);

    section.appendChild(composer);

    // -- Render existing notes --
    function renderNote(note) {
      var row = el('div', 'modal-highlight-item');

      if (note.r2_url) {
        var imgEl = el('img');
        imgEl.src = note.r2_url;
        imgEl.alt = note.text || 'Note image';
        imgEl.loading = 'lazy';
        imgEl.style.width = '100%';
        imgEl.style.borderRadius = '6px';
        imgEl.style.marginBottom = '8px';
        row.appendChild(imgEl);
      }

      makeEditable(row, note.text, 'Add text...', function(val) {
        apiPut('/api/note/' + note.id, { text: val });
      });

      var delBtn = el('button', 'note-delete-btn', '\u00D7');
      delBtn.title = 'Delete note';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        apiDelete('/api/note/' + note.id).then(function() {
          row.remove();
          showToast('Note deleted');
        });
      });
      row.style.position = 'relative';
      row.appendChild(delBtn);

      return row;
    }

    function loadNotes() {
      apiFetch('/api/notes?url=' + encodeURIComponent(url))
        .then(function(data) {
          var notes = data.notes || [];
          clearChildren(listContainer);
          notes.forEach(function(note) {
            listContainer.appendChild(renderNote(note));
          });
        });
    }

    loadNotes();
    function setImage(dataUrl, mime) {
      pendingImageBase64 = dataUrl;
      pendingImageMime = mime;
      composerImg.src = dataUrl;
      composerPreview.style.display = 'block';
      composerInput.focus();
    }

    return { section: section, reload: loadNotes, setImage: setImage };
  }

  function addShareButton(url, item) {
    var shareBtn = el('button', 'modal-share-btn', 'Make Public');
    var shareUrl = el('span', 'modal-share-url');
    shareUrl.style.display = 'none';
    shareUrl.style.fontSize = '12px';
    shareUrl.style.color = 'var(--text-tertiary)';
    shareUrl.style.cursor = 'pointer';
    shareUrl.title = 'Click to copy';
    modalFooter.appendChild(shareBtn);
    modalFooter.appendChild(shareUrl);

    var isPublic = !!(item && item.is_public);
    var shareToken = item && item.share_token ? item.share_token : null;
    var isVideo = url.indexOf('youtube.com') !== -1 || url.indexOf('youtu.be') !== -1;

    updateShareUI();

    // Check authoritative current share status. Do not piggyback on article
    // highlight loading; videos and articles both share this generic table.
    apiFetch('/api/content-share/status?url=' + encodeURIComponent(url))
      .then(function(data) {
        isPublic = !!data.is_public;
        shareToken = data.share_token || null;
        if (item) {
          item.is_public = isPublic;
          item.share_token = shareToken;
        }
        updateShareUI();
      })
      .catch(function() {});

    function getPublicUrl() {
      return API_BASE + (isVideo ? '/v/' : '/a/') + shareToken;
    }

    function updateShareUI() {
      if (isPublic) {
        shareBtn.textContent = 'Make Private';
        shareUrl.style.display = 'inline';
        shareUrl.textContent = getPublicUrl();
      } else {
        shareBtn.textContent = 'Make Public';
        shareUrl.style.display = 'none';
      }
    }

    shareUrl.addEventListener('click', function() {
      navigator.clipboard.writeText(getPublicUrl()).then(function() {
        showToast('Link copied');
      });
    });

    shareBtn.addEventListener('click', function() {
      shareBtn.disabled = true;
      var newPublic = !isPublic;
      apiPost('/api/content-share', { url: url, is_public: newPublic })
        .then(function(data) {
          isPublic = !!data.is_public;
          shareToken = data.share_token;
          if (item) {
            item.is_public = isPublic;
            item.share_token = shareToken;
          }
          updateShareUI();
          shareBtn.disabled = false;
          if (isPublic) {
            navigator.clipboard.writeText(getPublicUrl()).then(function() {
              showToast('Public link copied');
            });
          } else {
            showToast('Made private');
          }
        })
        .catch(function() {
          shareBtn.disabled = false;
          showToast('Failed');
        });
    });
  }

  function addDeleteButton(table, id) {
    var deleteBtn = el('button', 'modal-delete-btn', 'Delete');
    modalFooter.appendChild(deleteBtn);

    deleteBtn.addEventListener('click', function() {
      clearChildren(modalFooter);
      var confirm = el('div', 'modal-confirm', 'Are you sure? ');
      var yesBtn = el('button', 'confirm-yes', 'Yes, delete');
      var noBtn = el('button', 'confirm-no', 'Cancel');
      confirm.appendChild(yesBtn);
      confirm.appendChild(noBtn);
      modalFooter.appendChild(confirm);

      yesBtn.addEventListener('click', function() {
        var endpoint = table === 'image' ? '/api/image/' + id : '/api/timeline/' + table + '/' + id;
        apiDelete(endpoint).then(function() {
          libraryItems = libraryItems.filter(function(i) { return !(i.id === id && i.type === (table === 'image' ? 'image' : table === 'highlights' ? 'highlight' : '')); });
          renderLibrary(document.getElementById('library-content'));
          closeModal();
          showToast('Deleted');
        }).catch(function(err) {
          clearChildren(modalFooter);
          modalFooter.appendChild(el('div', 'modal-meta', 'Failed to delete: ' + err.message));
        });
      });

      noBtn.addEventListener('click', function() {
        clearChildren(modalFooter);
        addDeleteButton(table, id);
      });
    });
  }

  // ---- ANALYTICS ----
  function loadAnalytics() {
    if (!isBackendConfigured()) {
      var statsRow = document.getElementById('stats-row');
      clearChildren(statsRow);
      statsRow.appendChild(el('div', 'state-msg', 'Configure Railway backend sync in extension settings to load analytics.'));
      return;
    }

    document.getElementById('analytics-subtitle').textContent = 'Loading...';

    apiFetch('/api/analytics')
      .then(function(data) {
        renderStatCards(data.totals);
        renderStreaks(data.streaks);
        renderHeatmap(data.heatmap);
        renderWeekdayChart(data.weekdays);
        renderHourlyChart(data.hours);
        renderMonthlyChart(data.monthly_trend);
        renderDomains(data.top_domains);

        var total = data.totals.highlights + data.totals.youtube_annotations + data.totals.images + data.totals.notes;
        document.getElementById('analytics-subtitle').textContent = total.toLocaleString() + ' captures across ' + data.streaks.total_active_days + ' active days';
      })
      .catch(function() {
        document.getElementById('analytics-subtitle').textContent = '';
        var statsRow = document.getElementById('stats-row');
        clearChildren(statsRow);
        statsRow.appendChild(el('div', 'state-msg error', 'Failed to load analytics.'));
      });
  }

  function renderStatCards(totals) {
    var cards = [
      { n: totals.highlights, l: 'Highlights' },
      { n: totals.youtube_annotations, l: 'Video Notes' },
      { n: totals.images, l: 'Images' },
      { n: totals.video_reflections, l: 'Video Reflections' },
      { n: totals.notes, l: 'Notes' }
    ];

    var row = document.getElementById('stats-row');
    clearChildren(row);

    cards.forEach(function(c, i) {
      var card = el('div', 'stat-card fade-up');
      card.style.animationDelay = (i * 0.04) + 's';
      var num = el('div', 'stat-number', c.n.toLocaleString());
      var label = el('div', 'stat-label', c.l);
      card.appendChild(num);
      card.appendChild(label);
      row.appendChild(card);
    });
  }

  function renderStreaks(streaks) {
    var row = document.getElementById('streak-row');
    clearChildren(row);

    var items = [
      { v: streaks.current, u: 'day', l: 'current streak' },
      { v: streaks.longest, u: 'day', l: 'longest streak' },
      { v: streaks.today, u: '', l: 'today' }
    ];

    items.forEach(function(s) {
      var item = el('div', 'streak-item');
      item.appendChild(el('span', 'streak-value', String(s.v)));
      if (s.u) item.appendChild(el('span', 'streak-unit', s.v === 1 ? s.u : s.u + 's'));
      item.appendChild(el('span', 'streak-label', s.l));
      row.appendChild(item);
    });
  }

  function renderHeatmap(heatmap) {
    var wrapper = document.getElementById('heatmap-wrapper');
    clearChildren(wrapper);

    if (!heatmap || heatmap.length === 0) {
      wrapper.appendChild(el('div', 'state-msg', 'No data yet.'));
      return;
    }

    // Calculate intensity levels
    var counts = heatmap.map(function(d) { return d.count; });
    var maxCount = Math.max.apply(null, counts);
    var q1 = Math.max(1, Math.ceil(maxCount * 0.25));
    var q2 = Math.max(2, Math.ceil(maxCount * 0.5));
    var q3 = Math.max(3, Math.ceil(maxCount * 0.75));

    function getLevel(count) {
      if (count === 0) return '';
      if (count <= q1) return 'level-1';
      if (count <= q2) return 'level-2';
      if (count <= q3) return 'level-3';
      return 'level-4';
    }

    // Month labels
    var monthsRow = el('div', 'heatmap-months');
    var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var seenMonths = {};
    var weekMonths = [];
    for (var wi = 0; wi < heatmap.length; wi += 7) {
      var d = new Date(heatmap[Math.min(wi + 3, heatmap.length - 1)].date + 'T12:00:00');
      var mKey = d.getFullYear() + '-' + d.getMonth();
      if (!seenMonths[mKey]) {
        seenMonths[mKey] = true;
        weekMonths.push({ week: Math.floor(wi / 7), month: monthNames[d.getMonth()] });
      }
    }

    var totalWeeks = Math.ceil(heatmap.length / 7);
    var cellSize = 16;
    monthsRow.style.paddingLeft = '26px';
    weekMonths.forEach(function(wm, i) {
      var label = el('span', 'heatmap-month-label', wm.month);
      var nextWeek = (i + 1 < weekMonths.length) ? weekMonths[i + 1].week : totalWeeks;
      var span = nextWeek - wm.week;
      label.style.width = (span * cellSize) + 'px';
      label.style.display = 'inline-block';
      monthsRow.appendChild(label);
    });

    wrapper.appendChild(monthsRow);

    var body = el('div', 'heatmap-body');

    var dayLabels = el('div', 'heatmap-day-labels');
    var dayNamesList = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    dayNamesList.forEach(function(dn) {
      dayLabels.appendChild(el('span', '', dn));
    });
    body.appendChild(dayLabels);

    var grid = el('div', 'heatmap-grid');
    var firstDate = new Date(heatmap[0].date + 'T12:00:00');
    var dayOfWeek = firstDate.getDay();

    // Pad first week
    var firstWeek = el('div', 'heatmap-week');
    for (var p = 0; p < dayOfWeek; p++) {
      var empty = el('div', 'heatmap-cell');
      empty.style.visibility = 'hidden';
      firstWeek.appendChild(empty);
    }

    var idx = 0;
    for (var d2 = dayOfWeek; d2 < 7 && idx < heatmap.length; d2++, idx++) {
      var cell = el('div', 'heatmap-cell ' + getLevel(heatmap[idx].count));
      cell.dataset.date = heatmap[idx].date;
      cell.dataset.count = heatmap[idx].count;
      firstWeek.appendChild(cell);
    }
    grid.appendChild(firstWeek);

    while (idx < heatmap.length) {
      var week = el('div', 'heatmap-week');
      for (var wd = 0; wd < 7 && idx < heatmap.length; wd++, idx++) {
        var cell2 = el('div', 'heatmap-cell ' + getLevel(heatmap[idx].count));
        cell2.dataset.date = heatmap[idx].date;
        cell2.dataset.count = heatmap[idx].count;
        week.appendChild(cell2);
      }
      grid.appendChild(week);
    }

    body.appendChild(grid);
    wrapper.appendChild(body);

    // Legend
    var legend = el('div', 'heatmap-legend');
    legend.appendChild(el('span', '', 'Less'));
    ['', 'level-1', 'level-2', 'level-3', 'level-4'].forEach(function(lvl) {
      legend.appendChild(el('div', 'heatmap-legend-cell heatmap-cell ' + lvl));
    });
    legend.appendChild(el('span', '', 'More'));
    wrapper.appendChild(legend);

    // Tooltip on hover
    var tooltip = null;
    wrapper.addEventListener('mouseover', function(e) {
      var target = e.target;
      if (!target.classList.contains('heatmap-cell') || target.style.visibility === 'hidden') return;
      if (!target.dataset.date) return;

      if (!tooltip) {
        tooltip = el('div', 'heatmap-tooltip');
        document.body.appendChild(tooltip);
      }

      var dateStr = new Date(target.dataset.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      var count = parseInt(target.dataset.count);
      tooltip.textContent = count + ' capture' + (count !== 1 ? 's' : '') + ' on ' + dateStr;
      tooltip.style.display = 'block';

      var rect = target.getBoundingClientRect();
      tooltip.style.left = (rect.left + rect.width / 2) + 'px';
      tooltip.style.top = rect.top + 'px';
    });

    wrapper.addEventListener('mouseout', function(e) {
      if (e.target.classList.contains('heatmap-cell') && tooltip) {
        tooltip.style.display = 'none';
      }
    });
  }

  function renderWeekdayChart(weekdays) {
    var container = document.getElementById('chart-weekday');
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    renderBarChart(container, weekdays, dayNames);
  }

  function renderHourlyChart(hours) {
    var container = document.getElementById('chart-hourly');
    var labels = [];
    for (var i = 0; i < 24; i++) {
      labels.push(i % 6 === 0 ? (i === 0 ? '12a' : i < 12 ? i + 'a' : i === 12 ? '12p' : (i - 12) + 'p') : '');
    }
    renderBarChart(container, hours, labels);
  }

  function renderBarChart(container, values, labels) {
    clearChildren(container);
    var maxVal = Math.max.apply(null, values);
    if (maxVal === 0) maxVal = 1;

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 400 160');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    var barCount = values.length;
    var gap = 2;
    var barWidth = (400 - (barCount - 1) * gap) / barCount;
    var chartHeight = 130;
    var labelY = 155;

    values.forEach(function(v, i) {
      var g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'bar-group');

      var barH = (v / maxVal) * chartHeight;
      var x = i * (barWidth + gap);
      var y = chartHeight - barH;

      var rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('class', 'bar');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(Math.max(barH, 1)));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', '#c4a76c');
      g.appendChild(rect);

      if (labels[i]) {
        var text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', String(x + barWidth / 2));
        text.setAttribute('y', String(labelY));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '11');
        text.setAttribute('fill', '#b0a99f');
        text.textContent = labels[i];
        g.appendChild(text);
      }

      var title = document.createElementNS(svgNS, 'title');
      title.textContent = (labels[i] || String(i)) + ': ' + v;
      g.appendChild(title);

      svg.appendChild(g);
    });

    container.appendChild(svg);
  }

  function renderMonthlyChart(monthly) {
    var container = document.getElementById('chart-monthly');
    clearChildren(container);

    if (!monthly || monthly.length === 0) return;

    var colors = {
      highlights: '#b8860b',
      youtube_annotations: '#e04430'
    };

    var keys = ['highlights', 'youtube_annotations'];
    var legendLabels = { highlights: 'Highlights', youtube_annotations: 'Video Notes' };

    var maxTotal = 0;
    monthly.forEach(function(m) {
      var total = 0;
      keys.forEach(function(k) { total += m[k]; });
      if (total > maxTotal) maxTotal = total;
    });
    if (maxTotal === 0) maxTotal = 1;

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 500 200');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    var barCount = monthly.length;
    var gap = 6;
    var barWidth = (500 - (barCount - 1) * gap) / barCount;
    var chartHeight = 170;
    var labelY = 195;

    var monthNamesList = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    monthly.forEach(function(m, i) {
      var x = i * (barWidth + gap);
      var yOffset = chartHeight;

      keys.forEach(function(k) {
        var v = m[k];
        if (v === 0) return;
        var barH = (v / maxTotal) * chartHeight;
        yOffset -= barH;

        var rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(yOffset));
        rect.setAttribute('width', String(barWidth));
        rect.setAttribute('height', String(barH));
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', colors[k]);
        rect.setAttribute('opacity', '0.85');

        var title = document.createElementNS(svgNS, 'title');
        title.textContent = legendLabels[k] + ': ' + v;
        rect.appendChild(title);

        svg.appendChild(rect);
      });

      var monthIdx = parseInt(m.month.split('-')[1]) - 1;
      var text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', String(x + barWidth / 2));
      text.setAttribute('y', String(labelY));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '11');
      text.setAttribute('fill', '#b0a99f');
      text.textContent = monthNamesList[monthIdx];
      svg.appendChild(text);
    });

    container.appendChild(svg);

    // Legend
    var legendRow = el('div', 'monthly-legend');
    keys.forEach(function(k) {
      var item = el('div', 'monthly-legend-item');
      var dot = el('div', 'monthly-legend-dot');
      dot.style.background = colors[k];
      item.appendChild(dot);
      item.appendChild(el('span', '', legendLabels[k]));
      legendRow.appendChild(item);
    });
    container.parentNode.appendChild(legendRow);
  }

  function renderDomains(domains) {
    var list = document.getElementById('domains-list');
    clearChildren(list);

    if (!domains || domains.length === 0) {
      list.appendChild(el('div', 'state-msg', 'No domain data yet.'));
      return;
    }

    var maxCount = domains[0].count;

    domains.forEach(function(d, i) {
      var row = el('div', 'domain-row fade-up');
      row.style.animationDelay = (i * 0.03) + 's';

      row.appendChild(el('span', 'domain-rank', String(i + 1)));
      row.appendChild(el('span', 'domain-name', d.domain));

      var barBg = el('div', 'domain-bar-bg');
      var barFill = el('div', 'domain-bar-fill');
      barFill.style.width = '0%';
      barBg.appendChild(barFill);
      row.appendChild(barBg);

      row.appendChild(el('span', 'domain-count', d.count.toLocaleString()));

      list.appendChild(row);

      // Animate bar fill
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          barFill.style.width = Math.round((d.count / maxCount) * 100) + '%';
        });
      });
    });
  }

  // ---- Clipboard Image Paste (library tab only) ----
  document.addEventListener('paste', function(e) {
    var libraryPanel = document.getElementById('panel-library');
    if (!libraryPanel || !libraryPanel.classList.contains('active')) return;
    if (!isBackendConfigured()) return;

    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        var file = items[i].getAsFile();
        if (!file) continue;
        handleLibraryPaste(file);
        break;
      }
    }
  });

  function handleLibraryPaste(file) {
    var clientImageId = 'clip-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    var reader = new FileReader();
    reader.onload = function(ev) {
      var img = new Image();
      img.onload = function() {
        var MAX_DIM = 1200;
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (w > MAX_DIM || h > MAX_DIM) {
          var ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // Show immediate preview card in the masonry grid (non-clickable, no server ID yet)
        var previewItem = {
          type: 'image',
          r2_url: dataUrl,
          page_url: '',
          page_title: 'Clipboard paste',
          width: w,
          height: h,
          created_at: new Date().toISOString()
        };
        var cols = document.querySelectorAll('.feed-masonry-col');
        if (cols.length) {
          var card = renderCard(previewItem).cloneNode(true); // cloneNode strips event listeners (no broken modal)
          card.style.cursor = 'default';
          cols[0].insertBefore(card, cols[0].firstChild);
        }

        // Upload via background worker (has machine_id)
        chrome.runtime.sendMessage({
          action: 'paste-image',
          clientImageId: clientImageId,
          base64: dataUrl,
          mimeType: 'image/jpeg',
          width: w,
          height: h
        }, function(resp) {
          if (!resp || !resp.ok) {
            showToast('Failed to save image');
          }
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ---- Init ----
  initModal();
  loadConfig(function() {
    var saved = localStorage.getItem(TAB_KEY) || 'library';
    switchTab(saved);
  });
})();
