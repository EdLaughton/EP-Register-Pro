// ==UserScript==
// @name         EPO Register Pro v1.0.0
// @namespace    https://tampermonkey.net/
// @version      1.0.0
// @description  EP patent attorney sidebar for the European Patent Register
// @match        https://register.epo.org/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  'use strict';

  /* ────────────────────────────────────────────────────────────────
     Guard: only run once, only in the top frame
     ──────────────────────────────────────────────────────────────── */

  if (window.top !== window.self) return;
  if (window.__epoRegPro600) return;
  window.__epoRegPro600 = true;

  /* ────────────────────────────────────────────────────────────────
     Constants
     ──────────────────────────────────────────────────────────────── */

  const VERSION         = '6.0.0';
  const CACHE_KEY       = 'epoRP_600_cache';
  const OPTIONS_KEY     = 'epoRP_600_opts';
  const UI_KEY          = 'epoRP_600_ui';
  const DATE_RE         = /\b(\d{2}\.\d{2}\.\d{4})\b/;
  const MAX_CACHED_APPS = 60;
  const MAX_LOG_ENTRIES = 300;
  const FETCH_CONCURRENCY = 3;
  const FETCH_TIMEOUT_MS  = 15_000;

  const TABS = [
    { key: 'main',    slug: 'main',    title: 'EP About this file' },
    { key: 'doclist', slug: 'doclist', title: 'EP All documents' },
    { key: 'event',   slug: 'event',   title: 'EP Event history' },
    { key: 'family',  slug: 'family',  title: 'EP Patent family' },
    { key: 'legal',   slug: 'legal',   title: 'EP Legal status' },
    { key: 'ueMain',  slug: 'ueMain',  title: 'UP About this file' },
  ];

  const DEFAULTS = {
    shiftBody: true,
    panelWidthPx: 420,
    pageRightPaddingPx: 440,
    preloadAllTabs: true,
    refreshHours: 6,
    timelineMaxEntries: 300,
    showPublications: true,
    showEventHistory: true,
    showLegalStatusEvents: true,
  };

  /* ────────────────────────────────────────────────────────────────
     In-memory cache + batched localStorage sync
     ──────────────────────────────────────────────────────────────── */

  let _mem = null, _dirty = false, _flushT = null;

  const loadJson = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
  const saveJson = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

  function store() { if (!_mem) _mem = loadJson(CACHE_KEY, { apps: {} }); return _mem; }
  function dirty() { _dirty = true; if (!_flushT) _flushT = setTimeout(flush, 500); }
  function flush() { _flushT = null; if (!_dirty || !_mem) return; _dirty = false; evict(); saveJson(CACHE_KEY, _mem); }
  function flushNow() { if (_flushT) { clearTimeout(_flushT); _flushT = null; } if (_dirty && _mem) { _dirty = false; evict(); saveJson(CACHE_KEY, _mem); } }

  function evict() {
    if (!_mem) return;
    const a = _mem.apps, ks = Object.keys(a);
    if (ks.length <= MAX_CACHED_APPS) return;
    ks.sort((x, y) => (a[x].updatedAt || 0) - (a[y].updatedAt || 0))
      .slice(0, ks.length - MAX_CACHED_APPS)
      .forEach(k => delete a[k]);
  }

  function app(no) { const s = store(); if (!s.apps[no]) { s.apps[no] = { appNo: no, updatedAt: 0, sources: {} }; dirty(); } return s.apps[no]; }
  function patch(no, fn) { const s = store(); if (!s.apps[no]) s.apps[no] = { appNo: no, updatedAt: 0, sources: {} }; fn(s.apps[no]); s.apps[no].updatedAt = Date.now(); dirty(); return s.apps[no]; }
  function fresh(src, hrs) { return src?.fetchedAt && Date.now() - src.fetchedAt < hrs * 3_600_000; }

  /* ────────────────────────────────────────────────────────────────
     Runtime
     ──────────────────────────────────────────────────────────────── */

  const R = {
    appNo: '', activeView: loadJson(UI_KEY, {}).activeView || 'overview',
    collapsed: !!loadJson(UI_KEY, {}).collapsed,
    fetching: false, fetchLabel: 'Idle',
    panel: null, body: null, href: location.href,
    abort: null, fetchApp: null,
    logs: [],
  };

  function log(lvl, msg) { R.logs.push({ ts: new Date(), level: lvl, msg }); if (R.logs.length > MAX_LOG_ENTRIES) R.logs = R.logs.slice(-MAX_LOG_ENTRIES); }

  /* ────────────────────────────────────────────────────────────────
     CSS
     ──────────────────────────────────────────────────────────────── */

  GM_addStyle(`
body.epoRP-shifted{padding-right:${DEFAULTS.pageRightPaddingPx}px!important}

/* panel shell */
.epoRP{position:fixed;top:60px;right:10px;z-index:999999;width:${DEFAULTS.panelWidthPx}px;height:calc(100vh - 76px);display:flex;flex-direction:column;font:12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#f8f9fd;border:1px solid #d4dae6;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.14);overflow:hidden}
.epoRP.collapsed{width:180px;height:auto}
.epoRP.collapsed .epoRP-body{display:none}

/* header */
.epoRP-hd{padding:10px 12px 8px;background:#fff;border-bottom:1px solid #e2e7f0;display:flex;flex-direction:column;gap:6px}
.epoRP-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.epoRP-t{font-weight:800;font-size:13px;color:#111827}
.epoRP-st{font-size:11px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.epoRP-acts{display:flex;gap:5px;align-items:center;flex:0 0 auto}

/* buttons */
.epoRP-btn{appearance:none;border:1px solid #c8d0de;background:#fff;color:#0f172a;border-radius:8px;padding:3px 7px;font-size:11px;font-weight:700;cursor:pointer;line-height:1;transition:background .12s}
.epoRP-btn:hover{background:#eef3ff}

/* badges */
.epoRP-badges{display:flex;align-items:center;justify-content:space-between;gap:6px}
.epoRP-bdg{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;border:1px solid #c4cdd8;background:#eef3ff;font-size:10px;font-weight:800;color:#0f172a;white-space:nowrap}
.epoRP-bdg.ok{background:rgba(16,185,129,.10);border-color:rgba(16,185,129,.28)}
.epoRP-bdg.warn{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.28)}
.epoRP-bdg.bad{background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.28)}

/* tabs */
.epoRP-tabs{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.epoRP-tab{appearance:none;border:1px solid #c8d0de;background:#fff;color:#0f172a;border-radius:999px;padding:3px 9px;font-size:10px;font-weight:800;cursor:pointer;transition:background .12s}
.epoRP-tab.on{background:#dde4f4}

/* body */
.epoRP-body{flex:1;min-height:0;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}

/* cards */
.epoRP-c{background:#fff;border:1px solid #e0e5ee;border-radius:10px;padding:10px}
.epoRP-c h4{margin:0 0 6px;font-size:11px;font-weight:900;color:#0f172a}
.epoRP-g{display:grid;grid-template-columns:120px 1fr;gap:5px 8px;align-items:start}
.epoRP-l{font-weight:800;color:#64748b;font-size:11px;padding-top:1px}
.epoRP-v{min-width:0;color:#0f172a;white-space:pre-line;word-break:break-word}
.epoRP-m{color:#64748b;font-size:11px}
.epoRP-a{color:#0b4ab8;text-decoration:underline;font-weight:700}

/* copy button inline */
.epoRP-cp{display:inline-block;margin-left:4px;padding:1px 5px;font-size:9px;font-weight:700;border:1px solid #c8d0de;border-radius:4px;background:#fff;color:#64748b;cursor:pointer;vertical-align:middle;line-height:1.2}
.epoRP-cp:hover{background:#eef3ff;color:#0f172a}

/* publications */
.epoRP-pubs{display:flex;flex-direction:column;gap:5px}
.epoRP-pub{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:start;border-bottom:1px solid #edf1f7;padding-bottom:5px}
.epoRP-pub:last-child{border-bottom:0;padding-bottom:0}
.epoRP-pn{font-weight:800}
.epoRP-pm{font-size:11px;color:#475569}
.epoRP-d{white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:800;color:#334155}

/* timeline */
.epoRP-today{position:relative;border-top:2px solid #111827;margin:8px 0 2px}
.epoRP-today span{position:absolute;right:0;top:-10px;padding:0 5px;background:#f8f9fd;font-size:10px;font-weight:900;color:#111827}
.epoRP-it{display:grid;grid-template-columns:10px 82px 1fr;gap:8px;align-items:start;padding:6px 2px}
.epoRP-dot{width:10px;height:10px;margin-top:3px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 2px #fff,0 0 0 3px #cfd6e6}
.epoRP-dot.ok{background:#059669}.epoRP-dot.warn{background:#b45309}.epoRP-dot.bad{background:#b91c1c}.epoRP-dot.info{background:#2563eb}
.epoRP-mn{font-weight:800;color:#0f172a}
.epoRP-sb{margin-top:2px;color:#475569;white-space:pre-line;font-size:11px}

/* groups */
.epoRP-grp{border:1px solid rgba(100,116,139,.14);background:rgba(248,250,252,.95);border-radius:10px;padding:5px 5px 2px;margin:5px 0}
.epoRP-grph{display:grid;grid-template-columns:10px 82px 1fr;gap:8px;align-items:start;padding:4px 2px 5px;border-bottom:1px solid rgba(148,163,184,.12);margin-bottom:3px}
.epoRP-grpi .epoRP-it{padding:4px 2px}

/* options */
.epoRP-or{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid #edf1f7}
.epoRP-or:last-child{border-bottom:0}
.epoRP-ol{font-weight:700;color:#0f172a;font-size:11px}
.epoRP-oh{font-size:10px;color:#64748b;margin-top:1px}

/* logs */
.epoRP-ll{display:flex;flex-direction:column;max-height:500px;overflow-y:auto}
.epoRP-lr{display:grid;grid-template-columns:50px 10px 1fr;gap:5px;align-items:start;padding:3px 2px;border-bottom:1px solid #f1f3f7;font-size:11px}
.epoRP-lr:last-child{border-bottom:0}
.epoRP-lt{font-variant-numeric:tabular-nums;color:#64748b;font-weight:700;white-space:nowrap}
.epoRP-lm{color:#0f172a;word-break:break-word}

/* deadline cards */
.epoRP-dl{display:flex;flex-direction:column;gap:4px}
.epoRP-dr{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #edf1f7}
.epoRP-dr:last-child{border-bottom:0}
.epoRP-dn{font-weight:700;font-size:11px}
.epoRP-dd{font-size:11px;font-weight:800}
  `);

  /* ────────────────────────────────────────────────────────────────
     Utility helpers
     ──────────────────────────────────────────────────────────────── */

  const esc  = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const norm = v => String(v ?? '').replace(/\u00a0/g,' ').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  const txt  = n => n ? norm(n.innerText || n.textContent || '') : '';

  function dedup(list, keyFn) { const s = new Set(), o = []; for (const i of list || []) { const k = keyFn(i); if (!s.has(k)) { s.add(k); o.push(i); } } return o; }

  function toDate(s) { if (!s || !DATE_RE.test(s)) return null; const [d,m,y] = s.split('.').map(Number); return new Date(y, m-1, d); }
  function fmtD(d) { if (!(d instanceof Date) || isNaN(d)) return ''; return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; }
  function cmpDesc(a, b) { return (toDate(b?.dateStr)?.getTime() || 0) - (toDate(a?.dateStr)?.getTime() || 0); }

  function daysAgo(s) { const d = toDate(s); if (!d) return null; const t = new Date(); return Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - d) / 86_400_000); }
  function fmtAgo(n) { if (n == null) return ''; if (n === 0) return 'today'; if (n === 1) return '1 day ago'; if (n < 0) return `in ${-n} days`; return `${n} days ago`; }

  function addMonths(d, m) { const r = new Date(d); r.setMonth(r.getMonth() + m); return r; }
  function addYears(d, y) { const r = new Date(d); r.setFullYear(r.getFullYear() + y); return r; }

  const opts  = () => ({ ...DEFAULTS, ...loadJson(OPTIONS_KEY, {}) });
  const sOpts = p  => { const m = { ...opts(), ...p }; saveJson(OPTIONS_KEY, m); return m; };
  const uiSt  = () => loadJson(UI_KEY, { activeView: R.activeView, collapsed: R.collapsed });
  const sUI   = p  => { const n = { ...uiSt(), ...p }; saveJson(UI_KEY, n); R.activeView = n.activeView; R.collapsed = !!n.collapsed; };

  const curUrl  = () => new URL(location.href);
  const curLang = () => curUrl().searchParams.get('lng') || 'en';
  const appNo   = (u = curUrl()) => norm(u.searchParams.get('number') || '').toUpperCase();
  const tabSlug = (u = curUrl()) => norm(u.searchParams.get('tab') || 'main');
  const isCase  = (u = curUrl()) => /\/application$/i.test(u.pathname) && /^EP\d+/i.test(appNo(u));
  function tabUrl(no, slug) { const u = new URL(`${location.origin}/application`); u.searchParams.set('number', no); u.searchParams.set('lng', curLang()); u.searchParams.set('tab', slug); return u.toString(); }

  /* ────────────────────────────────────────────────────────────────
     Debounced render
     ──────────────────────────────────────────────────────────────── */

  let _rt = null;
  function sched() { if (!_rt) _rt = setTimeout(() => { _rt = null; renderPanel(); }, 50); }

  /* ────────────────────────────────────────────────────────────────
     DOM / HTML parsing helpers
     ──────────────────────────────────────────────────────────────── */

  const bTxt  = doc => norm(doc?.body?.innerText || doc?.body?.textContent || '');
  const pHtml = html => new DOMParser().parseFromString(html || '', 'text/html');

  function field(doc, res) {
    for (const row of doc.querySelectorAll('tr')) {
      const c = [...row.querySelectorAll('th,td')].map(txt);
      if (c.length < 2) continue;
      if (res.some(r => r.test(c[0] || ''))) { const v = c.slice(1).filter(Boolean).join('\n').trim(); if (v) return v; }
      for (let i = 0; i < c.length - 1; i++) { if (res.some(r => r.test(c[i] || ''))) { const v = c.slice(i+1).filter(Boolean).join('\n').trim(); if (v) return v; } }
    }
    for (const dl of doc.querySelectorAll('dl')) {
      const ch = [...dl.children];
      for (let i = 0; i < ch.length; i++) {
        if (ch[i]?.tagName !== 'DT') continue;
        if (!res.some(r => r.test(txt(ch[i])))) continue;
        const parts = [];
        for (let j = i+1; j < ch.length && ch[j]?.tagName !== 'DT'; j++) if (ch[j]?.tagName === 'DD') parts.push(txt(ch[j]));
        const v = parts.filter(Boolean).join('\n').trim();
        if (v) return v;
      }
    }
    return '';
  }

  function extractTitle(doc) {
    for (const el of [...doc.querySelectorAll('h1,h2,h3,strong,b,a')].slice(0, 100)) {
      const m = txt(el).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
      if (m?.[1]) return m[1].trim();
    }
    const m = bTxt(doc).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
    return m ? m[1].trim() : '';
  }

  const cleanApp  = v => String(v||'').split('\n').map(l=>l.trim()).filter(Boolean).filter(l=>!/^For all designated/i.test(l))[0] || '';
  const cleanStat = v => String(v||'').split('\n').map(l=>l.trim()).filter(Boolean).filter(l=>!/^(Status|Database last) updated/i.test(l))[0] || '';

  function simpStatus(st) {
    const t = norm(st).toLowerCase();
    if (!t) return { simple: 'Unknown', level: 'warn' };
    if (t.includes('grant of patent is intended') || /rule\s*71\(3\)/i.test(st)) return { simple: 'Grant intended (R71(3))', level: 'warn' };
    if (/granted|patent has been granted/i.test(t)) return { simple: 'Granted', level: 'ok' };
    if (/no further examination/i.test(t)) return { simple: 'No exam requested', level: 'warn' };
    if (/published/i.test(t)) return { simple: 'Published', level: 'ok' };
    if (/search/i.test(t)) return { simple: 'Search', level: 'info' };
    if (/examination/i.test(t)) return { simple: 'Examination', level: 'info' };
    if (/opposition|appeal/i.test(t)) return { simple: st, level: 'warn' };
    if (/revoked|refused|withdrawn|deemed to be withdrawn|expired|lapsed/i.test(t)) return { simple: st, level: 'bad' };
    return { simple: st, level: 'info' };
  }

  function parseAppField(v) {
    const m = norm(v).match(/\b(\d{6,10}\.\d)\b[\s\S]{0,60}?\b(\d{2}\.\d{2}\.\d{4})\b/);
    return { checksum: m?.[1] || '', filingDate: m?.[2] || '' };
  }

  function parsePriority(v) {
    const out = [];
    for (const ln of String(v||'').split('\n').map(l=>l.trim()).filter(Boolean)) {
      const m = ln.match(/\b([A-Z]{2}[A-Z0-9]{4,})\b[\s\S]{0,40}?\b(\d{2}\.\d{2}\.\d{4})\b/i);
      if (m) out.push({ no: m[1].replace(/\s+/g,'').toUpperCase(), dateStr: m[2] });
    }
    return dedup(out, i => `${i.no}|${i.dateStr}`);
  }

  function parseRecentEvents(v) {
    const lines = String(v||'').split('\n').map(l=>l.trim()).filter(Boolean);
    const out = []; let cur = null;
    for (const ln of lines) {
      const dm = ln.match(DATE_RE);
      if (dm) { if (cur?.dateStr && cur?.title) out.push(cur); cur = { dateStr: dm[1], title: '', detail: '', source: 'Main page' }; continue; }
      if (!cur) continue;
      if (!cur.title) cur.title = ln; else cur.detail = cur.detail ? `${cur.detail} \u00b7 ${ln}` : ln;
    }
    if (cur?.dateStr && cur?.title) out.push(cur);
    return dedup(out, i => `${i.dateStr}|${i.title}|${i.detail}`);
  }

  function parsePubs(text, role = '') {
    const out = [], re = /\b((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)[A-Z0-9]{5,})([A-Z]\d)?\b[\s\S]{0,50}?\b(\d{2}\.\d{2}\.\d{4})\b/gi;
    let m; while ((m = re.exec(text)) !== null) out.push({ no: m[1].toUpperCase(), kind: (m[2]||'').toUpperCase(), dateStr: m[3], role });
    return dedup(out, i => `${i.no}${i.kind}|${i.dateStr}|${i.role}`);
  }

  function parseDesignatedStates(v) {
    const m = String(v||'').match(/\b([A-Z]{2}(?:\s+[A-Z]{2}){2,})\b/);
    return m ? m[1].trim() : '';
  }

  /* ────────────────────────────────────────────────────────────────
     Page-specific parsers
     ──────────────────────────────────────────────────────────────── */

  function parseMain(doc, no) {
    const appF  = field(doc, [/^Application number/i]);
    const statF = field(doc, [/^Status$/i, /^Procedural status$/i]);
    const appli = field(doc, [/^Applicant/i]);
    const prior = field(doc, [/^Priority\b/i]);
    const pubF  = field(doc, [/^Publication$/i]);
    const evtF  = field(doc, [/^Most recent event$/i]);
    const repF  = field(doc, [/^Representative/i]);
    const invF  = field(doc, [/^Inventor/i]);
    const desF  = field(doc, [/^Designated/i]);
    const ipcF  = field(doc, [/^IPC$/i, /^Classification$/i, /^CPC$/i]);

    const ai = parseAppField(appF);
    const st = cleanStat(statF);
    const si = simpStatus(st);
    const pris = parsePriority(prior);
    const pubs = parsePubs(pubF, 'EP (this file)');
    const evts = parseRecentEvents(evtF);
    const desig = parseDesignatedStates(desF);

    // Detect divisional: priority claims own EP number
    const isDivisional = pris.some(p => /^EP/i.test(p.no));

    return {
      appNo: no, title: extractTitle(doc),
      applicant: cleanApp(appli), inventor: cleanApp(invF),
      filingDate: ai.filingDate, checksum: ai.checksum,
      priorities: pris, priorityText: pris.map(p => `${p.no} \u00b7 ${p.dateStr}`).join('\n'),
      representative: norm(repF), designatedStates: desig,
      ipc: norm(ipcF),
      statusRaw: st, statusSimple: si.simple, statusLevel: si.level,
      recentEvents: evts, publications: pubs, isDivisional,
    };
  }

  function bestTable(doc, hdrs) {
    let best = null, bs = 0;
    for (const t of doc.querySelectorAll('table')) {
      const h = txt(t.querySelector('thead') || t).toLowerCase();
      let s = 0; for (const hd of hdrs) if (h.includes(hd.toLowerCase())) s++;
      if (s > bs) { best = t; bs = s; }
    }
    return bs > 0 ? best : null;
  }

  function colMap(table) {
    const m = {}, hr = table.querySelector('thead tr') || table.querySelector('tr');
    ([...(hr?.querySelectorAll('th,td') || [])]).map(txt).forEach((h,i) => {
      const l = h.toLowerCase();
      if (/^date$/.test(l)) m.date = i;
      if (l.includes('document type')) m.docType = i;
      if (l.includes('procedure')) m.proc = i;
    });
    return m;
  }

  function classifyDoc(title) {
    if (/search report|european search opinion|search opinion|search started|information on search strategy|transmission of the european search report|written opinion/i.test(title))
      return { bundle: 'Search', level: 'info', actor: 'EPO' };
    if (/rule\s*71\(3\)|intention to grant|text intended for grant/i.test(title))
      return { bundle: 'R71(3)', level: 'warn', actor: 'EPO' };
    if (/communication from the examining division|examination started|article\s*94\(3\)|art\.\s*94\(3\)/i.test(title))
      return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    if (/refund of fees|decision|summons|communication|loss of rights|rule\s*112\(1\)|deemed to be withdrawn/i.test(title))
      return { bundle: 'Procedure', level: /loss of rights|deemed to be withdrawn/i.test(title) ? 'bad' : 'warn', actor: 'EPO' };
    if (/request for grant|description|claims|drawings|abstract|designation of inventor|priority document/i.test(title))
      return { bundle: 'Filing', level: 'info', actor: 'Applicant' };
    if (/amendments?|arguments?|reply|response|observations?|request|letter from applicant|filed by applicant|submission/i.test(title))
      return { bundle: 'Applicant', level: 'info', actor: 'Applicant' };
    if (/renewal|annual fee/i.test(title))
      return { bundle: 'Renewal', level: 'ok', actor: 'Applicant' };
    if (/opposition|third party/i.test(title))
      return { bundle: 'Opposition', level: 'warn', actor: 'Third party' };
    return { bundle: 'Other', level: 'info', actor: 'Other' };
  }

  function parseDoclist(doc, no) {
    const tbl = bestTable(doc, ['date','document type']) || bestTable(doc, ['date','document']);
    if (!tbl) return { docs: [] };
    const cm = colMap(tbl), docs = [];
    for (const row of tbl.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')];
      if (!cells.length || !row.querySelector("input[type='checkbox']")) continue;
      const rt = txt(row), dm = rt.match(DATE_RE);
      if (!dm) continue;
      const ds = dm[1], gc = i => (i != null && i < cells.length ? txt(cells[i]) : '');
      let title = gc(cm.docType);
      if (!title) title = [...row.querySelectorAll('a')].map(txt).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || '';
      if (!title) title = cells.map(txt).filter(Boolean).filter(v=>v!==ds).sort((a,b)=>b.length-a.length)[0] || '';
      if (!title) continue;
      const cls = classifyDoc(title);
      const href = ([...row.querySelectorAll('a[href]')].sort((a,b)=>txt(b).length-txt(a).length)[0]?.href) || tabUrl(no,'doclist');
      docs.push({ dateStr: ds, title, procedure: gc(cm.proc), url: href, ...cls });
    }
    return { docs: dedup(docs, i=>`${i.dateStr}|${i.title}|${i.url}`).sort(cmpDesc) };
  }

  function parseDatedRows(doc, url) {
    const out = [];
    for (const row of doc.querySelectorAll('tr')) {
      const c = [...row.querySelectorAll('th,td')].map(txt).filter(Boolean);
      if (c.length < 2) continue;
      const dc = c.find(v => DATE_RE.test(v)); if (!dc) continue;
      const ds = dc.match(DATE_RE)[1];
      const rest = c.filter((v,i) => !(i===0 && DATE_RE.test(v)) && !/^(date|event|status|publication|document type)$/i.test(v));
      if (!rest.length || !rest[0] || rest[0].length < 2) continue;
      out.push({ dateStr: ds, title: rest[0], detail: rest.slice(1).join(' \u00b7 '), url });
    }
    return dedup(out, i=>`${i.dateStr}|${i.title}|${i.detail}`).sort(cmpDesc);
  }

  function parseFamily(doc) { return { publications: parsePubs(bTxt(doc), 'Family') }; }

  function parseLegal(doc, no) {
    const events = parseDatedRows(doc, tabUrl(no, 'legal'));
    const renewals = [];
    for (const e of events) {
      const c = `${e.title} ${e.detail}`.toLowerCase();
      if (/renewal|annual fee|year\s*\d+/i.test(c)) {
        const ym = c.match(/year\s*(\d+)/i) || c.match(/(\d+)(?:st|nd|rd|th)\s*year/i);
        renewals.push({ dateStr: e.dateStr, title: e.title, detail: e.detail, year: ym ? +ym[1] : null });
      }
    }
    renewals.sort(cmpDesc);
    return { events, renewals };
  }

  function parseEvent(doc, no) { return { events: parseDatedRows(doc, tabUrl(no, 'event')) }; }

  function parseUE(doc) {
    const text = bTxt(doc);
    const st = cleanStat(field(doc, [/^Status$/i, /^Procedural status$/i]));
    let ue = '', optOut = '';
    if (/unitary effect registered|unitary patent/i.test(text)) ue = 'Unitary effect registered';
    else if (/request.*unitary effect|unitary effect.*request/i.test(text)) ue = 'UE requested';
    else if (st) ue = st;
    if (/opt[\s-]*out.*registered|opted[\s-]*out/i.test(text)) optOut = 'Opted out';
    else if (/opt[\s-]*out.*withdrawn|opt[\s-]*out.*removed/i.test(text)) optOut = 'Opt-out withdrawn';
    else if (/no\s*opt[\s-]*out|not\s*opted/i.test(text)) optOut = 'No opt-out';
    const ms = field(doc, [/^Member State/i, /^Participating/i, /^Designated/i]);
    return { statusRaw: st, ueStatus: ue, upcOptOut: optOut, memberStates: ms, text };
  }

  function parseSource(key, doc, no) {
    switch (key) {
      case 'main':    return parseMain(doc, no);
      case 'doclist': return parseDoclist(doc, no);
      case 'event':   return parseEvent(doc, no);
      case 'family':  return parseFamily(doc);
      case 'legal':   return parseLegal(doc, no);
      case 'ueMain':  return parseUE(doc);
      default:        return {};
    }
  }

  /* ────────────────────────────────────────────────────────────────
     Live page capture
     ──────────────────────────────────────────────────────────────── */

  function captureLive(no) {
    const key = TABS.find(t => t.slug === tabSlug())?.key;
    if (!key) return;
    try {
      const data = parseSource(key, document, no);
      log('info', `Live: ${key}`);
      patch(no, s => { s.sources[key] = { key, title: TABS.find(t=>t.key===key)?.title||key, status: 'ok', fetchedAt: Date.now(), url: location.href, data }; });
    } catch (e) {
      log('error', `Live error (${key}): ${e?.message || e}`);
      patch(no, s => { s.sources[key] = { key, title: TABS.find(t=>t.key===key)?.title||key, status: 'error', fetchedAt: Date.now(), url: location.href, error: String(e?.message||e) }; });
    }
  }

  /* ────────────────────────────────────────────────────────────────
     Background loading via fetch() — no iframes
     ──────────────────────────────────────────────────────────────── */

  async function fetchPage(url, signal) {
    const resp = await fetch(url, { signal, credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  }

  async function pooled(tasks, limit) {
    const res = Array(tasks.length); let idx = 0;
    async function w() { while (idx < tasks.length) { const i = idx++; res[i] = await tasks[i](); } }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => w()));
    return res;
  }

  function cancelFetch() {
    if (R.abort) { R.abort.abort(); R.abort = null; }
    R.fetchApp = null; R.fetching = false; R.fetchLabel = 'Idle';
  }

  async function prefetchAll(no, force = false) {
    const o = opts();
    if (!o.preloadAllTabs && !force) return;
    if (R.fetchApp === no && R.fetching && !force) return;
    cancelFetch();

    const ac = new AbortController();
    R.abort = ac; R.fetchApp = no; R.fetching = true; R.fetchLabel = 'Starting';
    log('info', `Prefetch ${no}${force ? ' (forced)' : ''}`);
    sched();

    try {
      const need = TABS.filter(t => {
        if (force) return true;
        const f = fresh(app(no).sources[t.key], o.refreshHours);
        if (f) log('info', `Hit: ${t.key}`);
        return !f;
      });
      if (!need.length) { log('ok', `All fresh for ${no}`); R.fetching = false; R.fetchLabel = 'Idle'; sched(); return; }
      log('info', `Fetching ${need.length}: ${need.map(t=>t.key).join(', ')}`);

      let done = 0;
      await pooled(need.map(src => async () => {
        if (ac.signal.aborted) return;
        R.fetchLabel = `${++done}/${need.length}`;
        sched();
        const url = tabUrl(no, src.slug);
        try {
          const html = await fetchPage(url, ac.signal);
          if (ac.signal.aborted) return;
          const doc = pHtml(html);
          const data = parseSource(src.key, doc, no);
          log('ok', `${src.key}: ${(html.length/1024).toFixed(1)} KB`);
          patch(no, s => { s.sources[src.key] = { key: src.key, title: src.title, status: 'ok', fetchedAt: Date.now(), url, data }; });
        } catch (e) {
          if (ac.signal.aborted) return;
          log('error', `${src.key}: ${e?.message || e}`);
          patch(no, s => { s.sources[src.key] = { key: src.key, title: src.title, status: 'error', fetchedAt: Date.now(), url, error: String(e?.message||e) }; });
        }
        if (R.appNo === no) sched();
      }), FETCH_CONCURRENCY);
    } finally {
      if (R.abort === ac) {
        const st = app(no); const ok = TABS.filter(t => st.sources[t.key]?.status === 'ok').length;
        log('ok', `Done ${no}: ${ok}/${TABS.length} OK`);
        R.fetching = false; R.fetchLabel = 'Idle'; R.abort = null; R.fetchApp = null;
        flushNow(); sched();
      } else { log('warn', `Cancelled ${no}`); }
    }
  }

  /* ────────────────────────────────────────────────────────────────
     Data models
     ──────────────────────────────────────────────────────────────── */

  function topSev(ls) { if (ls.includes('bad')) return 'bad'; if (ls.includes('warn')) return 'warn'; if (ls.includes('ok')) return 'ok'; return 'info'; }

  function overviewModel(no) {
    const s = app(no);
    const mn = s.sources.main?.data || {};
    const dl = s.sources.doclist?.data || {};
    const fm = s.sources.family?.data || {};
    const lg = s.sources.legal?.data || {};
    const ue = s.sources.ueMain?.data || {};

    const docs = (dl.docs || []).slice().sort(cmpDesc);
    const epo = docs.find(d => d.actor === 'EPO');
    const apl = docs.find(d => d.actor === 'Applicant');

    let stage = mn.statusSimple || 'Unknown';
    if (docs.some(d => d.bundle === 'R71(3)')) stage = 'Grant stage (R71(3))';
    else if (docs.some(d => d.bundle === 'Examination')) stage = 'Examination';
    else if (docs.some(d => d.bundle === 'Search')) stage = 'Search';

    const pubs = dedup([...(mn.publications||[]), ...(fm.publications||[])], i=>`${i.no}${i.kind}|${i.dateStr}|${i.role}`).sort(cmpDesc);

    // Document counts
    const docCounts = {};
    for (const d of docs) { docCounts[d.bundle] = (docCounts[d.bundle]||0) + 1; }

    // Renewals
    const rens = lg.renewals || [];
    const maxYr = rens.reduce((m, r) => r.year && r.year > m ? r.year : m, 0);

    // Deadlines
    const deadlines = [];
    const filing = toDate(mn.filingDate);
    const priDate = mn.priorities?.[0] ? toDate(mn.priorities[0].dateStr) : null;

    if (priDate && filing) {
      const priExp = addMonths(priDate, 12);
      if (priExp > new Date()) deadlines.push({ label: 'Priority expiry (12 mo)', date: priExp, level: priExp - new Date() < 60*86_400_000 ? 'warn' : 'info' });
    }
    if (filing) {
      const yr3 = addMonths(filing, 36);
      if (stage === 'Search' || stage === 'Unknown') {
        deadlines.push({ label: 'Exam request deadline (R70(1))', date: addMonths(filing, 6 * 12), level: 'info' });
      }
    }
    // R71(3) response: 4 months from latest R71(3) doc
    const r71doc = docs.find(d => d.bundle === 'R71(3)');
    if (r71doc) {
      const r71d = toDate(r71doc.dateStr);
      if (r71d) {
        const dl2 = addMonths(r71d, 4);
        deadlines.push({ label: 'R71(3) response deadline', date: dl2, level: dl2 < new Date() ? 'bad' : dl2 - new Date() < 30*86_400_000 ? 'warn' : 'info' });
      }
    }
    // Art 94(3) response: 4 months
    const a94doc = docs.find(d => /article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining/i.test(d.title));
    if (a94doc) {
      const a94d = toDate(a94doc.dateStr);
      if (a94d) {
        const dl3 = addMonths(a94d, 4);
        deadlines.push({ label: 'Art 94(3) response deadline', date: dl3, level: dl3 < new Date() ? 'bad' : dl3 - new Date() < 30*86_400_000 ? 'warn' : 'info' });
      }
    }

    deadlines.sort((a, b) => a.date - b.date);

    const epoDays = daysAgo(epo?.dateStr);
    const aplDays = daysAgo(apl?.dateStr);
    const caseAge = daysAgo(mn.filingDate);

    return {
      title: mn.title || '\u2014', applicant: mn.applicant || '\u2014',
      inventor: mn.inventor || '', representative: mn.representative || '\u2014',
      priority: mn.priorityText || '\u2014', appNum: no || '\u2014',
      filingDate: mn.filingDate || '\u2014', stage, status: mn.statusRaw || '\u2014',
      statusSimple: mn.statusSimple || 'Unknown', statusLevel: mn.statusLevel || 'warn',
      designatedStates: mn.designatedStates || '', ipc: mn.ipc || '',
      isDivisional: !!mn.isDivisional, caseAge,
      epoLast: epo ? `${epo.dateStr} \u00b7 ${epo.title}` : '\u2014', epoDays,
      aplLast: apl ? `${apl.dateStr} \u00b7 ${apl.title}` : '\u2014', aplDays,
      waitDays: aplDays, waitSince: apl?.dateStr || '', waitText: apl?.title || 'No applicant filing detected.',
      latestRen: rens[0], maxRenYr: maxYr || null, renCount: rens.length,
      ueStatus: ue.ueStatus || '', upcOptOut: ue.upcOptOut || '', ueMember: ue.memberStates || '',
      pubs, docCounts, deadlines,
    };
  }

  /* ────────────────────────────────────────────────────────────────
     Timeline model
     ──────────────────────────────────────────────────────────────── */

  function timelineModel(no) {
    const o = opts(), s = app(no);
    const mn = s.sources.main?.data || {}, dl = s.sources.doclist?.data || {};
    const ev = s.sources.event?.data || {}, lg = s.sources.legal?.data || {};
    const fm = s.sources.family?.data || {};
    const items = [];

    for (const e of mn.recentEvents || [])
      items.push({ type:'item', dateStr:e.dateStr, title:e.title, detail:[e.detail,e.source||'Main'].filter(Boolean).join('\n'), level:'info', url:tabUrl(no,'main') });

    // Doclist: group bundles by date
    const bk = new Map(), sg = [];
    for (const d of dl.docs || []) {
      const grp = d.bundle && !['Other','Procedure','Applicant','Opposition'].includes(d.bundle);
      if (!grp) { sg.push({ type:'item', dateStr:d.dateStr, title:d.title, detail:[d.procedure,'All documents'].filter(Boolean).join(' \u00b7 '), level:d.level||'info', url:d.url }); continue; }
      const k = `${d.dateStr}|${d.bundle}`;
      if (!bk.has(k)) bk.set(k, { type:'group', dateStr:d.dateStr, title:d.bundle, level:d.level||'info', url:d.url, items:[] });
      const b = bk.get(k);
      b.items.push({ dateStr:d.dateStr, title:d.title, detail:d.procedure||'All documents', level:d.level||'info', url:d.url });
      b.level = topSev([b.level, d.level||'info']);
    }
    for (const b of bk.values()) {
      if (b.items.length < 2) { const i = b.items[0]; items.push({ type:'item', dateStr:i.dateStr, title:i.title, detail:[i.detail,'All documents'].filter(Boolean).join(' \u00b7 '), level:i.level, url:i.url }); }
      else { b.items.sort(cmpDesc); items.push(b); }
    }
    items.push(...sg);

    if (o.showEventHistory) for (const e of ev.events || [])
      items.push({ type:'item', dateStr:e.dateStr, title:e.title, detail:[e.detail,'Event history'].filter(Boolean).join('\n'), level:'info', url:e.url||tabUrl(no,'event') });
    if (o.showLegalStatusEvents) for (const e of lg.events || [])
      items.push({ type:'item', dateStr:e.dateStr, title:e.title, detail:[e.detail,'Legal status'].filter(Boolean).join('\n'), level:'warn', url:e.url||tabUrl(no,'legal') });
    if (o.showPublications) for (const p of dedup([...(mn.publications||[]),...(fm.publications||[])], i=>`${i.no}${i.kind}|${i.dateStr}|${i.role}`))
      items.push({ type:'item', dateStr:p.dateStr, title:`${p.no}${p.kind||''} published`, detail:p.role||'Publication', level:'info', url:tabUrl(no,'main') });

    return dedup(items, i => i.type==='group' ? `g|${i.dateStr}|${i.title}|${(i.items||[]).map(x=>x.title).join('|')}` : `i|${i.dateStr}|${i.title}|${i.detail}|${i.url}`)
      .sort(cmpDesc).slice(0, o.timelineMaxEntries);
  }

  /* ────────────────────────────────────────────────────────────────
     Rendering — Overview
     ──────────────────────────────────────────────────────────────── */

  function copyBtn(text, label = 'Copy') {
    return `<button class="epoRP-cp" data-copy="${esc(text)}">${esc(label)}</button>`;
  }

  function renderOverview(no) {
    const m = overviewModel(no);
    const clock = (t, d) => { const a = fmtAgo(d); return a ? `${t}\n(${a})` : t; };
    const wLvl = m.waitDays == null ? 'info' : m.waitDays > 365 ? 'bad' : m.waitDays > 180 ? 'warn' : 'ok';

    let html = `
<div class="epoRP-c">
  <div class="epoRP-g">
    <div class="epoRP-l">Title</div><div class="epoRP-v">${esc(m.title)}</div>
    <div class="epoRP-l">Applicant</div><div class="epoRP-v">${esc(m.applicant)}</div>
    ${m.inventor ? `<div class="epoRP-l">Inventor</div><div class="epoRP-v">${esc(m.inventor)}</div>` : ''}
    <div class="epoRP-l">Application #</div><div class="epoRP-v">${esc(m.appNum)} ${copyBtn(m.appNum)}</div>
    <div class="epoRP-l">Filing date</div><div class="epoRP-v">${esc(m.filingDate)}${m.caseAge != null ? ` <span class="epoRP-m">(${m.caseAge} days / ${(m.caseAge/365.25).toFixed(1)} yr)</span>` : ''}</div>
    <div class="epoRP-l">Priority</div><div class="epoRP-v">${esc(m.priority)}</div>
    ${m.isDivisional ? `<div class="epoRP-l">Type</div><div class="epoRP-v"><span class="epoRP-bdg warn">Divisional</span></div>` : ''}
    <div class="epoRP-l">Stage</div><div class="epoRP-v">${esc(m.stage)}</div>
    <div class="epoRP-l">Status</div><div class="epoRP-v">${esc(m.status)}</div>
    <div class="epoRP-l">Representative</div><div class="epoRP-v">${esc(m.representative)}</div>
    ${m.ipc ? `<div class="epoRP-l">IPC / CPC</div><div class="epoRP-v">${esc(m.ipc)}</div>` : ''}
    ${m.designatedStates ? `<div class="epoRP-l">Designated states</div><div class="epoRP-v">${esc(m.designatedStates)}</div>` : ''}
  </div>
</div>`;

    // Deadlines
    if (m.deadlines.length) {
      html += `<div class="epoRP-c"><h4>Key Deadlines</h4><div class="epoRP-dl">`;
      for (const dl of m.deadlines) {
        const ds = fmtD(dl.date), da = daysAgo(ds);
        const ago = da != null && da < 0 ? `in ${-da} days` : da === 0 ? 'TODAY' : da != null ? `${da} days ago` : '';
        html += `<div class="epoRP-dr"><div class="epoRP-dn">${esc(dl.label)}</div><div class="epoRP-dd"><span class="epoRP-bdg ${esc(dl.level)}">${esc(ds)} ${ago ? `\u00b7 ${esc(ago)}` : ''}</span></div></div>`;
      }
      html += `</div></div>`;
    }

    // Clocks / Waiting
    html += `
<div class="epoRP-c">
  <h4>Clocks / Waiting</h4>
  <div class="epoRP-g">
    <div class="epoRP-l">EPO last action</div><div class="epoRP-v">${esc(clock(m.epoLast, m.epoDays))}</div>
    <div class="epoRP-l">Applicant last</div><div class="epoRP-v">${esc(clock(m.aplLast, m.aplDays))}</div>
    <div class="epoRP-l">Waiting on EPO</div><div class="epoRP-v"><span class="epoRP-bdg ${esc(wLvl)}">${m.waitDays != null ? esc(`${m.waitDays} days`) : '\u2014'}</span></div>
    <div class="epoRP-l">Since</div><div class="epoRP-v">${esc(m.waitSince || '\u2014')}</div>
    <div class="epoRP-l">Latest filing</div><div class="epoRP-v">${esc(m.waitText)}</div>
  </div>
</div>`;

    // Document summary
    const cats = Object.entries(m.docCounts).sort((a,b) => b[1]-a[1]);
    if (cats.length) {
      html += `<div class="epoRP-c"><h4>Documents (${(m.pubs||[]).length ? Object.values(m.docCounts).reduce((a,b)=>a+b,0) : 0})</h4><div class="epoRP-g">`;
      for (const [k,v] of cats) html += `<div class="epoRP-l">${esc(k)}</div><div class="epoRP-v">${v}</div>`;
      html += `</div></div>`;
    }

    // Renewals
    html += `<div class="epoRP-c"><h4>Renewals</h4>`;
    if (m.renCount > 0) {
      html += `<div class="epoRP-g">
        <div class="epoRP-l">Latest</div><div class="epoRP-v">${esc(m.latestRen?.dateStr||'')} \u00b7 ${esc(m.latestRen?.title||'')}</div>
        ${m.maxRenYr ? `<div class="epoRP-l">Highest year</div><div class="epoRP-v">Year ${m.maxRenYr}</div>` : ''}
        <div class="epoRP-l">Total events</div><div class="epoRP-v">${m.renCount}</div>
      </div>`;
    } else html += `<div class="epoRP-m">No renewal events in legal status.</div>`;
    html += `</div>`;

    // UPC / UE
    html += `<div class="epoRP-c"><h4>UPC / Unitary Effect</h4><div class="epoRP-g">
      <div class="epoRP-l">UE status</div><div class="epoRP-v">${esc(m.ueStatus || '\u2014')}</div>
      <div class="epoRP-l">UPC opt-out</div><div class="epoRP-v">${m.upcOptOut ? `<span class="epoRP-bdg ${/opted out/i.test(m.upcOptOut)?'warn':'info'}">${esc(m.upcOptOut)}</span>` : '\u2014'}</div>
      ${m.ueMember ? `<div class="epoRP-l">Member states</div><div class="epoRP-v">${esc(m.ueMember)}</div>` : ''}
    </div></div>`;

    // Publications
    const pubs = m.pubs.slice(0, 14);
    html += `<div class="epoRP-c"><h4>Publications (${m.pubs.length})</h4>`;
    if (pubs.length) {
      html += `<div class="epoRP-pubs">`;
      for (const p of pubs) {
        const n = `${p.no}${p.kind||''}`;
        html += `<div class="epoRP-pub"><div><div class="epoRP-pn">${esc(n)} ${copyBtn(n)}</div><div class="epoRP-pm">${esc(p.role||'Publication')}</div></div><div class="epoRP-d">${esc(p.dateStr||'\u2014')}</div></div>`;
      }
      html += `</div>`;
    } else html += `<div class="epoRP-m">\u2014</div>`;
    html += `</div>`;

    // Export button
    html += `<div class="epoRP-c"><button class="epoRP-btn" id="epoRP-export" style="width:100%">Copy case summary to clipboard</button></div>`;

    return html;
  }

  /* ────────────────────────────────────────────────────────────────
     Rendering — Timeline
     ──────────────────────────────────────────────────────────────── */

  function rItem(i) {
    return `<div class="epoRP-it"><div class="epoRP-dot ${esc(i.level||'info')}"></div><div class="epoRP-d">${esc(i.dateStr||'\u2014')}</div><div><div class="epoRP-mn">${i.url?`<a class="epoRP-a" href="${esc(i.url)}">${esc(i.title)}</a>`:esc(i.title)}</div><div class="epoRP-sb">${esc(i.detail||'')}</div></div></div>`;
  }

  function renderTimeline(no) {
    const items = timelineModel(no);
    if (!items.length) return '<div class="epoRP-c"><div class="epoRP-m">No timeline items yet. Background loading will populate this.</div></div>';

    const today = fmtD(new Date());
    let ins = false; const bl = [];
    for (const i of items) {
      if (!ins) { const d = toDate(i.dateStr), now = new Date(), mid = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(); if (!d || d.getTime() <= mid) { bl.push(`<div class="epoRP-today"><span>Today \u00b7 ${esc(today)}</span></div>`); ins = true; } }
      if (i.type === 'group') {
        bl.push(`<div class="epoRP-grp"><div class="epoRP-grph"><div class="epoRP-dot ${esc(i.level||'info')}"></div><div class="epoRP-d">${esc(i.dateStr||'\u2014')}</div><div><div class="epoRP-mn">${esc(i.title)} (${(i.items||[]).length})</div><div class="epoRP-sb">Grouped documents</div></div></div><div class="epoRP-grpi">${(i.items||[]).map(rItem).join('')}</div></div>`);
      } else bl.push(rItem(i));
    }
    if (!ins) bl.unshift(`<div class="epoRP-today"><span>Today \u00b7 ${esc(today)}</span></div>`);
    return `<div class="epoRP-c">${bl.join('')}</div>`;
  }

  /* ────────────────────────────────────────────────────────────────
     Rendering — Options
     ──────────────────────────────────────────────────────────────── */

  function renderOpts() {
    const o = opts();
    const chk = (id, key, label, help) => `<label class="epoRP-or"><div><div class="epoRP-ol">${esc(label)}</div><div class="epoRP-oh">${esc(help)}</div></div><input id="${id}" type="checkbox" ${o[key]?'checked':''}/></label>`;
    return `
<div class="epoRP-c"><h4>Options</h4>
  ${chk('epoRP-oS','shiftBody','Shift page left','Adds right padding so the page doesn\'t sit under the sidebar.')}
  ${chk('epoRP-oP','preloadAllTabs','Preload all tabs','Fetches all six case pages into cache in the background.')}
  ${chk('epoRP-oPu','showPublications','Show publications','Include publication entries in the timeline.')}
  ${chk('epoRP-oE','showEventHistory','Show event history','Include event history rows in the timeline.')}
  ${chk('epoRP-oL','showLegalStatusEvents','Show legal status','Include legal status rows in the timeline.')}
</div>
<div class="epoRP-c"><h4>Actions</h4>
  <div style="display:flex;gap:6px;flex-wrap:wrap">
    <button class="epoRP-btn" id="epoRP-aRefresh">Reload all pages</button>
    <button class="epoRP-btn" id="epoRP-aClear">Clear case cache</button>
  </div>
  <div class="epoRP-oh" style="margin-top:6px">v${esc(VERSION)} \u00b7 fetch() mode \u00b7 ${FETCH_CONCURRENCY} concurrent</div>
</div>`;
  }

  /* ────────────────────────────────────────────────────────────────
     Rendering — Logs
     ──────────────────────────────────────────────────────────────── */

  function renderLogs() {
    if (!R.logs.length) return '<div class="epoRP-c"><div class="epoRP-m">No log entries yet.</div></div>';
    const rows = R.logs.slice().reverse().map(e => {
      const t = e.ts instanceof Date ? e.ts : new Date(e.ts);
      const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
      const lc = e.level==='error'?'bad':e.level==='warn'?'warn':e.level==='ok'?'ok':'info';
      return `<div class="epoRP-lr"><div class="epoRP-lt">${esc(ts)}</div><div class="epoRP-dot ${esc(lc)}" style="width:8px;height:8px;margin-top:3px"></div><div class="epoRP-lm">${esc(e.msg)}</div></div>`;
    });
    return `<div class="epoRP-c"><h4>Activity Log (${R.logs.length})</h4><div class="epoRP-ll">${rows.join('')}</div></div>`;
  }

  /* ────────────────────────────────────────────────────────────────
     Panel UI
     ──────────────────────────────────────────────────────────────── */

  function badges(no) {
    const s = app(no), srcs = TABS.map(t=>s.sources[t.key]).filter(Boolean);
    const ok = srcs.filter(x=>x.status==='ok').length;
    const ml = s.sources.main?.data?.statusLevel || 'info';
    return {
      left: `<span class="epoRP-bdg ${esc(ml)}">${esc(s.sources.main?.data?.statusSimple||'Unknown')}</span>`,
      right: `<span class="epoRP-bdg ${R.fetching?'info':'ok'}">${esc(R.fetching?R.fetchLabel:`${ok}/${TABS.length}`)}</span>`,
    };
  }

  function createPanel() {
    let p = document.getElementById('epoRP-panel');
    if (p) return p;
    p = document.createElement('aside');
    p.id = 'epoRP-panel'; p.className = 'epoRP';
    p.innerHTML = `
<div class="epoRP-hd">
  <div class="epoRP-row"><div><div class="epoRP-t">Register Pro</div><div class="epoRP-st" id="epoRP-sub"></div></div><div class="epoRP-acts"><button class="epoRP-btn" id="epoRP-ref">\u21bb</button><button class="epoRP-btn" id="epoRP-col">\u2212</button></div></div>
  <div class="epoRP-badges"><div id="epoRP-bl"></div><div id="epoRP-br"></div></div>
  <div class="epoRP-tabs">
    <button class="epoRP-tab" data-v="overview">Overview</button>
    <button class="epoRP-tab" data-v="timeline">Timeline</button>
    <button class="epoRP-tab" data-v="options">Options</button>
    <button class="epoRP-tab" data-v="logs">Logs</button>
  </div>
</div>
<div class="epoRP-body" id="epoRP-bd"></div>`;
    document.body.appendChild(p);

    p.querySelector('#epoRP-ref').addEventListener('click', () => prefetchAll(R.appNo, true));
    p.querySelector('#epoRP-col').addEventListener('click', () => { sUI({ collapsed: !R.collapsed }); renderPanel(); });
    p.querySelectorAll('.epoRP-tab').forEach(b => b.addEventListener('click', () => { sUI({ activeView: b.dataset.v || 'overview' }); renderPanel(); }));

    R.panel = p; R.body = p.querySelector('#epoRP-bd');
    return p;
  }

  function wireOpts() {
    const b = R.body; if (!b) return;
    const hk = (id, key) => { const el = b.querySelector('#'+id); if (el) el.addEventListener('change', () => { sOpts({ [key]: !!el.checked }); applyShift(); renderPanel(); }); };
    hk('epoRP-oS','shiftBody'); hk('epoRP-oP','preloadAllTabs'); hk('epoRP-oPu','showPublications'); hk('epoRP-oE','showEventHistory'); hk('epoRP-oL','showLegalStatusEvents');
    b.querySelector('#epoRP-aRefresh')?.addEventListener('click', () => prefetchAll(R.appNo, true));
    b.querySelector('#epoRP-aClear')?.addEventListener('click', () => { patch(R.appNo, s => { s.sources = {}; }); flushNow(); captureLive(R.appNo); renderPanel(); prefetchAll(R.appNo, true); });
  }

  function wireOverview() {
    const b = R.body; if (!b) return;
    // Copy buttons
    b.querySelectorAll('.epoRP-cp').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.copy || '').then(() => { btn.textContent = 'OK'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); });
      });
    });
    // Export
    b.querySelector('#epoRP-export')?.addEventListener('click', () => {
      const m = overviewModel(R.appNo);
      const lines = [
        `${m.appNum} \u2014 ${m.title}`,
        `Applicant: ${m.applicant}`,
        `Filing: ${m.filingDate}`, `Priority: ${m.priority}`,
        `Status: ${m.status}`, `Stage: ${m.stage}`,
        m.isDivisional ? 'Type: Divisional' : '',
        `Representative: ${m.representative}`,
        m.designatedStates ? `Designated: ${m.designatedStates}` : '',
        m.ipc ? `IPC/CPC: ${m.ipc}` : '',
        '', '--- Clocks ---',
        `EPO last: ${m.epoLast}${m.epoDays != null ? ` (${fmtAgo(m.epoDays)})` : ''}`,
        `Applicant last: ${m.aplLast}${m.aplDays != null ? ` (${fmtAgo(m.aplDays)})` : ''}`,
        `Waiting on EPO: ${m.waitDays != null ? `${m.waitDays} days` : '\u2014'}`,
        '', '--- Renewals ---',
        m.renCount ? `Latest: ${m.latestRen?.dateStr} \u00b7 ${m.latestRen?.title}` : 'No renewal events.',
        m.maxRenYr ? `Highest year: ${m.maxRenYr}` : '',
        '', '--- Publications ---',
        ...m.pubs.slice(0,10).map(p => `${p.no}${p.kind||''} \u00b7 ${p.dateStr} \u00b7 ${p.role||''}`)
      ].filter(l => l !== '').join('\n');
      navigator.clipboard.writeText(lines).then(() => {
        const btn = b.querySelector('#epoRP-export');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy case summary to clipboard'; }, 2000); }
      });
    });
  }

  function applyShift() { document.body.classList.toggle('epoRP-shifted', !!opts().shiftBody && isCase()); }

  function renderPanel() {
    if (!isCase()) {
      try { R.panel?.remove(); } catch {}
      R.panel = null; R.body = null;
      document.body.classList.remove('epoRP-shifted');
      return;
    }
    const o = opts(), p = createPanel();
    R.appNo = appNo(); applyShift();

    p.classList.toggle('collapsed', !!R.collapsed);
    p.style.width = R.collapsed ? '180px' : `${o.panelWidthPx}px`;

    p.querySelector('#epoRP-sub').textContent = `${R.appNo} \u00b7 ${tabSlug()}`;
    const bg = badges(R.appNo);
    p.querySelector('#epoRP-bl').innerHTML = bg.left;
    p.querySelector('#epoRP-br').innerHTML = bg.right;
    p.querySelector('#epoRP-col').textContent = R.collapsed ? '+' : '\u2212';
    p.querySelectorAll('.epoRP-tab').forEach(b => b.classList.toggle('on', b.dataset.v === R.activeView));

    const bd = R.body; if (!bd) return;
    if (R.collapsed) { bd.innerHTML = ''; return; }

    if (R.activeView === 'timeline') { bd.innerHTML = renderTimeline(R.appNo); return; }
    if (R.activeView === 'options') { bd.innerHTML = renderOpts(); wireOpts(); return; }
    if (R.activeView === 'logs') { bd.innerHTML = renderLogs(); return; }
    bd.innerHTML = renderOverview(R.appNo);
    wireOverview();
  }

  /* ────────────────────────────────────────────────────────────────
     Init + navigation monitor
     ──────────────────────────────────────────────────────────────── */

  let _capT = null;

  function init(force = false) {
    if (!isCase()) { cancelFetch(); renderPanel(); return; }
    const no = appNo(), changed = R.appNo !== no;
    R.appNo = no;
    if (changed && R.fetchApp && R.fetchApp !== no) cancelFetch();

    captureLive(no); renderPanel();

    if (_capT) clearTimeout(_capT);
    _capT = setTimeout(() => { _capT = null; if (R.appNo !== no) return; captureLive(no); flushNow(); renderPanel(); }, 2000);

    if (force) { prefetchAll(no, true); return; }
    if (TABS.some(t => !fresh(app(no).sources[t.key], opts().refreshHours))) prefetchAll(no, false);
  }

  setInterval(() => { if (location.href !== R.href) { R.href = location.href; init(false); } }, 600);

  addEventListener('storage', e => { if (![CACHE_KEY, OPTIONS_KEY, UI_KEY].includes(e.key)) return; if (e.key === CACHE_KEY) _mem = null; if (isCase()) renderPanel(); });
  addEventListener('focus', () => { if (isCase()) renderPanel(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isCase()) renderPanel(); });
  addEventListener('pageshow', () => init(false));
  addEventListener('beforeunload', flushNow);

  init(false);
})();