# Public Release Checklist

## Before publishing

- [ ] Publish the Railway template and add the real deploy button URL to `README.md`.
- [ ] Run a working-tree secret scan.
- [ ] Run a git-history secret scan, or publish from a clean-history repository.
- [ ] Smoke test the unpacked extension in Chrome.
- [ ] Smoke test a fresh Railway deployment with PostgreSQL.
- [ ] Confirm image/note attachment behavior with and without R2 configured.

## Manual smoke test

- Load unpacked extension.
- Create a local text highlight with sync disabled.
- Configure Railway backend sync and create a synced highlight.
- Save/unsave a page with Read Later.
- Open new-tab Library, Read, Activity, and Analytics tabs.
- Create and edit a YouTube timestamp annotation.
- Check the service worker console for errors.
