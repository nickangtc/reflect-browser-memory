# Social Post Reflections

## Purpose

This feature helps Nick build an evidence-grounded understanding of what earns engagement on social media, initially LinkedIn. It captures two different kinds of evidence:

- outcomes and interpretations from Nick's own posts;
- Nick's reactions to posts by other people, which may suggest patterns but cannot by themselves prove what works for Nick's audience.

The feature records raw, timestamped observations. It does not grade drafts, maintain hypotheses, or infer social strategy inside Reflect. Those derived workflows belong to separate consumers of the versioned evidence API.

## Design intent

Reflect is a deliberate memory tool, not a social tracker. Social-post capture therefore happens only after all of these user actions:

1. Nick invokes the LinkedIn post-selector command or popup action.
2. Nick selects one visible post card.
3. Reflect highlights and extracts that card.
4. Nick reviews and can correct the author, content, publication time, ownership, and metrics.
5. Nick writes an interpretation and confirms the save.

Reflect must never crawl the feed, capture posts in the background, enumerate profiles, automate engagement, or silently infer which post Nick meant.

## Why selection and confirmation exist

LinkedIn is a dynamic SPA. Feed cards are recycled, generated class names change, and reposts can contain nested post cards. A silent parser can easily attribute one post's content to another post's metrics.

Selection starts from the exact element Nick clicks. The adapter then looks for a semantic post identity (LinkedIn activity URN/permalink), author information, and the post action group. A capture without a unique identity is rejected. The confirmation form is the final correctness boundary.

Generated LinkedIn CSS classes may be used as fallbacks, but never as the only way to identify a post.

## Invocation and hotkey

The Manifest V3 command is `capture-linkedin-post`. Its suggested shortcut is:

- macOS: `Command+Shift+Y`
- other platforms: `Ctrl+Shift+Y`

Chrome shortcuts are user-configurable at `chrome://extensions/shortcuts`. The Reflect popup displays the currently assigned shortcut and links to that page. The popup action remains as a fallback.

## Distinguishing Nick's posts

Reflect does not guess from display names. The settings page stores Nick's canonical LinkedIn profile URL in `chrome.storage.local`. During extraction, Reflect normalizes the post author's `/in/...` or `/company/...` URL and compares it with the configured URL:

- exact match: preselect `own`;
- definite non-match: preselect `external`;
- missing configuration or author URL: preselect `unknown`.

Nick confirms or corrects this classification before every save. The profile URL is extension configuration, not a backend identity credential.

## Time model

Two times must remain separate:

- `published_at`: when LinkedIn says the original post was published;
- `observed_at`: when Nick recorded this particular observation and its visible metrics.

LinkedIn often renders publication time relatively. Reflect prefers a real `<time datetime>` value and otherwise derives the creation time from the numeric LinkedIn activity ID. It stores the raw visible timestamp and derivation source, and the confirmation form allows correction.

Capturing the same post later creates another snapshot rather than another canonical post. This is essential: an early result and a mature result are different evidence about the same post.

## Data model

Raw evidence is stored in Railway PostgreSQL:

- `social_posts`: canonical post identity, content, author, publication time, media metadata, and optional embedded post;
- `social_post_snapshots`: timestamped visible metrics, page surface, parser version, and extraction confidence;
- `social_post_reflections`: Nick's interpretation, ownership classification, perceived performance, and tags.

The unique canonical key is `(platform, platform_post_id)`. The unique delivery key is `(machine_id, client_capture_id)`, making background retries idempotent. Every snapshot also preserves the confirmed post fields observed with it, so a later collapsed or imperfect capture cannot erase prior evidence. Routine later captures only fill missing canonical fields; fields that Nick explicitly edits in the confirmation form carry correction provenance and may replace the canonical value.

Confirmed captures enter a durable local outbox before network delivery. The outbox is not capped or age-expired; acknowledged records are removed after Railway accepts them. Chrome's `unlimitedStorage` permission prevents a prolonged backend outage from silently exhausting the normal local-storage quota. Network errors, authentication/configuration problems, rate limits, and server errors remain pending. Permanent contract failures are marked failed instead of being retried forever. Reflect settings exposes every pending/failed capture with its error and explicit Retry and Discard actions.

The extension first writes each confirmed capture to a durable local outbox. The service worker drains that outbox immediately when possible and through a Chrome alarm after network or backend failures. A local item is removed only after the backend acknowledges its idempotent delivery; synchronized raw evidence then lives in PostgreSQL.

The extension sends one transactional payload to:

```http
POST /api/v1/social-post-captures
```

Contract version 1 is represented by `contract_version: 1`. Future consumers must use a versioned read contract rather than depending directly on PostgreSQL table details.

## Evidence limits

Visible engagement on someone else's post is incomplete evidence. Reflect frequently cannot see impressions, audience size, distribution history, or post age with certainty. Missing numbers are stored as `null`, never zero. User perception such as “doing well” is stored separately from extracted metrics.

External observations are useful for generating ideas and hypotheses. They should not be treated as equivalent to analytics from Nick's own posts.

## Privacy and safety

- No screenshots or image files are uploaded for this feature.
- Only media type, counts, and visible alt text are stored.
- No post is captured without explicit selection and confirmation.
- No likes, comments, reposts, messages, follows, or other LinkedIn actions are performed.
- No bulk crawling, profile enumeration, CAPTCHA handling, stealth, or anti-detection behavior is permitted.
- Backend sync uses the existing user-configured Reflect URL and API key.

## Code boundaries

- `linkedin-capture.js`: LinkedIn-only selection, extraction, confirmation, and reflection UI.
- `background-with-api.js`: command dispatch, local persistence, retry, and backend delivery.
- `backend/routes/social-posts.js`: validation and transactional persistence.
- `backend/init.sql` and migration 013: storage schema.

Do not add LinkedIn parsing to the general `content.js`. Keep platform-specific behavior isolated so LinkedIn DOM changes do not destabilize highlighting and YouTube features.

## Out of scope for the first version

- passive or automatic metric refreshes;
- injected controls on every feed card;
- screenshots and media-file storage;
- grading drafts or updating content hypotheses;
- agent-facing reads;
- platforms other than LinkedIn;
- automatic engagement of any kind.

## Manual acceptance cases

Test at least:

1. a normal text post in the feed;
2. a post detail view;
3. a post containing an image;
4. a video or document post;
5. a repost with embedded content;
6. Nick's own post with impressions;
7. an external post without impressions;
8. the same post captured twice at different times;
9. an ambiguous element that must be rejected;
10. backend unavailability followed by a retry.
