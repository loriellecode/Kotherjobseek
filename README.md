# Kother — personalized, editorial job discovery

An Apple News–inspired feed that finds **real** current job listings through permitted APIs/feeds, matches them
transparently against a profile you control, and re-scans automatically whenever the profile changes.

Stack: Node ≥ 22.5 (built-in `node:sqlite`, no framework) · vanilla JS client · SQLite · `nodemailer`, `web-push`,
`pdf-parse`, `mammoth`. No build step.

```bash
npm install
cp .env.example .env      # fill in the keys you have; everything is optional except PUBLIC_URL in production
npm start                 # http://localhost:3000  → create your account
npm test                  # 17 backend tests (use local mock servers; nothing real is contacted)
```

## What you must configure (nothing here is simulated)

| Feature | Needed | Where to get it |
|---|---|---|
| Adzuna jobs | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | https://developer.adzuna.com/signup |
| USAJOBS (federal jobs in/near Stockton) | `USAJOBS_API_KEY`, `USAJOBS_USER_EMAIL` | https://developer.usajobs.gov/apirequest/ |
| Employer career pages (school districts, county, etc.) | `config/employer-feeds.json` | Only list pages that publish schema.org `JobPosting` data **and** whose terms/robots.txt allow automated reading |
| Editorial photos | `PEXELS_API_KEY` | https://www.pexels.com/api/ |
| Email alerts | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | any SMTP provider |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |

Settings → *Job sources* shows exactly which keys are missing and the setup steps. With no source configured the feed is
empty and says so; you can still import a JSON file of real postings. **Secrets live only in server environment
variables** (`.env` is git-ignored); the browser never receives them.

## How it works

1. **Profile** (education, experience, skills, credentials, résumé, preferences) is stored per user in SQLite. Records are
   created/edited/deleted individually; each change writes a numbered **profile revision**.
2. **Rescan pipeline** (`server/pipeline.js`): a meaningful change queues one task (edits within `RESCAN_DEBOUNCE_MS` are
   merged). Education/experience/skills/credentials/titles → full search + rematch; location → search new locations +
   rematch; salary/types → rematch only; notification settings → nothing. Stages are persisted
   (`queued → searching → matching → updating → done | failed`) and the UI shows them — "done" is written only after the work finishes.
   A failed search keeps all existing results and offers Retry.
3. **Sources** (`server/providers/`): Adzuna, USAJOBS, JSON-LD employer pages. Add a source by writing one module and
   listing it in `providers/index.js`. Per-provider daily request budgets; repeated identical searches are skipped
   within `MIN_REPEAT_SEARCH_MINUTES`. Only job titles, categories and city names are ever sent to a source.
4. **Normalize + dedupe** (`normalize.js`, `jobs.js`): provider id, application URL, then title/employer/city. Re-runs
   refresh a listing instead of duplicating it; cross-provider duplicates become one job with an "also listed by" list.
   Requirements found only in free text are flagged *detected from description*; unknown fields stay unknown.
5. **Matching** (`shared/match.js`): separate **qualification**, **salary**, **location** and **overall** indicators.
   Mandatory vs preferred requirements are scored separately; an unmet *required* credential/degree/experience moves a job to
   "Additional qualifications may be needed" (it is not a small penalty). Missing profile data is *unknown*, never *unmet*.
   Overall relevance is an alignment estimate, not a hiring probability (the formula is shown on each job).
6. **Lifecycle**: a listing is "verified" only if a provider returned it within `VERIFIED_WITHIN_DAYS`; not seen for
   `STALE_AFTER_DAYS` → "may have closed"; past its deadline → expired and removed from the default feed.
7. **Scheduler + alerts**: every `SCAN_INTERVAL_HOURS` per user, even when the app is closed. In-app notifications always
   record; email/push respect quiet hours, immediate/daily/weekly settings and categories. A unique key per
   (user, kind, job) prevents repeat notifications.
8. **Tracking**: save / dismiss / report / applied with date, status, interviews, employer response, notes, closed reason.
   Nothing is ever submitted for you.
9. **Imagery**: Pexels photos illustrate topics (finance, education, remote work, …) with required attribution; they are
   never presented as a picture of an employer. Job cards use a permitted employer logo only if a source supplies one,
   otherwise a typographic placeholder. Broken images disappear gracefully.

## Security & privacy
Scrypt password hashing, HttpOnly/SameSite sessions, same-origin check on writes, login rate limiting, strict CSP, input
validation, résumé uploads (type + magic-byte checks, 5 MB cap, random private filenames, owner-only access). You can delete
your résumé, your profile data, or your whole account (Profile page).

## Deploying
* Needs a Node host with a **persistent disk** (SQLite + résumé files in `DATA_DIR`) — not a stateless serverless runtime.
* Put it behind HTTPS (reverse proxy), set `PUBLIC_URL=https://…`, `TRUST_PROXY=true`, then `ALLOW_SIGNUP=false` after you create your account.
* Run one instance (the scheduler/worker run in-process). Back up `DATA_DIR`.
* Web push requires HTTPS and must be tested on your own devices after deploy.

## Tests
`npm test` covers scenarios A–M plus security checks against mock sources. Browser checks live in `test/e2e/`
(`npm i -D playwright`, run `node test/e2e/dev-server.js`, then `node test/e2e/ui.e2e.js`).
