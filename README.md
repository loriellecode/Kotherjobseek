# Jobgeek — personalized, editorial job discovery

An Apple News–inspired feed that finds **real** current job listings through permitted APIs/feeds, matches them transparently
against a profile you control, and re-scans automatically whenever the profile changes.
**Runs on your own computer (`npm run local`); it is not deployed to the internet** — see “Running it for one person” below.

Stack: Node ≥ 22.5 (built-in `node:sqlite`, no web framework) · vanilla JS client · SQLite · `web-push`, `pdf-parse`, `mammoth`, `jszip`.
No build step. **There is no email anywhere in the app** (alerts are in-app and optional web push only).

```bash
npm install
cp .env.example .env     # fill in the keys you have
npm start                # http://localhost:3000 → create the account
npm test                 # 73 tests run, 3 more live-provider checks skip without credentials
```

## Running it for one person (free, private, on her computer)
(The phone edition below is the easiest way. This section is the alternative: running the full server edition on a computer.)
1. Install Node 22.5 or newer (https://nodejs.org). 2. In this folder run `npm install` once. 3. Run `npm run local` — it starts the app and opens http://localhost:3000.
Her data (database and résumé files) stays in `./data` on that computer. To reach it from her phone on the same Wi-Fi, run `HOST=0.0.0.0 npm start` and open `http://<computer-ip>:3000` — only do this on a network you trust.
Live job listings still need free API keys in `.env` (Adzuna and/or USAJOBS); without keys the app opens but shows no listings.

## Phone edition on GitHub Pages (free; her data stays on her phone)
The app also builds as a static site that runs **entirely in the browser** — the same matching, trust checks, résumé reading, applications and email assistant, with data saved in the phone's own storage (IndexedDB). There is no server holding her profile, résumé, saved jobs or drafts, and nothing about her is ever sent anywhere. Address: **https://loriellecode.github.io/Kotherjobseek/**
Set-up (buttons on GitHub, once):
1. **Merge this branch into `main`** (open a pull request and merge it). GitHub only publishes Pages from `main` by default.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. (For live listings) **Settings → Secrets and variables → Actions → New repository secret**: `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free, https://developer.adzuna.com/signup) and/or `USAJOBS_API_KEY` + `USAJOBS_USER_EMAIL` (free, https://developer.usajobs.gov/apirequest/). Keys stay in GitHub Secrets and are never in the app.
4. **Actions → Publish app → Run workflow.** It runs the tests, fetches today's California listings, builds the app and publishes it. It repeats every morning to refresh the job list.
5. On her phone open the address, then **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android). The icon is the document-and-magnifier mark.
How it works: the daily GitHub job runs the real search for the starter profile (public job titles and California places — nothing personal) and publishes the listings as `jobs.json`. Her phone downloads that list and does the matching on the phone using *her* profile. Without keys the app still opens but shows no listings (it never invents any).
Honest limits of the phone edition: data lives in that one browser/phone (clearing site data or switching phones loses it — there is no cloud backup); no push notifications (alerts show in the app); no live "Re-check" page fetch (browsers block it; trust checks use the listing and link only); the job list updates once a day; and the Pexels key isn’t used — add free photos under `public/photos/` (see Photos) before publishing. `npm run build:phone` builds locally into `site/`; `node test/e2e/phone.e2e.js` is the browser check.

## Los Angeles-area suburbs
The starter profile also searches eight Los Angeles suburbs (Pasadena, Glendale, Burbank, Santa Clarita, Torrance, Long Beach, Santa Monica, Culver City). Editable under Profile → Location (“Also look in these areas”). Jobs there are shown **only** when the pay is listed and at least her minimum, and no required qualification is missing; otherwise they stay hidden. Everything is still California only.

## “Look for new jobs” on the phone
The published list holds the best ~2,100 matches in three ranked sets of 700. The phone shows one set at a time; each press of **Look for new jobs** swaps in the next set (jobs not shown yet; saved and applied jobs are kept). After the third set it starts over with the newest published list. The phone itself never searches live — new listings arrive when the list is refreshed (daily, once the Adzuna secrets are saved in GitHub).

## Photos
With a `PEXELS_API_KEY` the app uses Pexels photos (credited). Without one it uses **your own free photos**: put `.jpg`/`.png`/`.webp` files in `public/photos/<topic>/` (topics: `finance`, `business`, `education`, `special-education`, `workforce`, `banking`, `remote-work`, `workplace`, `professional-development`, `career-growth`) or `public/photos/any/` for all topics, and credit them in `public/photos/credits.json`: `{ "finance/desk.jpg": { "photographer": "Name", "url": "https://…" } }`. A starter set of 12 free-to-use Unsplash photos (generic office, classroom and finance scenes) is bundled in `public/photos/` and credited as “an Unsplash contributor” — replace or add to them any time. The app never shows a photo as a picture of a specific employer.

## Job trust statuses
Listings are not “verified/unverified”. Each gets one of five graded statuses with the reasons, evidence and time checked (open **Why this status** on a job): **Trusted source** (government/school/university site, the employer’s own careers feed, or an established job platform), **Application destination checked** (a recognised applicant-tracking system such as Workday, Greenhouse or Lever, or an address consistent with the employer), **Needs a closer look** (employer connection not confirmed — still shown), **High risk** (look-alike addresses, shorteners, IP/local hosts, sensitive-data requests — the apply action is hidden), **Blocked** (unsafe schemes, embedded credentials, upfront-payment requests — quarantined, not shown). Recognised names are evidence, not a pass, and nothing is ever described as guaranteed or fully verified.
* **Automated:** URL validation/normalisation, look-alike and impersonation patterns, listing-text patterns (fees, gift cards, Social Security/bank requests, private-messaging, implausible pay), expiry dates, support from other sources listing the same job, and — on **Re-check** — a guarded fetch of the application page (public addresses only, ≤3 re-validated redirects, 200 KB, text only, never executed).
* **Not done:** confirming the employer exists in a business registry, reputation services (e.g. Google Safe Browsing), and checking whether the employer’s own website lists the job. Set `TRUST_NETWORK_CHECKS=false` to disable live page checks.
* Jobgeek never submits an application or sends anything for you.

## Job Email Assistant
For listings that apply by email: write, correct, professionalise, shorten, tailor, and follow-up drafts from your *confirmed* profile only (placeholders for anything missing). It **never sends email** — copy it, open it in your email app (`mailto:`, plain text), or download an `.eml` draft. Optional AI wording needs `ANTHROPIC_API_KEY` (and per-request consent); without it the built-in editor is used. Not yet tested against the live Anthropic API.

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
plus her preferences ($28/hour minimum, $30/hour desired, North Stockton → Stockton → Lodi → Tracy → Manteca, California-wide OK). Matching treats
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

## Application-link safety and pay display
* Every application link is checked **before it is stored or shown** (`server/linkSafety.js`): https on the provider's own official domain, the employer's own careers domain, or a `.gov`/`.edu` site is *trusted*; Adzuna links are labelled as redirects; anything else is a *caution* — the Apply button becomes "Review link, then open" and a dialog shows the host plus anti-scam advice. Links with embedded credentials, raw IP/local hosts, URL shorteners or non-web schemes are **blocked** (never stored). This reduces risk; **no website can be certified safe** (a reputation service such as Google Safe Browsing could be added).
* Pay is shown both ways everywhere: posted figure first, then the equivalent (full-time = 2,080 h/yr), e.g. `$78,000–$92,000/yr · ≈ $37.50–$44.23/hr`.

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
