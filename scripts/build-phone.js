'use strict';
/* Builds the phone edition into ./site (what GitHub Pages publishes). Usage: node scripts/build-phone.js [path/to/jobs.json]
 * The result is a static site: the app runs entirely in the browser and keeps its data in the phone's own storage. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..'), out = path.join(root, 'site'), P = (...a) => path.join(root, ...a);
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });

(async () => {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

  // 1. Photos the family added (public/photos/<topic>/*.jpg + credits.json) → a manifest the engine uses in place of the server's folder scan.
  const photoDir = P('public', 'photos'), manifest = { dirs: {}, credits: null };
  if (fs.existsSync(photoDir)) {
    for (const d of fs.readdirSync(photoDir, { withFileTypes: true })) if (d.isDirectory()) manifest.dirs[d.name] = fs.readdirSync(path.join(photoDir, d.name)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    try { manifest.credits = JSON.parse(fs.readFileSync(path.join(photoDir, 'credits.json'), 'utf8')); } catch (_) { /* optional */ }
  }
  fs.writeFileSync(P('phone', 'photos-manifest.json'), JSON.stringify(manifest));

  // pdf-parse picks its bundled pdf.js build with a dynamic require; pin it to the one we use so only that build is bundled.
  fs.mkdirSync(P('phone', '.generated'), { recursive: true });
  const pdfSrc = fs.readFileSync(P('node_modules', 'pdf-parse', 'lib', 'pdf-parse.js'), 'utf8').replace('require(`./pdf.js/${options.version}/build/pdf.js`)', "require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')").replace('ret.version = PDFJS.version;', 'ret.version = PDFJS.version; if (globalThis.__KJ_PDF_WORKER_SRC) PDFJS.workerSrc = globalThis.__KJ_PDF_WORKER_SRC;');
  fs.writeFileSync(P('phone', '.generated', 'pdf-parse.js'), pdfSrc);

  // 2. The engine: the real server modules, bundled for the browser with browser stand-ins for Node's fs/crypto/sqlite.
  const sh = (f) => P('phone', 'shims', f);
  await esbuild.build({
    entryPoints: [P('phone', 'engine.js')], outfile: path.join(out, 'engine.js'), bundle: true, format: 'iife', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'none', logLevel: 'warning',
    inject: [sh('globals.js')], define: { __dirname: '"/app/server"', __filename: '"/app/server/index.js"', 'process.env.NODE_ENV': '"phone"' }, loader: { '.json': 'json' },
    alias: { 'node:fs': sh('fs.js'), fs: sh('fs.js'), 'node:path': 'path-browserify', path: 'path-browserify', 'node:crypto': sh('crypto.js'), crypto: sh('crypto.js'), 'node:sqlite': sh('sqlite.js'),
      'node:http': sh('empty.js'), http: sh('empty.js'), 'node:https': sh('empty.js'), https: sh('empty.js'), 'node:net': sh('empty.js'), net: sh('empty.js'), 'node:dns': sh('empty.js'), dns: sh('empty.js'), 'web-push': sh('empty.js'),
      url: sh('empty.js'), zlib: sh('empty.js'), stream: sh('empty.js'), canvas: sh('empty.js'), util: sh('empty.js'), os: sh('empty.js'), events: sh('empty.js'), 'pdf-parse/lib/pdf-parse.js': P('phone', '.generated', 'pdf-parse.js') },
  });
  fs.copyFileSync(P('node_modules', 'pdf-parse', 'lib', 'pdf.js', 'v1.10.100', 'build', 'pdf.worker.js'), path.join(out, 'pdf.worker.js')); // PDF reading helper, loaded on first PDF upload
  fs.copyFileSync(P('node_modules', 'sql.js', 'dist', 'sql-wasm-browser.wasm'), path.join(out, 'sql-wasm-browser.wasm'));

  // 3. The app itself (the same files the server edition serves).
  for (const d of ['css', 'js', 'icons']) copy(P('public', d), path.join(out, d));
  if (fs.existsSync(photoDir)) copy(photoDir, path.join(out, 'photos'));
  fs.copyFileSync(P('public', 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
  fs.mkdirSync(path.join(out, 'shared')); for (const f of fs.readdirSync(P('shared'))) if (f.endsWith('.js')) fs.copyFileSync(P('shared', f), path.join(out, 'shared', f));

  // 4. jobs.json — public job listings only (refreshed by the GitHub workflow). Never fabricated: without one the app says the list isn't published yet.
  const jobsArg = process.argv[2]; if (jobsArg && fs.existsSync(jobsArg)) fs.copyFileSync(jobsArg, path.join(out, 'jobs.json'));

  // 5. index.html: mark it as the phone edition, load the shim first, and add a content-security policy (GitHub Pages sets no headers).
  let html = fs.readFileSync(P('public', 'index.html'), 'utf8');
  const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.pexels.com; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'";
  html = html.replace('<meta name="color-scheme"', `<meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="kj-edition" content="phone">\n  <meta name="color-scheme"`).replace('<script src="shared/match.js">', '<script src="js/phone-boot.js"></script>\n  <script src="shared/match.js">');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, '404.html'), html);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  // 6. Service worker: opens instantly and works offline; the job list is always fetched fresh when online.
  const version = crypto.createHash('sha1').update(fs.readdirSync(out).join() + Date.now()).digest('hex').slice(0, 10);
  fs.writeFileSync(path.join(out, 'sw.js'), `const V='kj-${version}';
self.addEventListener('install',(e)=>{self.skipWaiting();});
self.addEventListener('activate',(e)=>{e.waitUntil(caches.keys().then((ks)=>Promise.all(ks.filter((k)=>k!==V).map((k)=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',(e)=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;
  const fresh=u.pathname.endsWith('/jobs.json');
  e.respondWith((async()=>{const c=await caches.open(V);
    if(fresh){try{const n=await fetch(r);if(n.ok)c.put(r,n.clone());return n;}catch(_){const h=await c.match(r);if(h)return h;throw _;}}
    const hit=await c.match(r);const net=fetch(r).then((n)=>{if(n.ok)c.put(r,n.clone());return n;}).catch(()=>null);
    return hit||(await net)||new Response('Offline',{status:503});})());});
`);
  const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB';
  console.log(`Built ${out}: engine.js ${size('engine.js')}, jobs.json ${fs.existsSync(path.join(out, 'jobs.json')) ? size('jobs.json') : 'not included'}`);
})().catch((e) => { console.error(e); process.exit(1); });
