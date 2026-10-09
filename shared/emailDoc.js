/* Email document model shared by server and browser.
 * An email body is a list of blocks — {type:'p', runs:[{t, b?}]} or {type:'ul', items:[runs[]]} — so formatting is DATA, never Markdown.
 * It is rendered to: editor/clipboard HTML (bold = <strong>), plain text (no markup characters), a mailto: link, and an .eml draft file. */
(function (root) {
  'use strict';
  const KJ = (root.KJ = root.KJ || {});
  const SB = '', EB = ''; // bold start / end sentinels used by text transforms

  const decode = (s) => s.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&');
  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Merge adjacent runs with the same weight, drop empties, strip any Markdown emphasis characters. */
  function normRuns(runs) {
    const out = [];
    for (const r of runs) {
      let t = String(r.t || '').replace(/\r/g, '');
      if (!t) continue;
      const last = out[out.length - 1];
      if (last && !!last.b === !!r.b) last.t += t; else out.push({ t, b: !!r.b });
    }
    return out;
  }
  /* Markdown guard: **x** / __x__ become real bold runs; stray emphasis markers never reach the email. */
  function mdToRuns(runs) {
    const out = [];
    for (const r of runs) {
      const parts = String(r.t || '').split(/(\*\*[^*\n]+\*\*|__[^_\n]+__)/);
      for (const p of parts) {
        if (/^(\*\*|__)[^]+(\*\*|__)$/.test(p) && p.length > 4) out.push({ t: p.slice(2, -2), b: true });
        else out.push({ t: p.replace(/\*\*|__/g, ''), b: !!r.b });
      }
    }
    return normRuns(out);
  }

  /* HTML (from the editor, the clipboard or an AI reply) -> blocks. Allows only p/div/br/strong/b/ul/ol/li. Everything else is dropped. */
  function htmlToBlocks(html) {
    const tokens = String(html || '').replace(/<!--[^]*?-->/g, '').replace(/<(script|style)[^]*?<\/\1>/gi, '').split(/(<[^>]*>)/);
    const blocks = []; let runs = [], bold = 0, list = null, item = null, listItems = null;
    const pushText = (t) => { if (!t) return; (item || runs).push({ t: decode(t), b: bold > 0 }); };
    const endPara = () => { const r = mdToRuns(runs); runs = []; if (r.length && r.some((x) => x.t.trim())) blocks.push({ type: 'p', runs: trimRuns(r) }); };
    const endItem = () => { if (item) { const r = mdToRuns(item); if (r.some((x) => x.t.trim())) listItems.push(trimRuns(r)); item = null; } };
    for (const tok of tokens) {
      if (tok[0] !== '<') { pushText(tok.replace(/\s*\n\s*/g, ' ')); continue; }
      const m = tok.match(/^<\s*(\/?)\s*([a-z0-9]+)/i); if (!m) continue; const close = !!m[1], tag = m[2].toLowerCase();
      if (tag === 'strong' || tag === 'b') bold += close ? (bold ? -1 : 0) : 1;
      else if (tag === 'br') { if (item) item.push({ t: ' ', b: false }); else runs.push({ t: '\n', b: false }); }
      else if (tag === 'p' || tag === 'div') { if (!item) endPara(); }
      else if (tag === 'ul' || tag === 'ol') { if (!close) { endPara(); listItems = []; list = tag; } else { endItem(); if (listItems && listItems.length) blocks.push({ type: 'ul', items: listItems }); listItems = null; list = null; } }
      else if (tag === 'li') { if (!close) { endItem(); item = []; } else endItem(); }
    }
    endItem(); endPara(); if (listItems && listItems.length) blocks.push({ type: 'ul', items: listItems });
    // a paragraph containing blank lines becomes separate paragraphs
    const out = [];
    for (const b of blocks) {
      if (b.type !== 'p') { out.push(b); continue; }
      let cur = []; for (const r of b.runs) { const segs = r.t.split(/\n{2,}/); segs.forEach((seg, i) => { if (i > 0) { out.push({ type: 'p', runs: trimRuns(normRuns(cur)) }); cur = []; } cur.push({ t: seg, b: r.b }); }); }
      out.push({ type: 'p', runs: trimRuns(normRuns(cur)) });
    }
    return out.filter((b) => b.type === 'ul' || b.runs.some((r) => r.t.trim()));
  }
  function trimRuns(runs) {
    const r = runs.map((x) => ({ t: x.t, b: x.b })); if (!r.length) return r;
    r[0].t = r[0].t.replace(/^[ \t\n]+/, ''); r[r.length - 1].t = r[r.length - 1].t.replace(/[ \t\n]+$/, '');
    return normRuns(r);
  }
  /* plain text (as typed into a textarea) -> blocks */
  function textToBlocks(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
      const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1 && lines.every((l) => /^[-•*]\s+/.test(l))) return { type: 'ul', items: lines.map((l) => mdToRuns([{ t: l.replace(/^[-•*]\s+/, '') }])) };
      return { type: 'p', runs: mdToRuns([{ t: lines.join('\n') }]) };
    });
  }

  const runsHtml = (runs) => runs.map((r) => { const t = escHtml(r.t).replace(/\n/g, '<br>'); return r.b ? `<strong>${t}</strong>` : t; }).join('');
  /* blocks -> HTML. opts.inline adds inline styles so formatting survives in email clients. */
  function blocksToHtml(blocks, opts) {
    opts = opts || {}; const ps = opts.inline ? ' style="margin:0 0 12px 0;"' : '', lis = opts.inline ? ' style="margin:0 0 4px 0;"' : '', uls = opts.inline ? ' style="margin:0 0 12px 22px;padding:0;"' : '';
    const body = blocks.map((b) => (b.type === 'ul' ? `<ul${uls}>${b.items.map((it) => `<li${lis}>${runsHtml(it)}</li>`).join('')}</ul>` : `<p${ps}>${runsHtml(b.runs)}</p>`)).join('');
    return opts.inline ? `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;color:#000000;">${body}</div>` : body;
  }
  const runsText = (runs) => runs.map((r) => r.t).join('');
  /* blocks -> plain text. Bold is simply dropped: no asterisks, underscores or other markup ever appears. */
  function blocksToText(blocks) {
    return blocks.map((b) => (b.type === 'ul' ? b.items.map((it) => '- ' + runsText(it)).join('\n') : runsText(b.runs))).join('\n\n').trim();
  }
  const hasBold = (blocks) => blocks.some((b) => (b.type === 'ul' ? b.items.some((it) => it.some((r) => r.b)) : b.runs.some((r) => r.b)));
  const boldRuns = (blocks) => blocks.flatMap((b) => (b.type === 'ul' ? b.items.flat() : b.runs)).filter((r) => r.b && r.t.trim());

  /* ---- validation / helpers ---- */
  const EMAIL_RE = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
  const emailValid = (a) => typeof a === 'string' && a.length <= 254 && EMAIL_RE.test(a.trim()) && !/\.\./.test(a);
  const findPlaceholders = (text) => [...new Set((String(text).match(/\[[^\]\n]{2,70}\]/g) || []))];

  function mailtoUrl(o) {
    const text = String(o.text || '').replace(/\r?\n/g, '\r\n');
    const q = [`subject=${encodeURIComponent(o.subject || '')}`, `body=${encodeURIComponent(text)}`].join('&');
    const url = `mailto:${String(o.to || '').trim().replace(/[\r\n<>"]/g, '')}?${q}`;
    return { url, tooLong: url.length > 1900 };
  }
  const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))));
  const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
  const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
  /* A draft .eml (X-Unsent: 1) opens as an unsent message in Outlook / Apple Mail with bold intact. Nothing is sent. */
  function buildEml(o) {
    const boundary = '----=_Kother_' + Math.random().toString(36).slice(2, 12), crlf = '\r\n';
    const head = ['X-Unsent: 1', o.to ? `To: ${String(o.to).replace(/[\r\n]/g, '')}` : null, `Subject: ${encWord(String(o.subject || '').replace(/[\r\n]/g, ' '))}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`].filter(Boolean).join(crlf);
    const part = (type, content) => [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(content))].join(crlf);
    return head + crlf + crlf + part('text/plain', String(o.text || '').replace(/\r?\n/g, crlf)) + crlf + part('text/html', `<html><body>${o.html || ''}</body></html>`) + crlf + `--${boundary}--` + crlf;
  }

  Object.assign(KJ, { email: { SB, EB, normRuns, mdToRuns, htmlToBlocks, textToBlocks, blocksToHtml, blocksToText, hasBold, boldRuns, runsText, emailValid, findPlaceholders, mailtoUrl, buildEml, escHtml, trimRuns } });
  if (typeof module !== 'undefined') module.exports = KJ;
})(typeof window !== 'undefined' ? window : globalThis);
