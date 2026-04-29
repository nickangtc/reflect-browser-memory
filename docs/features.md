# Reflect — Current Feature Scope

This document reflects the public scope of Reflect after removing privacy-sensitive and legacy features.

## Kept

- Text highlighting
- Highlight keyboard shortcut
- Adaptive highlight styling
- Highlight annotations, tooltips, editing, and deletion
- Nearby image capture for highlights
- Optional Cloudflare R2 image/attachment storage
- Standalone notes with pasted/dragged image attachments
- Read Later save/unsave and inbox management when backend sync is configured
- YouTube timestamp annotations
- YouTube annotation markers on the progress bar
- YouTube annotation editing/deletion
- YouTube watch reflections
- Narrow YouTube metadata needed to label annotation cards
- New tab dashboard with Library, Read, Activity, and Analytics tabs
- Masonry library, type filters, infinite scroll, activity sparkline, and Read Later preview
- Detail modals for articles/videos/content cards
- Public tokenized article/video sharing
- Optional Railway-hosted Express/PostgreSQL backend sync
- Local-first text highlight storage with retry queue for failed sync requests
- Machine ID and backend sync settings

## Removed from scope

- Read Later “found via” breadcrumbs
- Page-visit tracking
- SPA navigation tracking for visit history
- Browsing trails
- X/Twitter tracking
- X quote-tweet reason capture
- Copy for Agent on X
- LinkedIn tracking
- Social interaction “Why?” prompts
- YouTube value checkpoint / blocking
- Network/search request capture and sanitization
- Hosted backend review pages at `/library`, `/article`, and `/video`
- Processing pipeline endpoints (`/api/unprocessed`, `/api/mark-processed`)
- Obsidian sync helper
- Extension action keyboard shortcut
- Settings-page sync stats
