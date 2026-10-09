'use strict';
/* All configuration comes from environment variables (see .env.example). Secrets never leave the server. */
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no dependency). Real environment variables win.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch (_) { /* no .env */ }

const e = process.env;
const int = (v, d) => (v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : d);
const root = path.join(__dirname, '..');

/* Production safety: mock/stand-in provider endpoints are for automated tests only and must never serve the real app. */
if (e.NODE_ENV === 'production') {
  const official = { ADZUNA_BASE_URL: 'https://api.adzuna.com/v1/api', USAJOBS_BASE_URL: 'https://data.usajobs.gov/api', PEXELS_BASE_URL: 'https://api.pexels.com/v1' };
  for (const [k, v] of Object.entries(official)) if (e[k] && e[k] !== v) throw new Error(`${k} must not be overridden in production (found a non-official URL). Remove it from the environment.`);
}

module.exports = {
  root,
  port: int(e.PORT, 3000),
  dataDir: path.resolve(e.DATA_DIR || path.join(root, 'data')),
  publicUrl: e.PUBLIC_URL || `http://localhost:${int(e.PORT, 3000)}`,
  secureCookies: e.NODE_ENV === 'production' || /^https:/.test(e.PUBLIC_URL || ''),
  allowSignup: e.ALLOW_SIGNUP !== 'false',
  maxResumeBytes: int(e.MAX_RESUME_BYTES, 5 * 1024 * 1024),
  // pipeline
  debounceMs: int(e.RESCAN_DEBOUNCE_MS, 5000),
  scanIntervalHours: int(e.SCAN_INTERVAL_HOURS, 6),
  schedulerEnabled: e.SCHEDULER_ENABLED !== 'false',
  minRepeatSearchMinutes: int(e.MIN_REPEAT_SEARCH_MINUTES, 360),
  maxQueriesPerScan: int(e.MAX_QUERIES_PER_SCAN, 36),
  staleAfterDays: int(e.STALE_AFTER_DAYS, 14),
  verifiedWithinDays: int(e.VERIFIED_WITHIN_DAYS, 3),
  providers: {
    adzuna: { appId: e.ADZUNA_APP_ID, appKey: e.ADZUNA_APP_KEY, base: e.ADZUNA_BASE_URL || 'https://api.adzuna.com/v1/api', country: e.ADZUNA_COUNTRY || 'us', dailyBudget: int(e.ADZUNA_DAILY_BUDGET, 200) },
    usajobs: { key: e.USAJOBS_API_KEY, email: e.USAJOBS_USER_EMAIL, base: e.USAJOBS_BASE_URL || 'https://data.usajobs.gov/api', dailyBudget: int(e.USAJOBS_DAILY_BUDGET, 200) },
    feeds: { file: path.resolve(e.EMPLOYER_FEEDS_FILE || path.join(root, 'config', 'employer-feeds.json')), userAgent: e.FEED_USER_AGENT || 'KotherJobSearch/1.0', contact: e.FEED_CONTACT_URL || '' },
  },
  pexels: { key: e.PEXELS_API_KEY, base: e.PEXELS_BASE_URL || 'https://api.pexels.com/v1' },
  push: { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT || 'mailto:admin@example.com' },
};
