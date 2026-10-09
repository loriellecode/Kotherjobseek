/* Job Email Assistant (client). The user always previews, edits and approves; nothing is ever sent by Kother.
 * Output paths: formatted copy (HTML + plain on the clipboard), plain-text copy, mailto: (plain text only), and an unsent .eml draft. */
(function () {
  'use strict';
  const KJ = window.KJ, A = KJ.A, { esc, icon } = A, E = KJ.email;
  const st = { jobId: null, tab: 'formatted', prev: null, timer: null, review: null, serverWarnings: [], changes: [], busy: false, caps: null };
  const $ = (id) => document.getElementById(id);

  A.emailCaps = async () => { if (!st.caps) { try { st.caps = await A.api('GET', '/api/email/capabilities'); } catch (_) { st.caps = { ai: { configured: false }, sends: false }; } } return st.caps; };
  const job = () => A.job(st.jobId);
  const fields = () => ({ to: ($('em-to') || {}).value || '', subject: ($('em-subject') || {}).value || '', html: ($('em-body') || {}).innerHTML || '', notes: ($('em-notes') || {}).value || '' });
  const blocks = () => E.htmlToBlocks(fields().html);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  /* ---------- panel on the job page ---------- */
  A.emailPanel = function (j) {
    const ea = j.emailApply; if (!ea || !(ea.address || ea.mentionsEmail || ea.candidate)) return '';
    const high = !!(ea.address && ea.confidence === 'high');
    return `<section class="panel emailpanel"><h2>Apply by email</h2>
      ${ea.instructions ? `<p class="quote">“${esc(ea.instructions)}”</p><p class="note" style="margin-top:0">From the listing text.</p>` : ''}
      ${high ? `<p style="margin:8px 0">Send to <b>${esc(ea.address)}</b></p>${ea.freeMail ? `<p class="linknote caution">${icon('alert')}<span>This address is a personal email account (not an organization’s). Make sure the posting is legitimate before sending personal details.</span></p>` : ''}`
        : ea.candidate ? `<p class="linknote caution">${icon('alert')}<span>The listing contains <b>${esc(ea.candidate)}</b>, but it doesn’t say that’s where applications go. Check the posting before using it.</span></p>` : `<p class="linknote caution">${icon('alert')}<span>The listing mentions applying by email, but no address was found. Enter the address from the original posting.</span></p>`}
      ${ea.wantsResume ? `<p class="note">The listing asks for a résumé — you’ll need to attach it yourself.</p>` : ''}${ea.wantsCoverLetter ? '<p class="note">It also asks for a cover letter.</p>' : ''}${ea.requiredSubject ? `<p class="note">Requested subject line: <b>${esc(ea.requiredSubject)}</b> (used automatically).</p>` : ''}
      <div class="actions"><button class="btn primary" data-action="email-open" data-id="${j.id}">${icon('mail')} ${high ? 'Email to Apply' : 'Prepare an email'}</button></div>
      <p class="note">Kother helps you write the email. It never sends anything — you review it and send it yourself.</p></section>`;
  };

  /* ---------- assistant ---------- */
  A.openEmailAssistant = async function (jobId, opts) {
    opts = opts || {}; st.jobId = Number(jobId); st.prev = null; st.changes = []; st.serverWarnings = []; st.tab = 'formatted';
    const j = job(), caps = await A.emailCaps(), ea = j.emailApply || {};
    let d = null; try { d = (await A.api('GET', `/api/email/drafts/${j.id}`)).draft; } catch (_) { /* offline: start fresh */ }
    const aiOn = caps.ai.configured && localStorage.getItem('kj.emailAi') === '1', resume = A.S.resume && A.S.resume.resume;
    A.openModal(`<div class="em"><h2 id="mt">Email assistant</h2><p class="sub">${esc(j.title)} — ${esc(j.employer)}. Kother never sends email: you review it, then send it yourself.</p>
      ${ea.instructions ? `<details class="how" open><summary>What the listing says about applying</summary><p class="quote">“${esc(ea.instructions)}”</p></details>` : ''}
      <div class="em-grid"><div class="em-form">
        <div class="field"><label for="em-to">To</label><input id="em-to" type="email" inputmode="email" autocomplete="off" placeholder="recipient@employer.org" value="${esc(d ? d.to : ea.address || '')}"><span class="note" id="em-to-note"></span></div>
        <div class="field"><label for="em-subject">Subject</label><input id="em-subject" value="${esc(d ? d.subject : ea.requiredSubject || '')}" placeholder="Application for ${esc(j.title)}"></div>
        <div class="field"><span id="em-msg-l">Message</span><div class="em-toolbar" role="toolbar" aria-label="Formatting"><button type="button" class="tb" data-action="em-bold" aria-label="Bold (Ctrl+B)" title="Bold (Ctrl/Cmd+B)"><b>B</b></button><span class="note">Use bold sparingly — one or two key details.</span></div>
          <div id="em-body" class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="em-msg-l" spellcheck="true">${d ? d.html : ''}</div></div>
        <div class="field"><label for="em-notes">Anything specific to mention (optional)</label><textarea id="em-notes" placeholder="e.g. I’m available weekdays after 3 pm">${esc(d ? d.notes : '')}</textarea></div>
      </div><div class="em-side">
        <div class="em-actions" role="group" aria-label="Writing help">
          <button class="btn" data-action="em-run" data-act="write">${icon('pencil')} Write an email for me</button><button class="btn" data-action="em-run" data-act="grammar">Correct grammar and punctuation</button>
          <button class="btn" data-action="em-run" data-act="professional">Make this sound more professional</button><button class="btn" data-action="em-run" data-act="shorter">Make it shorter and clearer</button>
          <button class="btn" data-action="em-run" data-act="tailor">Tailor it to this job</button><button class="btn" data-action="em-run" data-act="followup">Write a polite follow-up email</button></div>
        ${caps.ai.configured ? `<label class="check aiswitch"><input type="checkbox" id="em-ai" ${aiOn ? 'checked' : ''}> Use AI to write and polish (optional)</label><details class="how"><summary>What gets sent if I turn AI on?</summary><p class="note">${esc(caps.ai.disclosure)}</p></details>` : '<p class="note">Using Kother’s built-in editor. (AI writing isn’t set up on this server; the built-in editor fixes grammar, tone and structure and drafts from your confirmed profile.)</p>'}
        <div id="em-status" class="em-status" role="status" aria-live="polite"></div><div id="em-warnings"></div>
        <div class="em-tabs" role="tablist"><button role="tab" data-action="em-tab" data-tab="formatted" aria-selected="true" id="tab-f">Preview</button><button role="tab" data-action="em-tab" data-tab="plain" aria-selected="false" id="tab-p">Plain text</button></div>
        <div id="em-preview" class="em-preview" aria-live="off"></div>
      </div></div>
      <div class="em-send"><h3 class="used-h">Before you send</h3><ul class="em-check"><li>Read it through and make any changes you like.</li><li id="ck-ph">Fill in anything shown in [square brackets].</li>
        ${ea.wantsResume ? `<li><b>Attach your résumé.</b> This listing asks for it — Kother can’t attach files. ${resume ? `<a href="/api/resume/file" download>Download your résumé</a>` : '<a href="#/profile" data-action="close-modal">Upload a résumé in your profile first</a>'}</li>` : ''}${ea.wantsCoverLetter ? '<li><b>Attach your cover letter</b> (requested in the listing).</li>' : ''}</ul>
        <div class="em-buttons"><button class="btn primary" data-action="em-copy">${icon('copy')} Copy email</button><button class="btn" data-action="em-copy-text">Copy as plain text</button><a class="btn" id="em-mailto" href="mailto:" data-action="em-mailto">${icon('mail')} Open in email app</a><button class="btn" data-action="em-eml">Download draft (.eml)</button></div>
        <details class="how"><summary>How formatting is handled</summary><p class="note"><b>Copy email</b> puts the formatted version on your clipboard, so bold survives when you paste into the body of Gmail, Outlook, Apple Mail and most email apps. <b>Open in email app</b> uses a <code>mailto:</code> link, which can only carry plain text — bold can’t pass through it, so the plain-text version is used (no symbols like ** appear). <b>Download draft (.eml)</b> opens as an unsent message with bold in Outlook and Apple Mail; Gmail on the web can’t open .eml files. Kother never attaches files or sends anything.</p></details>
        <div class="em-foot"><button class="btn quiet sm" data-action="em-undo" id="em-undo" disabled>Undo last change</button><button class="btn quiet sm danger" data-action="em-delete-draft">Delete saved draft</button><button class="btn" data-action="close-modal">Close</button></div></div></div>`);
    const body = $('em-body'); body.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
    for (const id of ['em-to', 'em-subject', 'em-notes']) $(id).addEventListener('input', onEdit); body.addEventListener('input', onEdit);
    if ($('em-ai')) $('em-ai').addEventListener('change', (e) => localStorage.setItem('kj.emailAi', e.target.checked ? '1' : '0'));
    refresh(); if (opts.autoAction) run(opts.autoAction);
  };

  function onEdit() { refresh(); clearTimeout(st.timer); st.timer = setTimeout(() => { save(); liveReview(); }, 700); }
  async function save() { if (!st.jobId || !$('em-body')) return; try { await A.api('PUT', `/api/email/drafts/${st.jobId}`, fields()); const s = $('em-status'); if (s && !st.busy) s.textContent = 'Draft saved privately to your account.'; } catch (_) { const s = $('em-status'); if (s) s.textContent = 'Couldn’t save the draft (offline?). Your text is still here.'; } }
  async function liveReview() { if (!$('em-body')) return; try { const f = fields(); const r = await A.api('POST', '/api/email/draft', Object.assign({ jobId: st.jobId, action: 'review' }, f)); st.serverWarnings = r.warnings; renderWarnings(); } catch (_) { /* ignore */ } }

  function renderWarnings() {
    const el = $('em-warnings'); if (!el) return; const f = fields(); const w = st.serverWarnings.slice();
    el.innerHTML = w.map((x) => `<p class="em-warn ${x.level}">${icon(x.level === 'info' ? 'info' : 'alert')}<span>${esc(x.msg)}</span></p>`).join('');
    const ph = E.findPlaceholders(E.blocksToText(blocks())); const ck = $('ck-ph'); if (ck) ck.classList.toggle('open', ph.length > 0);
    const note = $('em-to-note'); if (note) note.textContent = f.to && !E.emailValid(f.to) ? 'This doesn’t look like a valid email address.' : '';
    const to = $('em-to'); if (to) to.setAttribute('aria-invalid', f.to && !E.emailValid(f.to) ? 'true' : 'false');
  }
  function refresh() {
    const f = fields(), b = blocks(), text = E.blocksToText(b), pv = $('em-preview'); if (!pv) return;
    pv.innerHTML = st.tab === 'plain' ? `<pre>${esc(`To: ${f.to || '(not set)'}\nSubject: ${f.subject}\n\n${text}`)}</pre>` : `<div class="em-sheet"><div class="em-hd"><span>To</span> ${esc(f.to || '—')}</div><div class="em-hd"><span>Subject</span> <b>${esc(f.subject || '—')}</b></div><div class="em-bd">${b.length ? E.blocksToHtml(b) : '<p class="note">Your message will appear here.</p>'}</div></div>`;
    const m = E.mailtoUrl({ to: f.to, subject: f.subject, text }), a = $('em-mailto'); if (a) { a.href = m.url; a.dataset.tooLong = m.tooLong ? '1' : ''; }
    renderWarnings();
  }

  async function run(action) {
    const caps = await A.emailCaps(), ai = !!($('em-ai') && $('em-ai').checked), f = fields(); st.busy = true; const s = $('em-status'); s.innerHTML = '<span class="spin"></span> Working…';
    document.querySelectorAll('.em-actions .btn').forEach((b) => (b.disabled = true));
    try {
      const r = await A.api('POST', '/api/email/draft', Object.assign({ jobId: st.jobId, action, useAi: ai && caps.ai.configured, consent: ai && caps.ai.configured }, f));
      st.prev = f; $('em-undo').disabled = false; $('em-body').innerHTML = r.html; $('em-subject').value = r.subject; st.serverWarnings = r.warnings; st.changes = r.changes;
      s.innerHTML = `<b>${r.mode === 'ai' ? 'AI-assisted' : 'Built-in editor'}:</b> ${esc(r.changes.join(' · '))}`; refresh(); save();
    } catch (e) { s.textContent = e.message; } finally { st.busy = false; document.querySelectorAll('.em-actions .btn').forEach((b) => (b.disabled = false)); }
  }

  /* ---------- output paths ---------- */
  function guardPlaceholders(what) { const ph = E.findPlaceholders(E.blocksToText(blocks())); return !ph.length || confirm(`This email still has placeholders: ${ph.join(', ')}.\n\n${what} anyway?`); }
  function status(msg) { const s = $('em-status'); if (s) s.textContent = msg; A.toast(msg); }
  async function copyFormatted() {
    const b = blocks(); if (!b.length) return status('There’s nothing to copy yet.'); if (!guardPlaceholders('Copy')) return;
    const html = E.blocksToHtml(b, { inline: true }), text = E.blocksToText(b);
    try { if (navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); return status('Copied with formatting. Paste it into the body of your email.'); } } catch (_) { /* fall through */ }
    try { const tmp = document.createElement('div'); tmp.innerHTML = html; tmp.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap'; document.body.appendChild(tmp); const r = document.createRange(); r.selectNodeContents(tmp); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); const ok = document.execCommand('copy'); sel.removeAllRanges(); tmp.remove(); if (ok) return status('Copied with formatting. Paste it into the body of your email.'); } catch (_) { /* fall through */ }
    try { await navigator.clipboard.writeText(text); status('Your browser can’t copy formatting here, so the plain-text version was copied (no bold). Use “Download draft (.eml)” to keep bold.'); } catch (_) { status('Copying isn’t available in this browser. Select the preview text and copy it manually.'); }
  }
  async function copyPlain() { const b = blocks(); if (!b.length) return status('There’s nothing to copy yet.'); if (!guardPlaceholders('Copy')) return; try { await navigator.clipboard.writeText(E.blocksToText(b)); status('Copied as plain text.'); } catch (_) { status('Copying isn’t available in this browser. Select the Plain text tab and copy it manually.'); } }
  function openMail(e) {
    const f = fields(); if (f.to && !E.emailValid(f.to)) { e.preventDefault(); return status('Fix the recipient address first — it doesn’t look valid.'); }
    if (!blocks().length) { e.preventDefault(); return status('Write or generate a message first.'); }
    if (!guardPlaceholders('Open your email app')) { e.preventDefault(); return; }
    const tooLong = $('em-mailto').dataset.tooLong === '1';
    setTimeout(() => status(tooLong ? 'Your email app may cut off a message this long. If it does, use “Copy email” instead.' : 'Opening your email app with the recipient, subject and plain-text message. Bold can’t pass through this link — use “Copy email” to keep it. Review, attach your résumé if asked, then send it yourself. If nothing opened, your device may not have an email app set up.'), 50);
  }
  function downloadEml() {
    const f = fields(), b = blocks(); if (!b.length) return status('Write or generate a message first.'); if (f.to && !E.emailValid(f.to)) return status('Fix the recipient address first.'); if (!guardPlaceholders('Download')) return;
    const eml = E.buildEml({ to: f.to, subject: f.subject, html: E.blocksToHtml(b, { inline: true }), text: E.blocksToText(b) }), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' })); a.download = `email-draft-${slug(job().employer)}-${slug(job().title)}.eml`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    status('Downloaded an unsent draft. Open it in Outlook or Apple Mail to keep the bold formatting, then review and send it yourself.');
  }

  /* ---------- delegated actions (called from main.js) ---------- */
  A.emailActions = {
    'em-run': (t) => run(t.dataset.act), 'em-bold': () => { $('em-body').focus(); document.execCommand('bold'); onEdit(); },
    'em-tab': (t) => { st.tab = t.dataset.tab; document.querySelectorAll('.em-tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t))); refresh(); },
    'em-copy': copyFormatted, 'em-copy-text': copyPlain, 'em-eml': downloadEml, 'em-mailto': openMail,
    'em-undo': () => { if (!st.prev) return; $('em-to').value = st.prev.to; $('em-subject').value = st.prev.subject; $('em-body').innerHTML = st.prev.html; $('em-notes').value = st.prev.notes; st.prev = null; $('em-undo').disabled = true; status('Undid the last change.'); refresh(); save(); },
    'em-delete-draft': async () => { if (!confirm('Delete the saved draft for this job?')) return; try { await A.api('DELETE', `/api/email/drafts/${st.jobId}`); } catch (_) { /* ignore */ } $('em-body').innerHTML = ''; $('em-notes').value = ''; refresh(); status('Draft deleted.'); },
  };
})();
