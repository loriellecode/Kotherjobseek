'use strict';
/* One-command local run: `npm run local` starts the app on this computer and opens it in the browser.
 * Everything stays on this machine (database in ./data). Nothing is uploaded anywhere. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const port = process.env.PORT || '3000';
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'index.js')], { stdio: 'inherit', env: Object.assign({}, process.env, { PORT: port, HOST: process.env.HOST || '127.0.0.1' }) });
const url = `http://localhost:${port}`;
setTimeout(() => {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => console.log(`Open ${url} in your browser.`)).unref(); } catch (_) { console.log(`Open ${url} in your browser.`); }
}, 1800);
process.on('SIGINT', () => { child.kill('SIGINT'); process.exit(0); });
