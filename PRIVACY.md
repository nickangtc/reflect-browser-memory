# Privacy

Reflect is designed as a narrow personal capture tool, not a browsing tracker.

## Stored locally by default

- Text highlights are saved to `chrome.storage.local` immediately.
- YouTube video IDs are saved locally after playback reaches the reflection point so repeat watches are not interrupted by another reflection prompt.
- Backend sync is disabled on fresh install until you enable it in settings.
- Watched-video memory is not synced as visit history. When backend sync is enabled, existing annotations may be queried to recognize a previously watched video.
- If sync is disabled or no backend URL/API key is configured, highlights remain local and are not sent to any server.

## Synced only when you configure a backend

When backend sync is enabled with your configured Railway backend URL and API key, Reflect can send:

- highlights and highlight annotations;
- nearby images captured for highlights;
- standalone notes and note images;
- Read Later URLs, titles, domains, and preview images;
- YouTube timestamp annotations;
- explicit LinkedIn post reflections, including the canonical post URL, sanitized capture-page path, author/profile information, embedded-post information, user-confirmed post content, media type and visible alt text, visible metrics, timestamps, and the user's written interpretation;
- a generated machine ID used to distinguish devices.

Image and note attachments require backend object storage such as Cloudflare R2. If it is not configured, attachment uploads fail instead of being sent elsewhere.

## Not captured

Reflect does not capture or sync:

- general page visit history;
- SPA navigation history;
- browsing trails or click graphs;
- LinkedIn feed content that the user did not explicitly select, review, and confirm;
- LinkedIn screenshots or social-post image files;
- network/search requests.

The LinkedIn selector reads the chosen card only after the user invokes it. It never likes, comments, reposts, follows, messages, or otherwise acts on LinkedIn.

## Backend configuration

The extension has no hosted backend configured by default. If you enable sync, you control the Railway backend URL and API key in the extension settings page.
