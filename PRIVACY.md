# Privacy

Reflect is designed as a narrow personal capture tool, not a browsing tracker.

## Stored locally by default

- Text highlights are saved to `chrome.storage.local` immediately.
- Backend sync is disabled on fresh install until you enable it in settings.
- If sync is disabled or no backend URL/API key is configured, highlights remain local and are not sent to any server.

## Synced only when you configure a backend

When backend sync is enabled with your configured Railway backend URL and API key, Reflect can send:

- highlights and highlight annotations;
- nearby images captured for highlights;
- standalone notes and note images;
- Read Later URLs, titles, domains, and preview images;
- YouTube timestamp annotations;
- a generated machine ID used to distinguish devices.

Image and note attachments require backend object storage such as Cloudflare R2. If it is not configured, attachment uploads fail instead of being sent elsewhere.

## Not captured

Reflect does not capture or sync:

- general page visit history;
- SPA navigation history;
- browsing trails or click graphs;
- network/search requests.

## Backend configuration

The extension has no hosted backend configured by default. If you enable sync, you control the Railway backend URL and API key in the extension settings page.
