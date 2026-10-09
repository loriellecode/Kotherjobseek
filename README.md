# Kother — personalized, editorial job discovery

An Apple News–inspired feed that finds **real** current job listings through permitted APIs/feeds, matches them transparently
against a profile you control, and re-scans automatically whenever the profile changes. **Not deployed.**

Stack: Node ≥ 22.5 (built-in `node:sqlite`, no web framework) · vanilla JS client · SQLite · `web-push`, `pdf-parse`, `mammoth`, `jszip`.
No build step. **There is no email anywhere in the app** (alerts are in-app and optional web push only).

```bash
npm install
cp .env.example .env     # fill in the keys you have
npm start                # http://localhost:3000 → create the account
npm test                 # 70 tests (67 run, 3 live-provider checks skip without credentials)
```

## Setup checklist (nothing is simulated — missing keys mean no listings)
| Feature | Needed | Where |
|---|---|---|
| Adzuna jobs | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | https://developer.adzuna.com/signup |
| USAJOBS (federal) | `USAJOBS_API_KEY`, `USAJOBS_USER_EMAIL` | https://developer.usajobs.gov/apirequest/ |
| Employer career pages | `config/employer-feeds.json` (only sites whose terms + robots.txt allow it, publishing schema.org `JobPosting`) | see `config/employer-feeds.example.json` |
| Editorial photos | `PEXELS_API_KEY` | https://www.pexels.com/api/ |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
Secrets exist only in server environment variables. In `NODE_ENV=production` the server **refuses to start** if a provider base URL
is overridden (so test mocks can never feed the real app).

## Her profile
`config/initial-profile.json` seeds a new account with exactly what the family provided — four education items (Finance major;
Bachelor's in Business Management and Administration; Business Finance major; Master's in Special Education), each stored
**unverified with an explanation of what is unclear**, no school names, dates, exact degree titles, licenses or certifications —
plus her preferences ($27/hour minimum, North Stockton → Stockton → Lodi → Tracy → Manteca, California-wide OK). Matching treats
unverified education as *reported, not confirmed*: such jobs can't be a "Strong match" until she confirms, nothing is excluded for
an unclear credential, and a master's degree is **never** treated as a teaching credential or license. For an existing account:
`npm run seed -- her@email`.

## How it works
* **Profile** → per-record CRUD, numbered revisions. **Matching** (`shared/match.js`): separate qualification / salary / location /
  overall indicators; mandatory vs preferred; missing data = *unknown*, never *unmet*; an unmet *required* credential → "Additional
  qualifications may be needed" (not excluded). Overall score is an alignment estimate, never a hiring probability.
* **Résumé** (PDF/DOCX only): validated by extension + file signature + structure (not the browser's content type), 5 MB cap,
  zip-bomb guard, stored privately under random names, owner-only download, deleted from disk on removal/replace. Text is read
  locally (no external AI). Analysis only **proposes** entries — each is accepted, edited or rejected by the user; *stated* items are
  separated from *inferred* suggestions (with the sentence they came from); conflicts with existing records require an explicit
  choice (verified records are never silently overwritten); quick-accepting a credential records it **unverified**.
* **Career expansion** (`server/careers.js`, `server/occupations.js`): a curated occupation list with explicit evidence rules.
  A suggestion needs ≥2 kinds of evidence (work history, title, skill, education, industry) or a standard degree pathway; keyword
  overlap alone never qualifies. Each shows evidence, transferable skills, known/unknown/unmet requirements, licensing cautions, pay
  and geography **from real current listings only**, and include/exclude controls. Accepted résumé items trigger a broader search.
* **Pipeline**: debounced task queue (stages persisted; interrupted tasks are re-queued after a restart), provider daily budgets,
  repeat-search suppression, dedupe, stale/expired handling, scheduler, in-app notifications with duplicate prevention, optional push.

## Verification status (honest)
| Area | Status |
|---|---|
| Matching, pipeline, profile, résumé, careers, security, scheduler | Automated tests (70) + 41 browser checks |
| Adzuna / USAJOBS adapters | Tested against **local mocks shaped from public documentation excerpts**. The official docs sites were unreachable from the build sandbox, so field names and Adzuna's `distance` unit (km) are **unverified against the live API** |
| Live provider calls | **Not run** — no credentials. `test/live.providers.test.js` runs them when `LIVE_PROVIDER_TESTS=1` and keys are set (skipped, not passed, otherwise) |
| Web push delivery to real devices | **Not tested** (only to a local HTTPS stand-in) |
| Pexels | Mock only; attribution + fallback behaviour tested |

## Known limitations / security notes
* PDF parsing runs in-process with `pdf-parse` (old pdf.js). A hostile PDF could still burn CPU; for a public deployment move
  extraction to a sandboxed worker. (A real bug — random failures and cross-document text from Node's shared Buffer pool — was found and fixed; regression-tested.)
* `npm audit`: 3 moderate findings via `mammoth → argparse → sprintf-js` (ReDoS in a transitive dependency; low exposure here).
* `node:sqlite` is still flagged experimental in Node 22. Sessions/CSRF protection rely on SameSite=Lax cookies + same-origin checks (no CSRF tokens). Login rate-limiting is in-memory (per process).
* No email means **no password-reset email**: use `npm run reset-password -- email 'new password'`.
* Single instance only (worker + scheduler are in-process); SQLite and résumé files need a **persistent disk**.

## Tests
`npm test` · browser checks: `node test/e2e/dev-server.js` (mock providers, fictional data), then `node test/e2e/ui.e2e.js` (needs `playwright`).
