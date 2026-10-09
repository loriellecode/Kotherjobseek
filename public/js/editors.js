/* Profile editors (one record at a time), résumé review, tracker, report and delete dialogs. */
(function () {
  'use strict';
  const KJ = window.KJ, A = KJ.A, { esc, icon } = A;
  const EDU = KJ.EDU_LABEL;
  const FIELDS = {
    education: [{ k: 'level', l: 'Level', t: 'select', o: Object.entries(EDU) }, { k: 'field', l: 'Field of study', ph: 'e.g. Finance' }, { k: 'school', l: 'School' }, { k: 'status', l: 'Status', t: 'select', o: [['completed', 'Completed'], ['in progress', 'In progress']] }, { k: 'year', l: 'Year (optional)', t: 'number', step: '1' }],
    experience: [{ k: 'title', l: 'Job title' }, { k: 'employer', l: 'Employer' }, { k: 'field', l: 'Field', t: 'select', o: [['', 'Other / not listed']].concat(KJ.CATEGORIES.map((c) => [c, c])) }, { k: 'years', l: 'Years in this role', t: 'number', step: '0.5' }, { k: 'summary', l: 'What you did (optional)', t: 'textarea' }],
    cert: [{ k: 'name', l: 'Credential or license' }, { k: 'issuer', l: 'Issued by' }, { k: 'status', l: 'Status', t: 'select', o: [['held', 'Held'], ['in progress', 'In progress']] }, { k: 'expires', l: 'Expires (optional)', t: 'date' }],
    skill: [{ k: 'name', l: 'Skill' }],
  };
  const KIND = { education: 'education', experience: 'experience', certs: 'cert', skills: 'skill' };
  const SUMMARY = {
    education: (e) => `${EDU[e.level]}${e.field ? ' in ' + e.field : ''}${e.school ? ', ' + e.school : ''}${e.status === 'in progress' ? ' (in progress)' : ''}`,
    experience: (e) => `${e.title}${e.employer ? ', ' + e.employer : ''}${e.years ? ' · ' + e.years + ' yr' : ''}`,
    cert: (e) => `${e.name}${e.issuer ? ' · ' + e.issuer : ''}${e.status === 'in progress' ? ' (in progress)' : ''}`,
    skill: (e) => e.name,
  };
  const fid = () => 'f' + Math.random().toString(36).slice(2, 8);
  function field(f, v) {
    const id = fid(), val = v === undefined || v === null ? '' : v;
    if (f.t === 'select') return `<div class="field"><label for="${id}">${f.l}</label><select id="${id}" name="${f.k}">${f.o.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(val) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></div>`;
    if (f.t === 'textarea') return `<div class="field"><label for="${id}">${f.l}</label><textarea id="${id}" name="${f.k}">${esc(val)}</textarea></div>`;
    return `<div class="field"><label for="${id}">${f.l}</label><input id="${id}" name="${f.k}" type="${f.t || 'text'}" ${f.t === 'number' ? `min="0" step="${f.step || '1'}" inputmode="decimal"` : ''} value="${esc(val)}"></div>`;
  }
  const check = (name, label, on, val) => `<label class="check"><input type="checkbox" name="${name}" ${val !== undefined ? `value="${esc(val)}"` : ''} ${on ? 'checked' : ''}> ${esc(label)}</label>`;
  const head = (title, sub) => `<h2 id="mt">${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}`;
  const P = () => A.S.profile;

  /* ---- record lists ---- */
  function recordList(sec) {
    const kind = KIND[sec], recs = P()[sec === 'certs' ? 'certs' : sec];
    const title = A.SECTIONS[sec].t;
    A.openModal(`${head(title, 'Add, edit or remove entries one at a time. Each change is saved immediately and refreshes your matches.')}
      <div class="reclist">${recs.length ? recs.map((r) => `<div class="rec"><div class="grow"><b>${esc(SUMMARY[kind](r))}</b>${r.source === 'resume' ? '<small>From your résumé, reviewed by you</small>' : ''}</div><button class="btn sm" data-action="rec-edit" data-kind="${kind}" data-id="${r.id}">Edit</button><button class="act" data-action="rec-delete" data-kind="${kind}" data-id="${r.id}" aria-label="Delete ${esc(SUMMARY[kind](r))}">${icon('trash')}</button></div>`).join('') : '<p class="note">Nothing added yet.</p>'}</div>
      ${sec === 'certs' && !recs.length ? `<form data-form="certsnone">${check('certsNone', 'I don’t currently hold any certifications or licenses', P().certsNone)}<button class="btn sm" type="submit">Save answer</button></form>` : ''}
      <div class="foot"><button class="btn" data-action="close-modal">Done</button><button class="btn primary" data-action="rec-add" data-kind="${kind}" data-sec="${sec}">${icon('plus')} Add ${{ education: 'education', experience: 'a role', cert: 'a credential', skill: 'skills' }[kind]}</button></div>`);
  }
  function skillsEditor() {
    const skills = P().skills;
    A.openModal(`${head('Skills', 'Skills you list here can confirm requirements in job listings. Only add skills you have.')}
      <div class="tagrow">${skills.map((s) => `<span class="tag">${esc(s.name)}<button type="button" data-action="rec-delete" data-kind="skill" data-id="${s.id}" aria-label="Remove ${esc(s.name)}">${icon('x')}</button></span>`).join('') || '<p class="note">No skills yet.</p>'}</div>
      <form data-form="skills-add"><div class="field"><label for="sk">Add skills (separate with commas)</label><input id="sk" name="names" autocomplete="off"></div><p class="form-error" role="alert" hidden></p><div class="foot"><button type="button" class="btn" data-action="close-modal">Done</button><button class="btn primary" type="submit">Add</button></div></form>`);
  }
  function recordForm(kind, sec, rec) {
    A.openModal(`${head(rec ? 'Edit entry' : 'New entry')}<form data-form="record" data-kind="${kind}" data-sec="${sec}" data-id="${rec ? rec.id : ''}">${FIELDS[kind].map((f) => field(f, rec ? rec[f.k] : (f.k === 'status' ? (kind === 'cert' ? 'held' : 'completed') : f.k === 'level' ? 'bachelor' : ''))).join('')}<p class="form-error" role="alert" hidden></p><div class="foot"><button type="button" class="btn" data-action="rec-back" data-sec="${sec}">Cancel</button><button class="btn primary" type="submit">Save Changes</button></div></form>`);
  }

  /* ---- prefs / location / salary / notify / name ---- */
  const TZ = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu'];
  const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${h === 0 ? '12 am' : h < 12 ? h + ' am' : h === 12 ? '12 pm' : h - 12 + ' pm'}</option>`).join('');
  function prefsForm(sec) {
    const p = P(), n = p.notify;
    const body = {
      basics: `<div class="field"><label for="nm">First name</label><input id="nm" name="name" value="${esc(p.name)}" autocomplete="given-name"></div>`,
      prefs: `<div class="field"><label for="ti">Preferred job titles (one per line)</label><textarea id="ti" name="titles" placeholder="e.g. Budget Analyst">${esc(p.titles.join('\n'))}</textarea></div><div class="field"><span>Career categories</span>${KJ.CATEGORIES.map((c) => check('categories', c, p.categories.includes(c), c)).join('')}</div><div class="field"><span>Employment types</span>${['Full-time', 'Part-time', 'Contract', 'Temporary'].map((c) => check('types', c, p.types.includes(c), c)).join('')}</div><div class="field"><span>Work arrangement</span>${[['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']].map(([v, l]) => check('workModes', l, p.workModes.includes(v), v)).join('')}</div>`,
      location: `<div class="field"><label for="ci">Preferred cities (one per line, most important first)</label><textarea id="ci" name="cities">${esc(p.cities.join('\n'))}</textarea></div><div class="field"><label for="cm">Commuting distance (miles)</label><input id="cm" name="commuteMiles" type="number" min="0" max="500" value="${esc(p.commuteMiles)}"></div><p class="note">Changing locations searches the new places and updates your “Near You” results.</p>`,
      salary: `<div class="fields"><div class="field"><label for="smin">Minimum</label><input id="smin" name="min" type="number" min="0" inputmode="numeric" value="${esc(p.salary.min ?? '')}"></div><div class="field"><label for="sdes">Desired</label><input id="sdes" name="desired" type="number" min="0" inputmode="numeric" value="${esc(p.salary.desired ?? '')}"></div><div class="field"><label for="sper">Per</label><select id="sper" name="period"><option value="year" ${p.salary.period === 'year' ? 'selected' : ''}>Year</option><option value="hour" ${p.salary.period === 'hour' ? 'selected' : ''}>Hour</option></select></div></div>${check('showBelow', 'Also show jobs paying below my minimum', p.salary.showBelow)}<p class="note">Jobs whose listed pay tops out below your minimum are left out of your recommended feed. Jobs with no listed pay stay in. Pay that a source merely estimates is never used to filter.</p>`,
      notify: `${check('enabled', 'Send me job notifications', n.enabled)}<p class="note" style="margin-top:0">Turning this off does not stop searching.</p>
        <div class="field"><span>Channels</span>${check('inApp', 'In the app', n.inApp)}${check('email', 'Email (needs email set up on the server)', n.email)}${check('push', 'Push on this device (enable in Settings)', n.push)}</div>
        <div class="field"><span>When</span>${check('immediate', 'Immediately for strong new matches', n.immediate)}${check('daily', 'Daily summary', n.daily)}${check('weekly', 'Weekly summary', n.weekly)}</div>
        <div class="fields"><div class="field"><label for="dh">Summary time</label><select id="dh" name="dailyHour">${hours(n.dailyHour)}</select></div><div class="field"><label for="wd">Weekly on</label><select id="wd" name="weeklyDay">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${i === n.weeklyDay ? 'selected' : ''}>${d}</option>`).join('')}</select></div></div>
        <div class="fields"><div class="field"><label for="qs">Quiet hours start</label><select id="qs" name="quietStart">${hours(n.quietStart)}</select></div><div class="field"><label for="qe">Quiet hours end</label><select id="qe" name="quietEnd">${hours(n.quietEnd)}</select></div><div class="field"><label for="tz">Time zone</label><select id="tz" name="tz">${(TZ.includes(n.tz) ? TZ : [n.tz, ...TZ]).map((z) => `<option ${z === n.tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div></div>
        <div class="field"><span>Notify me about</span>${check('c_newMatches', 'New matches', n.categories.newMatches)}${check('c_deadlines', 'Deadlines and listing changes for saved jobs', n.categories.deadlines)}${check('c_profileUpdates', 'Better recommendations after profile updates', n.categories.profileUpdates)}${check('c_sourceIssues', 'Job source problems', n.categories.sourceIssues)}</div><p class="note">Quiet hours hold email and push; in-app items still appear.</p>`,
    }[sec];
    const title = sec === 'basics' ? 'Your name' : A.SECTIONS[sec].t;
    A.openModal(`${head(title, sec === 'basics' ? 'Used for your greeting.' : '')}<form data-form="prefs" data-sec="${sec}">${body}<p class="form-error" role="alert" hidden></p><div class="foot"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save Changes</button></div></form>`);
  }
  function collectPrefs(form) {
    const fd = new FormData(form), all = (n) => fd.getAll(n), lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean), sec = form.dataset.sec;
    if (sec === 'basics') return { name: fd.get('name') };
    if (sec === 'prefs') return { titles: lines(fd.get('titles')), categories: all('categories'), types: all('types'), workModes: all('workModes') };
    if (sec === 'location') return { cities: lines(fd.get('cities')), commuteMiles: fd.get('commuteMiles') };
    if (sec === 'salary') return { salary: { min: fd.get('min'), desired: fd.get('desired'), period: fd.get('period'), showBelow: !!fd.get('showBelow') } };
    const b = (k) => !!fd.get(k);
    return { notify: { enabled: b('enabled'), inApp: b('inApp'), email: b('email'), push: b('push'), immediate: b('immediate'), daily: b('daily'), weekly: b('weekly'), dailyHour: fd.get('dailyHour'), weeklyDay: fd.get('weeklyDay'), quietStart: fd.get('quietStart'), quietEnd: fd.get('quietEnd'), tz: fd.get('tz'), categories: { newMatches: b('c_newMatches'), deadlines: b('c_deadlines'), profileUpdates: b('c_profileUpdates'), sourceIssues: b('c_sourceIssues') } } };
  }

  /* ---- résumé ---- */
  function resumeEditor(proposals, note) {
    const r = P().resume;
    A.openModal(`${head('Résumé', 'Private to your account. Uploading never changes your profile by itself — you review suggestions first.')}
      ${r ? `<div class="rec"><div class="grow"><b>${esc(r.filename)}</b><small>${(r.size / 1024).toFixed(0)} KB · uploaded ${esc(A.fmtDate(new Date(r.created_at).toISOString()))}</small></div><a class="btn sm" href="/api/resume/file" download>Download</a><button class="act" data-action="resume-delete" aria-label="Delete résumé">${icon('trash')}</button></div>` : ''}
      <div class="field"><label for="rf">${r ? 'Replace with a new file' : 'Upload a résumé'} (.pdf, .docx, .txt, .md — up to 5 MB)</label><input id="rf" type="file" accept=".pdf,.docx,.txt,.md" data-action="resume-pick"></div>${note ? `<p class="note">${esc(note)}</p>` : ''}
      ${proposals && proposals.length ? `<h3 class="used-h">Suggested from your résumé — review before adding</h3><p class="note">These were guessed from the text and may be wrong. Only entries you add become part of your verified profile.</p><div class="reclist">${proposals.map((p) => `<div class="rec"><div class="grow"><b>${esc(({ education: 'Education', experience: 'Experience', skill: 'Skill', cert: 'Credential' })[p.kind])}: ${esc(SUMMARY[p.kind](p.data))}</b></div><button class="btn sm primary" data-action="prop-accept" data-id="${p.id}">Add</button><button class="btn sm" data-action="prop-reject" data-id="${p.id}">Dismiss</button></div>`).join('')}</div>` : (proposals ? '<p class="note">No suggestions to review.</p>' : '')}
      <p class="form-error" role="alert" hidden></p><div class="foot"><button class="btn" data-action="close-modal">Done</button></div>`);
  }

  /* ---- tracker / report / delete ---- */
  function trackerModal(jobId) {
    const j = A.job(jobId), a = A.S.apps[jobId] || { status: 'applied', appliedOn: new Date().toISOString().slice(0, 10), response: '', notes: '', interviews: [], closedReason: '' };
    const row = (i) => `<div class="irow"><input type="date" name="idate" value="${esc(i.date || '')}" aria-label="Interview date"><input name="inote" value="${esc(i.note || '')}" placeholder="Note (panel, location…)" aria-label="Interview note"><button type="button" class="act" data-action="int-rm" aria-label="Remove interview">${icon('x')}</button></div>`;
    A.openModal(`${head('Track application', `${j.title} — ${j.employer}`)}<p class="note">You record this yourself. Kother never submits applications or sends your résumé.</p>
      <form data-form="tracker" data-id="${jobId}"><div class="fields"><div class="field"><label for="ts">Status</label><select id="ts" name="status">${Object.entries(A.APP_STATUS).map(([v, l]) => `<option value="${v}" ${a.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field"><label for="td">Date applied</label><input id="td" type="date" name="appliedOn" value="${esc(a.appliedOn || '')}"></div></div>
        <div class="field"><label for="tr">Employer response</label><input id="tr" name="response" value="${esc(a.response)}" placeholder="e.g. Phone screen offered"></div>
        <div class="field"><span>Interviews</span><div id="ints">${(a.interviews || []).map(row).join('')}</div><button type="button" class="btn sm" data-action="int-add">${icon('plus')} Add interview</button></div>
        <div class="field"><label for="tn">Notes</label><textarea id="tn" name="notes">${esc(a.notes)}</textarea></div><div class="field"><label for="tc">If closed or no longer relevant, why?</label><input id="tc" name="closedReason" value="${esc(a.closedReason)}"></div>
        <p class="form-error" role="alert" hidden></p><div class="foot">${A.S.apps[jobId] ? '<button type="button" class="btn danger" data-action="untrack" data-id="' + jobId + '">Stop tracking</button>' : ''}<button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save Changes</button></div></form>`);
    A.intRow = row;
  }
  function reportModal(id) {
    const j = A.job(id);
    A.openModal(`${head('Report this listing', `${j.title} · ${j.employer}`)}<p class="note">The listing is hidden from your feed. Reports are stored with your account so you can undo them.</p><form data-form="report" data-id="${id}"><div class="field">${['The listing has expired or been filled', 'The salary or details are incorrect', 'The application link is broken', 'It isn’t a real job posting', 'Something else'].map((r, i) => `<label class="check"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${r}</label>`).join('')}</div><p class="form-error" role="alert" hidden></p><div class="foot"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Report and hide</button></div></form>`);
  }
  function deleteModal(kind) {
    A.openModal(kind === 'account'
      ? `${head('Delete your account?', 'This permanently deletes your profile, résumé, saved jobs, applications and notifications. It can’t be undone.')}<form data-form="delete-account"><div class="field"><label for="dp">Enter your password to confirm</label><input id="dp" name="password" type="password" autocomplete="current-password" required></div><p class="form-error" role="alert" hidden></p><div class="foot"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn danger" type="submit">Delete account</button></div></form>`
      : `${head('Delete your profile data?', 'This removes your education, experience, skills, credentials, preferences and uploaded résumé. Saved jobs and applications are kept. Your matches will be recalculated.')}<div class="foot"><button class="btn" data-action="close-modal">Cancel</button><button class="btn danger" data-action="delete-profile-confirm">Delete profile data</button></div>`);
  }

  A.editors = {
    open(sec) { if (sec === 'skills') return skillsEditor(); if (['education', 'experience', 'certs'].includes(sec)) return recordList(sec); if (sec === 'resume') return resumeEditor(null); return prefsForm(sec); },
    recordForm, recordList, skillsEditor, prefsForm, collectPrefs, resumeEditor, trackerModal, reportModal, deleteModal, KIND,
  };
})();
