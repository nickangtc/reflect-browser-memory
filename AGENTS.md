# Reflect agent instructions

Read `CLAUDE.md` for the repository architecture, current scope, deployment constraints, and required checks. Its instructions apply to all coding agents despite the filename.

## Social Post Reflections

Before changing LinkedIn capture, social-post persistence, or any future consumer API, read [`docs/social-post-reflections/README.md`](docs/social-post-reflections/README.md) completely.

Preserve these boundaries:

- Reflect captures explicit, user-confirmed raw evidence; it does not grade posts or maintain content-strategy hypotheses.
- LinkedIn behavior must remain user-triggered. Never add passive feed capture, bulk crawling, engagement automation, stealth, or account-evasion behavior.
- Keep LinkedIn parsing isolated from the general `content.js`.
- Preserve `published_at` (original post time) separately from each snapshot's `observed_at`.
- One canonical post may have many snapshots and reflections.
- Future external consumers must use a versioned API contract rather than depend directly on PostgreSQL tables.
- Do not commit API keys, Railway credentials, database URLs, or other secrets.
