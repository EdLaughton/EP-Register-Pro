// ==UserScript==
// @name         EPO Register Pro
// @namespace    https://tampermonkey.net/
// @version      7.0.7
// @description  EP patent attorney sidebar for the European Patent Register with cross-tab case cache, timeline, and diagnostics
// @updateURL    https://raw.githubusercontent.com/epregisterpro/EP-Register-Pro/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/epregisterpro/EP-Register-Pro/main/script.user.js
// @match        https://register.epo.org/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      unifiedpatentcourt.org
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__epoRegisterPro700) return;
  window.__epoRegisterPro700 = true;

  const VERSION = '7.0.7';
  const CACHE_KEY = 'epoRP_700_cache';
  const OPTIONS_KEY = 'epoRP_700_options';
  const UI_KEY = 'epoRP_700_ui';
  const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;

  const CACHE_SCHEMA = 2;
  const MAX_CASES = 80;
  const MAX_LOGS_PER_APP = 600;
  const FETCH_CONCURRENCY = 2;
  const FETCH_TIMEOUT_MS = 15000;
  const FETCH_RETRIES = 1;

  const SOURCES = [
    { key: 'main', slug: 'main', title: 'EP About this file' },
    { key: 'doclist', slug: 'doclist', title: 'EP All documents' },
    { key: 'event', slug: 'event', title: 'EP Event history' },
    { key: 'family', slug: 'family', title: 'EP Patent family' },
    { key: 'legal', slug: 'legal', title: 'EP Legal status' },
    { key: 'ueMain', slug: 'ueMain', title: 'UP About this file' },
  ];

  const DEFAULTS = {
    shiftBody: true,
    panelWidthPx: 430,
    pageRightPaddingPx: 450,
    preloadAllTabs: true,
    refreshHours: 6,
    timelineMaxEntries: 350,
    showPublications: true,
    showEventHistory: true,
    showLegalStatusRows: true,
    showRenewals: true,
    showUpcUe: true,
    timelineDensity: 'standard',
    timelineEventLevel: 'info',
    timelineLegalLevel: 'warn',
  };

  const runtime = {
    appNo: '',
    href: location.href,
    activeView: loadJson(UI_KEY, {}).activeView || 'overview',
    collapsed: !!loadJson(UI_KEY, {}).collapsed,
    panel: null,
    body: null,
    fetching: false,
    fetchLabel: 'Idle',
    abortController: null,
    fetchCaseNo: null,
  };

  let memory = null;
  let dirty = false;
  let flushTimer = null;
  let renderTimer = null;
  let initTimer = null;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota errors
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalize(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function dedupeMultiline(value) {
    const raw = normalize(value);
    if (!raw) return '';

    const lines = raw.split('\n').map((v) => normalize(v)).filter(Boolean);
    const uniqueLines = [];
    for (const line of lines) {
      if (uniqueLines[uniqueLines.length - 1] === line) continue;
      uniqueLines.push(line);
    }

    if (uniqueLines.length % 2 === 0) {
      const half = uniqueLines.length / 2;
      const a = uniqueLines.slice(0, half).join('\n');
      const b = uniqueLines.slice(half).join('\n');
      if (a && a === b) return a;
    }

    return uniqueLines.join('\n');
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(node) {
    return node ? normalize(node.innerText || node.textContent || '') : '';
  }

  function parseDateString(value) {
    const m = String(value || '').match(DATE_RE);
    if (!m) return null;
    const [d, mth, y] = m[1].split('.').map(Number);
    const dt = new Date(y, mth - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function formatDate(dt) {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
  }

  function compareDateDesc(a, b) {
    return (parseDateString(b?.dateStr)?.getTime() || 0) - (parseDateString(a?.dateStr)?.getTime() || 0);
  }

  function dedupe(items, keyFn) {
    const out = [];
    const seen = new Set();
    for (const item of items || []) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function bodyText(doc) {
    return normalize(doc?.body?.innerText || doc?.body?.textContent || '');
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html || '', 'text/html');
  }

  function appStore() {
    if (memory) return memory;
    const loaded = loadJson(CACHE_KEY, null);
    if (!loaded || typeof loaded !== 'object') {
      memory = { schema: CACHE_SCHEMA, apps: {} };
      return memory;
    }
    if (!loaded.schema || loaded.schema !== CACHE_SCHEMA) {
      memory = { schema: CACHE_SCHEMA, apps: loaded.apps || {} };
      return memory;
    }
    memory = loaded;
    if (!memory.apps) memory.apps = {};
    return memory;
  }

  function markDirty() {
    dirty = true;
    if (!flushTimer) flushTimer = setTimeout(flushCache, 500);
  }

  function evictOldCases() {
    const s = appStore();
    const keys = Object.keys(s.apps || {});
    if (keys.length <= MAX_CASES) return;
    keys
      .sort((a, b) => (s.apps[a]?.updatedAt || 0) - (s.apps[b]?.updatedAt || 0))
      .slice(0, keys.length - MAX_CASES)
      .forEach((k) => delete s.apps[k]);
  }

  function flushCache() {
    flushTimer = null;
    if (!dirty || !memory) return;
    dirty = false;
    evictOldCases();
    saveJson(CACHE_KEY, memory);
  }

  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty || !memory) return;
    dirty = false;
    evictOldCases();
    saveJson(CACHE_KEY, memory);
  }

  function getCase(caseNo) {
    const store = appStore();
    if (!store.apps[caseNo]) {
      store.apps[caseNo] = {
        appNo: caseNo,
        updatedAt: 0,
        sources: {},
        logs: [],
      };
      markDirty();
    }
    if (!Array.isArray(store.apps[caseNo].logs)) store.apps[caseNo].logs = [];
    if (!store.apps[caseNo].sources || typeof store.apps[caseNo].sources !== 'object') store.apps[caseNo].sources = {};
    return store.apps[caseNo];
  }

  function patchCase(caseNo, mutator) {
    const store = appStore();
    if (!store.apps[caseNo]) {
      store.apps[caseNo] = { appNo: caseNo, updatedAt: 0, sources: {}, logs: [] };
    }
    mutator(store.apps[caseNo]);
    store.apps[caseNo].updatedAt = Date.now();
    markDirty();
    return store.apps[caseNo];
  }

  function addLog(caseNo, level, message, meta = {}) {
    try {
      patchCase(caseNo, (c) => {
        c.logs.push({ ts: nowIso(), level, message, meta });
        if (c.logs.length > MAX_LOGS_PER_APP) c.logs = c.logs.slice(-MAX_LOGS_PER_APP);
      });
    } catch {
      // logging must never break script
    }
  }

  function getLogs(caseNo) {
    return getCase(caseNo).logs || [];
  }

  function clearLogs(caseNo) {
    patchCase(caseNo, (c) => {
      c.logs = [];
    });
  }

  function isFresh(src, refreshHours) {
    return !!(src?.fetchedAt && Date.now() - src.fetchedAt < refreshHours * 3600000);
  }

  function currentUrl() {
    return new URL(location.href);
  }

  function currentLang() {
    return currentUrl().searchParams.get('lng') || 'en';
  }

  function appNoFromDocument(doc = document) {
    const m = bodyText(doc).match(/\b(EP\d{6,12})\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function appNoFromUrl(url = currentUrl()) {
    return normalize(url.searchParams.get('number') || '').toUpperCase();
  }

  function detectAppNo(url = currentUrl(), doc = document) {
    const fromUrl = appNoFromUrl(url);
    if (/^EP\d+/i.test(fromUrl)) return fromUrl;
    const fromDom = appNoFromDocument(doc);
    return /^EP\d+/i.test(fromDom) ? fromDom : '';
  }

  function tabSlug(url = currentUrl()) {
    return normalize(url.searchParams.get('tab') || 'main');
  }

  function isCasePage(url = currentUrl()) {
    return /\/application$/i.test(url.pathname) && /^EP\d+/i.test(detectAppNo(url));
  }

  function sourceUrl(caseNo, slug) {
    const u = new URL(`${location.origin}/application`);
    u.searchParams.set('number', caseNo);
    u.searchParams.set('lng', currentLang());
    u.searchParams.set('tab', slug);
    return u.toString();
  }

  function sourceTitle(key) {
    return SOURCES.find((s) => s.key === key)?.title || key;
  }

  function normalizeOptions(raw) {
    const merged = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };

    for (const key of Object.keys(DEFAULTS)) {
      if (typeof DEFAULTS[key] === 'boolean') {
        const value = merged[key];
        if (typeof value === 'string') {
          const lowered = value.trim().toLowerCase();
          merged[key] = !(lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === 'off' || lowered === '');
        } else {
          merged[key] = !!value;
        }
      }
    }

    const density = String(merged.timelineDensity || DEFAULTS.timelineDensity).toLowerCase();
    merged.timelineDensity = ['compact', 'standard', 'verbose'].includes(density) ? density : DEFAULTS.timelineDensity;

    const eventLevel = String(merged.timelineEventLevel || DEFAULTS.timelineEventLevel).toLowerCase();
    merged.timelineEventLevel = ['info', 'warn', 'bad', 'ok'].includes(eventLevel) ? eventLevel : DEFAULTS.timelineEventLevel;

    const legalLevel = String(merged.timelineLegalLevel || DEFAULTS.timelineLegalLevel).toLowerCase();
    merged.timelineLegalLevel = ['info', 'warn', 'bad', 'ok'].includes(legalLevel) ? legalLevel : DEFAULTS.timelineLegalLevel;

    return merged;
  }

  function options() {
    return normalizeOptions(loadJson(OPTIONS_KEY, {}));
  }

  function setOptions(patch) {
    const next = normalizeOptions({ ...options(), ...patch });
    saveJson(OPTIONS_KEY, next);
    return next;
  }

  function uiState() {
    return loadJson(UI_KEY, { activeView: runtime.activeView, collapsed: runtime.collapsed });
  }

  function setUiState(patch) {
    const next = { ...uiState(), ...patch };
    saveJson(UI_KEY, next);
    runtime.activeView = next.activeView;
    runtime.collapsed = !!next.collapsed;
  }

  function scheduleRender() {
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        renderPanel();
      }, 60);
    }
  }

  function fieldByLabel(doc, regexes) {
    for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('th,td')].map(text);
      if (cells.length < 2) continue;
      for (let i = 0; i < cells.length - 1; i++) {
        if (!regexes.some((re) => re.test(cells[i] || ''))) continue;
        const value = cells.slice(i + 1).filter(Boolean).join('\n').trim();
        if (value) return value;
      }
    }
    for (const dl of doc.querySelectorAll('dl')) {
      const children = [...dl.children];
      for (let i = 0; i < children.length; i++) {
        if (children[i]?.tagName !== 'DT') continue;
        if (!regexes.some((re) => re.test(text(children[i])))) continue;
        const values = [];
        for (let j = i + 1; j < children.length && children[j]?.tagName !== 'DT'; j++) {
          if (children[j]?.tagName === 'DD') values.push(text(children[j]));
        }
        const value = values.filter(Boolean).join('\n').trim();
        if (value) return value;
      }
    }
    return '';
  }

  function parseApplicationField(raw) {
    const m = normalize(raw).match(/\b(\d{6,10}\.\d)\b[\s\S]{0,70}?\b(\d{2}\.\d{2}\.\d{4})\b/);
    return { checksum: m?.[1] || '', filingDate: m?.[2] || '' };
  }

  function parsePriority(raw) {
    const out = [];
    for (const line of String(raw || '').split('\n').map((v) => v.trim()).filter(Boolean)) {
      const m = line.match(/\b([A-Z]{2}[A-Z0-9\/\-]{4,})\b[\s\S]{0,50}?\b(\d{2}\.\d{2}\.\d{4})\b/i);
      if (!m) continue;
      out.push({ no: m[1].replace(/\s+/g, '').toUpperCase(), dateStr: m[2] });
    }
    return dedupe(out, (i) => `${i.no}|${i.dateStr}`);
  }

  function parsePublications(textBlock, role = '') {
    const re = /\b((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)[A-Z0-9]{5,})([A-Z]\d)?\b[\s\S]{0,60}?\b(\d{2}\.\d{2}\.\d{4})\b/gi;
    const out = [];
    let m;
    while ((m = re.exec(textBlock || '')) !== null) {
      out.push({ no: m[1].toUpperCase(), kind: (m[2] || '').toUpperCase(), dateStr: m[3], role });
    }
    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function inferPublicationsFromDocs(docs = []) {
    const out = [];
    const re = /\b((?:EP|WO)[A-Z0-9]{6,})([A-Z]\d)?\b/i;
    for (const d of docs) {
      const title = String(d?.title || '');
      if (!/publication|published|a1|a2|a3|b1|b2/i.test(title)) continue;
      const m = title.match(re);
      if (!m) continue;
      out.push({
        no: String(m[1] || '').toUpperCase(),
        kind: String(m[2] || '').toUpperCase(),
        dateStr: d.dateStr || '',
        role: 'Inferred from documents',
      });
    }
    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function parseRecentEvents(raw) {
    const lines = String(raw || '').split('\n').map((v) => v.trim()).filter(Boolean);
    const out = [];
    let current = null;
    for (const line of lines) {
      const dm = line.match(DATE_RE);
      if (dm) {
        if (current?.dateStr && current?.title) out.push(current);
        current = { dateStr: dm[1], title: '', detail: '', source: 'Main page' };
        continue;
      }
      if (!current) continue;
      if (!current.title) current.title = line;
      else current.detail = current.detail ? `${current.detail} · ${line}` : line;
    }
    if (current?.dateStr && current?.title) out.push(current);
    return dedupe(out, (e) => `${e.dateStr}|${e.title}|${e.detail}`);
  }

  function summarizeStatus(raw) {
    const normalized = dedupeMultiline(raw);
    const t = normalize(normalized).toLowerCase();
    if (!t) return { simple: 'Unknown', level: 'warn' };
    if (/grant of patent is intended|rule\s*71\(3\)/i.test(normalized)) return { simple: 'Grant intended (R71(3))', level: 'warn' };
    if (/application has been published|has been published/.test(t)) return { simple: 'Published', level: 'info' };
    if (/granted|patent has been granted/.test(t)) return { simple: 'Granted', level: 'ok' };
    if (/revoked|refused|withdrawn|deemed to be withdrawn|expired|lapsed/.test(t)) return { simple: 'Withdrawn/closed', level: 'bad' };
    if (/examination/.test(t)) return { simple: 'Examination', level: 'info' };
    if (/search/.test(t)) return { simple: 'Search', level: 'info' };
    const oneLine = normalize(normalized.split('\n')[0] || normalized);
    return { simple: oneLine || 'Unknown', level: 'info' };
  }

  function parseApplicationType(mainData) {
    const appNo = mainData.appNo || '';
    const statusText = `${mainData.statusRaw || ''} ${mainData.title || ''} ${mainData.priorityText || ''} ${mainData.parentCase || ''}`;
    const priorities = mainData.priorities || [];

    if (/PCT|WO\d+/i.test(statusText) || priorities.some((p) => /^WO/i.test(p.no))) {
      return 'Euro-PCT regional phase';
    }
    if (mainData.isDivisional || mainData.parentCase) return 'Divisional';
    if (priorities.length > 0) return 'EP convention filing';
    if (/^EP\d+$/i.test(appNo)) return 'EP direct first filing';
    return 'Unknown';
  }

  function cleanTitle(raw) {
    const v = dedupeMultiline(raw)
      .replace(/^\s*(?:English|German|French)\s*:\s*/i, '')
      .replace(/\s*\[[^\]]+\]\s*$/g, '')
      .trim();
    return v;
  }

  function extractTitle(doc) {
    const explicitTitle = cleanTitle(fieldByLabel(doc, [/^Title$/i]));
    if (explicitTitle) {
      const firstLine = explicitTitle.split('\n').find((line) => !/^(English|German|French)\s*:/i.test(line.trim()) && line.trim());
      if (firstLine) return cleanTitle(firstLine);
      return cleanTitle(explicitTitle);
    }

    for (const el of [...doc.querySelectorAll('h1,h2,h3,strong,b,a')].slice(0, 120)) {
      const m = text(el).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
      if (m?.[1]) return cleanTitle(m[1]);
    }
    const fromBody = bodyText(doc).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
    return cleanTitle(fromBody?.[1] || '');
  }

  function parseMain(doc, caseNo) {
    const appField = fieldByLabel(doc, [/^Application number/i]);
    const statusField = dedupeMultiline(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
    const priorityField = fieldByLabel(doc, [/^Priority\b/i]);
    const publicationField = fieldByLabel(doc, [/^Publication$/i]);
    const recentEventField = fieldByLabel(doc, [/^Most recent event$/i]);

    const appInfo = parseApplicationField(appField);
    const priorities = parsePriority(priorityField);
    const status = summarizeStatus(statusField);

    const pageText = bodyText(doc);
    const parentMatch = pageText.match(/\bdivisional(?:\s+application)?(?:\s+of|\s+from)?\s*(EP\d{6,12})\b/i);
    const parentCase = parentMatch ? parentMatch[1].toUpperCase() : '';

    const titleField = normalize(fieldByLabel(doc, [/^Title$/i]));
    const applicantField = normalize(fieldByLabel(doc, [/^Applicant/i]));
    const representativeField = normalize(fieldByLabel(doc, [/^Representative/i]));

    const result = {
      appNo: caseNo,
      title: cleanTitle(titleField || extractTitle(doc)),
      applicant: normalize(applicantField.split('\n').find(Boolean) || ''),
      representative: normalize(representativeField.split('\n').find(Boolean) || ''),
      filingDate: appInfo.filingDate,
      checksum: appInfo.checksum,
      priorities,
      priorityText: priorities.map((p) => `${p.no} · ${p.dateStr}`).join('\n'),
      statusRaw: normalize(statusField),
      statusSimple: status.simple,
      statusLevel: status.level,
      designatedStates: dedupeMultiline(fieldByLabel(doc, [/^Designated/i])),
      recentEvents: parseRecentEvents(recentEventField),
      publications: parsePublications(publicationField, 'EP (this file)'),
      isDivisional: priorities.some((p) => /^EP/i.test(p.no)) || !!parentCase,
      parentCase,
    };
    result.applicationType = parseApplicationType(result);
    return result;
  }

  function bestTable(doc, hints) {
    let best = null;
    let score = 0;
    for (const table of doc.querySelectorAll('table')) {
      const headerText = text(table.querySelector('thead') || table).toLowerCase();
      let s = 0;
      for (const hint of hints) if (headerText.includes(hint.toLowerCase())) s++;
      if (s > score) {
        score = s;
        best = table;
      }
    }
    return score > 0 ? best : null;
  }

  function tableColumnMap(table) {
    const map = {};
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    [...(headerRow?.querySelectorAll('th,td') || [])].map(text).forEach((h, idx) => {
      const low = h.toLowerCase();
      if (/^date$/.test(low)) map.date = idx;
      if (low.includes('document type') || low === 'document') map.document = idx;
      if (low.includes('procedure')) map.procedure = idx;
    });
    return map;
  }

  function classifyDocument(title) {
    const t = title.toLowerCase();
    if (/search report|search opinion|written opinion|search strategy|esr/.test(t)) return { bundle: 'Search package', level: 'info', actor: 'EPO' };
    if (/rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t)) return { bundle: 'Grant package', level: 'warn', actor: 'EPO' };
    if (/article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining/.test(t)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    if (/renewal|annual fee/.test(t)) return { bundle: 'Renewal', level: 'ok', actor: 'Applicant' };
    if (/request for grant|description|claims|drawings|designation of inventor|priority document/.test(t)) return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
    if (/acknowledgement of receipt|receipt of electronic submission|auto-acknowledgement/.test(t)) return { bundle: 'Other', level: 'info', actor: 'System' };
    if (/reply|response|arguments|observations|letter|filed by applicant|submission|request/.test(t)) return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    if (/opposition|third party/.test(t)) return { bundle: 'Opposition', level: 'warn', actor: 'Third party' };
    return { bundle: 'Other', level: 'info', actor: 'Other' };
  }

  function parseDoclist(doc, caseNo) {
    const table = bestTable(doc, ['date', 'document']) || bestTable(doc, ['document type']);
    if (!table) return { docs: [] };
    const map = tableColumnMap(table);
    const docs = [];

    for (const row of table.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')];
      if (!cells.length || !row.querySelector("input[type='checkbox']")) continue;
      const rowText = text(row);
      const dm = rowText.match(DATE_RE);
      if (!dm) continue;
      const dateStr = dm[1];

      const getCell = (i) => (i != null && i < cells.length ? text(cells[i]) : '');
      let title = getCell(map.document);
      if (!title) title = [...row.querySelectorAll('a')].map(text).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
      if (!title) continue;

      const url = [...row.querySelectorAll('a[href]')].map((a) => a.href).find(Boolean) || sourceUrl(caseNo, 'doclist');
      const cls = classifyDocument(title);
      docs.push({
        dateStr,
        title,
        procedure: getCell(map.procedure),
        url,
        ...cls,
        source: 'All documents',
      });
    }

    return { docs: dedupe(docs, (d) => `${d.dateStr}|${d.title}|${d.url}`).sort(compareDateDesc) };
  }

  function parseDatedRows(doc, url) {
    const rows = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('th,td')].map(text).filter(Boolean);
      if (cells.length < 2) continue;
      const dateCell = cells.find((v) => DATE_RE.test(v));
      if (!dateCell) continue;
      const dateStr = dateCell.match(DATE_RE)[1];
      let payload = cells.filter((value, idx) => {
        if (idx === 0 && DATE_RE.test(value)) return false;
        return !/^(date|event|status|publication|document|document type)$/i.test(value);
      });
      if (!payload[0]) continue;
      if (/^event\s*date\s*:?$/i.test(payload[0]) && payload[1]) payload = payload.slice(1);
      if (!payload[0] || /^\d{2}\.\d{2}\.\d{4}$/.test(payload[0])) continue;
      rows.push({ dateStr, title: payload[0], detail: payload.slice(1).join(' · '), url });
    }
    return dedupe(rows, (r) => `${r.dateStr}|${r.title}|${r.detail}`).sort(compareDateDesc);
  }

  function parseFamily(doc) {
    return { publications: parsePublications(bodyText(doc), 'Family') };
  }

  function parseLegal(doc, caseNo) {
    const events = parseDatedRows(doc, sourceUrl(caseNo, 'legal'));
    const renewals = [];
    for (const e of events) {
      const low = `${e.title} ${e.detail}`.toLowerCase();
      if (!/renewal|annual fee|year\s*\d+/.test(low)) continue;
      const ym = low.match(/year\s*(\d+)/i) || low.match(/(\d+)(?:st|nd|rd|th)\s*year/i);
      renewals.push({ dateStr: e.dateStr, title: e.title, detail: e.detail, year: ym ? +ym[1] : null });
    }
    return { events, renewals: renewals.sort(compareDateDesc) };
  }

  function parseEventHistory(doc, caseNo) {
    return { events: parseDatedRows(doc, sourceUrl(caseNo, 'event')) };
  }

  function parseUe(doc) {
    const pageText = bodyText(doc);
    const status = normalize(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
    let ueStatus = '';
    let upcOptOut = '';

    if (/unitary effect registered|registered as a unitary patent/i.test(pageText)) ueStatus = 'Unitary effect registered';
    else if (/request.*unitary effect|unitary effect.*request/i.test(pageText)) ueStatus = 'UE requested';
    else if (status) ueStatus = status;

    if (/opt[\s-]*out.*registered|opted[\s-]*out/i.test(pageText)) upcOptOut = 'Opted out';
    else if (/opt[\s-]*out.*withdrawn|opt[\s-]*out.*removed/i.test(pageText)) upcOptOut = 'Opt-out withdrawn';
    else if (/no\s*opt[\s-]*out|not\s*opted/i.test(pageText)) upcOptOut = 'No opt-out';

    return {
      statusRaw: status,
      ueStatus,
      upcOptOut,
      memberStates: normalize(fieldByLabel(doc, [/^Member State/i, /^Participating/i, /^Designated/i])),
      text: pageText,
    };
  }

  function parseSource(key, doc, caseNo) {
    switch (key) {
      case 'main': return parseMain(doc, caseNo);
      case 'doclist': return parseDoclist(doc, caseNo);
      case 'event': return parseEventHistory(doc, caseNo);
      case 'family': return parseFamily(doc);
      case 'legal': return parseLegal(doc, caseNo);
      case 'ueMain': return parseUe(doc);
      default: return {};
    }
  }

  function captureLiveSource(caseNo) {
    const sourceKey = SOURCES.find((s) => s.slug === tabSlug())?.key;
    if (!sourceKey) return;
    try {
      const data = parseSource(sourceKey, document, caseNo);
      addLog(caseNo, 'info', `Live parse success`, { source: sourceKey, transport: 'dom' });
      patchCase(caseNo, (c) => {
        c.sources[sourceKey] = {
          key: sourceKey,
          title: sourceTitle(sourceKey),
          status: 'ok',
          fetchedAt: Date.now(),
          url: location.href,
          transport: 'dom',
          data,
        };
      });
    } catch (error) {
      addLog(caseNo, 'error', `Live parse failure: ${error?.message || error}`, { source: sourceKey, transport: 'dom' });
      patchCase(caseNo, (c) => {
        c.sources[sourceKey] = {
          key: sourceKey,
          title: sourceTitle(sourceKey),
          status: 'error',
          fetchedAt: Date.now(),
          url: location.href,
          transport: 'dom',
          error: String(error?.message || error),
        };
      });
    }
  }

  async function fetchWithTimeout(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function fetchCrossOrigin(url, signal) {
    if (typeof GM_xmlhttpRequest !== 'function') return fetchWithRetry(url, signal);
    return new Promise((resolve, reject) => {
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: FETCH_TIMEOUT_MS,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) resolve(String(res.responseText || ''));
          else reject(new Error(`HTTP ${res.status}`));
        },
        onerror: () => reject(new Error('Cross-origin request failed')),
        ontimeout: () => reject(new Error('Cross-origin request timed out')),
      });

      const onAbort = () => {
        try { req?.abort?.(); } catch {}
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function parseUpcOptOutResult(html, patentNumber) {
    const t = normalize((html || '').replace(/<[^>]+>/g, ' ')).toLowerCase();
    if (!t) return null;
    if (/no results found/.test(t)) {
      return { patentNumber, optedOut: false, status: 'No opt-out found', source: 'UPC registry' };
    }
    if (/opt-?out/.test(t) && (t.includes((patentNumber || '').toLowerCase()) || /results/.test(t))) {
      return { patentNumber, optedOut: true, status: 'Opted out', source: 'UPC registry' };
    }
    return null;
  }

  function upcCandidateNumbers(caseNo) {
    const c = getCase(caseNo);
    const main = c.sources.main?.data || {};
    const family = c.sources.family?.data || {};
    const picks = [];

    for (const p of [...(main.publications || []), ...(family.publications || [])]) {
      const m = String(p.no || '').toUpperCase().match(/^(EP\d{6,})/);
      if (m?.[1]) picks.push(m[1]);
    }

    if (/^EP\d{6,}$/i.test(main.parentCase || '')) picks.push(main.parentCase.toUpperCase());
    if (/^EP\d{6,}$/i.test(caseNo || '')) picks.push(caseNo.toUpperCase());

    return [...new Set(picks)].slice(0, 8);
  }

  async function refreshUpcRegistry(caseNo, signal) {
    const candidates = upcCandidateNumbers(caseNo);
    if (!candidates.length) return;

    for (const patentNumber of candidates) {
      const url = `https://www.unifiedpatentcourt.org/en/registry/opt-out/results?patent_number=${encodeURIComponent(patentNumber)}`;
      try {
        const html = await fetchCrossOrigin(url, signal);
        const parsed = parseUpcOptOutResult(html, patentNumber);
        if (!parsed) continue;
        patchCase(caseNo, (c) => {
          c.sources.upcRegistry = {
            key: 'upcRegistry',
            title: 'UPC Opt-out registry',
            status: 'ok',
            fetchedAt: Date.now(),
            url,
            transport: 'cross-origin',
            data: parsed,
          };
        });
        addLog(caseNo, 'ok', `UPC registry check: ${parsed.status}`, { source: 'upcRegistry', patentNumber });
        return;
      } catch (error) {
        addLog(caseNo, 'warn', `UPC registry check failed for ${patentNumber}: ${error?.message || error}`, { source: 'upcRegistry' });
      }
    }
  }

  async function fetchWithRetry(url, signal) {
    let lastError;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        return await fetchWithTimeout(url, signal);
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        if (attempt >= FETCH_RETRIES) throw error;
      }
    }
    throw lastError;
  }

  async function runPool(tasks, concurrency) {
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        await tasks[i]();
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  }

  function cancelPrefetch() {
    if (runtime.abortController) {
      runtime.abortController.abort();
      runtime.abortController = null;
    }
    runtime.fetching = false;
    runtime.fetchLabel = 'Idle';
    runtime.fetchCaseNo = null;
  }

  async function prefetchCase(caseNo, force = false) {
    const opts = options();
    if (!opts.preloadAllTabs && !force) return;
    if (!caseNo) return;

    if (runtime.fetchCaseNo === caseNo && runtime.fetching && !force) return;

    cancelPrefetch();

    const controller = new AbortController();
    runtime.abortController = controller;
    runtime.fetching = true;
    runtime.fetchCaseNo = caseNo;
    runtime.fetchLabel = 'Starting';

    addLog(caseNo, 'info', `Background prefetch start${force ? ' (forced)' : ''}`);
    scheduleRender();

    try {
      const needed = SOURCES.filter((s) => {
        if (force) return true;
        const cached = getCase(caseNo).sources[s.key];
        const fresh = isFresh(cached, opts.refreshHours);
        if (fresh) addLog(caseNo, 'info', `Skip fresh source ${s.key}`);
        return !fresh;
      });

      if (!needed.length) {
        addLog(caseNo, 'ok', 'Background prefetch complete (all fresh)');
        runtime.fetching = false;
        runtime.fetchLabel = 'Idle';
        scheduleRender();
        return;
      }

      let completed = 0;
      await runPool(needed.map((src) => async () => {
        if (controller.signal.aborted) return;

        const url = sourceUrl(caseNo, src.slug);
        runtime.fetchLabel = `${completed + 1}/${needed.length}`;
        addLog(caseNo, 'info', `Request source ${src.key}`, { source: src.key, transport: 'fetch', url });
        scheduleRender();

        try {
          const html = await fetchWithRetry(url, controller.signal);
          if (controller.signal.aborted) return;

          addLog(caseNo, 'ok', `Fetch success ${src.key}`, { source: src.key, sizeKb: +(html.length / 1024).toFixed(2), transport: 'fetch' });
          const parsed = parseSource(src.key, parseHtml(html), caseNo);
          addLog(caseNo, 'ok', `Parse success ${src.key}`, { source: src.key });

          patchCase(caseNo, (c) => {
            c.sources[src.key] = {
              key: src.key,
              title: src.title,
              status: 'ok',
              fetchedAt: Date.now(),
              url,
              transport: 'fetch',
              data: parsed,
            };
          });
          addLog(caseNo, 'info', `Cache write ${src.key}`, { source: src.key });
        } catch (error) {
          if (controller.signal.aborted) return;
          addLog(caseNo, 'error', `Fetch/parse failure ${src.key}: ${error?.message || error}`, { source: src.key, transport: 'fetch' });
          patchCase(caseNo, (c) => {
            c.sources[src.key] = {
              key: src.key,
              title: src.title,
              status: 'error',
              fetchedAt: Date.now(),
              url,
              transport: 'fetch',
              error: String(error?.message || error),
            };
          });
        }

        completed += 1;
        if (runtime.appNo === caseNo) scheduleRender();
      }), FETCH_CONCURRENCY);
    } finally {
      if (runtime.abortController === controller) {
        try {
          await refreshUpcRegistry(caseNo, controller.signal);
        } catch {
          // non-blocking
        }

        const c = getCase(caseNo);
        const okCount = SOURCES.filter((s) => c.sources[s.key]?.status === 'ok').length;
        addLog(caseNo, 'ok', `Background prefetch finish (${okCount}/${SOURCES.length} sources ok)`);
        runtime.fetching = false;
        runtime.fetchLabel = 'Idle';
        runtime.abortController = null;
        runtime.fetchCaseNo = null;
        flushNow();
        scheduleRender();
      }
    }
  }

  function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function inferRenewalModel(main, legal, ue) {
    const renewals = legal.renewals || [];
    const mentionGrant = (legal.events || []).find((e) => /mention of grant|granted/i.test(`${e.title} ${e.detail}`));
    const ueRegistered = /unitary effect registered/i.test(ue.ueStatus || ue.statusRaw || '');
    const filingDate = parseDateString(main.filingDate);
    const nextDue = filingDate ? addMonths(filingDate, 24) : null;

    const mode = ueRegistered
      ? 'Unitary patent renewal fees become centrally payable at EPO after UE registration.'
      : mentionGrant
        ? 'Post-grant national renewals generally due in designated states after grant.'
        : 'Pre-grant EP renewal fees start from patent year 3 (about 2 years from filing date).';

    return {
      count: renewals.length,
      latest: renewals[0] || null,
      highestYear: renewals.reduce((m, r) => (r.year && r.year > m ? r.year : m), 0) || null,
      explanatoryBasis: mode,
      mentionGrantDate: mentionGrant?.dateStr || '',
      isUnitary: ueRegistered,
      nextDue,
    };
  }

  function overviewModel(caseNo) {
    const c = getCase(caseNo);
    const main = c.sources.main?.data || {};
    const doclist = c.sources.doclist?.data || {};
    const family = c.sources.family?.data || {};
    const legal = c.sources.legal?.data || {};
    const ue = c.sources.ueMain?.data || {};
    const upcRegistry = c.sources.upcRegistry?.data || null;

    const docs = [...(doclist.docs || [])].sort(compareDateDesc);
    const latestEpo = docs.find((d) => d.actor === 'EPO');
    const latestApplicant = docs.find((d) => d.actor === 'Applicant');
    const publicationsPrimary = dedupe([...(main.publications || []), ...(family.publications || [])], (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
    const publicationFallback = publicationsPrimary.length ? [] : inferPublicationsFromDocs(docs);
    const publications = dedupe([...publicationsPrimary, ...publicationFallback], (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`).sort(compareDateDesc);

    const stage = docs.some((d) => d.bundle === 'Grant package')
      ? 'Grant stage'
      : docs.some((d) => d.bundle === 'Examination')
        ? 'Examination'
        : docs.some((d) => d.bundle === 'Search package')
          ? 'Search'
          : (main.statusSimple || 'Unknown');

    const deadlines = [];
    const filingDate = parseDateString(main.filingDate);
    const priorityDate = main.priorities?.[0] ? parseDateString(main.priorities[0].dateStr) : null;
    if (priorityDate) {
      const due = addMonths(priorityDate, 12);
      if (due > new Date()) deadlines.push({ label: 'Priority year ends', date: due, level: 'warn' });
    }
    const rule713 = docs.find((d) => /rule\s*71\(3\)|intention to grant/i.test(d.title));
    if (rule713) {
      const d = parseDateString(rule713.dateStr);
      if (d) deadlines.push({ label: 'R71(3) response (approx.)', date: addMonths(d, 4), level: 'warn' });
    }
    const art943 = docs.find((d) => /article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining/i.test(d.title));
    if (art943) {
      const d = parseDateString(art943.dateStr);
      if (d) deadlines.push({ label: 'Art. 94(3) response (approx.)', date: addMonths(d, 4), level: 'warn' });
    }
    if (filingDate) deadlines.push({ label: '20-year term from filing (reference)', date: addMonths(filingDate, 12 * 20), level: 'info' });

    const renewal = inferRenewalModel(main, legal, ue);

    const latestEpoDate = parseDateString(latestEpo?.dateStr);
    const latestApplicantDate = parseDateString(latestApplicant?.dateStr);
    const waitingOn = latestApplicantDate && (!latestEpoDate || latestApplicantDate > latestEpoDate) ? 'EPO' : 'Applicant';
    const waitingDays = waitingOn === 'EPO' && latestApplicantDate ? Math.floor((Date.now() - latestApplicantDate.getTime()) / 86400000) : null;
    const nextDeadline = deadlines.find((d) => d.date > new Date()) || deadlines[0] || null;

    return {
      title: main.title || '—',
      applicant: main.applicant || '—',
      representative: main.representative || '—',
      appNo: caseNo,
      filingDate: main.filingDate || '—',
      priority: main.priorityText || '—',
      stage,
      status: (main.statusRaw || '—').split('\n')[0],
      statusSimple: main.statusSimple || 'Unknown',
      statusLevel: main.statusLevel || 'warn',
      applicationType: main.applicationType || parseApplicationType(main),
      parentCase: main.parentCase || '',
      recentMainEvent: main.recentEvents?.[0] || (legal.events || [])[0] || null,
      latestEpo,
      latestApplicant,
      waitingOn,
      waitingDays,
      nextDeadline,
      publications,
      deadlines: deadlines.sort((a, b) => a.date - b.date),
      renewal,
      upcUe: {
        ueStatus: ue.ueStatus || 'Unknown',
        upcOptOut: upcRegistry ? (upcRegistry.optedOut ? 'Opted out' : 'No opt-out found') : (ue.upcOptOut || 'Unknown'),
        note: upcRegistry
          ? `UPC opt-out checked against registry for ${upcRegistry.patentNumber}.`
          : (ue.ueStatus
            ? 'UE/UPC inferred from UP tab and legal data where available.'
            : 'UE/UPC data unavailable in current cache; will populate when source loads.'),
      },
      docs,
      docBundles: docs.reduce((acc, d) => {
        acc[d.bundle] = (acc[d.bundle] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  function topLevel(levels) {
    if (levels.includes('bad')) return 'bad';
    if (levels.includes('warn')) return 'warn';
    if (levels.includes('ok')) return 'ok';
    return 'info';
  }

  function timelineModel(caseNo) {
    const opts = options();
    const c = getCase(caseNo);
    const main = c.sources.main?.data || {};
    const doclist = c.sources.doclist?.data || {};
    const family = c.sources.family?.data || {};
    const eventHistory = c.sources.event?.data || {};
    const legal = c.sources.legal?.data || {};

    const items = [];

    for (const e of main.recentEvents || []) {
      items.push({
        type: 'item',
        dateStr: e.dateStr,
        title: e.title,
        detail: [e.detail, 'Main page'].filter(Boolean).join('\n'),
        source: 'Main',
        level: 'info',
        url: sourceUrl(caseNo, 'main'),
      });
    }

    const grouped = new Map();
    for (const d of doclist.docs || []) {
      const shouldGroup = ['Search package', 'Grant package', 'Examination', 'Filing package', 'Applicant filings'].includes(d.bundle);
      if (!shouldGroup) {
        items.push({
          type: 'item',
          dateStr: d.dateStr,
          title: d.title,
          detail: [d.procedure, 'All documents'].filter(Boolean).join(' · '),
          source: 'Documents',
          level: d.level || 'info',
          url: d.url,
        });
        continue;
      }
      const key = `${d.dateStr}|${d.bundle}`;
      if (!grouped.has(key)) {
        grouped.set(key, { type: 'group', dateStr: d.dateStr, title: d.bundle, source: 'Documents', level: d.level || 'info', items: [] });
      }
      const g = grouped.get(key);
      g.items.push({ dateStr: d.dateStr, title: d.title, detail: d.procedure || 'All documents', source: 'Documents', level: d.level || 'info', url: d.url });
      g.level = topLevel([g.level, d.level || 'info']);
    }

    for (const g of grouped.values()) {
      g.items.sort(compareDateDesc);
      if (g.items.length === 1) {
        const first = g.items[0];
        items.push({ type: 'item', dateStr: first.dateStr, title: first.title, detail: `${first.detail} · ${g.title}`, source: 'Documents', level: first.level, url: first.url });
      } else {
        items.push(g);
      }
    }

    if (opts.showEventHistory) {
      for (const e of eventHistory.events || []) {
        items.push({ type: 'item', dateStr: e.dateStr, title: e.title, detail: [e.detail, 'Event history'].filter(Boolean).join('\n'), source: 'Event history', level: opts.timelineEventLevel || 'info', url: e.url || sourceUrl(caseNo, 'event') });
      }
    }

    if (opts.showLegalStatusRows) {
      for (const e of legal.events || []) {
        items.push({ type: 'item', dateStr: e.dateStr, title: e.title, detail: [e.detail, 'Legal status'].filter(Boolean).join('\n'), source: 'Legal status', level: opts.timelineLegalLevel || 'warn', url: e.url || sourceUrl(caseNo, 'legal') });
      }
    }

    if (opts.showPublications) {
      for (const p of dedupe([...(main.publications || []), ...(family.publications || [])], (x) => `${x.no}${x.kind}|${x.dateStr}|${x.role}`)) {
        items.push({ type: 'item', dateStr: p.dateStr, title: `${p.no}${p.kind || ''} publication`, detail: p.role || 'Publication', source: 'Publications', level: 'info', url: sourceUrl(caseNo, 'main') });
      }
    }

    return dedupe(items, (i) => {
      if (i.type === 'group') return `g|${i.dateStr}|${i.title}|${(i.items || []).map((x) => `${x.title}|${x.url}`).join('||')}`;
      return `i|${i.dateStr}|${i.title}|${i.detail}|${i.url}`;
    }).sort(compareDateDesc).slice(0, opts.timelineMaxEntries);
  }

  function documentIndexModel(caseNo, query = '') {
    const docs = getCase(caseNo).sources.doclist?.data?.docs || [];
    const q = normalize(query).toLowerCase();
    const filtered = !q
      ? docs
      : docs.filter((d) => `${d.dateStr} ${d.title} ${d.procedure} ${d.bundle}`.toLowerCase().includes(q));
    return filtered.slice(0, 120);
  }

  function renderOverview(caseNo) {
    const opts = options();
    const m = overviewModel(caseNo);

    let html = `<div class="epoRP-c"><div class="epoRP-g">
      <div class="epoRP-l">Title</div><div class="epoRP-v">${esc(m.title)}</div>
      <div class="epoRP-l">Applicant</div><div class="epoRP-v">${esc(m.applicant)}</div>
      <div class="epoRP-l">Application #</div><div class="epoRP-v">${esc(m.appNo)}</div>
      <div class="epoRP-l">Filing date</div><div class="epoRP-v">${esc(m.filingDate)}</div>
      <div class="epoRP-l">Priority</div><div class="epoRP-v">${esc(m.priority)}</div>
      <div class="epoRP-l">Type</div><div class="epoRP-v">${esc(m.applicationType)}${m.parentCase ? ` (<a class="epoRP-a" href="${esc(sourceUrl(m.parentCase, 'main'))}">${esc(m.parentCase)}</a>)` : ''}</div>
      <div class="epoRP-l">Stage</div><div class="epoRP-v">${esc(m.stage)}</div>
      <div class="epoRP-l">Status</div><div class="epoRP-v"><span class="epoRP-bdg ${esc(m.statusLevel)}">${esc(m.statusSimple)}</span></div>
      <div class="epoRP-l">Representative</div><div class="epoRP-v">${esc(m.representative)}</div>
    </div></div>`;

    html += `<div class="epoRP-c"><h4>Actionable status</h4><div class="epoRP-g">
      <div class="epoRP-l">EPO last action</div><div class="epoRP-v">${m.latestEpo ? `${esc(m.latestEpo.dateStr)} · ${esc(m.latestEpo.title)}` : '—'}</div>
      <div class="epoRP-l">Applicant last filing</div><div class="epoRP-v">${m.latestApplicant ? `${esc(m.latestApplicant.dateStr)} · ${esc(m.latestApplicant.title)}` : '—'}</div>
      <div class="epoRP-l">${m.waitingOn === 'EPO' ? 'Waiting on EPO' : 'Next deadline'}</div><div class="epoRP-v">${m.waitingOn === 'EPO' ? (m.waitingDays != null ? `<span class="epoRP-bdg ${m.waitingDays > 365 ? 'bad' : m.waitingDays > 180 ? 'warn' : 'ok'}">${m.waitingDays} days</span>` : '—') : (m.nextDeadline ? `${esc(formatDate(m.nextDeadline.date))} · ${esc(m.nextDeadline.label)}` : '—')}</div>
      <div class="epoRP-l">Most recent event</div><div class="epoRP-v">${m.recentMainEvent ? `${esc(m.recentMainEvent.dateStr)} · ${esc(m.recentMainEvent.title)}` : '—'}</div>
    </div></div>`;

    if (m.deadlines.length) {
      html += `<div class="epoRP-c"><h4>Deadlines & clocks</h4><div class="epoRP-dl">`;
      for (const d of m.deadlines) {
        const ds = formatDate(d.date);
        html += `<div class="epoRP-dr"><div class="epoRP-dn">${esc(d.label)}</div><div class="epoRP-dd"><span class="epoRP-bdg ${esc(d.level)}">${esc(ds)}</span></div></div>`;
      }
      html += `</div><div class="epoRP-m">Some deadlines are heuristic approximations from document dates.</div></div>`;
    }

    html += `<div class="epoRP-c"><h4>Document bundles</h4><div class="epoRP-g">`;
    for (const [bundle, count] of Object.entries(m.docBundles)) {
      html += `<div class="epoRP-l">${esc(bundle)}</div><div class="epoRP-v">${count}</div>`;
    }
    if (!Object.keys(m.docBundles).length) html += `<div class="epoRP-v">No document rows loaded yet.</div>`;
    html += `</div></div>`;

    if (opts.showRenewals) {
      html += `<div class="epoRP-c"><h4>Renewals</h4><div class="epoRP-g">
        <div class="epoRP-l">Mode</div><div class="epoRP-v">${esc(m.renewal.explanatoryBasis)}</div>
        <div class="epoRP-l">Next due (est.)</div><div class="epoRP-v">${m.renewal.nextDue ? esc(formatDate(m.renewal.nextDue)) : 'Unknown'}</div>
        <div class="epoRP-l">Latest renewal</div><div class="epoRP-v">${m.renewal.latest ? `${esc(m.renewal.latest.dateStr)} · ${esc(m.renewal.latest.title)}` : 'No renewal events cached.'}</div>
        <div class="epoRP-l">Highest year</div><div class="epoRP-v">${m.renewal.highestYear ? `Year ${m.renewal.highestYear}` : 'Unknown'}</div>
        ${m.renewal.mentionGrantDate ? `<div class="epoRP-l">Mention of grant</div><div class="epoRP-v">${esc(m.renewal.mentionGrantDate)}</div>` : ''}
      </div></div>`;
    }

    if (opts.showUpcUe) {
      html += `<div class="epoRP-c"><h4>UPC / UE</h4><div class="epoRP-g">
        <div class="epoRP-l">UE status</div><div class="epoRP-v">${esc(m.upcUe.ueStatus)}</div>
        <div class="epoRP-l">UPC opt-out</div><div class="epoRP-v">${esc(m.upcUe.upcOptOut)}${/Unitary effect registered/i.test(m.upcUe.ueStatus) ? ' (opt-out typically not applicable to UP)' : ''}</div>
      </div><div class="epoRP-m">${esc(m.upcUe.note)} Unitary effect is only possible after grant/publication milestones.</div></div>`;
    }

    html += `<div class="epoRP-c"><h4>Publications (${m.publications.length})</h4>`;
    if (m.publications.length) {
      html += `<div class="epoRP-pubs">`;
      for (const p of m.publications.slice(0, 24)) {
        const number = `${p.no}${p.kind || ''}`;
        html += `<div class="epoRP-pub"><div><div class="epoRP-pn"><a class="epoRP-a" href="${esc(sourceUrl(caseNo, 'main'))}">${esc(number)}</a></div><div class="epoRP-pm">${esc(p.role || 'Publication')}</div></div><div class="epoRP-d">${esc(p.dateStr)}</div></div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="epoRP-m">No publication entries yet. Family/main source may still be loading.</div>`;
    }
    html += `</div>`;

    return html;
  }

  function timelineItemHtml(item, compact = false) {
    return `<div class="epoRP-it ${compact ? 'compact' : ''}">
      <div class="epoRP-dot ${esc(item.level || 'info')}"></div>
      <div class="epoRP-d">${esc(item.dateStr || '—')}</div>
      <div>
        <div class="epoRP-mn">${item.url ? `<a class="epoRP-a" href="${esc(item.url)}">${esc(item.title)}</a>` : esc(item.title)}</div>
        <div class="epoRP-sb">${esc([item.detail, item.source].filter(Boolean).join(' · '))}</div>
      </div>
    </div>`;
  }

  function renderTimeline(caseNo) {
    const opts = options();
    const items = timelineModel(caseNo);
    if (!items.length) return `<div class="epoRP-c"><div class="epoRP-m">No timeline items yet. Background loading will populate cache incrementally.</div></div>`;

    const compact = opts.timelineDensity === 'compact';
    const verbose = opts.timelineDensity === 'verbose';
    const today = formatDate(new Date());

    let insertedToday = false;
    const out = [];

    for (const item of items) {
      if (!insertedToday) {
        const itemDate = parseDateString(item.dateStr);
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        if (!itemDate || itemDate.getTime() <= midnight.getTime()) {
          out.push(`<div class="epoRP-today"><span>Today · ${esc(today)}</span></div>`);
          insertedToday = true;
        }
      }

      if (item.type === 'group') {
        out.push(`<details class="epoRP-grp">
          <summary class="epoRP-grph">
            <div class="epoRP-dot ${esc(item.level || 'info')}"></div>
            <div class="epoRP-d">${esc(item.dateStr || '—')}</div>
            <div>
              <div class="epoRP-mn">${esc(item.title)} (${(item.items || []).length})</div>
              <div class="epoRP-sb">Grouped items · ${esc(item.source || 'Documents')}</div>
            </div>
            <div class="epoRP-garrow">▸</div>
          </summary>
          <div class="epoRP-grpi">${(item.items || []).map((x) => timelineItemHtml(x, compact)).join('')}</div>
        </details>`);
      } else {
        out.push(timelineItemHtml(item, compact));
      }
    }

    if (!insertedToday) out.unshift(`<div class="epoRP-today"><span>Today · ${esc(today)}</span></div>`);
    if (verbose) out.unshift(`<div class="epoRP-m">Verbose mode shows extended source labels and grouped event bodies.</div>`);

    const controls = `<div class="epoRP-c epoRP-tlControls"><div class="epoRP-g">
      <div class="epoRP-l">Include event history</div><div><input id="epoRP-tl-events" type="checkbox" ${opts.showEventHistory ? 'checked' : ''}></div>
      <div class="epoRP-l">Include legal status</div><div><input id="epoRP-tl-legal" type="checkbox" ${opts.showLegalStatusRows ? 'checked' : ''}></div>
      <div class="epoRP-l">Event importance</div><div><select id="epoRP-tl-event-level" class="epoRP-in"><option value="info" ${opts.timelineEventLevel === 'info' ? 'selected' : ''}>Info</option><option value="warn" ${opts.timelineEventLevel === 'warn' ? 'selected' : ''}>Warn</option><option value="bad" ${opts.timelineEventLevel === 'bad' ? 'selected' : ''}>High</option><option value="ok" ${opts.timelineEventLevel === 'ok' ? 'selected' : ''}>Low</option></select></div>
      <div class="epoRP-l">Legal importance</div><div><select id="epoRP-tl-legal-level" class="epoRP-in"><option value="warn" ${opts.timelineLegalLevel === 'warn' ? 'selected' : ''}>Warn</option><option value="info" ${opts.timelineLegalLevel === 'info' ? 'selected' : ''}>Info</option><option value="bad" ${opts.timelineLegalLevel === 'bad' ? 'selected' : ''}>High</option><option value="ok" ${opts.timelineLegalLevel === 'ok' ? 'selected' : ''}>Low</option></select></div>
    </div></div>`;

    return `${controls}<div class="epoRP-c">${out.join('')}</div>`;
  }

  function renderOptions() {
    const o = options();
    const checkbox = (id, key, title, help) => `<label class="epoRP-or"><div><div class="epoRP-ol">${esc(title)}</div><div class="epoRP-oh">${esc(help)}</div></div><input id="${id}" type="checkbox" ${o[key] ? 'checked' : ''}></label>`;

    return `<div class="epoRP-c"><h4>Options</h4>
      ${checkbox('epoRP-opt-shift', 'shiftBody', 'Shift page body', 'Adds right padding so Register content is not hidden under panel.')}
      ${checkbox('epoRP-opt-preload', 'preloadAllTabs', 'Preload all case tabs in background', 'Loads main/doclist/event/family/legal/ueMain in background and fills cache.')}
      ${checkbox('epoRP-opt-pubs', 'showPublications', 'Show publications on timeline', 'Includes publication entries from main + family sources.')}
      ${checkbox('epoRP-opt-events', 'showEventHistory', 'Show event-history rows', 'Includes EP Event history source rows in timeline.')}
      ${checkbox('epoRP-opt-legal', 'showLegalStatusRows', 'Show legal-status rows', 'Includes EP Legal status rows in timeline.')}
      ${checkbox('epoRP-opt-ren', 'showRenewals', 'Show renewals panel', 'Displays pre-/post-grant and UE-sensitive renewal explanation in Overview.')}
      ${checkbox('epoRP-opt-upc', 'showUpcUe', 'Show UPC/UE panel', 'Displays inferred UE + UPC opt-out state with notes.')}
      <label class="epoRP-or"><div><div class="epoRP-ol">Timeline density</div><div class="epoRP-oh">Compact / standard / verbose visual density.</div></div>
        <select id="epoRP-opt-density" class="epoRP-in"><option value="compact" ${o.timelineDensity === 'compact' ? 'selected' : ''}>Compact</option><option value="standard" ${o.timelineDensity === 'standard' ? 'selected' : ''}>Standard</option><option value="verbose" ${o.timelineDensity === 'verbose' ? 'selected' : ''}>Verbose</option></select>
      </label>
      <div class="epoRP-actions"><button class="epoRP-btn" id="epoRP-reload">Reload all background pages</button><button class="epoRP-btn" id="epoRP-clear">Clear this case cache</button></div>
    </div>`;
  }

  function renderLogs(caseNo) {
    const logs = getLogs(caseNo).slice().reverse();
    const rows = logs.length
      ? logs.map((entry) => `<div class="epoRP-lr"><div class="epoRP-lt">${esc(entry.ts.split('T')[1]?.replace('Z', '') || '')}</div><div class="epoRP-dot ${esc(entry.level)}"></div><div class="epoRP-lm">${esc(entry.message)}${entry.meta?.source ? ` · ${esc(entry.meta.source)}` : ''}${entry.meta?.transport ? ` · ${esc(entry.meta.transport)}` : ''}</div></div>`).join('')
      : `<div class="epoRP-m">No logs for this case yet.</div>`;

    return `<div class="epoRP-c"><h4>Logs (${logs.length})</h4><div class="epoRP-actions"><button class="epoRP-btn" id="epoRP-logRefresh">Refresh</button><button class="epoRP-btn" id="epoRP-logClear">Clear logs</button></div><div class="epoRP-ll">${rows}</div></div>`;
  }

  function renderBadges(caseNo) {
    const c = getCase(caseNo);
    const loaded = SOURCES.filter((s) => c.sources[s.key]?.status === 'ok').length;
    const statusLevel = c.sources.main?.data?.statusLevel || 'info';
    return {
      left: `<span class="epoRP-bdg ${esc(statusLevel)}">${esc(c.sources.main?.data?.statusSimple || 'Unknown')}</span>`,
      right: `<span class="epoRP-bdg ${runtime.fetching ? 'info' : 'ok'}">${runtime.fetching ? esc(runtime.fetchLabel) : `${loaded}/${SOURCES.length}`}</span>`,
    };
  }

  function applyBodyShift() {
    document.body.classList.toggle('epoRP-shifted', !!options().shiftBody && isCasePage());
  }

  function ensurePanel() {
    let panel = document.getElementById('epoRP-panel');
    if (panel) return panel;

    panel = document.createElement('aside');
    panel.id = 'epoRP-panel';
    panel.className = 'epoRP';
    panel.innerHTML = `<div class="epoRP-hd">
      <div class="epoRP-row"><div><div class="epoRP-t">EP Register Pro</div><div class="epoRP-st" id="epoRP-sub"></div></div><div class="epoRP-acts"><button class="epoRP-btn" id="epoRP-refresh">↻</button><button class="epoRP-btn" id="epoRP-collapse">−</button></div></div>
      <div class="epoRP-badges"><div id="epoRP-badge-left"></div><div id="epoRP-badge-right"></div></div>
      <div class="epoRP-tabs">
        <button class="epoRP-tab" data-view="overview">Overview</button>
        <button class="epoRP-tab" data-view="timeline">Timeline</button>
        <button class="epoRP-tab" data-view="options">Options</button>
      </div>
    </div><div class="epoRP-body" id="epoRP-body"></div>`;

    document.body.appendChild(panel);

    panel.querySelector('#epoRP-refresh').addEventListener('click', () => prefetchCase(runtime.appNo, true));
    panel.querySelector('#epoRP-collapse').addEventListener('click', () => {
      setUiState({ collapsed: !runtime.collapsed });
      renderPanel();
    });

    panel.querySelectorAll('.epoRP-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        setUiState({ activeView: btn.dataset.view || 'overview' });
        renderPanel();
      });
    });

    runtime.panel = panel;
    runtime.body = panel.querySelector('#epoRP-body');
    return panel;
  }

  function wireOptions() {
    const b = runtime.body;
    if (!b) return;

    const wireToggle = (id, key) => {
      const el = b.querySelector(`#${id}`);
      if (!el) return;
      el.checked = !!options()[key];
      el.addEventListener('change', () => {
        const next = setOptions({ [key]: !!el.checked });
        el.checked = !!next[key];
        applyBodyShift();
        renderPanel();
      });
    };

    wireToggle('epoRP-opt-shift', 'shiftBody');
    wireToggle('epoRP-opt-preload', 'preloadAllTabs');
    wireToggle('epoRP-opt-pubs', 'showPublications');
    wireToggle('epoRP-opt-events', 'showEventHistory');
    wireToggle('epoRP-opt-legal', 'showLegalStatusRows');
    wireToggle('epoRP-opt-ren', 'showRenewals');
    wireToggle('epoRP-opt-upc', 'showUpcUe');

    b.querySelector('#epoRP-opt-density')?.addEventListener('change', (event) => {
      setOptions({ timelineDensity: event.target.value || 'standard' });
      renderPanel();
    });

    b.querySelector('#epoRP-reload')?.addEventListener('click', () => {
      addLog(runtime.appNo, 'info', 'Manual reload all background pages');
      prefetchCase(runtime.appNo, true);
    });

    b.querySelector('#epoRP-clear')?.addEventListener('click', () => {
      patchCase(runtime.appNo, (c) => {
        c.sources = {};
      });
      addLog(runtime.appNo, 'warn', 'Manual clear case cache');
      flushNow();
      captureLiveSource(runtime.appNo);
      renderPanel();
      prefetchCase(runtime.appNo, true);
    });
  }

  function wireTimeline() {
    const b = runtime.body;
    if (!b) return;

    b.querySelector('#epoRP-tl-events')?.addEventListener('change', (event) => {
      setOptions({ showEventHistory: !!event.target.checked });
      renderPanel();
    });

    b.querySelector('#epoRP-tl-legal')?.addEventListener('change', (event) => {
      setOptions({ showLegalStatusRows: !!event.target.checked });
      renderPanel();
    });

    b.querySelector('#epoRP-tl-event-level')?.addEventListener('change', (event) => {
      setOptions({ timelineEventLevel: event.target.value || 'info' });
      renderPanel();
    });

    b.querySelector('#epoRP-tl-legal-level')?.addEventListener('change', (event) => {
      setOptions({ timelineLegalLevel: event.target.value || 'warn' });
      renderPanel();
    });
  }

  function wireLogs() {
    const b = runtime.body;
    if (!b) return;
    b.querySelector('#epoRP-logRefresh')?.addEventListener('click', () => renderPanel());
    b.querySelector('#epoRP-logClear')?.addEventListener('click', () => {
      clearLogs(runtime.appNo);
      addLog(runtime.appNo, 'warn', 'Logs cleared');
      renderPanel();
    });
  }

  function renderPanel() {
    if (!isCasePage()) {
      runtime.panel?.remove();
      runtime.panel = null;
      runtime.body = null;
      document.body.classList.remove('epoRP-shifted');
      return;
    }

    const caseNo = detectAppNo();
    runtime.appNo = caseNo;

    const panel = ensurePanel();
    const o = options();

    applyBodyShift();
    panel.classList.toggle('collapsed', runtime.collapsed);
    panel.style.width = runtime.collapsed ? '200px' : `${o.panelWidthPx}px`;

    panel.querySelector('#epoRP-sub').textContent = `${caseNo} · ${tabSlug()}`;
    panel.querySelector('#epoRP-collapse').textContent = runtime.collapsed ? '+' : '−';

    const badges = renderBadges(caseNo);
    panel.querySelector('#epoRP-badge-left').innerHTML = badges.left;
    panel.querySelector('#epoRP-badge-right').innerHTML = badges.right;

    panel.querySelectorAll('.epoRP-tab').forEach((btn) => btn.classList.toggle('on', btn.dataset.view === runtime.activeView));

    const body = runtime.body;
    if (!body) return;
    if (runtime.collapsed) {
      body.innerHTML = '';
      return;
    }

    if (runtime.activeView === 'timeline') {
      body.innerHTML = renderTimeline(caseNo);
      wireTimeline();
      return;
    }
    if (runtime.activeView === 'options') {
      body.innerHTML = renderOptions();
      wireOptions();
      return;
    }
    body.innerHTML = renderOverview(caseNo);
  }

  function init(force = false) {
    if (!isCasePage()) {
      cancelPrefetch();
      renderPanel();
      return;
    }

    const caseNo = detectAppNo();
    const changed = runtime.appNo !== caseNo;
    runtime.appNo = caseNo;

    if (changed && runtime.fetchCaseNo && runtime.fetchCaseNo !== caseNo) cancelPrefetch();

    captureLiveSource(caseNo);
    renderPanel();

    if (initTimer) clearTimeout(initTimer);
    initTimer = setTimeout(() => {
      if (runtime.appNo !== caseNo) return;
      captureLiveSource(caseNo);
      flushNow();
      renderPanel();
    }, 1800);

    if (force) {
      prefetchCase(caseNo, true);
      return;
    }

    const needsRefresh = SOURCES.some((s) => !isFresh(getCase(caseNo).sources[s.key], options().refreshHours));
    if (needsRefresh) prefetchCase(caseNo, false);
  }

  GM_addStyle(`
    body.epoRP-shifted{padding-right:${DEFAULTS.pageRightPaddingPx}px !important}
    .epoRP{position:fixed;top:60px;right:10px;z-index:999999;width:${DEFAULTS.panelWidthPx}px;height:calc(100vh - 70px);background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 26px rgba(2,6,23,.18);display:flex;flex-direction:column;color:#0f172a;font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .epoRP.collapsed{height:auto;max-height:55px;overflow:hidden}
    .epoRP-hd{padding:8px 10px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#f8fafc,#f1f5f9)}
    .epoRP-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .epoRP-t{font-size:14px;font-weight:800}
    .epoRP-st{font-size:11px;color:#475569}
    .epoRP-tabs{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
    .epoRP-tab,.epoRP-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer}
    .epoRP-tab.on{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
    .epoRP-acts{display:flex;gap:6px}
    .epoRP-badges{display:flex;justify-content:space-between;gap:6px;margin-top:6px}
    .epoRP-body{padding:8px;overflow:auto;display:flex;flex-direction:column;gap:8px}
    .epoRP-c{border:1px solid #e2e8f0;border-radius:10px;padding:8px;background:#fff}
    .epoRP-g{display:grid;grid-template-columns:115px 1fr;gap:6px;align-items:start}
    .epoRP-l{font-weight:700;color:#334155}
    .epoRP-v{color:#0f172a;white-space:pre-wrap;word-break:break-word}
    .epoRP-m{font-size:11px;color:#64748b;margin-top:6px}
    .epoRP-d{font-variant-numeric:tabular-nums;color:#334155;font-size:11px}
    .epoRP-bdg{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;border:1px solid transparent}
    .epoRP-bdg.info{background:#e2e8f0;border-color:#cbd5e1;color:#334155}
    .epoRP-bdg.ok{background:#dcfce7;border-color:#86efac;color:#14532d}
    .epoRP-bdg.warn{background:#fef3c7;border-color:#fcd34d;color:#854d0e}
    .epoRP-bdg.bad{background:#fee2e2;border-color:#fca5a5;color:#7f1d1d}
    .epoRP-pubs{display:flex;flex-direction:column;gap:6px}
    .epoRP-pub,.epoRP-doc{display:grid;grid-template-columns:1fr auto;gap:8px;padding:6px;border:1px solid #edf2f7;border-radius:8px;background:#fafcff}
    .epoRP-pn{font-weight:700}
    .epoRP-pm{font-size:11px;color:#64748b}
    .epoRP-a{color:#1d4ed8;text-decoration:none}
    .epoRP-a:hover{text-decoration:underline}
    .epoRP-it{display:grid;grid-template-columns:12px 72px 1fr;gap:8px;padding:6px 4px;border-bottom:1px solid #f1f5f9}
    .epoRP-it.compact{padding:4px 2px}
    .epoRP-it:last-child{border-bottom:0}
    .epoRP-dot{width:9px;height:9px;border-radius:999px;margin-top:4px;background:#94a3b8}
    .epoRP-dot.ok{background:#16a34a}
    .epoRP-dot.warn{background:#d97706}
    .epoRP-dot.bad{background:#dc2626}
    .epoRP-dot.info{background:#2563eb}
    .epoRP-mn{font-weight:700}
    .epoRP-sb{font-size:11px;color:#64748b;white-space:pre-wrap}
    .epoRP-grp{border:1px solid #e2e8f0;border-radius:10px;padding:5px;background:#f8fafc;margin-bottom:7px}
    .epoRP-grph{display:grid;grid-template-columns:12px 72px 1fr 14px;gap:8px;padding:4px;cursor:pointer;list-style:none;align-items:start}
    .epoRP-grph::-webkit-details-marker{display:none}
    .epoRP-garrow{font-size:12px;color:#64748b;justify-self:end;transition:transform .15s ease}
    .epoRP-grp[open] .epoRP-garrow{transform:rotate(90deg)}
    .epoRP-grp .epoRP-grpi{margin-left:12px;border-left:2px dotted #cbd5e1;padding-left:8px}
    .epoRP-grp:not([open]) .epoRP-grpi{display:none}
    .epoRP-today{border-top:2px solid #1d4ed8;margin:10px 0 8px;padding-top:4px;font-size:11px;color:#1e40af;font-weight:700}
    .epoRP-dl{display:flex;flex-direction:column;gap:4px}
    .epoRP-dr{display:grid;grid-template-columns:1fr auto;gap:8px;padding:4px 0;border-bottom:1px solid #edf2f7}
    .epoRP-dr:last-child{border-bottom:0}
    .epoRP-dn{font-weight:700}
    .epoRP-dd{font-size:11px}
    .epoRP-or{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #edf2f7}
    .epoRP-or:last-child{border-bottom:0}
    .epoRP-ol{font-weight:700;font-size:11px}
    .epoRP-oh{font-size:10px;color:#64748b}
    .epoRP-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
    .epoRP-in{border:1px solid #cbd5e1;border-radius:8px;padding:5px 7px;font-size:12px;width:100%}
    .epoRP-docIdx{max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-top:8px}
    .epoRP-ll{display:flex;flex-direction:column;max-height:530px;overflow:auto}
    .epoRP-lr{display:grid;grid-template-columns:80px 11px 1fr;gap:6px;padding:5px 2px;border-bottom:1px solid #f1f5f9}
    .epoRP-lt{font-variant-numeric:tabular-nums;font-size:10px;color:#64748b}
    .epoRP-lm{font-size:11px;color:#0f172a}
  `);

  setInterval(() => {
    if (location.href !== runtime.href) {
      runtime.href = location.href;
      init(false);
    }
  }, 650);

  addEventListener('storage', (event) => {
    if (![CACHE_KEY, OPTIONS_KEY, UI_KEY].includes(event.key)) return;
    if (event.key === CACHE_KEY) memory = null;
    if (isCasePage()) renderPanel();
  });

  addEventListener('focus', () => {
    if (!isCasePage()) return;
    renderPanel();
    const needsRefresh = SOURCES.some((s) => !isFresh(getCase(runtime.appNo).sources[s.key], options().refreshHours));
    if (needsRefresh) prefetchCase(runtime.appNo, false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !isCasePage()) return;
    renderPanel();
  });

  addEventListener('pageshow', () => init(false));
  addEventListener('beforeunload', flushNow);

  init(false);
})();
