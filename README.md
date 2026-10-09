# Kother — editorial job discovery

An Apple News–inspired feed for browsing job opportunities. No build step, no dependencies:
open `index.html` in a browser (or `npx http-server .`).

- **Honest by design:** the app ships with *no* jobs. Import real postings (Settings → Import, JSON; see the
  template download) or preview with clearly labeled, fictional sample listings.
- **Personalized:** profile edits re-rank the feed (salary floor, locations, interests, remote, credentials).
  Choose "review changes first" in Notification Preferences to approve refreshes manually.
- **Local only:** profile, saved jobs and applications live in `localStorage` on this device.
- `js/match.js` holds the pure matching/feed logic; `js/store.js` persistence and import validation.
