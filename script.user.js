// ==UserScript==
// @name         EPO Register Pro
// @namespace    https://tampermonkey.net/
// @version      7.0.92
// @description  EP patent attorney sidebar for the European Patent Register with cross-tab case cache, timeline, and diagnostics
// @updateURL    https://raw.githubusercontent.com/EdLaughton/EP-Register-Pro/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/EdLaughton/EP-Register-Pro/main/script.user.js
// @match        https://register.epo.org/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      unifiedpatentcourt.org
// @connect      cdnjs.cloudflare.com
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @connect      tessdata.projectnaptha.com
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__epoRegisterPro700) return;
  window.__epoRegisterPro700 = true;

  const VERSION = '7.0.92';
  const CACHE_KEY = 'epoRP_700_cache';
  const OPTIONS_KEY = 'epoRP_700_options';
  const UI_KEY = 'epoRP_700_ui';
  const SESSION_KEY = 'epoRP_700_session';
  const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;

  const CACHE_SCHEMA = 2;
  const MAX_CASES = 30;
  const MAX_LOGS_PER_APP = 500;
  const FETCH_CONCURRENCY = 2;
  const FETCH_TIMEOUT_MS = 15000;
  const FETCH_RETRIES = 1;
  const PDF_JS_CANDIDATES = [
    {
      id: 'cdnjs',
      lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js',
      worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js',
    },
    {
      id: 'jsdelivr',
      lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.min.js',
      worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
    },
    {
      id: 'unpkg',
      lib: 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js',
      worker: 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
    },
  ];
  const OCR_TESSERACT_CANDIDATES = [
    { id: 'jsdelivr', lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js' },
    { id: 'unpkg', lib: 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js' },
  ];
  const OCR_MAX_PAGES = 2;
  const OCR_RENDER_SCALE = 2;
  const OCR_RECOGNIZE_OPTIONS = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: () => {},
  };

  const SOURCES = [
    { key: 'main', slug: 'main', title: 'EP About this file' },
    { key: 'doclist', slug: 'doclist', title: 'EP All documents' },
    { key: 'event', slug: 'event', title: 'EP Event history' },
    { key: 'family', slug: 'family', title: 'EP Patent family' },
    { key: 'legal', slug: 'legal', title: 'EP Legal status' },
    { key: 'federated', slug: 'federated', title: 'EP Federated register' },
    { key: 'citations', slug: 'citations', title: 'EP Citations' },
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
    showCitations: true,
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
    scrollSaveTimer: null,
    timelineCache: { key: '', items: [] },
    overviewCache: { key: '', model: null },
    doclistGroupSigByCase: {},
    pdfjsPromise: null,
    tesseractPromise: null,
    autoPrefetchDoneByCase: {},
    lastRegisterTabByCase: {},
    lastViewLogKey: '',
    routeTimer: null,
    pendingInitForce: false,
  };

  let memory = null;
  let optionsShadow = null;
  let sessionShadow = null;
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
    const payload = JSON.stringify(value);
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch (error) {
      const msg = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
      const isQuota = msg.includes('quota') || msg.includes('exceeded');
      if (!isQuota) return false;

      // Try to free room by compacting cache before giving up on options/UI writes.
      if (key !== CACHE_KEY) {
        try {
          evictOldCases();
          if (memory) localStorage.setItem(CACHE_KEY, JSON.stringify(memory));
          localStorage.setItem(key, payload);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  function loadSessionJson(key, fallback) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveSessionJson(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
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

  function syncMainSourceMeta(caseEntry, data) {
    if (!caseEntry || !data || typeof data !== 'object') return;
    caseEntry.meta = caseEntry.meta || {};
    caseEntry.meta.lastMainStatusRaw = String(data?.statusRaw || '');
    caseEntry.meta.lastMainStage = String(data?.statusStage || inferStatusStage(data?.statusRaw || '') || '');
  }

  function clearMainSourceMeta(caseEntry) {
    if (!caseEntry) return;
    caseEntry.meta = caseEntry.meta || {};
    caseEntry.meta.lastMainStatusRaw = '';
    caseEntry.meta.lastMainStage = '';
  }

  function storeCaseSource(caseNo, key, payload = {}) {
    if (!caseNo || !key) return null;
    const title = payload.title || sourceTitle(key);
    return patchCase(caseNo, (c) => {
      const next = {
        key,
        title,
        status: payload.status || 'ok',
        fetchedAt: payload.fetchedAt || Date.now(),
        parserVersion: payload.parserVersion || VERSION,
      };

      if (payload.url) next.url = payload.url;
      if (payload.transport) next.transport = payload.transport;
      if (payload.dependencyStamp != null) next.dependencyStamp = String(payload.dependencyStamp || '');
      if (payload.error) next.error = String(payload.error || '');
      if (payload.data !== undefined) next.data = payload.data;

      c.sources[key] = next;
      if (key === 'main') {
        if (payload.data && payload.status === 'ok') syncMainSourceMeta(c, payload.data);
        else clearMainSourceMeta(c);
      }
    });
  }

  function addLog(caseNo, level, message, meta = {}) {
    try {
      const normalizedLevel = String(level || 'info').toLowerCase();
      const normalizedMessage = normalize(String(message || '')) || '(no message)';
      const normalizedMeta = (meta && typeof meta === 'object' && !Array.isArray(meta)) ? meta : {};

      patchCase(caseNo, (c) => {
        const last = c.logs?.[c.logs.length - 1];
        if (last && String(last.level || '').toLowerCase() === normalizedLevel && String(last.message || '') === normalizedMessage) {
          const lastTs = new Date(last.ts || '').getTime();
          const delta = Number.isFinite(lastTs) ? Date.now() - lastTs : Infinity;
          if (delta >= 0 && delta < 900) {
            const sameMeta = safeInlineJson(last.meta || {}) === safeInlineJson(normalizedMeta);
            if (sameMeta) return;
          }
        }

        c.logs.push({ ts: nowIso(), level: normalizedLevel, message: normalizedMessage, meta: normalizedMeta });
        if (c.logs.length > MAX_LOGS_PER_APP) c.logs = c.logs.slice(-MAX_LOGS_PER_APP);
      });
    } catch {
      // logging must never break script
    }
  }

  function formatLogClock(ts) {
    const dt = new Date(ts || '');
    if (Number.isNaN(dt.getTime())) return '--:--:--';
    return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
  }

  function safeInlineJson(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }

  function renderLogConsole(caseNo) {
    const logs = (getCase(caseNo).logs || []).slice(-MAX_LOGS_PER_APP).reverse();
    if (!logs.length) {
      return `<div class="epoRP-log-empty">No operation logs yet for this case.</div>`;
    }

    return logs.map((entry) => {
      const level = String(entry?.level || 'info').toLowerCase();
      const levelClass = ['ok', 'info', 'warn', 'bad', 'error'].includes(level) ? level : 'info';
      const message = normalize(String(entry?.message || '')) || '(no message)';
      const meta = entry?.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta) ? entry.meta : {};
      const metaText = Object.keys(meta).length ? ` ${safeInlineJson(meta)}` : '';

      return `<div class="epoRP-log-row ${esc(levelClass)}">
        <div class="epoRP-log-ts">${esc(formatLogClock(entry?.ts))}</div>
        <div class="epoRP-log-lv">${esc(levelClass.toUpperCase())}</div>
        <div class="epoRP-log-msg">${esc(message)}${metaText ? `<span class="epoRP-log-meta">${esc(metaText)}</span>` : ''}</div>
      </div>`;
    }).join('');
  }

  function optionValueText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null) return 'null';
    return safeInlineJson(value);
  }

  function renderOptionSnapshot() {
    const o = options();
    const keys = Object.keys(o).sort((a, b) => a.localeCompare(b));
    return keys.map((key) => `<div class="epoRP-optval-row"><div class="epoRP-optval-k">${esc(key)}</div><div class="epoRP-optval-v">${esc(optionValueText(o[key]))}</div></div>`).join('');
  }

  function parsedSourceHasContent(sourceKey, data = {}) {
    const d = data && typeof data === 'object' ? data : {};
    switch (sourceKey) {
      case 'main':
        return !!(
          normalize(d.title || '')
          || normalize(d.statusRaw || '')
          || normalize(d.filingDate || '')
          || normalize(d.applicant || '')
          || (Array.isArray(d.priorities) && d.priorities.length)
          || (Array.isArray(d.publications) && d.publications.length)
          || (Array.isArray(d.recentEvents) && d.recentEvents.length)
        );
      case 'doclist':
        return !!(Array.isArray(d.docs) && d.docs.length);
      case 'event':
        return !!(Array.isArray(d.events) && d.events.length);
      case 'family':
        return !!(Array.isArray(d.publications) && d.publications.length);
      case 'legal':
        return !!((Array.isArray(d.events) && d.events.length) || (Array.isArray(d.renewals) && d.renewals.length));
      case 'federated':
        return !!(
          normalize(d.status || '')
          || normalize(d.upMemberStates || '')
          || normalize(d.invalidationDate || '')
          || normalize(d.renewalFeesPaidUntil || '')
          || normalize(d.recordUpdated || '')
          || normalize(d.applicantProprietor || '')
          || (Array.isArray(d.states) && d.states.length)
        );
      case 'citations':
        return !!((Array.isArray(d.entries) && d.entries.length) || (Array.isArray(d.phases) && d.phases.length));
      case 'ueMain':
        return !!(normalize(d.ueStatus || '') || normalize(d.upcOptOut || '') || normalize(d.memberStates || ''));
      default:
        return !!Object.keys(d).length;
    }
  }

  function placeholderPageState(doc) {
    const page = bodyText(doc).toLowerCase();
    if (!page) return '';
    if (/no files were found|no files containing your search terms|your search terms(?:.|\n){0,120}no files|no matching files were found/.test(page)) return 'notFound';
    if (/there are no items to display|no items found|no data available|no results found/.test(page)) return 'empty';
    return '';
  }

  function classifyParsedSourceState(sourceKey, doc, data = {}) {
    const hasContent = parsedSourceHasContent(sourceKey, data);
    const placeholderState = placeholderPageState(doc);

    if (placeholderState === 'notFound' && !hasContent) {
      return {
        status: sourceKey === 'main' ? 'notFound' : 'empty',
        reason: 'placeholder-no-files',
      };
    }

    if (placeholderState === 'empty' && !hasContent) {
      return {
        status: 'empty',
        reason: 'placeholder-empty',
      };
    }

    if (!hasContent) {
      return {
        status: sourceKey === 'main' ? 'empty' : 'empty',
        reason: 'no-usable-data',
      };
    }

    return {
      status: 'ok',
      reason: placeholderState ? 'content-overrode-placeholder' : 'parsed-data',
    };
  }

  function sourceStatusCounts(caseEntry) {
    const counts = { ok: 0, empty: 0, notFound: 0, error: 0, missing: 0 };
    for (const src of SOURCES) {
      const status = String(caseEntry?.sources?.[src.key]?.status || '').toLowerCase();
      if (status === 'ok') counts.ok += 1;
      else if (status === 'empty') counts.empty += 1;
      else if (status === 'notfound') counts.notFound += 1;
      else if (status === 'error') counts.error += 1;
      else counts.missing += 1;
    }
    return counts;
  }

  function sourceStatusSummaryText(counts) {
    if ((counts.ok || 0) === SOURCES.length) return `${counts.ok}/${SOURCES.length} ok`;
    const parts = [];
    if (counts.ok) parts.push(`${counts.ok} ok`);
    if (counts.empty) parts.push(`${counts.empty} empty`);
    if (counts.notFound) parts.push(`${counts.notFound} not found`);
    if (counts.error) parts.push(`${counts.error} error`);
    if (counts.missing) parts.push(`${counts.missing} pending`);
    return parts.join(' · ') || `0/${SOURCES.length}`;
  }

  function sourceStatusLevel(counts) {
    if ((counts.error || 0) > 0) return 'bad';
    if ((counts.notFound || 0) > 0 || (counts.empty || 0) > 0) return 'warn';
    if ((counts.ok || 0) > 0 && (counts.missing || 0) === 0) return 'ok';
    return 'info';
  }

  function isFresh(src, refreshHours, config = {}) {
    const sameParser = src?.parserVersion === VERSION;
    const ageMs = Number(refreshHours || 0) * 3600000;
    const allowEmpty = !!config.allowEmpty;
    const status = String(src?.status || '').toLowerCase();
    const reusableStatuses = allowEmpty ? new Set(['ok', 'empty']) : new Set(['ok']);
    if (config.allowNotFound) reusableStatuses.add('notfound');
    if (!reusableStatuses.has(status)) return false;
    if (config.dependencyStamp != null && String(src?.dependencyStamp || '') !== String(config.dependencyStamp || '')) return false;
    return !!(sameParser && src?.fetchedAt && ageMs > 0 && Date.now() - src.fetchedAt < ageMs);
  }

  function clearDerivedCaches() {
    runtime.timelineCache = { key: '', items: [] };
    runtime.overviewCache = { key: '', model: null };
  }

  function resetRouteRuntime() {
    if (initTimer) {
      clearTimeout(initTimer);
      initTimer = null;
    }
    if (runtime.routeTimer) {
      clearTimeout(runtime.routeTimer);
      runtime.routeTimer = null;
    }
    runtime.pendingInitForce = false;
    runtime.appNo = '';
    runtime.fetchCaseNo = null;
    runtime.lastViewLogKey = '';
    clearDerivedCaches();
  }

  function scheduleInit(force = false) {
    runtime.pendingInitForce = runtime.pendingInitForce || !!force;
    if (runtime.routeTimer) clearTimeout(runtime.routeTimer);
    runtime.routeTimer = setTimeout(() => {
      runtime.routeTimer = null;
      const nextForce = runtime.pendingInitForce;
      runtime.pendingInitForce = false;
      init(nextForce);
    }, 80);
  }

  function derivedDependencyStamp(caseNo, key) {
    const c = getCase(caseNo);
    if (key === 'upcRegistry') {
      return `main:${sourceStamp(c, 'main')}|pubs:${upcCandidateNumbers(caseNo).join(',')}`;
    }
    if (key === 'pdfDeadlines') {
      return `doclist:${sourceStamp(c, 'doclist')}`;
    }
    return '';
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
    if (!/\/application$/i.test(url.pathname)) return false;
    if (url.searchParams.has('documentId')) return false;
    return /^EP\d+/i.test(appNoFromUrl(url));
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
    if (!optionsShadow) optionsShadow = normalizeOptions(loadJson(OPTIONS_KEY, {}));
    return normalizeOptions(optionsShadow);
  }

  function setOptions(patch) {
    const next = normalizeOptions({ ...options(), ...patch });
    optionsShadow = next;
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

  function sessionState() {
    if (!sessionShadow || typeof sessionShadow !== 'object') {
      sessionShadow = loadSessionJson(SESSION_KEY, { cases: {} });
    }
    if (!sessionShadow.cases || typeof sessionShadow.cases !== 'object') sessionShadow.cases = {};
    return sessionShadow;
  }

  function saveSessionState() {
    return saveSessionJson(SESSION_KEY, sessionState());
  }

  function getCaseSession(caseNo) {
    if (!caseNo) return {};
    const state = sessionState();
    const key = String(caseNo).toUpperCase();
    if (!state.cases[key] || typeof state.cases[key] !== 'object') state.cases[key] = {};
    return state.cases[key];
  }

  function patchCaseSession(caseNo, patch) {
    if (!caseNo || !patch || typeof patch !== 'object') return {};
    const state = sessionState();
    const key = String(caseNo).toUpperCase();
    const next = { ...(state.cases[key] || {}), ...patch, updatedAt: Date.now() };
    state.cases[key] = next;

    const keys = Object.keys(state.cases || {});
    const maxEntries = 40;
    if (keys.length > maxEntries) {
      keys
        .sort((a, b) => Number(state.cases[a]?.updatedAt || 0) - Number(state.cases[b]?.updatedAt || 0))
        .slice(0, keys.length - maxEntries)
        .forEach((k) => delete state.cases[k]);
    }

    saveSessionState();
    return next;
  }

  function timelineGroupKey(caseNo, item) {
    const topTitles = (item.items || []).slice(0, 3).map((x) => normalize(String(x?.title || ''))).join('||');
    const parts = [
      caseNo,
      item.dateStr || '',
      item.title || '',
      item.actor || '',
      topTitles,
    ];
    return parts.map((v) => normalize(String(v))).join('|');
  }

  function getDoclistOpenGroups(caseNo) {
    const byCase = uiState().doclistOpenByCase || {};
    const arr = Array.isArray(byCase[caseNo]) ? byCase[caseNo] : [];
    return new Set(arr.map((v) => String(v)));
  }

  function setDoclistOpenGroups(caseNo, groupSet) {
    const state = uiState();
    const byCase = { ...(state.doclistOpenByCase || {}) };
    byCase[caseNo] = [...groupSet].slice(0, 250);

    const keys = Object.keys(byCase);
    if (keys.length > 20) {
      const keep = new Set(keys.slice(-20));
      for (const k of keys) if (!keep.has(k)) delete byCase[k];
    }

    setUiState({ doclistOpenByCase: byCase });
  }

  function doclistGroupKey(caseNo, bundle, ordinal = 0) {
    const parts = [caseNo, bundle || 'Group', String(ordinal || 0)];
    return parts.map((v) => normalize(String(v))).join('|');
  }

  function persistLiveDoclistGroups(caseNo) {
    if (!caseNo || tabSlug() !== 'doclist') return;
    const table = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
    if (!table) return;

    const openGroups = getDoclistOpenGroups(caseNo);
    table.querySelectorAll('tr.epoRP-docgrp .epoRP-docgrp-btn[data-group-key]').forEach((btn) => {
      const key = String(btn.getAttribute('data-group-key') || '');
      if (!key) return;
      if (btn.getAttribute('aria-expanded') === 'true') openGroups.add(key);
      else openGroups.delete(key);
    });
    setDoclistOpenGroups(caseNo, openGroups);
  }

  function panelScrollKey(caseNo, view) {
    return `${String(caseNo || '').toUpperCase()}|${String(view || 'overview').toLowerCase()}`;
  }

  function getPanelScroll(caseNo, view) {
    const key = panelScrollKey(caseNo, view);
    const map = uiState().panelScrollByView || {};
    const value = Number(map[key]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function setPanelScroll(caseNo, view, scrollTop) {
    if (!caseNo || !view) return;
    const key = panelScrollKey(caseNo, view);
    const state = uiState();
    const map = { ...(state.panelScrollByView || {}) };
    const top = Math.max(0, Math.round(Number(scrollTop) || 0));
    if ((Number(map[key]) || 0) === top) return;
    map[key] = top;

    const keys = Object.keys(map);
    const maxEntries = 180;
    if (keys.length > maxEntries) {
      for (const oldKey of keys.slice(0, keys.length - maxEntries)) delete map[oldKey];
    }

    setUiState({ panelScrollByView: map });
  }

  function persistCurrentPanelScroll() {
    const b = runtime.body;
    if (!b || runtime.collapsed || !runtime.appNo) return;
    setPanelScroll(runtime.appNo, runtime.activeView || 'overview', b.scrollTop || 0);
  }

  function schedulePanelScrollSave(caseNo, view, scrollTop) {
    if (runtime.scrollSaveTimer) clearTimeout(runtime.scrollSaveTimer);
    runtime.scrollSaveTimer = setTimeout(() => {
      runtime.scrollSaveTimer = null;
      setPanelScroll(caseNo, view, scrollTop);
    }, 120);
  }

  function restorePanelScroll(caseNo, view) {
    const b = runtime.body;
    if (!b) return;
    const top = getPanelScroll(caseNo, view);
    requestAnimationFrame(() => {
      if (runtime.body !== b) return;
      if (runtime.appNo !== caseNo) return;
      if (runtime.activeView !== view) return;
      b.scrollTop = top;
    });
  }

  function scheduleRender() {
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        renderPanel();
      }, 60);
    }
  }

  function logViewContext(caseNo, view) {
    if (!caseNo || !view) return;
    const registerTab = tabSlug();
    const key = `${caseNo}|${registerTab}|${view}|${runtime.collapsed ? 'collapsed' : 'expanded'}`;
    if (runtime.lastViewLogKey === key) return;
    runtime.lastViewLogKey = key;
    addLog(caseNo, 'info', 'Sidebar context', {
      source: 'ui',
      registerTab,
      view,
      collapsed: !!runtime.collapsed,
    });
  }

  function sectionRowsByHeader(doc, headerRegex) {
    const groups = [];

    for (const tr of doc.querySelectorAll('tr')) {
      const headers = [...tr.querySelectorAll('th,td')].filter((cell) => {
        const tag = String(cell.tagName || '').toUpperCase();
        if (tag === 'TH') return true;
        const cls = String(cell.className || '').toLowerCase();
        return /\bth\b/.test(cls) || cls.includes('header');
      });
      const th = headers.find((h) => headerRegex.test(text(h)));
      if (!th) continue;

      const rows = [tr];
      const rowspan = Math.max(1, parseInt(th.getAttribute('rowspan') || '1', 10) || 1);
      let next = tr;
      for (let i = 1; i < rowspan; i++) {
        next = next?.nextElementSibling;
        if (!next || next.tagName !== 'TR') break;
        rows.push(next);
      }
      groups.push(rows);
    }

    return groups;
  }

  function sectionTextsByHeader(doc, headerRegex) {
    return dedupe(sectionRowsByHeader(doc, headerRegex).map((rows) => rows.map((r) => text(r)).join('\n').trim()).filter(Boolean), (x) => x);
  }

  function rowLabelValuePairs(row) {
    const pairs = {};
    let currentKey = '';
    for (const cell of row.querySelectorAll('th,td')) {
      const raw = normalize(text(cell));
      const tag = String(cell.tagName || '').toUpperCase();
      const cls = String(cell.className || '').toLowerCase();
      const isLabel = tag === 'TH' || /\bth\b/.test(cls) || cls.includes('header');
      if (isLabel) {
        currentKey = raw.replace(/:\s*$/, '').trim();
        if (currentKey && !(currentKey in pairs)) pairs[currentKey] = '';
        continue;
      }
      if (!currentKey) continue;
      if (raw) pairs[currentKey] = pairs[currentKey] ? `${pairs[currentKey]} ${raw}`.trim() : raw;
      currentKey = '';
    }
    return pairs;
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
    const m = normalize(raw).match(/(\d{6,10}\.\d)[\s\S]{0,70}?(\d{2}\.\d{2}\.\d{4})\b/);
    return { checksum: m?.[1] || '', filingDate: m?.[2] || '' };
  }

  function parseMainPublications(doc, role = 'EP (this file)') {
    const out = [];

    const push = (rawNo, rawKind, rawDate) => {
      const parsed = splitPublicationNumber(rawNo, rawKind);
      const dateStr = String(rawDate || '').match(DATE_RE)?.[1] || '';
      if (!parsed.no || !dateStr) return;
      out.push({ no: parsed.no, kind: parsed.kind, dateStr, role });
    };

    for (const rows of sectionRowsByHeader(doc, /^Publication\b/i)) {
      let currentType = '';
      let currentNo = '';
      let currentDate = '';

      const flush = () => {
        if (!currentNo || !currentDate) return;
        push(currentNo, currentType, currentDate);
        currentType = '';
        currentNo = '';
        currentDate = '';
      };

      for (const row of rows) {
        const cells = [...row.querySelectorAll('th,td')].map(text).filter(Boolean);
        for (let i = 0; i < cells.length - 1; i++) {
          const label = cells[i];
          const value = cells.slice(i + 1).join(' ');
          if (/^Type:?$/i.test(label)) {
            currentType = value.match(/\b([A-Z]\d)\b/)?.[1] || currentType;
          } else if (/^No\.:?$/i.test(label)) {
            currentNo = value;
          } else if (/^Date:?$/i.test(label)) {
            currentDate = value;
            flush();
          }
        }
      }

      flush();
    }

    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function extractEpNumbersByHeader(doc, headerRegex) {
    const values = [];
    for (const chunk of sectionTextsByHeader(doc, headerRegex)) {
      for (const m of chunk.matchAll(/\b(EP\d{6,12})(?:\.\d)?\b/gi)) {
        values.push(String(m[1] || '').toUpperCase());
      }
    }
    return dedupe(values, (x) => x);
  }

  function parsePriority(raw, pageText = '') {
    const out = [];
    const rawText = dedupeMultiline(raw);
    const rawLines = String(rawText || '').split('\n').map((v) => v.trim()).filter(Boolean);

    const push = (no, dateStr) => {
      const n = String(no || '').replace(/\s+/g, '').toUpperCase();
      const d = String(dateStr || '').trim();
      if (!n || !d) return;
      out.push({ no: n, dateStr: d });
    };

    // Priority IDs are usually country-code + numeric-ish body (e.g. GB20230019788).
    const parseLine = (line, loose = false) => {
      const re = loose
        ? /\b([A-Z]{2}[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/i
        : /\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/i;
      const m = String(line || '').match(re);
      if (!m) return null;
      return { no: m[1], dateStr: m[2] };
    };

    for (const line of rawLines) {
      const parsed = parseLine(line, false) || parseLine(line, true);
      if (!parsed) continue;
      push(parsed.no, parsed.dateStr);
    }

    if (!out.length && rawText) {
      for (const m of rawText.matchAll(/\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b[\s\S]{0,120}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) {
        push(m[1], m[2]);
      }

      // Last-resort pairing for layouts where number/date are split across cells/lines.
      if (!out.length) {
        const ids = [...rawText.matchAll(/\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b/gi)].map((m) => String(m[1] || ''));
        const dates = [...rawText.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)].map((m) => String(m[1] || ''));
        if (ids[0] && dates[0]) push(ids[0], dates[0]);
      }
    }

    if (!out.length && pageText) {
      const section = String(pageText).match(/Priority\s+number,\s*date([\s\S]{0,500}?)(?=\b(?:Filing language|Procedural language|Publication|Applicant|Representative|Status|Most recent event)\b|$)/i)?.[1] || '';
      for (const m of section.matchAll(/\b([A-Z]{2}\d[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) {
        push(m[1], m[2]);
      }
      if (!out.length) {
        for (const m of section.matchAll(/\b([A-Z]{2}[0-9A-Z\/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) {
          push(m[1], m[2]);
        }
      }
    }

    return dedupe(out, (i) => `${i.no}|${i.dateStr}`);
  }

  function normalizePublicationNumber(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function splitPublicationNumber(rawNo, rawKind = '') {
    let no = normalizePublicationNumber(rawNo);
    let kind = String(rawKind || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (kind && no.endsWith(kind) && no.length > kind.length + 5) {
      no = no.slice(0, -kind.length);
    }

    if (!kind) {
      const m = no.match(/^(.*?)([A-Z]\d)$/);
      if (m && m[1].length >= 7) {
        no = m[1];
        kind = m[2];
      }
    }

    return { no, kind };
  }

  function parsePublications(textBlock, role = '') {
    const out = [];
    const pubPrefixes = /^(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)/;

    const push = (rawNo, rawKind, rawDate) => {
      const parsed = splitPublicationNumber(rawNo, rawKind);
      const dateStr = String(rawDate || '').match(DATE_RE)?.[1] || '';
      if (!parsed.no || !dateStr) return;
      if (!pubPrefixes.test(parsed.no)) return;
      if (!/\d/.test(parsed.no.slice(2))) return;

      out.push({ no: parsed.no, kind: parsed.kind, dateStr, role });
    };

    const text = String(textBlock || '');
    const numberPattern = '((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)(?:[\\s.\\-\\/]*[A-Z0-9]){5,24})';

    const reNumberBeforeDate = new RegExp(`\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?[\\s\\S]{0,50}?\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b`, 'gi');
    let m;
    while ((m = reNumberBeforeDate.exec(text)) !== null) {
      push(m[1], m[2], m[3]);
    }

    const reDateBeforeNumber = new RegExp(`\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b[\\s\\S]{0,50}?\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?`, 'gi');
    while ((m = reDateBeforeNumber.exec(text)) !== null) {
      push(m[2], m[3], m[1]);
    }

    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function inferPublicationsFromDocs(docs = []) {
    const out = [];
    const re = /\b((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)(?:[\s.\-\/]*[A-Z0-9]){6,24})\b(?:\s+([A-Z]\d))?\b/i;
    for (const d of docs) {
      const title = String(d?.title || '');
      const procedure = String(d?.procedure || '');
      if (!/publication|published|a1|a2|a3|b1|b2|bulletin|gazette/i.test(`${title} ${procedure}`)) continue;
      const m = `${title}\n${procedure}`.match(re);
      if (!m) continue;
      const parsed = splitPublicationNumber(m[1], m[2]);
      if (!parsed.no || !/^(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)/.test(parsed.no)) continue;
      if (!/\d/.test(parsed.no.slice(2))) continue;
      out.push({
        no: parsed.no,
        kind: parsed.kind,
        dateStr: d.dateStr || '',
        role: 'Inferred from documents',
      });
    }
    return dedupe(out, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
  }

  function publicationKey(pub = {}) {
    return `${pub.no || ''}${pub.kind || ''}|${pub.dateStr || ''}|${pub.role || ''}`;
  }

  function mergePublications(...groups) {
    return dedupe(groups.flat().filter(Boolean), publicationKey).sort(compareDateDesc);
  }

  function caseSourceData(caseEntry, key, fallback = {}) {
    const data = caseEntry?.sources?.[key]?.data;
    return data == null ? fallback : data;
  }

  function caseDocs(caseEntry) {
    return [...(caseSourceData(caseEntry, 'doclist', {}).docs || [])].sort(compareDateDesc);
  }

  function casePublications(caseEntry, config = {}) {
    const main = caseSourceData(caseEntry, 'main', {});
    const family = caseSourceData(caseEntry, 'family', {});
    const docs = config.docs || caseDocs(caseEntry);
    const includeFamily = config.includeFamily !== false;
    const includeDocFallback = config.includeDocFallback !== false;
    const publicationFallback = includeDocFallback ? inferPublicationsFromDocs(docs) : [];
    return mergePublications(
      main.publications || [],
      includeFamily ? (family.publications || []) : [],
      publicationFallback,
    );
  }

  function caseSnapshot(caseNo) {
    const c = getCase(caseNo);
    const main = caseSourceData(c, 'main', {});
    const doclist = caseSourceData(c, 'doclist', {});
    const family = caseSourceData(c, 'family', {});
    const legal = caseSourceData(c, 'legal', {});
    const federated = caseSourceData(c, 'federated', {});
    const citations = caseSourceData(c, 'citations', {});
    const eventHistory = caseSourceData(c, 'event', {});
    const ue = caseSourceData(c, 'ueMain', {});
    const upcRegistry = caseSourceData(c, 'upcRegistry', null);
    const pdfDeadlines = caseSourceData(c, 'pdfDeadlines', {});
    const docs = [...(doclist.docs || [])].sort(compareDateDesc);
    const publications = casePublications(c, { docs });
    return { c, main, doclist, family, legal, federated, citations, eventHistory, ue, upcRegistry, pdfDeadlines, docs, publications };
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

  function inferStatusStage(statusRaw) {
    const t = normalize(statusRaw || '').toLowerCase();
    if (!t) return '';
    if (/revoked|refused|withdrawn|deemed to be withdrawn|lapsed|expired|closed/.test(t)) return 'Closed';
    if (/rule\s*71\(3\)|intention to grant|mention of grant|granted/.test(t)) return 'Grant / post-grant';
    if (/article\s*94\(3\)|art\.\s*94\(3\)|examining division|examination/.test(t)) return 'Examination';
    if (/search report|search opinion|written opinion|\bsearch\b/.test(t)) return 'Search';
    if (/filing/.test(t)) return 'Filing';
    if (/published|publication/.test(t)) return 'Post-publication';
    return '';
  }

  function parseApplicationType(mainData) {
    const appNo = mainData.appNo || '';
    const priorities = Array.isArray(mainData.priorities) ? mainData.priorities : [];
    const internationalAppNo = normalize(mainData.internationalAppNo || '').toUpperCase();
    const statusRaw = normalize(mainData.statusRaw || '');

    const hasExplicitPctMarker =
      /\bPCT\/[A-Z]{2}\d{4}\/\d{5,}\b/i.test(internationalAppNo)
      || /\bWO\d{4}[A-Z]{2}\d{3,}\b/i.test(internationalAppNo)
      || /\b(?:E\/PCT|EURO-?PCT|regional phase)\b/i.test(statusRaw);

    if (hasExplicitPctMarker || priorities.some((p) => /^WO\d{4}[A-Z]{2}\d{3,}$/i.test(String(p?.no || '')))) {
      return 'E/PCT regional phase';
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

  function pickApplicantLine(raw) {
    const out = [];
    const lines = dedupeMultiline(raw)
      .split('\n')
      .map((line) => normalize(line))
      .filter(Boolean);

    for (let line of lines) {
      if (/^for all designated states$/i.test(line)) continue;
      if (/^\[[^\]]+\]$/.test(line)) continue;

      if (/^for all designated states\b/i.test(line)) {
        line = line.replace(/^for all designated states\b[:\s-]*/i, '').trim();
        if (!line) continue;
      }

      if (/^(applicant|for applicant)\s*[:\-]?\s*$/i.test(line)) continue;
      out.push(line);
    }

    return out[0] || '';
  }

  function formatDaysHuman(days) {
    if (!Number.isFinite(days)) return '—';
    const sign = days < 0 ? '-' : '';
    const abs = Math.abs(days);
    const years = Math.floor(abs / 365);
    const rem = abs % 365;
    if (years <= 0) return `${sign}${rem}d`;
    return `${sign}${years}y ${rem}d`;
  }

  function extractTitle(doc) {
    const rawTitle = dedupeMultiline(fieldByLabel(doc, [/^Title$/i]));
    const page = bodyText(doc);
    if (rawTitle) {
      const englishLine = rawTitle.split('\n').map((x) => x.trim()).find((line) => /^English\s*:/i.test(line));
      if (englishLine) return cleanTitle(englishLine.replace(/^English\s*:\s*/i, ''));

      const englishFromPage = page.match(/\bEnglish\s*:\s*([^\n\r\[]+)/i);
      if (englishFromPage?.[1]) return cleanTitle(englishFromPage[1]);
    }

    for (const el of [...doc.querySelectorAll('h1,h2,h3,strong,b,a')].slice(0, 120)) {
      const m = text(el).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
      if (m?.[1]) return cleanTitle(m[1]);
    }

    if (rawTitle) {
      const cleanedLines = rawTitle
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !/^(German|French)\s*:/i.test(line));
      if (cleanedLines.length) return cleanTitle(cleanedLines[0]);
    }

    const fromBody = bodyText(doc).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
    return cleanTitle(fromBody?.[1] || '');
  }

  function parseMain(doc, caseNo) {
    const appSections = sectionTextsByHeader(doc, /^Application number/i);
    const publicationSections = sectionTextsByHeader(doc, /^Publication\b/i);
    const appField = appSections[0] || fieldByLabel(doc, [/^Application number/i]);
    const statusField = dedupeMultiline(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
    const priorityField = fieldByLabel(doc, [/^Priority\b/i]);
    const publicationField = publicationSections.join('\n') || fieldByLabel(doc, [/^Publication\b/i]);
    const recentEventField = fieldByLabel(doc, [/^Most recent event$/i]);

    const appInfo = parseApplicationField(appField);
    const pageText = bodyText(doc);
    const priorities = parsePriority(priorityField, pageText);
    const status = summarizeStatus(statusField);

    const parentCandidates = extractEpNumbersByHeader(doc, /\bParent application(?:\(s\))?\b/i);
    const parentMatch = pageText.match(/\bparent\s+application(?:\(s\))?[^\n]{0,140}\b(EP\d{6,12})\b/i);
    const parentCase = parentCandidates[0] || (parentMatch ? parentMatch[1].toUpperCase() : '');

    const divisionalChildrenFromHeader = extractEpNumbersByHeader(doc, /\bDivisional application(?:\(s\))?\b/i);
    const divisionalSection = String(pageText).match(/Divisional\s+application(?:\(s\))?[\s\S]{0,400}/i)?.[0] || '';
    const divisionalChildrenFromText = [...divisionalSection.matchAll(/\b(EP\d{6,12})(?:\.\d)?\b/gi)].map((m) => String(m[1] || '').toUpperCase());
    const divisionalChildren = dedupe([...divisionalChildrenFromHeader, ...divisionalChildrenFromText], (x) => x);
    const mainPublications = parseMainPublications(doc, 'EP (this file)');

    const internationalField = dedupeMultiline(fieldByLabel(doc, [/^International application\b/i, /^International publication\b/i, /^PCT application\b/i]));
    const internationalSectionFromPage = String(pageText).match(/International\s+application(?:\s+number)?[\s\S]{0,220}/i)?.[0] || '';
    const pctScopeText = `${appSections.join('\n')}\n${String(appField || '')}\n${internationalField}\n${internationalSectionFromPage}\n${pageText}`;
    const woMatch = pctScopeText.match(/\b(WO\d{4}(?:[A-Z]{2})?\d{3,})\b/i);
    const pctMatch = pctScopeText.match(/\b(PCT\/[A-Z]{2}\d{4}\/\d{5,})\b/i);
    const internationalAppNo = (woMatch?.[1] || pctMatch?.[1] || '').toUpperCase();
    const isEuroPct = !!internationalAppNo;

    const titleField = normalize(fieldByLabel(doc, [/^Title$/i]));
    const applicantField = normalize(fieldByLabel(doc, [/^Applicant/i]));
    const representativeField = normalize(fieldByLabel(doc, [/^Representative/i]));

    const fallbackApplicant = normalize((pageText.match(/\bApplicant\s*(?:\n|:)\s*([^\n]+)/i)?.[1]) || '');

    const divisionalMarker = /\bdivisional application\b/i.test(`${String(statusField || '')}\n${pageText}`);

    const result = {
      appNo: caseNo,
      title: extractTitle(doc) || cleanTitle(titleField),
      applicant: pickApplicantLine(applicantField) || normalize(applicantField.split('\n').find(Boolean) || '') || fallbackApplicant,
      representative: normalize(representativeField.split('\n').find(Boolean) || ''),
      filingDate: appInfo.filingDate,
      checksum: appInfo.checksum,
      priorities,
      priorityText: priorities.map((p) => `${p.no} · ${p.dateStr}`).join('\n'),
      statusRaw: normalize(statusField),
      statusSimple: status.simple,
      statusLevel: status.level,
      statusStage: inferStatusStage(statusField),
      designatedStates: dedupeMultiline(fieldByLabel(doc, [/^Designated/i])),
      recentEvents: parseRecentEvents(recentEventField),
      publications: mainPublications.length ? mainPublications : parsePublications(publicationField, 'EP (this file)'),
      internationalAppNo,
      isEuroPct,
      isDivisional: !!parentCase || divisionalMarker,
      parentCase,
      divisionalChildren: divisionalChildren.filter((ep) => ep !== caseNo),
      hasDivisionals: divisionalChildren.some((ep) => ep !== caseNo),
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

  function classifyDocument(title, procedure = '') {
    const t = String(title || '').toLowerCase();
    const p = String(procedure || '').toLowerCase();

    const isSearchResponseContext =
      /search\s*\/\s*examination|search\s*and\s*examination|search report|search opinion/.test(p)
      || /after receipt of \(?(?:european\)? )?search report|before examination/.test(t);

    const isGrantContext = /rule\s*71\(3\)|intention to grant|text intended for grant|text proposed for grant|proposed for grant/.test(`${t} ${p}`);
    const isGrantResponse = isGrantContext && /amend|correction|request|claims|description|translation|approval|text proposed for grant/.test(t);

    const isLossOfRights = /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|communication under rule\s*112\(1\)|rule\s*112\(1\)|noting of loss of rights|application refused|application rejected/.test(`${t} ${p}`);
    if (isLossOfRights) {
      return { bundle: 'Examination', level: 'bad', actor: 'EPO' };
    }

    if (/by applicant|amendment by applicant|filed by applicant|from applicant/.test(p)) {
      if (isGrantResponse) {
        return { bundle: 'Grant package', level: 'warn', actor: 'Applicant' };
      }
      if (isSearchResponseContext && !isGrantContext && /amend|claims|description|letter|annotations|subsequently filed items/.test(t)) {
        return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
      }
      if (/request for grant|description|claims|drawings|designation of inventor|priority document|annex/.test(t)) {
        return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
      }
      return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    }

    if (/acknowledgement of receipt|receipt of electronic submission|auto-acknowledgement/.test(t) || /acknowledgement/.test(p)) {
      return { bundle: 'Other', level: 'info', actor: 'System' };
    }

    if (isGrantResponse) {
      return { bundle: 'Grant package', level: 'warn', actor: 'Applicant' };
    }

    if (isSearchResponseContext && !isGrantContext && /amend|claims|description|letter accompanying subsequently filed items|annotations|amendments received before examination/.test(t)) {
      return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
    }

    if (/amended claims filed|amendment by applicant|claims and\/or description|filed after receipt/i.test(t)) {
      return isGrantContext
        ? { bundle: 'Grant package', level: 'warn', actor: 'Applicant' }
        : { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    }

    if (/search report|search opinion|written opinion|search strategy|esr/.test(t)) return { bundle: 'Search package', level: 'info', actor: 'EPO' };
    if (/rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t)) return { bundle: 'Grant package', level: 'warn', actor: 'EPO' };
    if (/annex to (?:the )?communication|communication annex|annex.*examining division/.test(t)) {
      return /intention to grant|rule\s*71\(3\)/.test(t)
        ? { bundle: 'Grant package', level: 'warn', actor: 'EPO' }
        : { bundle: 'Examination', level: 'info', actor: 'EPO' };
    }
    if (/article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining|examining division has become responsible/.test(t)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    if (/renewal|annual fee/.test(t)) return { bundle: 'Renewal', level: 'ok', actor: 'Applicant' };
    if (/request for grant|description|claims|drawings|designation of inventor|priority document/.test(t)) return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
    if (/reply|response|arguments|observations|letter|filed by applicant|submission|request/.test(t)) return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    if (/opposition|third party/.test(t) || /third party/.test(p)) return { bundle: 'Opposition', level: 'warn', actor: 'Third party' };

    if (/examining division|epo|office/.test(p)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    return { bundle: 'Other', level: 'info', actor: 'Other' };
  }

  function doclistBundleLabel(bundle) {
    if (bundle === 'Grant package' || bundle === 'Grant communication') return 'Intention to grant (R71(3) EPC)';
    if (bundle === 'Grant response') return 'Response to intention to grant';
    if (bundle === 'Examination communication') return 'Examination communication';
    if (bundle === 'Examination response') return 'Response to examination communication';
    return bundle;
  }

  function parseDoclist(doc) {
    const table = bestTable(doc, ['date', 'document']) || bestTable(doc, ['document type']);
    if (!table) return { docs: [] };
    const map = tableColumnMap(table);
    const docs = [];
    const fallbackCaseNo = runtime.fetchCaseNo || runtime.appNo || detectAppNo();

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

      const url = [...row.querySelectorAll('a[href]')].map((a) => a.href).find(Boolean) || sourceUrl(fallbackCaseNo, 'doclist');
      const procedure = getCell(map.procedure);
      const cls = classifyDocument(title, procedure);
      docs.push({
        dateStr,
        title,
        procedure,
        url,
        ...cls,
        source: 'All documents',
      });
    }

    return { docs: dedupe(docs, (d) => `${d.dateStr}|${d.title}|${d.url}`).sort(compareDateDesc) };
  }

  function applyDoclistFilter(table, query) {
    const q = normalize(query).toLowerCase();
    const rows = [...table.querySelectorAll('tr')];

    for (const row of rows) {
      if (row.classList.contains('epoRP-docgrp')) continue;
      if (!row.querySelector("input[type='checkbox']")) continue;
      const txt = text(row).toLowerCase();
      row.classList.toggle('epoRP-filter-hidden', !!q && !txt.includes(q));
    }

    table.querySelectorAll('tr.epoRP-docgrp').forEach((groupHeader) => {
      const group = groupHeader.querySelector('.epoRP-docgrp-btn')?.getAttribute('data-group');
      if (!group) return;
      const groupRows = [...table.querySelectorAll(`tr[data-eporp-group='${group}']`)];
      const visibleCount = groupRows.filter((r) => !r.classList.contains('epoRP-filter-hidden')).length;
      groupHeader.classList.toggle('epoRP-filter-hidden', visibleCount === 0);
      const label = groupHeader.querySelector('.epoRP-docgrp-label');
      if (label) {
        const base = label.getAttribute('data-bundle') || 'Group';
        label.textContent = `${base} (${visibleCount}/${groupRows.length})`;
      }
    });
  }

  function doclistGroupingSignature(table) {
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    if (!rows.length) return 'empty';
    const head = rows.slice(0, 5);
    const tail = rows.slice(-5);
    const sample = [...head, ...tail].map((row) => {
      const cells = [...row.querySelectorAll('td')].map(text).filter(Boolean);
      const joined = cells.slice(0, 3).join('|');
      return normalize(joined).slice(0, 200);
    }).join('||');
    return `${rows.length}|${sample}`;
  }

  function ensureDoclistFilterWrap(table) {
    let filterWrap = document.getElementById('epoRP-doclist-filter-wrap');
    if (filterWrap) return filterWrap;

    filterWrap = document.createElement('div');
    filterWrap.id = 'epoRP-doclist-filter-wrap';
    filterWrap.className = 'epoRP-doclist-filter-wrap';
    filterWrap.innerHTML = `<input id="epoRP-doclist-filter" class="epoRP-doclist-filter" placeholder="Filter documents by name…" />`;
    table.parentElement?.insertBefore(filterWrap, table);
    filterWrap.querySelector('#epoRP-doclist-filter')?.addEventListener('input', (event) => {
      const liveTable = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
      if (!liveTable) return;
      applyDoclistFilter(liveTable, event.target.value || '');
    });
    return filterWrap;
  }

  function resetDoclistGrouping(table) {
    table.querySelectorAll('tr.epoRP-docgrp').forEach((row) => row.remove());
    table.querySelectorAll('tr[data-eporp-group]').forEach((row) => {
      row.classList.remove('epoRP-docgrp-item', 'collapsed', 'epoRP-filter-hidden', 'epoRP-docgrp-open', 'epoRP-docgrp-last');
      row.removeAttribute('data-eporp-group');
    });
  }

  function doclistGroupingSignals(title, procedure = '') {
    const t = String(title || '').toLowerCase();
    const p = String(procedure || '').toLowerCase();
    return {
      isReceipt: /\(electronic\) receipt|acknowledgement of receipt|receipt of electronic submission|auto-acknowledgement/.test(t),
      isGrantCommunication: /communication about intention to grant|intention to grant \(signatures\)|text intended for grant|annex to the communication about intention to grant|bibliographic data of the european patent application/.test(t),
      isGrantResponseExplicit: /request for correction\/amendment of the text proposed for grant|text proposed for grant|approval of the text|disapproval of the communication of intention to grant|translation of the claim|translation of claims|grant and publication fee|grant and printing fee|fee for grant|fee for publishing|fee for printing/.test(t),
      isExamCommunication: !/reply to|response to|intention to grant|text intended for grant|text proposed for grant/.test(t) && /article\s*94\(3\)|art\.?\s*94\(3\)|communication from the examining division|despatch of a communication from the examining division|summons to oral proceedings|rule\s*116|examining division has become responsible/.test(`${t} ${p}`),
      isExamResponseExplicit: /reply to (?:a )?communication from the examining division|response to (?:a )?communication from the examining division|reply to summons|response to summons|observations in reply|arguments in reply|request for oral proceedings/.test(t),
      isSearchPackage: /^(?:communication regarding the transmission of the european search report|european search opinion|european search report|information on search strategy|copy of the international search report|partial international search report|written opinion(?: of the isa)?|isr: cited documents|copy of the international preliminary report on patentability|provisional opinion accompanying the partial search results)/.test(t),
      isSearchResponseExplicit: /amendments received before examination|amended claims filed after receipt of \(?(?:european\)? )?search report|amended description filed after receipt of \(?(?:european\)? )?search report|correction of deficiencies in written opinion\/amendment/.test(t),
      isFilingSignal: /^(?:abstract|claims|description|drawings|designation of inventor|request for grant|electronic request for grant|priority document|published international application|request for entry into the european phase|priority search results|document concerning fees and payments|confirmation of effective date of early entry)\b/.test(t),
      isApplicantAdminSignal: /submission concerning|annexes in respect of a client data request|letter accompanying subsequently filed items|result of consultation by telephone\/in person|change of applicant'?s representative|communication of amended entries concerning the representative/.test(t),
      isResponseCompanion: /reply|response|amend|claims|description|drawings|letter accompanying subsequently filed items|subsequently filed items|observations|arguments|request|translation|annotations|abstract|designation of inventor|priority document|published international application|document concerning fees and payments|priority search results|confirmation of effective date of early entry/.test(t),
    };
  }

  function doclistDateBlocks(rowModels) {
    const blocks = [];
    let current = [];
    let currentDate = '';
    for (const model of rowModels) {
      if (!current.length || model.dateStr === currentDate) {
        current.push(model);
        currentDate = model.dateStr;
        continue;
      }
      blocks.push(current);
      current = [model];
      currentDate = model.dateStr;
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  function doclistRowModels(rows) {
    const rowModels = [];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')];
      if (!cells.length) continue;
      const title = [...row.querySelectorAll('a')].map(text).filter(Boolean).sort((a, b) => b.length - a.length)[0] || text(cells[2] || cells[1] || cells[0] || row);
      const procedure = text(cells[3] || '');
      const rowText = text(row);
      const dateStr = rowText.match(DATE_RE)?.[1] || '';
      const cls = classifyDocument(title, procedure);
      rowModels.push({
        row,
        title,
        procedure,
        dateStr,
        rowText,
        bundle: cls.bundle || 'Other',
        actor: cls.actor || 'Other',
        signals: doclistGroupingSignals(title, procedure),
        groupKind: '',
      });
    }
    return rowModels;
  }

  function normalizeGrantPackageRowModels(rowModels) {
    for (const block of doclistDateBlocks(rowModels)) {
      for (const model of block) {
        if (!/bibliographic data of the european patent application/i.test(model.title || '')) continue;
        const sameDateGrantSignals = block.some((other) => {
          if (other === model) return false;
          return /intention to grant|rule\s*71\(3\)|text intended for grant|communication about intention to grant|annex to the communication about intention to grant/i.test(other.title || '');
        });
        if (sameDateGrantSignals) model.bundle = 'Grant package';
      }
    }
    return rowModels;
  }

  function doclistBaseGroupKind(model) {
    if (model.bundle === 'Grant package') {
      return model.signals.isGrantCommunication ? 'Grant communication' : 'Grant response';
    }
    if (model.bundle === 'Search package') return 'Search package';
    if (model.bundle === 'Response to search') return 'Response to search';
    if (model.bundle === 'Filing package') return 'Filing package';
    if (model.bundle === 'Applicant filings') return 'Applicant filings';
    if (model.bundle === 'Examination') return model.signals.isExamCommunication ? 'Examination communication' : 'Examination';
    return model.bundle || 'Other';
  }

  function normalizeDoclistGroupKinds(rowModels) {
    for (const block of doclistDateBlocks(rowModels)) {
      const hasGrantCommunication = block.some((model) => model.signals.isGrantCommunication);
      const hasGrantResponse = block.some((model) => model.signals.isGrantResponseExplicit);
      const hasExamCommunication = block.some((model) => model.signals.isExamCommunication);
      const hasExamResponse = block.some((model) => model.signals.isExamResponseExplicit);
      const hasSearchPackage = block.some((model) => model.signals.isSearchPackage);
      const hasSearchResponse = block.some((model) => model.signals.isSearchResponseExplicit);
      const hasFilingPacket = block.some((model) => model.bundle === 'Filing package' || model.signals.isFilingSignal);
      const hasApplicantPacket = !hasGrantCommunication && !hasGrantResponse && !hasExamCommunication && !hasExamResponse && !hasSearchPackage && !hasSearchResponse && block.some((model) => model.bundle === 'Applicant filings' || model.signals.isApplicantAdminSignal);

      for (const model of block) {
        model.groupKind = doclistBaseGroupKind(model);

        if (hasGrantCommunication && model.signals.isGrantCommunication) {
          model.groupKind = 'Grant communication';
          continue;
        }
        if (hasGrantResponse && (model.signals.isGrantResponseExplicit || model.signals.isReceipt || (model.actor === 'Applicant' && model.signals.isResponseCompanion))) {
          model.groupKind = 'Grant response';
          continue;
        }
        if (hasExamCommunication && model.signals.isExamCommunication) {
          model.groupKind = 'Examination communication';
          continue;
        }
        if (hasExamResponse && (model.signals.isExamResponseExplicit || model.signals.isReceipt || (model.actor === 'Applicant' && model.signals.isResponseCompanion))) {
          model.groupKind = 'Examination response';
          continue;
        }
        if (hasSearchResponse && (model.signals.isReceipt || (model.actor === 'Applicant' && model.signals.isResponseCompanion))) {
          model.groupKind = 'Response to search';
          continue;
        }
        if (hasFilingPacket && !hasGrantCommunication && !hasGrantResponse && !hasExamCommunication && !hasExamResponse && !hasSearchResponse && (model.signals.isReceipt || model.signals.isFilingSignal || model.bundle === 'Filing package' || model.signals.isSearchPackage)) {
          model.groupKind = 'Filing package';
          continue;
        }
        if (hasSearchPackage && model.signals.isSearchPackage) {
          model.groupKind = 'Search package';
          continue;
        }
        if (hasApplicantPacket && (model.signals.isReceipt || model.signals.isApplicantAdminSignal || model.bundle === 'Applicant filings')) {
          model.groupKind = 'Applicant filings';
          continue;
        }
      }
    }
    return rowModels;
  }

  function doclistRuns(rowModels) {
    const runs = [];
    let run = null;
    for (const model of rowModels) {
      const kind = model.groupKind || model.bundle || 'Other';
      const runKey = `${kind}|${model.dateStr || ''}`;
      if (!run || run.key !== runKey) {
        run = { key: runKey, bundle: kind, groupKind: kind, dateStr: model.dateStr || '', rows: [model.row], models: [model] };
        runs.push(run);
      } else {
        run.rows.push(model.row);
        run.models.push(model);
      }
    }
    return runs;
  }

  function doclistGroupingPreview(doc) {
    const table = bestTable(doc, ['date', 'document']) || bestTable(doc, ['document type']);
    if (!table) return [];
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    return doclistRuns(normalizeDoclistGroupKinds(normalizeGrantPackageRowModels(doclistRowModels(rows)))).map((run) => ({
      bundle: run.bundle,
      label: doclistBundleLabel(run.bundle),
      dateStr: run.dateStr,
      size: run.rows.length,
      titles: run.models.map((model) => model.title),
    }));
  }

  function attachDoclistGroupRun(caseNo, run, gid, openGroups, hasSavedOpenState) {
    const groupId = `g${gid}`;
    const groupKey = doclistGroupKey(caseNo, run.bundle, gid);
    const isOpen = hasSavedOpenState ? openGroups.has(groupKey) : true;
    if (!hasSavedOpenState) openGroups.add(groupKey);
    const firstRow = run.rows[0];
    const cells = [...firstRow.querySelectorAll('td')];

    const headerRow = document.createElement('tr');
    headerRow.className = 'epoRP-docgrp';
    headerRow.classList.toggle('open', isOpen);

    const td = document.createElement('td');
    td.colSpan = Math.max(1, cells.length);
    const bundleLabel = doclistBundleLabel(run.bundle);
    td.innerHTML = `<div class="epoRP-docgrp-head"><label class="epoRP-docgrp-sel" title="Select all in this group"><input type="checkbox" class="epoRP-docgrp-check" data-group="${groupId}" data-group-key="${esc(groupKey)}"><span>All</span></label><button type="button" class="epoRP-docgrp-btn" data-group="${groupId}" data-group-key="${esc(groupKey)}" aria-expanded="${isOpen ? 'true' : 'false'}"><span class="epoRP-docgrp-label" data-bundle="${esc(bundleLabel)}">${esc(bundleLabel)} (${run.rows.length})</span><span class="epoRP-docgrp-arrow">▸</span></button></div>`;
    headerRow.appendChild(td);
    firstRow.parentElement?.insertBefore(headerRow, firstRow);

    const rowCheckboxes = [];
    run.rows.forEach((row, idx) => {
      row.setAttribute('data-eporp-group', groupId);
      row.classList.add('epoRP-docgrp-item');
      row.classList.toggle('collapsed', !isOpen);
      row.classList.toggle('epoRP-docgrp-open', isOpen);
      row.classList.toggle('epoRP-docgrp-last', idx === run.rows.length - 1);
      const cb = row.querySelector("input[type='checkbox']");
      if (cb) rowCheckboxes.push(cb);
    });

    const button = td.querySelector('button.epoRP-docgrp-btn');
    const headerCheckbox = td.querySelector('input.epoRP-docgrp-check');

    const syncHeaderCheckbox = () => {
      if (!headerCheckbox || !rowCheckboxes.length) return;
      const checked = rowCheckboxes.filter((cb) => !!cb.checked).length;
      headerCheckbox.indeterminate = checked > 0 && checked < rowCheckboxes.length;
      headerCheckbox.checked = checked > 0 && checked === rowCheckboxes.length;
    };

    if (button) {
      button.addEventListener('click', (event) => {
        const btn = event.currentTarget;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !expanded;
        btn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        headerRow.classList.toggle('open', nextExpanded);
        for (const row of run.rows) {
          row.classList.toggle('collapsed', !nextExpanded);
          row.classList.toggle('epoRP-docgrp-open', nextExpanded);
        }
        if (nextExpanded) openGroups.add(groupKey);
        else openGroups.delete(groupKey);
        if (caseNo) setDoclistOpenGroups(caseNo, openGroups);
      });
    }

    if (headerCheckbox) {
      headerCheckbox.addEventListener('change', () => {
        const shouldCheck = !!headerCheckbox.checked;
        for (const cb of rowCheckboxes) {
          if (cb.checked === shouldCheck) continue;
          cb.checked = shouldCheck;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncHeaderCheckbox();
      });
    }

    rowCheckboxes.forEach((cb) => cb.addEventListener('change', syncHeaderCheckbox));
    syncHeaderCheckbox();
  }

  function enhanceDoclistGrouping() {
    if (tabSlug() !== 'doclist') return;

    const caseNo = detectAppNo() || runtime.appNo || '';
    const table = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
    if (!table) return;

    const filterWrap = ensureDoclistFilterWrap(table);
    const currentQuery = (filterWrap.querySelector('#epoRP-doclist-filter')?.value || '');
    const signature = doclistGroupingSignature(table);

    if (runtime.doclistGroupSigByCase[caseNo] === signature && table.querySelector('tr.epoRP-docgrp')) {
      applyDoclistFilter(table, currentQuery);
      return;
    }

    persistLiveDoclistGroups(caseNo);
    const openGroups = getDoclistOpenGroups(caseNo);
    const doclistOpenByCase = uiState().doclistOpenByCase || {};
    const hasSavedOpenState = Array.isArray(doclistOpenByCase[caseNo]);

    resetDoclistGrouping(table);

    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    const groupable = new Set(['Search package', 'Grant communication', 'Grant response', 'Examination communication', 'Examination response', 'Examination', 'Filing package', 'Applicant filings', 'Response to search']);
    const runs = doclistRuns(normalizeDoclistGroupKinds(normalizeGrantPackageRowModels(doclistRowModels(rows))));

    let gid = 0;
    for (const run of runs) {
      if (!groupable.has(run.bundle) || run.rows.length < 2) continue;
      gid += 1;
      attachDoclistGroupRun(caseNo, run, gid, openGroups, hasSavedOpenState);
    }

    runtime.doclistGroupSigByCase[caseNo] = signature;
    applyDoclistFilter(table, currentQuery);
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
    const publications = [];
    const rows = [...doc.querySelectorAll('tr')];
    let inPublicationBlock = false;

    for (const row of rows) {
      const cells = [...row.querySelectorAll('td,th')].map((cell) => normalize(text(cell)));
      if (!cells.length) continue;
      const rowText = cells.join(' | ');

      if (/^publication no\.?$/i.test(cells[0] || '')) {
        inPublicationBlock = true;
        continue;
      }
      if (/^priority number$/i.test(cells[0] || '')) {
        inPublicationBlock = false;
        continue;
      }
      if (!inPublicationBlock) continue;
      if (!/^(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)/i.test(cells[0] || '')) continue;

      const dateStr = cells.find((value) => DATE_RE.test(value || '')) || '';
      const kind = cells.find((value) => /^[A-Z]\d?$/.test(value || '')) || '';
      const parsed = splitPublicationNumber(cells[0], kind);
      if (!parsed.no || !dateStr) continue;
      publications.push({ no: parsed.no, kind: parsed.kind, dateStr: dateStr.match(DATE_RE)?.[1] || '', role: 'Family' });
    }

    return { publications: publications.length ? dedupe(publications, (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`) : parsePublications(bodyText(doc), 'Family') };
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

  function parseFederated(doc, caseNo) {
    const states = [];
    const summary = {
      appNo: caseNo,
      fullPublicationNo: '',
      applicantProprietor: '',
      status: '',
      upMemberStates: '',
      invalidationDate: '',
      renewalFeesPaidUntil: '',
      recordUpdated: '',
    };

    const captureSummary = (pairs) => {
      if (!summary.appNo && pairs['EP application number']) summary.appNo = pairs['EP application number'];
      if (!summary.fullPublicationNo && pairs['Full publication number']) summary.fullPublicationNo = pairs['Full publication number'];
      if (!summary.applicantProprietor && pairs['Applicant / proprietor']) summary.applicantProprietor = pairs['Applicant / proprietor'];
      if (!summary.status && pairs.Status) summary.status = pairs.Status;
      if (!summary.upMemberStates && pairs['Member States covered by Unitary Patent Protection']) summary.upMemberStates = pairs['Member States covered by Unitary Patent Protection'];
      if (!summary.invalidationDate && pairs['Invalidation date']) summary.invalidationDate = pairs['Invalidation date'];
      if (!summary.renewalFeesPaidUntil && pairs['Renewal fees paid until']) summary.renewalFeesPaidUntil = pairs['Renewal fees paid until'];
      if (!summary.recordUpdated && pairs['Record last updated']) summary.recordUpdated = pairs['Record last updated'];
    };

    for (const row of doc.querySelectorAll('tr')) {
      const pairs = rowLabelValuePairs(row);
      if (Object.keys(pairs).length < 1) continue;
      captureSummary(pairs);
      if (!pairs.State) continue;
      states.push({
        state: pairs.State,
        nationalPublicationNo: pairs['National publication number'] || '',
        publicationDate: pairs['Publication date'] || '',
        upMemberStates: pairs['Member States covered by Unitary Patent Protection'] || '',
        invalidationDate: pairs['Invalidation date'] || '',
        renewalFeesPaidUntil: pairs['Renewal fees paid until'] || '',
        recordUpdated: pairs['Record last updated'] || '',
        notInForceSince: pairs['Not in force since'] || '',
        status: pairs.Status || summary.status || '',
      });
    }

    return {
      ...summary,
      states,
      notableStates: states.filter((s) => normalize(s.notInForceSince || '') || /lapse|revok|terminated|not in force/i.test(`${s.status || ''} ${s.nationalPublicationNo || ''}`)),
    };
  }

  function parseCitations(doc) {
    const entries = [];
    let phase = '';
    let currentType = '';

    for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('th,td')].map((cell) => normalize(text(cell))).filter(Boolean);
      if (!cells.length) continue;

      if (/^Cited in$/i.test(cells[0] || '') && cells[1]) {
        phase = cells[1];
        continue;
      }
      if (/^Type:?$/i.test(cells[0] || '')) {
        currentType = cells[1] || '';
        continue;
      }
      if (!/^Publication No\.:?$/i.test(cells[0] || '')) continue;

      const raw = cells.slice(1).join(' ');
      const pubMatch = raw.match(/\b((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)\d{4,})\b/i);
      if (!pubMatch?.[1]) continue;
      const categoryMatches = [...raw.matchAll(/\[([A-Z]{1,4})\]/g)].map((m) => String(m[1] || ''));
      const applicant = raw.match(/\(([^)]+)\)/)?.[1] || '';
      entries.push({
        phase: phase || 'Other',
        type: currentType || 'Patent literature',
        publicationNo: String(pubMatch[1] || '').toUpperCase(),
        categories: dedupe(categoryMatches, (x) => x),
        applicant,
        detail: raw,
      });
    }

    const phaseOrder = ['Search', 'International search', 'Examination', 'Opposition', 'Appeal', 'by applicant'];
    const byPhase = {};
    for (const entry of entries) {
      (byPhase[entry.phase] ||= []).push(entry);
    }
    const phases = Object.keys(byPhase).sort((a, b) => {
      const ai = phaseOrder.indexOf(a);
      const bi = phaseOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    }).map((name) => ({ name, entries: byPhase[name] }));

    return { entries, phases };
  }

  function parseSource(key, doc, caseNo) {
    switch (key) {
      case 'main': return parseMain(doc, caseNo);
      case 'doclist': return parseDoclist(doc);
      case 'event': return parseEventHistory(doc, caseNo);
      case 'family': return parseFamily(doc);
      case 'legal': return parseLegal(doc, caseNo);
      case 'federated': return parseFederated(doc, caseNo);
      case 'citations': return parseCitations(doc);
      case 'ueMain': return parseUe(doc);
      default: return {};
    }
  }

  function sourceDiagnostics(sourceKey, data) {
    const d = data && typeof data === 'object' ? data : {};
    if (sourceKey === 'main') {
      return {
        source: sourceKey,
        titlePresent: !!normalize(d.title || ''),
        priorities: Array.isArray(d.priorities) ? d.priorities.length : 0,
        publications: Array.isArray(d.publications) ? d.publications.length : 0,
        recentEvents: Array.isArray(d.recentEvents) ? d.recentEvents.length : 0,
        status: d.statusSimple || 'Unknown',
      };
    }
    if (sourceKey === 'doclist') {
      return {
        source: sourceKey,
        docs: Array.isArray(d.docs) ? d.docs.length : 0,
      };
    }
    if (sourceKey === 'event') {
      return {
        source: sourceKey,
        events: Array.isArray(d.events) ? d.events.length : 0,
      };
    }
    if (sourceKey === 'family') {
      return {
        source: sourceKey,
        publications: Array.isArray(d.publications) ? d.publications.length : 0,
      };
    }
    if (sourceKey === 'legal') {
      return {
        source: sourceKey,
        events: Array.isArray(d.events) ? d.events.length : 0,
        renewals: Array.isArray(d.renewals) ? d.renewals.length : 0,
      };
    }
    if (sourceKey === 'federated') {
      return {
        source: sourceKey,
        status: d.status || '',
        states: Array.isArray(d.states) ? d.states.length : 0,
        upMemberStates: normalize(d.upMemberStates || '').split(/,\s*/).filter(Boolean).length,
      };
    }
    if (sourceKey === 'citations') {
      return {
        source: sourceKey,
        entries: Array.isArray(d.entries) ? d.entries.length : 0,
        phases: Array.isArray(d.phases) ? d.phases.length : 0,
      };
    }
    if (sourceKey === 'ueMain') {
      return {
        source: sourceKey,
        ueStatus: d.ueStatus || '',
        upcOptOut: d.upcOptOut || '',
      };
    }
    return { source: sourceKey };
  }

  function captureLiveSource(caseNo) {
    const sourceKey = SOURCES.find((s) => s.slug === tabSlug())?.key;
    if (!sourceKey) return;
    try {
      const data = parseSource(sourceKey, document, caseNo);
      const classified = classifyParsedSourceState(sourceKey, document, data);
      const parseMessage = classified.status === 'ok'
        ? 'Live parse success'
        : classified.status === 'notFound'
          ? 'Live parse result not found'
          : 'Live parse result empty';
      const parseLevel = classified.status === 'ok' ? 'info' : classified.status === 'notFound' ? 'warn' : 'info';
      addLog(caseNo, parseLevel, parseMessage, { transport: 'dom', status: classified.status, reason: classified.reason, ...sourceDiagnostics(sourceKey, data) });
      storeCaseSource(caseNo, sourceKey, {
        status: classified.status,
        url: location.href,
        transport: 'dom',
        data,
      });
    } catch (error) {
      addLog(caseNo, 'error', `Live parse failure: ${error?.message || error}`, { source: sourceKey, transport: 'dom' });
      storeCaseSource(caseNo, sourceKey, {
        status: 'error',
        url: location.href,
        transport: 'dom',
        error: String(error?.message || error),
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

  async function fetchBinaryWithTimeout(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function loadExternalScriptText(url, signal) {
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('GM_xmlhttpRequest unavailable'));
    return new Promise((resolve, reject) => {
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: FETCH_TIMEOUT_MS * 2,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) resolve(String(res.responseText || ''));
          else reject(new Error(`HTTP ${res.status}`));
        },
        onerror: () => reject(new Error(`Failed to load script: ${url}`)),
        ontimeout: () => reject(new Error(`Timed out loading script: ${url}`)),
      });
      const onAbort = () => {
        try { req?.abort?.(); } catch {}
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function loadExternalScriptTag(url, signal) {
    return new Promise((resolve, reject) => {
      const root = document.head || document.documentElement || document.body;
      if (!root) {
        reject(new Error('Document root unavailable for script injection'));
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = url;
      script.crossOrigin = 'anonymous';

      let settled = false;
      const cleanup = () => {
        script.onload = null;
        script.onerror = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const settle = (error = null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          try { script.remove(); } catch {}
          reject(error);
          return;
        }
        resolve();
      };

      const timeout = setTimeout(() => settle(new Error(`Timed out loading script tag: ${url}`)), FETCH_TIMEOUT_MS * 2);
      const onAbort = () => settle(new DOMException('Aborted', 'AbortError'));

      script.onload = () => {
        clearTimeout(timeout);
        settle();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        settle(new Error(`Failed to load script tag: ${url}`));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      root.appendChild(script);
    });
  }

  function getUnsafeWindow() {
    try {
      return typeof unsafeWindow !== 'undefined' ? unsafeWindow : null;
    } catch {
      return null;
    }
  }

  function getPdfJsGlobal() {
    const uw = getUnsafeWindow();
    const candidates = [
      window?.pdfjsLib,
      globalThis?.pdfjsLib,
      window?.['pdfjs-dist/build/pdf'],
      globalThis?.['pdfjs-dist/build/pdf'],
      uw?.pdfjsLib,
      uw?.['pdfjs-dist/build/pdf'],
    ];
    return candidates.find((lib) => lib && typeof lib.getDocument === 'function') || null;
  }

  function clearPdfJsGlobals() {
    const uw = getUnsafeWindow();
    const holders = [window, globalThis, uw].filter(Boolean);
    for (const holder of holders) {
      if (holder.pdfjsLib && typeof holder.pdfjsLib.getDocument !== 'function') {
        try { delete holder.pdfjsLib; } catch { holder.pdfjsLib = undefined; }
      }
      if (holder['pdfjs-dist/build/pdf'] && typeof holder['pdfjs-dist/build/pdf'].getDocument !== 'function') {
        try { delete holder['pdfjs-dist/build/pdf']; } catch { holder['pdfjs-dist/build/pdf'] = undefined; }
      }
    }
  }

  function registerPdfJsGlobal(lib) {
    if (!lib || typeof lib.getDocument !== 'function') return null;
    const uw = getUnsafeWindow();
    try { window.pdfjsLib = lib; } catch {}
    try { globalThis.pdfjsLib = lib; } catch {}
    if (uw) {
      try { uw.pdfjsLib = lib; } catch {}
    }
    return lib;
  }

  function evaluateExternalScriptCode(code, label = 'external-script') {
    const source = `${String(code || '')}\n//# sourceURL=${label}.js`;
    let lastError = null;

    const existing = getPdfJsGlobal();
    if (existing) return existing;

    try {
      // eslint-disable-next-line no-new-func
      const commonJsRunner = new Function('window', 'globalThis', 'self', `${source}\nreturn (typeof module !== 'undefined' && module && module.exports) ? module.exports : null;`);
      const mod = commonJsRunner(window, globalThis, self);
      const lib = mod && typeof mod.getDocument === 'function'
        ? mod
        : (mod?.pdfjsLib && typeof mod.pdfjsLib.getDocument === 'function')
          ? mod.pdfjsLib
          : null;
      if (lib) return registerPdfJsGlobal(lib);
    } catch (error) {
      lastError = error;
    }

    try {
      // eslint-disable-next-line no-new-func
      Function(source)();
    } catch (error) {
      lastError = error;
    }

    const afterFunction = getPdfJsGlobal();
    if (afterFunction) return registerPdfJsGlobal(afterFunction);

    try {
      // eslint-disable-next-line no-eval
      (0, eval)(source);
    } catch (error) {
      lastError = error;
    }

    const afterEval = getPdfJsGlobal();
    if (afterEval) return registerPdfJsGlobal(afterEval);

    try {
      const root = document.head || document.documentElement || document.body;
      if (!root) throw new Error('Document root unavailable for inline script evaluation');
      const script = document.createElement('script');
      script.textContent = source;
      root.appendChild(script);
      script.remove();
    } catch (error) {
      lastError = error;
    }

    const afterInlineScript = getPdfJsGlobal();
    if (afterInlineScript) return registerPdfJsGlobal(afterInlineScript);
    if (lastError) throw lastError;
    throw new Error('Script evaluated but pdf.js global/module was not exposed');
  }

  async function ensurePdfJs(signal) {
    const existing = getPdfJsGlobal();
    if (existing) return existing;
    if (runtime.pdfjsPromise) return runtime.pdfjsPromise;

    runtime.pdfjsPromise = (async () => {
      const errors = [];

      for (const candidate of PDF_JS_CANDIDATES) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        clearPdfJsGlobals();

        try {
          const code = await loadExternalScriptText(candidate.lib, signal);
          const head = String(code || '').slice(0, 400);
          if (!code || code.length < 1000 || /<html|<!doctype/i.test(head)) {
            throw new Error('non-script payload received');
          }
          const lib = evaluateExternalScriptCode(code, `eporp-pdfjs-${candidate.id}-text`);
          if (!lib?.getDocument) throw new Error('pdf.js global not available after text load/eval');
          lib.GlobalWorkerOptions.workerSrc = candidate.worker;
          return registerPdfJsGlobal(lib);
        } catch (error) {
          errors.push(`${candidate.id}/text: ${error?.message || error}`);
        }

        try {
          await loadExternalScriptTag(candidate.lib, signal);
          const lib = getPdfJsGlobal();
          if (!lib?.getDocument) throw new Error('pdf.js global not available after script-tag load');
          lib.GlobalWorkerOptions.workerSrc = candidate.worker;
          return registerPdfJsGlobal(lib);
        } catch (error) {
          errors.push(`${candidate.id}/tag: ${error?.message || error}`);
        }
      }

      throw new Error(`pdf.js load failed (${errors.join(' | ') || 'unknown error'})`);
    })().catch((error) => {
      runtime.pdfjsPromise = null;
      throw error;
    });

    return runtime.pdfjsPromise;
  }

  function getTesseractGlobal() {
    const uw = getUnsafeWindow();
    const candidates = [window?.Tesseract, globalThis?.Tesseract, uw?.Tesseract];
    return candidates.find((lib) => lib && typeof lib.recognize === 'function') || null;
  }

  function clearTesseractGlobals() {
    const uw = getUnsafeWindow();
    const holders = [window, globalThis, uw].filter(Boolean);
    for (const holder of holders) {
      if (holder.Tesseract && typeof holder.Tesseract.recognize !== 'function') {
        try { delete holder.Tesseract; } catch { holder.Tesseract = undefined; }
      }
    }
  }

  function registerTesseractGlobal(lib) {
    if (!lib || typeof lib.recognize !== 'function') return null;
    const uw = getUnsafeWindow();
    try { window.Tesseract = lib; } catch {}
    try { globalThis.Tesseract = lib; } catch {}
    if (uw) {
      try { uw.Tesseract = lib; } catch {}
    }
    return lib;
  }

  function evaluateTesseractScriptCode(code, label = 'external-tesseract') {
    const source = `${String(code || '')}\n//# sourceURL=${label}.js`;
    let lastError = null;

    const existing = getTesseractGlobal();
    if (existing) return existing;

    try {
      // eslint-disable-next-line no-new-func
      Function(source)();
    } catch (error) {
      lastError = error;
    }

    const afterFunction = getTesseractGlobal();
    if (afterFunction) return registerTesseractGlobal(afterFunction);

    try {
      // eslint-disable-next-line no-eval
      (0, eval)(source);
    } catch (error) {
      lastError = error;
    }

    const afterEval = getTesseractGlobal();
    if (afterEval) return registerTesseractGlobal(afterEval);

    try {
      const root = document.head || document.documentElement || document.body;
      if (!root) throw new Error('Document root unavailable for inline script evaluation');
      const script = document.createElement('script');
      script.textContent = source;
      root.appendChild(script);
      script.remove();
    } catch (error) {
      lastError = error;
    }

    const afterInline = getTesseractGlobal();
    if (afterInline) return registerTesseractGlobal(afterInline);
    if (lastError) throw lastError;
    throw new Error('Script evaluated but tesseract global/module was not exposed');
  }

  async function ensureTesseract(signal) {
    const existing = getTesseractGlobal();
    if (existing) return existing;
    if (runtime.tesseractPromise) return runtime.tesseractPromise;

    runtime.tesseractPromise = (async () => {
      const errors = [];

      for (const candidate of OCR_TESSERACT_CANDIDATES) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        clearTesseractGlobals();

        try {
          const code = await loadExternalScriptText(candidate.lib, signal);
          const head = String(code || '').slice(0, 400);
          if (!code || code.length < 900 || /<html|<!doctype/i.test(head)) {
            throw new Error('non-script payload received');
          }
          const lib = evaluateTesseractScriptCode(code, `eporp-tesseract-${candidate.id}-text`);
          if (!lib?.recognize) throw new Error('Tesseract global not available after text load/eval');
          return registerTesseractGlobal(lib);
        } catch (error) {
          errors.push(`${candidate.id}/text: ${error?.message || error}`);
        }

        try {
          await loadExternalScriptTag(candidate.lib, signal);
          const lib = getTesseractGlobal();
          if (!lib?.recognize) throw new Error('Tesseract global not available after script-tag load');
          return registerTesseractGlobal(lib);
        } catch (error) {
          errors.push(`${candidate.id}/tag: ${error?.message || error}`);
        }
      }

      throw new Error(`Tesseract load failed (${errors.join(' | ') || 'unknown error'})`);
    })().catch((error) => {
      runtime.tesseractPromise = null;
      throw error;
    });

    return runtime.tesseractPromise;
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

    const pn = String(patentNumber || '').toLowerCase();
    const hasPatentRef = pn && t.includes(pn);
    if (!hasPatentRef) return null;

    const hasOptOutToken = /\bopt(?:ed)?[\s-]*out\b/.test(t);
    const positiveSignal =
      /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+(?:register(?:ed)?|enter(?:ed)?|effective)\b/.test(t)
      || /\b(?:register(?:ed)?|enter(?:ed)?|effective)(?:\s+\w+){0,8}\s+opt(?:ed)?[\s-]*out\b/.test(t)
      || /\bcase\s+type\s+opt(?:ed)?[\s-]*out\s+application\b/.test(t)
      || /\bopt(?:ed)?[\s-]*out\s+application\b/.test(t);
    const withdrawnSignal = /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+(?:withdrawn|removed|revoked)\b/.test(t);
    const negativeSignal =
      /\bnot\s+opt(?:ed)?[\s-]*out\b/.test(t)
      || /\bno\s+opt(?:ed)?[\s-]*out\b/.test(t)
      || /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+not\s+(?:been\s+)?(?:register(?:ed)?|enter(?:ed)?|effective)\b/.test(t);

    if (withdrawnSignal) {
      return { patentNumber, optedOut: false, status: 'Opt-out withdrawn', source: 'UPC registry' };
    }

    if (hasOptOutToken && positiveSignal && !negativeSignal) {
      return { patentNumber, optedOut: true, status: 'Opted out', source: 'UPC registry' };
    }

    return null;
  }

  function upcCandidateNumbers(caseNo) {
    const { c, docs } = caseSnapshot(caseNo);
    const picks = [];

    // Use case-specific publication numbers only (avoid family-wide false positives).
    // IMPORTANT: UPC patent_number must be a publication number, never an EP application number.
    // Prefer explicit main-page publications, then supplement from case-local doclist evidence.
    for (const p of casePublications(c, { docs, includeFamily: false })) {
      const m = String(p.no || '').toUpperCase().match(/^(EP\d{6,})/);
      if (m?.[1]) picks.push(m[1]);
    }

    return [...new Set(picks)].slice(0, 4);
  }

  async function refreshUpcRegistry(caseNo, signal, force = false) {
    const dependencyStamp = derivedDependencyStamp(caseNo, 'upcRegistry');
    const cached = getCase(caseNo).sources.upcRegistry;
    if (!force && isFresh(cached, options().refreshHours, { allowEmpty: true, dependencyStamp })) return;

    const candidates = upcCandidateNumbers(caseNo);
    if (!candidates.length) {
      storeCaseSource(caseNo, 'upcRegistry', {
        title: 'UPC Opt-out registry',
        status: 'empty',
        transport: 'cross-origin',
        dependencyStamp,
        data: { patentNumbers: [], status: 'No EP publication numbers available' },
      });
      addLog(caseNo, 'info', 'UPC registry check skipped: no EP publication numbers available', { source: 'upcRegistry' });
      return;
    }

    let hadResponse = false;
    let lastError = null;

    for (const patentNumber of candidates) {
      const url = `https://www.unifiedpatentcourt.org/en/registry/opt-out/results?patent_number=${encodeURIComponent(patentNumber)}`;
      try {
        const html = await fetchCrossOrigin(url, signal);
        hadResponse = true;
        const parsed = parseUpcOptOutResult(html, patentNumber);
        if (!parsed) continue;
        storeCaseSource(caseNo, 'upcRegistry', {
          title: 'UPC Opt-out registry',
          status: 'ok',
          url,
          transport: 'cross-origin',
          dependencyStamp,
          data: parsed,
        });
        addLog(caseNo, 'ok', `UPC registry check: ${parsed.status}`, { source: 'upcRegistry', patentNumber });
        return;
      } catch (error) {
        lastError = error;
        addLog(caseNo, 'warn', `UPC registry check failed for ${patentNumber}: ${error?.message || error}`, { source: 'upcRegistry' });
      }
    }

    if (hadResponse) {
      storeCaseSource(caseNo, 'upcRegistry', {
        title: 'UPC Opt-out registry',
        status: 'empty',
        transport: 'cross-origin',
        dependencyStamp,
        data: { patentNumbers: candidates, status: 'No registry match found' },
      });
      addLog(caseNo, 'info', 'UPC registry check completed without a matching opt-out result', {
        source: 'upcRegistry',
        candidates,
      });
      return;
    }

    storeCaseSource(caseNo, 'upcRegistry', {
      title: 'UPC Opt-out registry',
      status: 'error',
      transport: 'cross-origin',
      dependencyStamp,
      error: String(lastError?.message || lastError || 'UPC registry lookup failed'),
      data: { patentNumbers: candidates },
    });
    addLog(caseNo, 'error', 'UPC registry check failed for all publication candidates', {
      source: 'upcRegistry',
      candidates,
    });
  }

  function normalizeDateString(raw) {
    const t = String(raw || '').trim();
    if (!t) return '';
    const m = t.match(/(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})/);
    if (!m) return '';
    const d = String(m[1] || '').padStart(2, '0');
    const mo = String(m[2] || '').padStart(2, '0');
    const yRaw = String(m[3] || '');
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${d}.${mo}.${y}`;
  }

  function parseSmallNumberToken(token) {
    const t = String(token || '').trim().toLowerCase();
    if (!t) return 0;
    if (/^\d{1,2}$/.test(t)) return Number(t);
    const map = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    return map[t] || 0;
  }

  function extractExplicitDeadlineDateFromPdf(textBlock) {
    const textRaw = String(textBlock || '');
    if (!textRaw) return { dateStr: '', evidence: '' };

    const candidates = [];
    const push = (rawDate, evidence, score = 100) => {
      const dateStr = normalizeDateString(rawDate);
      if (!dateStr) return;
      candidates.push({ dateStr, evidence, score });
    };

    for (const m of textRaw.matchAll(/(?:\bfinal\s+date\b[\s\S]{0,32}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit final date found in PDF communication text', 130);
    }
    for (const m of textRaw.matchAll(/(?:\bdeadline\b[\s\S]{0,32}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit deadline date found in PDF communication text', 120);
    }
    for (const m of textRaw.matchAll(/(?:\btime\s+limit\s+(?:expires?|expiring|ending)\b[\s\S]{0,24}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit time-limit expiry date found in PDF communication text', 125);
    }
    for (const m of textRaw.matchAll(/(?:\bno\s+later\s+than\b|\bat\s+the\s+latest(?:\s+by|\s+on)?\b|\blatest\s+by\b)\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 'Explicit latest-by date found in PDF communication text', 135);
    }

    if (!candidates.length) return { dateStr: '', evidence: '' };

    const best = candidates
      .map((c) => ({ ...c, ts: parseDateString(c.dateStr)?.getTime() || 0 }))
      .sort((a, b) => (b.score - a.score) || (b.ts - a.ts))[0];

    return { dateStr: best?.dateStr || '', evidence: best?.evidence || '' };
  }

  function extractCommunicationDateFromPdf(textBlock, context = {}) {
    const textRaw = String(textBlock || '');
    const docDateStr = normalizeDateString(context.docDateStr || '');
    const candidates = [];

    const push = (rawDate, score, evidence, contextText = '') => {
      const dateStr = normalizeDateString(rawDate);
      if (!dateStr) return;
      const veto = /final\s+date|deadline|latest\s+by|no\s+later\s+than|time\s+limit\s+(?:expires?|expiring|ending)/i;
      if (veto.test(contextText || '')) return;
      candidates.push({ dateStr, score, evidence });
    };

    // Common letter header table: Application No. / Ref. / Date
    for (const m of textRaw.matchAll(/application\s*no\.?[\s\S]{0,120}?\bref\.?[\s\S]{0,80}?\bdate\b[^\d]{0,16}(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 185, 'Date extracted from Application/Ref/Date header table in PDF');
    }

    for (const m of textRaw.matchAll(/(?:date\s+of\s+(?:this\s+)?(?:communication|notification|letter)[\s\S]{0,20}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 180, 'Date of communication field found in PDF');
    }

    for (const m of textRaw.matchAll(/\bdate\b\s*[:\-]?\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      const idx = m.index || 0;
      const snippet = textRaw.slice(Math.max(0, idx - 24), Math.min(textRaw.length, idx + String(m[0] || '').length + 24));
      push(m[1], 150, 'Date field found in PDF communication header', snippet);
    }

    for (const m of textRaw.matchAll(/(?:communication(?:\s+pursuant\s+to[^\n]{0,40})?[^\n]{0,80}?\bdated\b[^\d]{0,12})(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
      push(m[1], 145, 'Dated communication line found in PDF');
    }

    const registered = extractRegisteredLetterProofLine(textRaw);
    const proofDate = normalizeDateString(String(registered.proofLine || '').match(DATE_RE)?.[1] || '');
    if (proofDate) {
      push(proofDate, 105, 'Date extracted from line below "Registered Letter" in PDF (dispatch proof context)');
    }

    const registeredLineDate = normalizeDateString(String(registered.registeredLetterLine || '').match(DATE_RE)?.[1] || '');
    if (registeredLineDate) {
      push(registeredLineDate, 95, 'Date extracted from "Registered Letter" line in PDF (dispatch proof context)');
    }

    for (const m of textRaw.matchAll(/epo\s*form[^\n\r]{0,80}\((\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})\)/gi)) {
      push(m[1], 100, 'Date extracted from EPO form stamp near Registered Letter (dispatch proof context)');
    }

    if (docDateStr) {
      push(docDateStr, 30, 'Doclist date fallback for communication date');
    }

    if (!candidates.length) return { dateStr: '', evidence: '' };

    const best = candidates
      .map((c) => ({
        ...c,
        bonus: docDateStr && c.dateStr === docDateStr ? 8 : 0,
        ts: parseDateString(c.dateStr)?.getTime() || 0,
      }))
      .sort((a, b) => ((b.score + b.bonus) - (a.score + a.bonus)) || (b.ts - a.ts))[0];

    return { dateStr: best?.dateStr || '', evidence: best?.evidence || '' };
  }

  function extractResponseMonthsFromPdf(textBlock) {
    const textRaw = String(textBlock || '');
    if (!textRaw) return { months: 0, evidence: '' };

    const candidates = [];
    const push = (token, evidence, score) => {
      const months = parseSmallNumberToken(token);
      if (!Number.isFinite(months) || months <= 0 || months > 24) return;
      candidates.push({ months, evidence, score });
    };

    for (const m of textRaw.matchAll(/\bwithin\s+(?:a\s+)?(?:period|time\s+limit)\s+of\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from "${String(m[0] || '').trim()}" in PDF text`, 130);
    }
    for (const m of textRaw.matchAll(/\b(?:period|time\s+limit)\s+of\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from "${String(m[0] || '').trim()}" in PDF text`, 120);
    }
    for (const m of textRaw.matchAll(/\bwithin\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from "${String(m[0] || '').trim()}" in PDF text`, 110);
    }
    for (const m of textRaw.matchAll(/\bof\s+([a-z]+|\d{1,2})\s+months?\b/gi)) {
      push(m[1], `Derived from fragmented phrase "${String(m[0] || '').trim()}" in PDF text`, 70);
    }

    // OCR/fragmented fallback phrases that often surface as short "X months" snippets.
    for (const m of textRaw.matchAll(/\b((?:2|3|5|6|two|three|five|six))\s+months?\b/gi)) {
      push(m[1], `Derived from fragmented target phrase "${String(m[0] || '').trim()}" in PDF text`, 62);
    }
    for (const m of textRaw.matchAll(/\bmonths?\s*(?:of|:|-)?\s*((?:2|3|5|6|two|three|five|six))\b/gi)) {
      push(m[1], `Derived from reversed fragmented target phrase "${String(m[0] || '').trim()}" in PDF text`, 58);
    }

    if (!candidates.length) return { months: 0, evidence: '' };

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    return { months: best?.months || 0, evidence: best?.evidence || '' };
  }

  function extractRegisteredLetterProofLine(textBlock) {
    const raw = String(textBlock || '');
    if (!raw) return { registeredLetterLine: '', proofLine: '' };

    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalize(line))
      .filter(Boolean);

    const idx = lines.findIndex((line) => /\bregistered\s+letter\b/i.test(line));
    if (idx >= 0) {
      const current = lines[idx] || '';
      const tail = normalize(current.replace(/.*?\bregistered\s+letter\b[:\s\-]*/i, ''));
      if (tail && !/\bregistered\s+letter\b/i.test(tail)) {
        return {
          registeredLetterLine: current,
          proofLine: tail.slice(0, 180),
        };
      }

      for (let i = idx + 1; i < Math.min(lines.length, idx + 10); i++) {
        const line = normalize(lines[i]);
        if (!line) continue;
        if (/\bregistered\s+letter\b/i.test(line)) continue;
        return {
          registeredLetterLine: current,
          proofLine: line,
        };
      }

      for (let i = Math.max(0, idx - 4); i < idx; i++) {
        const line = normalize(lines[i]);
        if (!line) continue;
        if (/\bregistered\s+letter\b/i.test(line)) continue;
        if (/\bepo\s*form\b|\(\d{2}\.\d{2}\.\d{4}\)/i.test(line)) {
          return {
            registeredLetterLine: current,
            proofLine: line,
          };
        }
      }

      return {
        registeredLetterLine: current,
        proofLine: '',
      };
    }

    const inline = normalize(raw).match(/registered\s+letter\s*[:\-]?\s*([^\n\r]{3,180})/i);
    if (inline?.[1]) {
      const proof = normalize(String(inline[1] || '').split(/\s{2,}/)[0]);
      if (proof) {
        return {
          registeredLetterLine: 'Registered Letter',
          proofLine: proof,
        };
      }
    }

    const nearby = normalize(raw).match(/(epo\s*form[^\n\r]{0,140}\(\d{2}\.\d{2}\.\d{4}\))/i);
    if (nearby?.[1]) {
      return {
        registeredLetterLine: 'Registered Letter',
        proofLine: normalize(nearby[1]),
      };
    }

    return { registeredLetterLine: '', proofLine: '' };
  }

  function inferDeadlineCategoryFromContext(context = {}) {
    const low = `${String(context.docTitle || '')} ${String(context.docProcedure || '')}`.toLowerCase();
    if (!normalize(low)) return { category: '', evidence: '' };

    if (/rule\s*71\s*\(\s*3\s*\)|intention to grant|text intended for grant/.test(low)) {
      return { category: 'R71(3) response period', evidence: 'Inferred from document title/procedure metadata (Rule 71(3) / intention to grant signal)' };
    }
    if (/\brule\s*116\b|summons to oral proceedings/.test(low)) {
      return { category: 'Rule 116 final date', evidence: 'Inferred from document title/procedure metadata (Rule 116 / summons signal)' };
    }
    if (/\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)|communication from (?:the )?examining|examining division/.test(low)) {
      return { category: 'Art. 94(3) response period', evidence: 'Inferred from document title/procedure metadata (examining-division communication signal)' };
    }
    if (/\brule\s*161\b|\brule\s*162\b/.test(low)) {
      return { category: 'Rule 161/162 response period', evidence: 'Inferred from document title/procedure metadata (Rule 161/162 signal)' };
    }
    if (/\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b|\bofficial communication\b|\boffice action\b/.test(low)) {
      return { category: 'Communication response period', evidence: 'Inferred from document title/procedure metadata (generic communication signal)' };
    }

    return { category: '', evidence: '' };
  }

  function defaultResponseMonthsForCategory(category) {
    const c = String(category || '').toLowerCase();
    if (c.includes('art. 94(3)')) return 4;
    if (c.includes('r71(3)')) return 4;
    if (c.includes('rule 161/162')) return 6;
    return 0;
  }

  function parsePdfDeadlineHints(pdfText, context = {}) {
    const textRaw = String(pdfText || '');
    const textLower = textRaw.toLowerCase();
    const docDateStr = normalizeDateString(context.docDateStr || '');

    const diagnostics = {
      category: '',
      categoryEvidence: '',
      communicationDate: '',
      communicationEvidence: '',
      responseMonths: 0,
      responseEvidence: '',
      explicitDeadlineDate: '',
      explicitDeadlineEvidence: '',
      registeredLetterLine: '',
      registeredLetterProofLine: '',
    };

    if (!textLower) return { hints: [], diagnostics };

    const hints = [];

    const pushHint = (hint) => {
      const date = parseDateString(hint?.dateStr || '');
      if (!date) return;
      hints.push({
        label: hint.label,
        dateStr: formatDate(date),
        sourceDate: hint.sourceDate || '',
        confidence: hint.confidence || 'high',
        level: hint.level || 'bad',
        resolved: false,
        source: 'PDF parse',
        evidence: hint.evidence || '',
      });
    };

    const categoryFromText = /rule\s*71\s*\(\s*3\s*\)|intention to grant/.test(textLower)
      ? 'R71(3) response period'
      : /\brule\s*116\b|summons to oral proceedings/.test(textLower)
        ? 'Rule 116 final date'
        : /\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)/.test(textLower)
          ? 'Art. 94(3) response period'
          : /\brule\s*161\b|\brule\s*162\b/.test(textLower)
            ? 'Rule 161/162 response period'
            : '';

    const categoryFromContext = inferDeadlineCategoryFromContext(context);
    let category = categoryFromText || categoryFromContext.category;

    diagnostics.category = category;
    diagnostics.categoryEvidence = categoryFromText
      ? 'Detected from communication text'
      : (categoryFromContext.evidence || '');

    const registeredLetter = extractRegisteredLetterProofLine(textRaw);
    diagnostics.registeredLetterLine = registeredLetter.registeredLetterLine || '';
    diagnostics.registeredLetterProofLine = registeredLetter.proofLine || '';

    const communication = extractCommunicationDateFromPdf(textRaw, { docDateStr });
    const communicationDateStr = communication.dateStr || docDateStr;
    const communicationDate = parseDateString(communicationDateStr);
    diagnostics.communicationDate = communicationDateStr || '';
    diagnostics.communicationEvidence = communication.evidence || (docDateStr ? 'Doclist date fallback for communication date' : '');

    const monthPeriod = extractResponseMonthsFromPdf(textRaw);
    let responseMonths = monthPeriod.months || 0;
    let responseEvidence = monthPeriod.evidence || '';
    if (!responseMonths && category) {
      const fallbackMonths = defaultResponseMonthsForCategory(category);
      if (fallbackMonths > 0) {
        responseMonths = fallbackMonths;
        responseEvidence = `Default ${fallbackMonths}-month period inferred for ${category}${diagnostics.categoryEvidence ? ` (${diagnostics.categoryEvidence})` : ''}`;
      }
    }

    diagnostics.responseMonths = responseMonths;
    diagnostics.responseEvidence = responseEvidence;

    const explicitDue = extractExplicitDeadlineDateFromPdf(textRaw);
    diagnostics.explicitDeadlineDate = explicitDue.dateStr || '';
    diagnostics.explicitDeadlineEvidence = explicitDue.evidence || '';

    const genericCommunicationSignal = /\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b/.test(textLower);
    if (!category && (monthPeriod.months || explicitDue.dateStr || genericCommunicationSignal) && communicationDateStr) {
      category = 'Communication response period';
      diagnostics.category = category;
      diagnostics.categoryEvidence = monthPeriod.months || explicitDue.dateStr
        ? 'Inferred from communication-period evidence in document text'
        : 'Inferred from generic communication text signal';
    }

    if (!category) {
      return { hints: [], diagnostics };
    }

    let explicitAdded = false;
    if (explicitDue.dateStr) {
      pushHint({
        label: category,
        dateStr: explicitDue.dateStr,
        sourceDate: communicationDateStr || docDateStr,
        confidence: 'high',
        level: /rule\s*116/i.test(category) ? 'warn' : 'bad',
        evidence: explicitDue.evidence,
      });
      explicitAdded = true;
    }

    if (!explicitAdded && responseMonths && communicationDate) {
      const calc = addCalendarMonthsDetailed(communicationDate, responseMonths);
      const communicationFromDocFallback = /doclist date fallback/i.test(String(diagnostics.communicationEvidence || ''));
      const confidence = monthPeriod.months
        ? (communicationFromDocFallback ? 'medium' : 'high')
        : 'low';

      pushHint({
        label: category,
        dateStr: formatDate(calc.date),
        sourceDate: communicationDateStr,
        confidence,
        level: /rule\s*116/i.test(category) ? 'warn' : 'bad',
        evidence: `${responseEvidence || `Derived from ${responseMonths} month response period`} from communication date ${communicationDateStr}${calc.rolledOver ? ` (rollover ${calc.fromDay}→${calc.toDay})` : ''}`,
      });
    }

    return {
      hints: dedupe(hints, (h) => `${h.label}|${h.dateStr}`),
      diagnostics,
    };
  }

  function normalizePdfDocumentUrl(rawUrl) {
    const absolutize = (candidate) => {
      const value = String(candidate || '').trim();
      if (!value) return '';
      try {
        return new URL(value.replace(/&amp;/gi, '&'), location.origin).toString();
      } catch {
        return '';
      }
    };

    let raw = String(rawUrl || '').trim();
    if (!raw) return '';

    if (/^javascript:/i.test(raw)) {
      const js = raw
        .replace(/^javascript:\s*/i, '')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');

      let decodedJs = js;
      try {
        decodedJs = decodeURIComponent(js);
      } catch {
        // keep raw form
      }

      const source = `${js}\n${decodedJs}`;

      const absMatch = source.match(/https?:\/\/[^'"\s)]+/i)?.[0] || '';
      if (absMatch) {
        const cleanedAbs = absMatch
          .replace(/%27.*$/i, '')
          .replace(/&#39;.*$/i, '')
          .split("'")[0]
          .split('"')[0]
          .split(')')[0]
          .split(',')[0];
        const absUrl = absolutize(cleanedAbs);
        if (absUrl) return absUrl;
      }

      const relMatch = source.match(/\/?application\?documentId=[^'"\s)]+/i)?.[0] || '';
      if (relMatch) {
        let cleanedRel = relMatch
          .replace(/%27.*$/i, '')
          .replace(/&#39;.*$/i, '')
          .split("'")[0]
          .split('"')[0]
          .split(')')[0]
          .split(',')[0];
        if (!cleanedRel.startsWith('/')) cleanedRel = `/${cleanedRel}`;
        return absolutize(cleanedRel);
      }

      return '';
    }

    raw = raw.replace(/%27.*$/i, '');
    return absolutize(raw);
  }

  async function resolvePdfUrl(url, signal) {
    const normalized = normalizePdfDocumentUrl(url);
    if (!normalized) return '';
    if (/\.pdf(?:\?|$)/i.test(normalized)) return normalized;

    try {
      if (/[?&]documentId=/i.test(normalized) && /\/application\b/i.test(new URL(normalized).pathname)) {
        return normalized;
      }
    } catch {
      // continue to HTML fallback
    }

    try {
      const html = await fetchWithRetry(normalized, signal);
      const doc = parseHtml(html);

      const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
      const pdfHref = links.find((href) => /\.pdf(?:\?|$)/i.test(href));
      if (pdfHref) return new URL(pdfHref, normalized).toString();

      const embeds = [
        ...[...doc.querySelectorAll('iframe[src], embed[src]')].map((el) => el.getAttribute('src') || ''),
        ...[...doc.querySelectorAll('object[data]')].map((el) => el.getAttribute('data') || ''),
      ].filter(Boolean);

      const embedHref = embeds.find((href) => /\.pdf(?:\?|$)/i.test(href) || /[?&]documentId=/i.test(href));
      if (embedHref) return new URL(embedHref, normalized).toString();

      return '';
    } catch {
      return '';
    }
  }

  function pdfContentToStructuredText(content) {
    const rawItems = Array.isArray(content?.items) ? content.items : [];
    const items = rawItems
      .map((it, idx) => ({
        str: String(it?.str || '').trim(),
        x: Number(it?.transform?.[4] || 0),
        y: Number(it?.transform?.[5] || 0),
        idx,
      }))
      .filter((it) => !!it.str);

    if (!items.length) return '';

    const hasCoords = items.some((it) => Number.isFinite(it.x) && Number.isFinite(it.y) && (it.x !== 0 || it.y !== 0));
    if (!hasCoords) return items.map((it) => it.str).join(' ');

    items.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 2.5) return dy;
      const dx = a.x - b.x;
      if (Math.abs(dx) > 0.5) return dx;
      return a.idx - b.idx;
    });

    const lines = [];
    let current = [];
    let lineY = null;

    const flush = () => {
      if (!current.length) return;
      current.sort((a, b) => (a.x - b.x) || (a.idx - b.idx));
      lines.push(current.map((it) => it.str).join(' '));
      current = [];
      lineY = null;
    };

    for (const item of items) {
      if (lineY == null) {
        current.push(item);
        lineY = item.y;
        continue;
      }
      if (Math.abs(item.y - lineY) <= 2.5) {
        current.push(item);
        lineY = (lineY + item.y) / 2;
        continue;
      }
      flush();
      current.push(item);
      lineY = item.y;
    }
    flush();

    return lines.join('\n');
  }

  function isPdfBinaryData(binary) {
    if (!binary) return false;
    const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    if (bytes.length < 5) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
  }

  function binaryToUtf8(binary, maxBytes = 300000) {
    if (!binary) return '';
    const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    const slice = bytes.slice(0, Math.max(0, maxBytes));
    try {
      if (typeof TextDecoder === 'function') return new TextDecoder('utf-8', { fatal: false }).decode(slice);
    } catch {
      // fallback below
    }
    return Array.from(slice).map((b) => String.fromCharCode(b)).join('');
  }

  function hasMeaningfulCommunicationText(raw) {
    const txt = normalize(String(raw || ''));
    if (!txt) return false;
    const alphaCount = (txt.match(/[A-Za-z]/g) || []).length;
    return txt.length >= 120 && alphaCount >= 40;
  }

  function focusCommunicationContextText(raw) {
    const txt = normalize(String(raw || ''));
    if (!txt) return '';

    const low = txt.toLowerCase();
    const anchors = [
      'registered letter',
      'date of communication',
      'date of this communication',
      'time limit',
      'within',
      'article 94(3)',
      'art. 94(3)',
      'rule 71(3)',
      'rule 116',
      'rule 161',
      'rule 162',
    ];

    let idx = -1;
    for (const anchor of anchors) {
      const pos = low.indexOf(anchor);
      if (pos >= 0 && (idx < 0 || pos < idx)) idx = pos;
    }

    if (idx < 0) return txt;
    const start = Math.max(0, idx - 1200);
    const end = Math.min(txt.length, idx + 3200);
    let focused = txt.slice(start, end);

    const regIdx = low.lastIndexOf('registered letter');
    if (regIdx >= 0 && (regIdx < start || regIdx > end)) {
      const regStart = Math.max(0, regIdx - 220);
      const regEnd = Math.min(txt.length, regIdx + 380);
      focused = `${focused}\n${txt.slice(regStart, regEnd)}`;
    }

    return dedupeMultiline(focused);
  }

  function deriveDocumentPageUrlFromPdfUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ''), location.origin);
      const docId = normalize(u.searchParams.get('documentId') || '');
      if (!docId) return '';

      const number = normalize(u.searchParams.get('number') || u.searchParams.get('appnumber') || '').toUpperCase();
      const lng = normalize(u.searchParams.get('lng') || currentLang() || 'en');

      const out = new URL(`${location.origin}/application`);
      out.searchParams.set('documentId', docId);
      if (number) out.searchParams.set('number', number);
      if (lng) out.searchParams.set('lng', lng);
      out.searchParams.set('npl', 'false');
      return out.toString();
    } catch {
      return '';
    }
  }

  function extractPdfLikeUrlFromHtml(html, baseUrl) {
    const doc = parseHtml(String(html || ''));
    const attrCandidates = [
      ...[...doc.querySelectorAll('a[href]')].map((el) => el.getAttribute('href') || ''),
      ...[...doc.querySelectorAll('iframe[src], embed[src]')].map((el) => el.getAttribute('src') || ''),
      ...[...doc.querySelectorAll('object[data]')].map((el) => el.getAttribute('data') || ''),
    ];

    const scriptText = [...doc.querySelectorAll('script')].map((s) => text(s)).join('\n');
    const regexCandidates = [
      ...(scriptText.match(/https?:\/\/[^\s"')>]+\.pdf(?:\?[^\s"')>]*)?/gi) || []),
      ...(scriptText.match(/\/?application\?documentId=[^\s"')>]+/gi) || []),
    ];

    const all = [...attrCandidates, ...regexCandidates].map((v) => normalize(String(v || ''))).filter(Boolean);
    for (const raw of all) {
      const normalized = normalizePdfDocumentUrl(raw) || (() => {
        try { return new URL(raw, baseUrl).toString(); } catch { return ''; }
      })();
      if (!normalized) continue;
      if (/\.pdf(?:\?|$)/i.test(normalized) || /[?&]documentId=/i.test(normalized)) return normalized;
    }
    return '';
  }

  async function extractTextFromPdfViaOcr(binary, pdfjs, signal) {
    const tesseract = await ensureTesseract(signal);
    const data = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
    const loadingTask = pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
    const pdf = await loadingTask.promise;

    try {
      const maxPages = Math.min(pdf.numPages || 0, OCR_MAX_PAGES);
      const chunks = [];
      let pagesUsed = 0;

      for (let i = 1; i <= maxPages; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!ctx) continue;

        await page.render({ canvasContext: ctx, viewport }).promise;

        const result = await tesseract.recognize(canvas, 'eng', OCR_RECOGNIZE_OPTIONS);
        const pageText = normalize(String(result?.data?.text || ''));
        if (pageText) chunks.push(pageText);
        pagesUsed += 1;

        canvas.width = 1;
        canvas.height = 1;

        const joined = normalize(chunks.join('\n'));
        if (/\bregistered\s+letter\b|\btime\s+limit\b|\bwithin\b|\barticle\s*94\s*\(\s*3\s*\)\b|\bart\.?\s*94\s*\(\s*3\s*\)\b/i.test(joined) && joined.length > 120) {
          break;
        }
      }

      return { text: normalize(chunks.join('\n')), pagesUsed };
    } finally {
      try { await pdf.destroy(); } catch {}
    }
  }

  async function extractPdfText(url, signal, pdfjsInstance = null) {
    const pdfjs = pdfjsInstance || await ensurePdfJs(signal);

    const parsePdfBinaryToText = async (binary) => {
      const data = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
      const loadingTask = pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
      const pdf = await loadingTask.promise;
      try {
        const maxPages = Math.min(pdf.numPages || 0, 8);
        const chunks = [];
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const txt = pdfContentToStructuredText(content);
          if (txt) chunks.push(txt);
        }
        return chunks.join('\n');
      } finally {
        try { await pdf.destroy(); } catch {}
      }
    };

    const htmlFallbackFromPayload = (html, transport, resolvedUrl) => {
      const raw = bodyText(parseHtml(String(html || '')));
      const focused = focusCommunicationContextText(raw);
      if (!hasMeaningfulCommunicationText(focused)) return null;
      return { text: focused, transport, resolvedUrl, isPdf: false, usedOcr: false, ocrPages: 0 };
    };

    const tryDocumentPageFallback = async (seedUrl, transport) => {
      const docPageUrl = deriveDocumentPageUrlFromPdfUrl(seedUrl);
      if (!docPageUrl) return null;
      try {
        const html = await fetchWithRetry(docPageUrl, signal);
        return htmlFallbackFromPayload(html, transport, docPageUrl);
      } catch {
        return null;
      }
    };

    const binary = await fetchBinaryWithRetry(url, signal);
    if (isPdfBinaryData(binary)) {
      const text = normalize(await parsePdfBinaryToText(binary));
      if (text) {
        return { text, transport: 'pdfjs', resolvedUrl: url, isPdf: true, usedOcr: false, ocrPages: 0 };
      }

      try {
        const ocr = await extractTextFromPdfViaOcr(binary, pdfjs, signal);
        const ocrText = focusCommunicationContextText(ocr?.text || '');
        if (hasMeaningfulCommunicationText(ocrText)) {
          return {
            text: ocrText,
            transport: 'pdfjs-ocr',
            resolvedUrl: url,
            isPdf: true,
            usedOcr: true,
            ocrPages: Number(ocr?.pagesUsed || 0),
          };
        }
      } catch {
        // continue with HTML fallbacks
      }

      const docPageFallback = await tryDocumentPageFallback(url, 'html-fallback-from-document-page-after-empty-pdf-text');
      if (docPageFallback) return docPageFallback;

      return { text: '', transport: 'pdfjs-empty-text', resolvedUrl: url, isPdf: true, usedOcr: false, ocrPages: 0 };
    }

    const htmlPayload = binaryToUtf8(binary);
    const looksHtml = /<\s*html\b|<!doctype\s+html|<\s*body\b|<\s*title\b/i.test(String(htmlPayload || '').slice(0, 2000));
    if (!looksHtml) {
      throw new Error('Invalid PDF structure (non-PDF payload)');
    }

    const directHtmlFallback = htmlFallbackFromPayload(htmlPayload, 'html-fallback', url);

    const linkedUrl = extractPdfLikeUrlFromHtml(htmlPayload, url);
    if (linkedUrl && linkedUrl !== url) {
      const linkedBinary = await fetchBinaryWithRetry(linkedUrl, signal);
      if (isPdfBinaryData(linkedBinary)) {
        const linkedText = normalize(await parsePdfBinaryToText(linkedBinary));
        if (linkedText) {
          return { text: linkedText, transport: 'pdfjs-via-linked-url', resolvedUrl: linkedUrl, isPdf: true, usedOcr: false, ocrPages: 0 };
        }

        try {
          const linkedOcr = await extractTextFromPdfViaOcr(linkedBinary, pdfjs, signal);
          const linkedOcrText = focusCommunicationContextText(linkedOcr?.text || '');
          if (hasMeaningfulCommunicationText(linkedOcrText)) {
            return {
              text: linkedOcrText,
              transport: 'pdfjs-via-linked-url-ocr',
              resolvedUrl: linkedUrl,
              isPdf: true,
              usedOcr: true,
              ocrPages: Number(linkedOcr?.pagesUsed || 0),
            };
          }
        } catch {
          // continue with HTML fallbacks
        }

        const parentHtmlFallback = htmlFallbackFromPayload(htmlPayload, 'html-fallback-from-document-page-after-empty-linked-pdf-text', url);
        if (parentHtmlFallback) return parentHtmlFallback;

        const linkedDocPageFallback = await tryDocumentPageFallback(linkedUrl, 'html-fallback-from-linked-document-page-after-empty-pdf-text');
        if (linkedDocPageFallback) return linkedDocPageFallback;

        return { text: '', transport: 'pdfjs-via-linked-url-empty-text', resolvedUrl: linkedUrl, isPdf: true, usedOcr: false, ocrPages: 0 };
      }

      const linkedHtml = binaryToUtf8(linkedBinary);
      const linkedHtmlFallback = htmlFallbackFromPayload(linkedHtml, 'html-fallback-via-linked-url', linkedUrl);
      if (linkedHtmlFallback) return linkedHtmlFallback;
    }

    if (directHtmlFallback) return directHtmlFallback;

    throw new Error('Invalid PDF structure (HTML payload without readable text)');
  }

  function pdfDeadlineCandidates(docs = []) {
    return docs.filter((d) => {
      const actor = String(d.actor || '').toLowerCase();
      const text = normalize(`${d.title || ''} ${d.procedure || ''}`).toLowerCase();
      if (!text) return false;

      const ruleSignal = /rule\s*71\s*\(\s*3\s*\)|\brule\s*116\b|\brule\s*161\b|\brule\s*162\b|\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)/.test(text);
      const communicationSignal = /\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b|\bintention to grant\b|\bexamining division\b|\bopposition division\b/.test(text);

      if (ruleSignal) return true;
      if (communicationSignal && actor !== 'applicant') return true;
      return false;
    }).slice(0, 8);
  }

  function storePdfDeadlineSource(caseNo, dependencyStamp, status, data = { hints: [], scanned: [] }, error = '') {
    storeCaseSource(caseNo, 'pdfDeadlines', {
      title: 'PDF-derived deadlines',
      status,
      transport: 'fetch+pdfjs',
      dependencyStamp,
      error,
      data,
    });
  }

  function derivePdfDeadlineStatus(hints, scanned, successfulCandidates) {
    if ((hints || []).length) return 'ok';
    if ((successfulCandidates || 0) > 0 || (scanned || []).length > 0) return 'empty';
    return 'error';
  }

  function buildPdfDeadlineSummary(scanned, successfulCandidates, failedCandidates) {
    return {
      scannedDocs: scanned.length,
      successfulCandidates,
      failedCandidates,
      withHints: scanned.filter((x) => (x.hintCount || 0) > 0).length,
      withCommunicationDate: scanned.filter((x) => !!x.communicationDate).length,
      withResponsePeriod: scanned.filter((x) => Number(x.responseMonths || 0) > 0).length,
      withProofLine: scanned.filter((x) => !!x.registeredLetterProofLine).length,
      withOcr: scanned.filter((x) => !!x.usedOcr).length,
    };
  }

  async function scanPdfDeadlineCandidate(caseNo, doc, signal, pdfjs) {
    addLog(caseNo, 'info', 'PDF candidate scan start', { source: 'pdfDeadlines', doc: doc.title || '', docDate: doc.dateStr || '' });

    const resolvedUrl = await resolvePdfUrl(doc.url, signal);
    if (!resolvedUrl) {
      addLog(caseNo, 'warn', 'PDF URL could not be resolved from document page', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        docUrl: doc.url || '',
        normalizedDocUrl: normalizePdfDocumentUrl(doc.url || ''),
      });
      return { scanSucceeded: false, parsedHints: [], scannedEntry: null };
    }

    const extracted = await extractPdfText(resolvedUrl, signal, pdfjs);
    const text = normalize(String(extracted?.text || ''));
    const parseTransport = String(extracted?.transport || 'unknown');
    const parseUrl = String(extracted?.resolvedUrl || resolvedUrl);

    if (extracted?.usedOcr) {
      addLog(caseNo, 'ok', 'PDF OCR fallback used', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        url: parseUrl,
        transport: parseTransport,
        ocrPages: Number(extracted?.ocrPages || 0),
      });
    }

    if (!text) {
      addLog(caseNo, 'warn', 'PDF opened but extracted text was empty', { source: 'pdfDeadlines', doc: doc.title || '', url: parseUrl, transport: parseTransport });
      return { scanSucceeded: true, parsedHints: [], scannedEntry: null };
    }

    if (!extracted?.isPdf) {
      addLog(caseNo, 'warn', 'PDF binary unavailable; using HTML fallback text extraction', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        url: parseUrl,
        transport: parseTransport,
      });
    }

    const parsed = parsePdfDeadlineHints(text, {
      docDateStr: doc.dateStr,
      docTitle: doc.title,
      docProcedure: doc.procedure,
    });
    const parsedHints = Array.isArray(parsed?.hints) ? parsed.hints : [];
    const diagnostics = parsed?.diagnostics || {};

    const proofLine = normalize(diagnostics.registeredLetterProofLine || '');
    addLog(caseNo, proofLine ? 'ok' : 'warn', `PDF proof line (below "Registered Letter"): ${proofLine || 'not found'}`, {
      source: 'pdfDeadlines',
      doc: doc.title || '',
      docDate: doc.dateStr || '',
      transport: parseTransport,
      url: parseUrl,
    });

    addLog(caseNo, 'info', 'PDF parse diagnostics', {
      source: 'pdfDeadlines',
      doc: doc.title || '',
      transport: parseTransport,
      url: parseUrl,
      usedOcr: !!extracted?.usedOcr,
      ocrPages: Number(extracted?.ocrPages || 0),
      category: diagnostics.category || '',
      categoryEvidence: diagnostics.categoryEvidence || '',
      communicationDate: diagnostics.communicationDate || '',
      communicationEvidence: diagnostics.communicationEvidence || '',
      responseMonths: Number(diagnostics.responseMonths || 0),
      responseEvidence: diagnostics.responseEvidence || '',
      explicitDeadlineDate: diagnostics.explicitDeadlineDate || '',
      explicitDeadlineEvidence: diagnostics.explicitDeadlineEvidence || '',
      registeredLetterLine: String(diagnostics.registeredLetterLine || '').slice(0, 180),
      registeredLetterProofLine: String(diagnostics.registeredLetterProofLine || '').slice(0, 180),
      textChars: text.length,
    });

    const doclistDate = normalizeDateString(doc.dateStr || '');
    const commDate = normalizeDateString(diagnostics.communicationDate || '');
    if (doclistDate && commDate && doclistDate !== commDate) {
      addLog(caseNo, 'warn', 'PDF communication date differs from doclist date (using PDF date for deadline derivation)', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        doclistDate,
        pdfCommunicationDate: commDate,
      });
    }

    if (parsedHints.length) {
      addLog(caseNo, 'ok', `PDF deadline hints parsed: ${parsedHints.length}`, {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        transport: parseTransport,
        url: parseUrl,
        hints: parsedHints.map((h) => `${h.label}=${h.dateStr}`),
      });
    } else {
      addLog(caseNo, 'info', 'PDF opened but no deadline hint produced for this document', {
        source: 'pdfDeadlines',
        doc: doc.title || '',
        transport: parseTransport,
        url: parseUrl,
        category: diagnostics.category || '',
      });
    }

    return {
      scanSucceeded: true,
      parsedHints,
      scannedEntry: {
        title: doc.title,
        dateStr: doc.dateStr,
        url: parseUrl,
        transport: parseTransport,
        usedOcr: !!extracted?.usedOcr,
        ocrPages: Number(extracted?.ocrPages || 0),
        hintCount: parsedHints.length,
        category: String(diagnostics.category || ''),
        communicationDate: String(diagnostics.communicationDate || ''),
        responseMonths: Number(diagnostics.responseMonths || 0),
        explicitDeadlineDate: String(diagnostics.explicitDeadlineDate || ''),
        registeredLetterProofLine: proofLine,
      },
    };
  }

  async function refreshPdfDeadlines(caseNo, signal, force = false) {
    if (!caseNo) return;
    const c = getCase(caseNo);
    const dependencyStamp = derivedDependencyStamp(caseNo, 'pdfDeadlines');
    const cached = c.sources.pdfDeadlines;
    if (!force && isFresh(cached, options().refreshHours, { allowEmpty: true, dependencyStamp })) return;

    const docs = caseDocs(c);
    if (!docs.length) {
      storePdfDeadlineSource(caseNo, dependencyStamp, 'empty');
      addLog(caseNo, 'info', 'PDF deadline scan skipped: doclist cache is empty', { source: 'pdfDeadlines' });
      return;
    }

    const candidates = pdfDeadlineCandidates(docs);
    if (!candidates.length) {
      storePdfDeadlineSource(caseNo, dependencyStamp, 'empty');
      addLog(caseNo, 'info', 'PDF deadline scan skipped: no communication-type documents found', { source: 'pdfDeadlines' });
      return;
    }

    let pdfjs = null;
    try {
      pdfjs = await ensurePdfJs(signal);
      addLog(caseNo, 'ok', 'PDF parser engine ready', { source: 'pdfDeadlines' });
    } catch (error) {
      const errText = String(error?.message || error || 'unknown error');
      addLog(caseNo, 'error', `PDF parser unavailable: ${errText}`, { source: 'pdfDeadlines' });
      storePdfDeadlineSource(caseNo, dependencyStamp, 'error', { hints: [], scanned: [] }, errText);
      addLog(caseNo, 'warn', 'PDF deadline parse aborted (parser engine unavailable)', { source: 'pdfDeadlines' });
      return;
    }

    const hints = [];
    const scanned = [];
    let failedCandidates = 0;
    let successfulCandidates = 0;
    let lastCandidateError = null;

    for (const doc of candidates) {
      if (signal?.aborted) return;
      try {
        const result = await scanPdfDeadlineCandidate(caseNo, doc, signal, pdfjs);
        if (result.scanSucceeded) successfulCandidates += 1;
        if (Array.isArray(result.parsedHints) && result.parsedHints.length) hints.push(...result.parsedHints);
        if (result.scannedEntry) scanned.push(result.scannedEntry);
      } catch (error) {
        failedCandidates += 1;
        lastCandidateError = error;
        addLog(caseNo, 'warn', `PDF deadline parse skipped: ${error?.message || error}`, { source: 'pdfDeadlines', doc: doc.title || '' });
      }
    }

    const dedupedHints = dedupe(hints, (h) => `${h.label}|${h.dateStr}`);
    const pdfStatus = derivePdfDeadlineStatus(dedupedHints, scanned, successfulCandidates);
    storePdfDeadlineSource(
      caseNo,
      dependencyStamp,
      pdfStatus,
      { hints: dedupedHints, scanned },
      pdfStatus === 'error' ? String(lastCandidateError?.message || lastCandidateError || 'PDF deadline scan failed') : '',
    );

    const summary = buildPdfDeadlineSummary(scanned, successfulCandidates, failedCandidates);
    const summaryLevel = pdfStatus === 'error' ? 'error' : (dedupedHints.length ? 'ok' : 'info');
    const summaryMessage = pdfStatus === 'error'
      ? 'PDF deadline parse failed for all candidate documents'
      : `PDF deadline parse ${dedupedHints.length ? `found ${dedupedHints.length} hint(s)` : 'found no explicit hints'}`;
    addLog(caseNo, summaryLevel, summaryMessage, { source: 'pdfDeadlines', ...summary });
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

  async function fetchBinaryWithRetry(url, signal) {
    let lastError;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        return await fetchBinaryWithTimeout(url, signal);
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
    if (!caseNo) return;
    if (!opts.preloadAllTabs && !force) {
      addLog(caseNo, 'info', 'Auto prefetch skipped (preloadAllTabs disabled)', { source: 'prefetch' });
      return;
    }

    if (runtime.fetchCaseNo === caseNo && runtime.fetching && !force) {
      addLog(caseNo, 'info', 'Prefetch request ignored (already running for this case)', { source: 'prefetch' });
      return;
    }

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
        const fresh = isFresh(cached, opts.refreshHours, { allowEmpty: true, allowNotFound: true });
        if (fresh) addLog(caseNo, 'info', `Skip fresh source ${s.key}`);
        return !fresh;
      });
      const neededKeys = needed.map((s) => s.key);
      const freshKeys = SOURCES.map((s) => s.key).filter((k) => !neededKeys.includes(k));

      addLog(caseNo, 'info', 'Prefetch plan ready', {
        source: 'prefetch',
        force: !!force,
        needed: neededKeys,
        fresh: freshKeys,
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
          const parsedDoc = parseHtml(html);
          const parsed = parseSource(src.key, parsedDoc, caseNo);
          const classified = classifyParsedSourceState(src.key, parsedDoc, parsed);
          const parseMessage = classified.status === 'ok'
            ? `Parse success ${src.key}`
            : classified.status === 'notFound'
              ? `Parse result not found ${src.key}`
              : `Parse result empty ${src.key}`;
          const parseLevel = classified.status === 'ok' ? 'ok' : classified.status === 'notFound' ? 'warn' : 'info';
          addLog(caseNo, parseLevel, parseMessage, { transport: 'fetch', status: classified.status, reason: classified.reason, ...sourceDiagnostics(src.key, parsed) });

          storeCaseSource(caseNo, src.key, {
            title: src.title,
            status: classified.status,
            url,
            transport: 'fetch',
            data: parsed,
          });
          addLog(caseNo, 'info', `Cache write ${src.key}`, { source: src.key });
        } catch (error) {
          if (controller.signal.aborted) return;
          addLog(caseNo, 'error', `Fetch/parse failure ${src.key}: ${error?.message || error}`, { source: src.key, transport: 'fetch' });
          storeCaseSource(caseNo, src.key, {
            title: src.title,
            status: 'error',
            url,
            transport: 'fetch',
            error: String(error?.message || error),
          });
        }

        completed += 1;
        if (runtime.appNo === caseNo) scheduleRender();
      }), FETCH_CONCURRENCY);
    } finally {
      if (runtime.abortController === controller) {
        try {
          await refreshUpcRegistry(caseNo, controller.signal, force);
        } catch {
          // non-blocking
        }

        try {
          await refreshPdfDeadlines(caseNo, controller.signal, force);
        } catch {
          // non-blocking
        }

        const c = getCase(caseNo);
        const counts = sourceStatusCounts(c);
        const statusBySource = Object.fromEntries(SOURCES.map((s) => [s.key, c.sources[s.key]?.status || 'missing']));
        addLog(caseNo, counts.error ? 'warn' : 'ok', `Background prefetch finish (${sourceStatusSummaryText(counts)})`, {
          source: 'prefetch',
          counts,
          statusBySource,
        });
        runtime.fetching = false;
        runtime.fetchLabel = 'Idle';
        runtime.abortController = null;
        runtime.fetchCaseNo = null;
        flushNow();
        scheduleRender();
      }
    }
  }

  function addCalendarMonthsDetailed(date, months) {
    const src = new Date(date);
    if (Number.isNaN(src.getTime())) return { date: new Date(NaN), rolledOver: false, fromDay: 0, toDay: 0 };

    const srcDay = src.getDate();
    const srcMonth = src.getMonth();
    const srcYear = src.getFullYear();
    const rawMonth = srcMonth + Number(months || 0);

    const targetYear = srcYear + Math.floor(rawMonth / 12);
    const targetMonth = ((rawMonth % 12) + 12) % 12;
    const lastDay = endOfMonth(targetYear, targetMonth).getDate();
    const targetDay = Math.min(srcDay, lastDay);

    return {
      date: new Date(targetYear, targetMonth, targetDay),
      rolledOver: srcDay !== targetDay,
      fromDay: srcDay,
      toDay: targetDay,
    };
  }

  function addMonths(date, months) {
    return addCalendarMonthsDetailed(date, months).date;
  }

  function endOfMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0);
  }

  function epRenewalDueDate(filingDate, patentYear) {
    if (!(filingDate instanceof Date) || Number.isNaN(filingDate.getTime())) return null;
    if (!Number.isFinite(patentYear) || patentYear < 3) return null;
    const anniversaryYear = filingDate.getFullYear() + patentYear - 1;
    return endOfMonth(anniversaryYear, filingDate.getMonth());
  }

  function buildDeadlineRecords(docs, eventHistory = {}, legal = {}) {
    const sortedDocs = [...(docs || [])].sort(compareDateDesc);
    const sortedEvents = dedupe([...(eventHistory.events || []), ...(legal.events || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}`).sort(compareDateDesc);
    return dedupe([
      ...sortedDocs.map((d) => ({
        dateStr: d.dateStr,
        title: d.title || '',
        detail: d.procedure || d.detail || '',
        actor: d.actor || 'Other',
        source: 'Documents',
      })),
      ...sortedEvents.map((e) => ({
        dateStr: e.dateStr,
        title: e.title || '',
        detail: e.detail || '',
        actor: /applicant|filed by applicant|by applicant/i.test(`${e.title || ''} ${e.detail || ''}`) ? 'Applicant' : 'EPO',
        source: 'Event',
      })),
    ], (r) => `${r.dateStr}|${r.title}|${r.detail}|${r.source}`).sort(compareDateDesc);
  }

  function pdfHintsWithParsedDates(pdfData = {}) {
    return (Array.isArray(pdfData?.hints) ? pdfData.hints : [])
      .map((h) => ({
        ...h,
        date: parseDateString(h.dateStr),
      }))
      .filter((h) => h.date);
  }

  function buildDeadlineComputationContext(main, docs, eventHistory = {}, legal = {}, pdfData = {}) {
    const out = [];
    const records = buildDeadlineRecords(docs, eventHistory, legal);
    const pdfHints = pdfHintsWithParsedDates(pdfData);
    const appType = normalize(main.applicationType || '').toLowerCase();
    const isEuroPct = /e\/pct/.test(appType);
    const isDivisional = /divisional/.test(appType);
    const priorityDate = main.priorities?.[0] ? parseDateString(main.priorities[0].dateStr) : null;
    const filingDate = parseDateString(main.filingDate);

    const push = (entry) => {
      if (!entry?.date || Number.isNaN(entry.date.getTime())) return;
      out.push(entry);
    };

    const latestRecord = (regex) => records.find((r) => regex.test(`${r.title || ''} ${r.detail || ''}`));
    const hasPdfHint = (regex) => pdfHints.some((h) => regex.test(String(h.label || '')));
    const hasAfter = (anchorDate, predicate) => {
      const ts = anchorDate?.getTime?.() || 0;
      if (!ts) return false;
      return records.some((r) => {
        const dt = parseDateString(r.dateStr);
        return dt && dt.getTime() > ts && predicate(r, dt);
      });
    };

    const hasApplicantResponseAfter = (anchorDate, regex = /reply|response|observations|arguments|amended|amendment|claims|request|translation|appeal/i) =>
      hasAfter(anchorDate, (r) => r.actor === 'Applicant' && regex.test(`${r.title} ${r.detail}`));

    const hasFeeSignalAfter = (anchorDate, regex = /payment|fee paid|paid|examination fee|designation fee|grant and publishing fee|grant and publication fee|renewal fee/i) =>
      hasAfter(anchorDate, (r) => regex.test(`${r.title} ${r.detail}`));

    const resolveHintByActivity = (label, anchorDate) => {
      const l = String(label || '').toLowerCase();
      if (!anchorDate) return false;

      if (/r71\(3\)|intention to grant/.test(l)) {
        return hasFeeSignalAfter(anchorDate, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections|approval of text|text proposed for grant/i)
          || hasApplicantResponseAfter(anchorDate, /reply|response|amend|correction|claims|translation|approval|text proposed for grant|request for correction/i);
      }

      if (/art\.?\s*94\(3\)|communication response period/.test(l)) {
        return hasApplicantResponseAfter(anchorDate, /reply|response|observations|arguments|amend|claims|request|further processing|re-establishment/i);
      }

      if (/rule 161\/162/.test(l)) {
        return hasApplicantResponseAfter(anchorDate, /reply|response|amend|claims|observations|arguments/i)
          || hasFeeSignalAfter(anchorDate, /claims fee|fee payment received/i);
      }

      if (/rule 116/.test(l)) {
        return hasApplicantResponseAfter(anchorDate, /response|request|submission|oral proceedings|withdrawal/i);
      }

      return hasApplicantResponseAfter(anchorDate);
    };

    const addMonthsDeadline = ({ triggerRegex, label, months, level, confidence = 'medium', resolvedBy }) => {
      if (hasPdfHint(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) return;
      const rec = latestRecord(triggerRegex);
      if (!rec) return;
      const anchor = parseDateString(rec.dateStr);
      if (!anchor) return;

      const resolved = typeof resolvedBy === 'function'
        ? !!resolvedBy(anchor, rec)
        : hasApplicantResponseAfter(anchor);

      const calc = addCalendarMonthsDetailed(anchor, months);
      push({
        label,
        date: calc.date,
        level,
        confidence,
        sourceDate: rec.dateStr,
        resolved,
        method: `Heuristic: +${months} month(s) from ${rec.source.toLowerCase()} trigger`,
        rolledOver: calc.rolledOver,
        rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
      });
    };

    return {
      out,
      main,
      docs,
      records,
      pdfHints,
      isEuroPct,
      isDivisional,
      priorityDate,
      filingDate,
      push,
      latestRecord,
      hasPdfHint,
      hasAfter,
      hasApplicantResponseAfter,
      hasFeeSignalAfter,
      resolveHintByActivity,
      addMonthsDeadline,
    };
  }

  function appendPdfDerivedDeadlines(ctx) {
    const resolveHintByActivity = ctx.resolveHintByActivity;
    for (const hint of ctx.pdfHints) {
      const label = String(hint.label || 'PDF-derived deadline');
      const sourceDate = String(hint.sourceDate || '');
      const anchor = parseDateString(sourceDate) || hint.date;
      const resolvedByActivity = resolveHintByActivity(label, anchor);
      const resolved = !!hint.resolved || resolvedByActivity;
      const baseMethod = String(hint.evidence || 'PDF parse');

      ctx.push({
        label,
        date: hint.date,
        level: String(hint.level || 'bad'),
        confidence: String(hint.confidence || 'high'),
        sourceDate,
        resolved,
        fromPdf: true,
        method: resolvedByActivity && !hint.resolved
          ? `${baseMethod} · resolved by subsequent activity`
          : baseMethod,
      });
    }
  }

  function appendCoreCommunicationDeadlines(ctx) {
    ctx.addMonthsDeadline({
      triggerRegex: /rule\s*71\(3\)|intention to grant|text intended for grant/i,
      label: 'R71(3) response period',
      months: 4,
      level: 'bad',
      confidence: 'high',
      resolvedBy: (anchor) => ctx.hasFeeSignalAfter(anchor, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections/i) || ctx.hasApplicantResponseAfter(anchor),
    });

    ctx.addMonthsDeadline({
      triggerRegex: /article\s*94\(3\)|art\.\s*94\(3\)|communication from (?:the )?examining/i,
      label: 'Art. 94(3) response period',
      months: 4,
      level: 'warn',
      confidence: 'medium',
    });

    ctx.addMonthsDeadline({
      triggerRegex: /rule\s*70\(2\)|confirm.*proceed|wish to proceed|proceed further/i,
      label: 'Rule 70(2) confirmation/response period',
      months: 6,
      level: 'warn',
      confidence: 'high',
    });

    ctx.addMonthsDeadline({
      triggerRegex: /rule\s*161|rule\s*162|communication pursuant to rule 161|rules?\s*161.*162/i,
      label: 'Rule 161/162 response period',
      months: 6,
      level: 'bad',
      confidence: 'high',
      resolvedBy: (anchor) => ctx.hasApplicantResponseAfter(anchor, /reply|response|amend|claims|observations|arguments/i) || ctx.hasFeeSignalAfter(anchor, /claims fee|fee payment received/i),
    });
  }

  function appendDirectOrPctDeadlines(ctx) {
    if (!ctx.isEuroPct) {
      const esrMention = ctx.latestRecord(/mention of publication of (?:the )?european search report|publication of (?:the )?european search report/i);
      if (esrMention) {
        const anchor = parseDateString(esrMention.dateStr);
        if (anchor) {
          const calc = addCalendarMonthsDetailed(anchor, 6);
          ctx.push({
            label: `${ctx.isDivisional ? 'Divisional ' : ''}exam/designation + search-opinion bundle`,
            date: calc.date,
            level: 'bad',
            confidence: 'high',
            sourceDate: esrMention.dateStr,
            resolved: ctx.hasFeeSignalAfter(anchor, /request for examination|examination fee|designation fee|extension fee|validation fee|fee payment received/i) || ctx.hasApplicantResponseAfter(anchor),
            method: 'Rule-based: +6 months from ESR publication mention',
            rolledOver: calc.rolledOver,
            rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
          });
        }
      }
      return;
    }

    const base31Date = ctx.priorityDate || ctx.filingDate;
    if (!base31Date) return;

    const calc31 = addCalendarMonthsDetailed(base31Date, 31);
    const due31 = calc31.date;
    const isr = ctx.latestRecord(/international search report|\bisr\b|written opinion/i);
    const isrDate = parseDateString(isr?.dateStr || '');
    const calcIsr = isrDate ? addCalendarMonthsDetailed(isrDate, 6) : null;
    const isrPlus6 = calcIsr?.date || null;
    const dueLater = isrPlus6 && isrPlus6 > due31 ? isrPlus6 : due31;
    const dueLaterRolled = isrPlus6 && isrPlus6 > due31 ? !!calcIsr?.rolledOver : calc31.rolledOver;
    const dueLaterRollNote = isrPlus6 && isrPlus6 > due31
      ? (calcIsr?.rolledOver ? `day ${calcIsr.fromDay}→${calcIsr.toDay}` : '')
      : (calc31.rolledOver ? `day ${calc31.fromDay}→${calc31.toDay}` : '');

    ctx.push({
      label: 'Euro-PCT entry acts (31-month stop)',
      date: due31,
      level: 'bad',
      confidence: 'high',
      sourceDate: ctx.priorityDate ? ctx.main.priorities?.[0]?.dateStr || '' : ctx.main.filingDate || '',
      resolved: ctx.hasFeeSignalAfter(base31Date, /translation|entry into european phase|rule 159|filing fee|page fee|request for examination/i),
      method: 'Rule-based: priority/filing date +31 months',
      rolledOver: calc31.rolledOver,
      rolloverNote: calc31.rolledOver ? `day ${calc31.fromDay}→${calc31.toDay}` : '',
    });

    ctx.push({
      label: 'Euro-PCT exam/designation deadline (later-of formula)',
      date: dueLater,
      level: 'bad',
      confidence: isrDate ? 'high' : 'medium',
      sourceDate: isrDate ? `${formatDate(base31Date)} / ${isr?.dateStr || ''}` : formatDate(base31Date),
      resolved: ctx.hasFeeSignalAfter(base31Date, /request for examination|examination fee|designation fee|extension fee|validation fee/i),
      method: isrDate ? 'Rule-based: max(31 months from priority/filing, ISR +6 months)' : 'Rule-based: 31 months from priority/filing (ISR date unavailable)',
      rolledOver: dueLaterRolled,
      rolloverNote: dueLaterRollNote,
    });
  }

  function appendPostGrantDeadlines(ctx) {
    const grantMention = ctx.latestRecord(/mention of grant|patent has been granted|granted/i);
    if (grantMention) {
      const anchor = parseDateString(grantMention.dateStr);
      if (anchor) {
        const calcOpp = addCalendarMonthsDetailed(anchor, 9);
        ctx.push({
          label: 'Opposition period (third-party monitor)',
          date: calcOpp.date,
          level: 'warn',
          confidence: 'high',
          sourceDate: grantMention.dateStr,
          resolved: false,
          method: 'Rule-based: grant mention +9 months',
          rolledOver: calcOpp.rolledOver,
          rolloverNote: calcOpp.rolledOver ? `day ${calcOpp.fromDay}→${calcOpp.toDay}` : '',
        });
        const calcUe = addCalendarMonthsDetailed(anchor, 1);
        ctx.push({
          label: 'Unitary effect request window',
          date: calcUe.date,
          level: 'warn',
          confidence: 'high',
          sourceDate: grantMention.dateStr,
          resolved: ctx.hasAfter(anchor, (r) => /unitary effect/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: grant mention +1 month',
          rolledOver: calcUe.rolledOver,
          rolloverNote: calcUe.rolledOver ? `day ${calcUe.fromDay}→${calcUe.toDay}` : '',
        });
      }
    }

    const decision = ctx.latestRecord(/\bdecision\b.*(?:refus|grant|revok|maintain)|\bdecision\b/i);
    if (decision) {
      const anchor = parseDateString(decision.dateStr);
      if (anchor) {
        const calcNotice = addCalendarMonthsDetailed(anchor, 2);
        ctx.push({
          label: 'Appeal notice + fee',
          date: calcNotice.date,
          level: 'bad',
          confidence: 'high',
          sourceDate: decision.dateStr,
          resolved: ctx.hasAfter(anchor, (r) => /notice of appeal|appeal fee/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: decision date +2 months',
          rolledOver: calcNotice.rolledOver,
          rolloverNote: calcNotice.rolledOver ? `day ${calcNotice.fromDay}→${calcNotice.toDay}` : '',
        });
        const calcGrounds = addCalendarMonthsDetailed(anchor, 4);
        ctx.push({
          label: 'Appeal grounds',
          date: calcGrounds.date,
          level: 'bad',
          confidence: 'high',
          sourceDate: decision.dateStr,
          resolved: ctx.hasAfter(anchor, (r) => /grounds of appeal|statement of grounds/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: decision date +4 months',
          rolledOver: calcGrounds.rolledOver,
          rolloverNote: calcGrounds.rolledOver ? `day ${calcGrounds.fromDay}→${calcGrounds.toDay}` : '',
        });
      }
    }
  }

  function appendReferenceDeadlines(ctx) {
    if (ctx.priorityDate) {
      const calcPriority = addCalendarMonthsDetailed(ctx.priorityDate, 12);
      const due = calcPriority.date;
      if (due > new Date()) {
        ctx.push({
          label: 'Priority year ends',
          date: due,
          level: 'warn',
          confidence: 'high',
          sourceDate: ctx.main.priorities?.[0]?.dateStr || '',
          resolved: false,
          method: 'Rule-based: earliest priority date +12 months',
          rolledOver: calcPriority.rolledOver,
          rolloverNote: calcPriority.rolledOver ? `day ${calcPriority.fromDay}→${calcPriority.toDay}` : '',
        });
      }
    }

    if (ctx.filingDate) {
      const calcTerm = addCalendarMonthsDetailed(ctx.filingDate, 12 * 20);
      ctx.push({
        label: '20-year term from filing (reference)',
        date: calcTerm.date,
        level: 'info',
        confidence: 'high',
        reference: true,
        resolved: false,
        method: 'Rule-based: filing date +20 years',
        rolledOver: calcTerm.rolledOver,
        rolloverNote: calcTerm.rolledOver ? `day ${calcTerm.fromDay}→${calcTerm.toDay}` : '',
      });
    }
  }

  function inferProceduralDeadlines(main, docs, eventHistory = {}, legal = {}, pdfData = {}) {
    const ctx = buildDeadlineComputationContext(main, docs, eventHistory, legal, pdfData);
    appendPdfDerivedDeadlines(ctx);
    appendCoreCommunicationDeadlines(ctx);
    appendDirectOrPctDeadlines(ctx);
    appendPostGrantDeadlines(ctx);
    appendReferenceDeadlines(ctx);
    return dedupe(ctx.out, (d) => `${d.label}|${formatDate(d.date)}|${d.sourceDate || ''}`);
  }


  function inferRenewalModel(main, legal, ue) {
    const now = new Date();
    const renewals = legal.renewals || [];
    const mentionGrant = (legal.events || []).find((e) => /mention of grant|granted/i.test(`${e.title} ${e.detail}`));
    const ueRegistered = /unitary effect registered/i.test(ue.ueStatus || ue.statusRaw || '');
    const filingDate = parseDateString(main.filingDate);
    const highestYear = renewals.reduce((m, r) => (r.year && r.year > m ? r.year : m), 0) || null;

    let feeForum = 'Unknown';
    if (ueRegistered) feeForum = 'EPO central (Unitary Patent)';
    else if (mentionGrant) feeForum = 'National offices (post-grant EP bundle)';
    else if (filingDate) feeForum = 'EPO central (pre-grant EP application)';

    let nextYear = null;
    let nextDue = null;
    let graceUntil = null;
    let dueState = 'unknown';
    let confidence = 'low';

    const canUseCentralEpSchedule = !!filingDate && (ueRegistered || !mentionGrant);
    if (canUseCentralEpSchedule) {
      if (highestYear) {
        nextYear = highestYear + 1;
        confidence = 'high';
      } else {
        for (let y = 3; y <= 40; y++) {
          const due = epRenewalDueDate(filingDate, y);
          if (!due) continue;
          const grace = addMonths(due, 6);
          if (grace.getTime() >= now.getTime() - 86400000) {
            nextYear = y;
            break;
          }
        }
        if (!nextYear) nextYear = 40;
        confidence = 'medium';
      }

      nextDue = epRenewalDueDate(filingDate, nextYear);
      graceUntil = nextDue ? addMonths(nextDue, 6) : null;

      if (nextDue) {
        if (now.getTime() <= nextDue.getTime()) dueState = 'upcoming';
        else if (graceUntil && now.getTime() <= graceUntil.getTime()) dueState = 'grace';
        else dueState = 'overdue';
      }
    }

    const mode = ueRegistered
      ? 'Unitary patent renewal fees are payable centrally at the EPO; due dates follow the EP filing-anniversary month schedule.'
      : mentionGrant
        ? 'After mention of grant, renewal timing generally shifts to designated national offices (unless unitary effect applies).'
        : 'Pre-grant EP renewal fees are centrally payable at the EPO from patent year 3 onward.';

    return {
      count: renewals.length,
      latest: renewals[0] || null,
      highestYear,
      explanatoryBasis: mode,
      mentionGrantDate: mentionGrant?.dateStr || '',
      isUnitary: ueRegistered,
      feeForum,
      nextYear,
      nextDue,
      graceUntil,
      dueState,
      confidence,
    };
  }

  function overviewCacheKey(caseNo, opts, c) {
    const optPart = [
      opts.showRenewals,
      opts.showUpcUe,
      opts.showCitations,
      opts.showPublications,
      opts.showEventHistory,
      opts.showLegalStatusRows,
    ].join('|');

    const srcPart = ['main', 'doclist', 'event', 'family', 'legal', 'federated', 'citations', 'ueMain', 'upcRegistry', 'pdfDeadlines']
      .map((k) => sourceStamp(c, k))
      .join('|');
    return `${caseNo}|${optPart}|${srcPart}`;
  }

  function overviewModel(caseNo) {
    const { c, main, legal, federated, citations, eventHistory, ue, upcRegistry, pdfDeadlines, docs, publications } = caseSnapshot(caseNo);
    const opts = options();
    const cacheKey = overviewCacheKey(caseNo, opts, c);
    if (runtime.overviewCache.key === cacheKey && runtime.overviewCache.model) {
      return runtime.overviewCache.model;
    }

    const latestEpo = docs.find((d) => d.actor === 'EPO' && d.bundle !== 'Other') || docs.find((d) => d.actor === 'EPO') || null;
    const applicantDocs = docs.filter((d) => d.actor === 'Applicant');
    const latestApplicant = applicantDocs.find((d) => d.bundle !== 'Other') || applicantDocs[0] || null;

    const storedStatusRaw = c.meta?.lastMainStatusRaw || '';
    const stageText = normalize(main.statusRaw || storedStatusRaw).toLowerCase();
    const statusStage = main.statusStage || c.meta?.lastMainStage || inferStatusStage(stageText);
    const mainSourceStatus = String(c.sources.main?.status || '').toLowerCase();
    const mainUnavailable = mainSourceStatus === 'notfound' || mainSourceStatus === 'empty';

    const stage = mainUnavailable
      ? 'Unavailable'
      : (statusStage
        || (docs.some((d) => d.bundle === 'Grant package')
          ? 'Grant / post-grant'
          : docs.some((d) => d.bundle === 'Examination')
            ? 'Examination'
            : docs.some((d) => d.bundle === 'Search package')
              ? 'Search'
              : docs.some((d) => d.bundle === 'Filing package')
                ? 'Filing'
                : 'Unknown'));

    const deadlines = inferProceduralDeadlines(main, docs, eventHistory, legal, pdfDeadlines);

    const renewal = inferRenewalModel(main, legal, ue);

    const latestEpoDate = parseDateString(latestEpo?.dateStr);
    const latestApplicantDate = parseDateString(latestApplicant?.dateStr);

    const latestEpoIsLossOfRights = /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|communication under rule\s*112\(1\)|rule\s*112\(1\)|application refused|application rejected/.test(`${String(latestEpo?.title || '')} ${String(latestEpo?.procedure || '')}`.toLowerCase());
    const applicantAfterLatestEpo = !!(latestEpoDate && latestApplicantDate && latestApplicantDate > latestEpoDate);

    const waitingOn = latestEpoIsLossOfRights
      ? (applicantAfterLatestEpo ? 'EPO' : 'Applicant')
      : (latestApplicantDate && (!latestEpoDate || latestApplicantDate > latestEpoDate) ? 'EPO' : 'Applicant');

    const waitingDays = waitingOn === 'EPO' && latestApplicantDate
      ? Math.floor((Date.now() - latestApplicantDate.getTime()) / 86400000)
      : null;

    let recoveryOptions = '';
    if (latestEpoIsLossOfRights) {
      recoveryOptions = applicantAfterLatestEpo
        ? 'Loss-of-rights posture detected. Applicant appears to have responded; monitor the EPO recovery outcome.'
        : 'Loss-of-rights posture detected. Check further processing first; if unavailable, consider Rule 136 re-establishment.';
    }

    const actionableDeadlines = deadlines.filter((d) => !d.reference && !d.resolved);
    const nextDeadline = actionableDeadlines.find((d) => d.date > new Date())
      || actionableDeadlines[0]
      || null;

    const daysToDeadline = nextDeadline ? Math.ceil((nextDeadline.date.getTime() - Date.now()) / 86400000) : null;

    const federatedStates = Array.isArray(federated.states) ? federated.states : [];
    const federatedNotableStates = Array.isArray(federated.notableStates) ? federated.notableStates : [];
    const citationEntries = Array.isArray(citations.entries) ? citations.entries : [];
    const citationPhases = Array.isArray(citations.phases) ? citations.phases : [];

    const model = {
      title: main.title || (mainSourceStatus === 'notfound' ? 'No Register file found' : '—'),
      applicant: main.applicant || '—',
      representative: main.representative || '—',
      appNo: caseNo,
      filingDate: main.filingDate || '—',
      priority: main.priorityText || '—',
      stage,
      status: mainSourceStatus === 'notfound'
        ? 'No Register file found for this application number.'
        : mainSourceStatus === 'empty'
          ? 'Main tab returned no usable case data.'
          : (main.statusRaw || storedStatusRaw || '—').split('\n')[0],
      statusSimple: mainSourceStatus === 'notfound' ? 'Not found' : (mainSourceStatus === 'empty' ? 'No main data' : (main.statusSimple || 'Unknown')),
      statusLevel: mainSourceStatus === 'notfound' ? 'bad' : (mainSourceStatus === 'empty' ? 'warn' : (main.statusLevel || 'warn')),
      applicationType: mainUnavailable ? 'Unavailable' : (main.applicationType || parseApplicationType(main)),
      parentCase: mainUnavailable ? '' : (main.parentCase || ''),
      divisionalChildren: mainUnavailable ? [] : (main.divisionalChildren || []),
      hasDivisionals: mainUnavailable ? false : !!main.hasDivisionals,
      recentMainEvent: main.recentEvents?.[0] || (legal.events || [])[0] || null,
      latestEpo,
      latestApplicant,
      waitingOn,
      waitingDays,
      recoveryOptions,
      nextDeadline,
      daysToDeadline,
      publications,
      deadlines: deadlines.sort((a, b) => a.date - b.date),
      renewal,
      federated: {
        status: federated.status || '',
        upMemberStates: federated.upMemberStates || '',
        invalidationDate: federated.invalidationDate || '',
        renewalFeesPaidUntil: federated.renewalFeesPaidUntil || '',
        recordUpdated: federated.recordUpdated || '',
        applicantProprietor: federated.applicantProprietor || '',
        trackedStates: federatedStates.length,
        notableStates: federatedNotableStates.slice(0, 6),
      },
      citations: {
        entries: citationEntries,
        phases: citationPhases,
      },
      upcUe: {
        ueStatus: ue.ueStatus || 'Unknown',
        upcOptOut: upcRegistry ? (upcRegistry.status || (upcRegistry.optedOut ? 'Opted out' : 'No opt-out found')) : (ue.upcOptOut || 'Unknown'),
        note: upcRegistry
          ? `Registry checked for ${upcRegistry.patentNumber}.`
          : (ue.ueStatus
            ? 'Taken from UP/legal data where available.'
            : 'No cached UP/UPC data yet.'),
      },
      docs,
    };

    runtime.overviewCache = { key: cacheKey, model };
    return model;
  }

  function topLevel(levels) {
    if (levels.includes('bad')) return 'bad';
    if (levels.includes('warn')) return 'warn';
    if (levels.includes('ok')) return 'ok';
    return 'info';
  }

  function timelineAttorneyImportance(title, detail = '', source = '', actor = 'Other', baseLevel = 'info') {
    const base = ['bad', 'warn', 'ok', 'info'].includes(baseLevel) ? baseLevel : 'info';
    const t = normalize(`${title || ''}\n${detail || ''}\n${source || ''}\n${actor || ''}`).toLowerCase();

    const badSignals = /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|rule\s*112\(1\)|application refused|application rejected|revoked|revocation|lapsed|not maintained|request for re-establishment.*rejected|rights restored refused|withdrawn by applicant|deemed withdrawn/;
    if (badSignals.test(t)) return 'bad';
    if (base === 'bad') return 'bad';

    const warnSignals = /deadline|time limit|final date|summons to oral proceedings|rule\s*116|article\s*94\(3\)|art\.?\s*94\(3\)|rule\s*71\(3\)|intention to grant|communication from the examining|communication under|opposition|third party observations|request for re-establishment|further processing/;
    if (warnSignals.test(t)) return 'warn';
    if (base === 'warn') return 'warn';

    const okSignals = /mention of grant|patent granted|grant decision|fee paid|renewal paid|annual fee paid|validation|registered|recorded/;
    if (okSignals.test(t)) return 'ok';
    if (base === 'ok') return 'ok';

    return 'info';
  }

  function sourceStamp(c, key) {
    const src = c?.sources?.[key] || {};
    return `${key}:${src.status || 'na'}:${src.fetchedAt || 0}:${src.parserVersion || ''}:${src.dependencyStamp || ''}`;
  }

  function timelineCacheKey(caseNo, opts, c) {
    const optPart = [
      opts.showEventHistory,
      opts.showLegalStatusRows,
      opts.showPublications,
      opts.timelineEventLevel,
      opts.timelineLegalLevel,
      opts.timelineMaxEntries,
    ].join('|');

    const srcPart = ['main', 'doclist', 'event', 'family', 'legal'].map((k) => sourceStamp(c, k)).join('|');
    return `${caseNo}|${optPart}|${srcPart}`;
  }

  function timelineModel(caseNo) {
    const opts = options();
    const { c, main, eventHistory, legal, docs, publications } = caseSnapshot(caseNo);
    const cacheKey = timelineCacheKey(caseNo, opts, c);
    if (runtime.timelineCache.key === cacheKey && Array.isArray(runtime.timelineCache.items)) {
      return runtime.timelineCache.items;
    }

    const items = [];

    for (const e of main.recentEvents || []) {
      const detail = [e.detail, 'Main page'].filter(Boolean).join('\n');
      items.push({
        type: 'item',
        dateStr: e.dateStr,
        title: e.title,
        detail,
        source: 'Main',
        level: timelineAttorneyImportance(e.title, detail, 'Main', 'EPO', 'info'),
        actor: 'EPO',
        url: sourceUrl(caseNo, 'main'),
      });
    }

    const docsSorted = docs;
    const groupableBundles = new Set(['Search package', 'Grant package', 'Examination', 'Filing package', 'Applicant filings', 'Response to search']);

    const docItems = [];
    const groupedByKey = new Map();

    for (const d of docsSorted) {
      const actor = d.actor || 'Other';
      const shouldGroup = groupableBundles.has(d.bundle);
      const detail = [d.procedure, 'All documents'].filter(Boolean).join(' · ');
      const itemLevel = timelineAttorneyImportance(d.title, detail, 'Documents', actor, d.level || 'info');

      if (!shouldGroup) {
        docItems.push({
          type: 'item',
          dateStr: d.dateStr,
          title: d.title,
          detail,
          source: 'Documents',
          level: itemLevel,
          actor,
          url: d.url,
        });
        continue;
      }

      // Group by exact document date + bundle + actor to avoid fragmented filing-package rows.
      const groupKey = `${d.dateStr || 'nodate'}|${d.bundle}|${actor}`;
      if (!groupedByKey.has(groupKey)) {
        const group = { type: 'group', _key: groupKey, dateStr: d.dateStr, title: d.bundle, source: 'Documents', level: itemLevel, actor, items: [] };
        groupedByKey.set(groupKey, group);
        docItems.push(group);
      }

      const group = groupedByKey.get(groupKey);
      group.items.push({ dateStr: d.dateStr, title: d.title, detail: d.procedure || 'All documents', source: 'Documents', level: itemLevel, actor, url: d.url });
      group.level = topLevel([group.level, itemLevel]);
    }

    const normalizedDocItems = docItems.map((item) => {
      if (item.type !== 'group') return item;
      if ((item.items || []).length !== 1) return item;
      const first = item.items[0];
      return { type: 'item', dateStr: first.dateStr, title: first.title, detail: `${first.detail} · ${item.title}`, source: 'Documents', level: first.level, actor: first.actor || item.actor || 'Other', url: first.url };
    });

    items.push(...normalizedDocItems);

    if (opts.showEventHistory) {
      for (const e of eventHistory.events || []) {
        const detail = [e.detail, 'Event history'].filter(Boolean).join('\n');
        items.push({
          type: 'item',
          dateStr: e.dateStr,
          title: e.title,
          detail,
          source: 'Event history',
          level: timelineAttorneyImportance(e.title, detail, 'Event history', 'EPO', opts.timelineEventLevel || 'info'),
          actor: 'EPO',
          url: e.url || sourceUrl(caseNo, 'event'),
        });
      }
    }

    if (opts.showLegalStatusRows) {
      for (const e of legal.events || []) {
        const detail = [e.detail, 'Legal status'].filter(Boolean).join('\n');
        items.push({
          type: 'item',
          dateStr: e.dateStr,
          title: e.title,
          detail,
          source: 'Legal status',
          level: timelineAttorneyImportance(e.title, detail, 'Legal status', 'EPO', opts.timelineLegalLevel || 'warn'),
          actor: 'EPO',
          url: e.url || sourceUrl(caseNo, 'legal'),
        });
      }
    }

    if (opts.showPublications) {
      for (const p of publications) {
        const title = `${p.no}${p.kind || ''} publication`;
        const detail = p.role || 'Publication';
        items.push({
          type: 'item',
          dateStr: p.dateStr,
          title,
          detail,
          source: 'Publications',
          level: timelineAttorneyImportance(title, detail, 'Publications', 'EPO', 'info'),
          actor: 'EPO',
          url: sourceUrl(caseNo, 'main'),
        });
      }
    }

    const built = dedupe(items, (i) => {
      if (i.type === 'group') return `g|${i.dateStr}|${i.title}|${(i.items || []).map((x) => `${x.title}|${x.url}`).join('||')}`;
      return `i|${i.dateStr}|${i.title}|${i.detail}|${i.url}`;
    }).sort(compareDateDesc).slice(0, opts.timelineMaxEntries);

    runtime.timelineCache = { key: cacheKey, items: built };
    return built;
  }

  function compactOverviewTitle(title = '') {
    const normalized = normalize(title);
    if (!normalized) return '—';

    const exactMap = new Map([
      ['Text intended for grant (version for approval)', 'Grant text for approval'],
      ['Text intended for grant (clean copy)', 'Grant text (clean copy)'],
      ['Communication about intention to grant a European patent', 'Intention to grant'],
      ['Annex to the communication about intention to grant a European patent', 'Grant communication annex'],
      ['Bibliographic data of the European patent application', 'Bibliographic data'],
      ['Request for correction/amendment of the text proposed for grant sent from 01.04.2012', 'Grant text correction request'],
      ['Reminder period for payment of examination fee/designation fee and correction of deficiencies in Written Opinion/amendment', 'Exam / designation fee reminder'],
      ['Communication regarding the transmission of the European search report', 'Search report transmission'],
      ['Amendments received before examination', 'Amendments before examination'],
    ]);
    if (exactMap.has(normalized)) return exactMap.get(normalized);

    return normalized
      .replace(/\s+a European patent$/i, '')
      .replace(/^New entry:\s*/i, '')
      .replace(/^Deletion\s+-\s*/i, '')
      .replace(/\s+sent from 01\.04\.2012$/i, '')
      .trim();
  }

  function overviewLatestActionText(doc) {
    if (!doc) return '—';
    return `${doc.dateStr} · ${compactOverviewTitle(doc.title || '')}`;
  }

  function renderOverviewHeaderCard(m) {
    const termReference = m.deadlines.find((d) => d.reference && /20-year term from filing/i.test(String(d.label || '')));
    const termReferenceDate = termReference?.date ? formatDate(termReference.date) : '';
    const filingSummary = normalize([
      m.filingDate ? `Filed ${m.filingDate}` : 'Filed —',
      termReferenceDate ? `20-year term ${termReferenceDate}` : '',
    ].filter(Boolean).join(' · ')) || 'Filed —';

    return `<div class="epoRP-c"><div class="epoRP-g">
      <div class="epoRP-l">Title</div><div class="epoRP-v">${esc(m.title)}</div>
      <div class="epoRP-l">Applicant</div><div class="epoRP-v">${esc(m.applicant)}</div>
      <div class="epoRP-l">Application #</div><div class="epoRP-v">${esc(m.appNo)}</div>
      <div class="epoRP-l">Filing date</div><div class="epoRP-v">${esc(filingSummary)}</div>
      <div class="epoRP-l">Priority</div><div class="epoRP-v">${esc(m.priority)}</div>
      <div class="epoRP-l">Type / stage</div><div class="epoRP-v">${esc(m.applicationType)}${m.parentCase ? ` (<a class="epoRP-a" href="${esc(sourceUrl(m.parentCase, 'main'))}">${esc(m.parentCase)}</a>)` : ''} · ${esc(m.stage)}</div>
      ${m.divisionalChildren?.length ? `<div class="epoRP-l">Divisionals</div><div class="epoRP-v">${m.divisionalChildren.map((ep) => `<a class="epoRP-a" href="${esc(sourceUrl(ep, 'main'))}">${esc(ep)}</a>`).join(', ')}</div>` : ''}
      <div class="epoRP-l">Representative</div><div class="epoRP-v">${esc(m.representative)}</div>
    </div></div>`;
  }

  function renderOverviewDetailedDeadlines(m) {
    const detailedDeadlines = m.deadlines.filter((d) => {
      if (d.reference && /20-year term from filing/i.test(String(d.label || ''))) return false;
      if (d.resolved) return false;
      if (!m.nextDeadline) return true;
      const sameLabel = d.label === m.nextDeadline.label;
      const sameDate = formatDate(d.date) === formatDate(m.nextDeadline.date);
      const sameSource = String(d.sourceDate || '') === String(m.nextDeadline.sourceDate || '');
      return !(sameLabel && sameDate && sameSource);
    });

    let detailedDeadlinesHtml = '';
    if (detailedDeadlines.length) {
      let rows = '';
      for (const d of detailedDeadlines) {
        const ds = formatDate(d.date);
        const dd = Math.ceil((d.date.getTime() - Date.now()) / 86400000);
        const proximity = dd < 0 ? 'bad' : dd <= 14 ? 'bad' : dd <= 45 ? 'warn' : 'ok';
        const metaParts = [
          `From ${d.sourceDate || 'procedural event'}`,
          d.confidence ? `${d.confidence} confidence` : '',
          d.method || '',
          d.rolledOver ? `rolled over${d.rolloverNote ? ` (${d.rolloverNote})` : ''}` : '',
          d.resolved ? 'responded' : '',
        ].filter(Boolean);
        rows += `<div class="epoRP-dr"><div class="epoRP-dn">${esc(d.label)}</div><div class="epoRP-dd"><span class="epoRP-bdg ${esc(proximity)}">${esc(ds)}${Number.isFinite(dd) ? ` · ${dd >= 0 ? formatDaysHuman(dd) : `${formatDaysHuman(dd).slice(1)} overdue`}` : ''}</span>${!d.reference ? `<div class="epoRP-m">${esc(`(${metaParts.join(' · ')})`)}</div>` : ''}</div></div>`;
      }
      detailedDeadlinesHtml = `<div class="epoRP-m">Detailed clocks</div><div class="epoRP-dl">${rows}</div><div class="epoRP-m">Procedural due dates are heuristic unless the Register provides explicit legal due dates.</div>`;
    }
    return detailedDeadlinesHtml;
  }

  function overviewNextDeadlineState(m) {
    const nextDeadlineBadge = m.daysToDeadline != null
      ? `<span class="epoRP-bdg ${m.daysToDeadline < 0 ? 'bad' : m.daysToDeadline <= 14 ? 'bad' : m.daysToDeadline <= 45 ? 'warn' : 'ok'}">${m.daysToDeadline >= 0 ? formatDaysHuman(m.daysToDeadline) : `${formatDaysHuman(m.daysToDeadline).slice(1)} overdue`}</span>`
      : '';

    let nextDeadlineMethod = normalize(m.nextDeadline?.method || '').replace(/\s*\n\s*/g, ' ');
    const nextDeadlineSourceDate = normalize(m.nextDeadline?.sourceDate || '');
    const sourceAlreadyInMethod = nextDeadlineSourceDate
      && new RegExp(`from\\s+communication\\s+date\\s+${nextDeadlineSourceDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(nextDeadlineMethod);
    if (sourceAlreadyInMethod && nextDeadlineSourceDate) {
      nextDeadlineMethod = normalize(nextDeadlineMethod.replace(new RegExp(`\\s*from\\s+communication\\s+date\\s+${nextDeadlineSourceDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ''));
    }

    const nextDeadlineMetaLines = [];
    const nextDeadlineContextBits = [];
    if (nextDeadlineSourceDate && !sourceAlreadyInMethod) nextDeadlineContextBits.push(`From ${nextDeadlineSourceDate}`);
    if (m.nextDeadline?.confidence) nextDeadlineContextBits.push(`${m.nextDeadline.confidence} confidence`);
    if (nextDeadlineContextBits.length) nextDeadlineMetaLines.push(nextDeadlineContextBits.join(' · '));
    if (nextDeadlineMethod) nextDeadlineMetaLines.push(`Basis: ${nextDeadlineMethod}`);
    if (m.nextDeadline?.rolledOver) nextDeadlineMetaLines.push(`Calendar rollover${m.nextDeadline.rolloverNote ? ` (${m.nextDeadline.rolloverNote})` : ''}`);
    if (m.nextDeadline?.resolved) nextDeadlineMetaLines.push('Marked as responded');

    const nextDeadlineMetaHtml = nextDeadlineMetaLines.map((line) => `<div class="epoRP-m">${esc(line)}</div>`).join('');
    return { nextDeadlineBadge, nextDeadlineMetaHtml };
  }

  function renderOverviewActionableCard(m) {
    const detailedDeadlinesHtml = renderOverviewDetailedDeadlines(m);
    const { nextDeadlineBadge, nextDeadlineMetaHtml } = overviewNextDeadlineState(m);
    const latestEpoText = overviewLatestActionText(m.latestEpo);
    const latestApplicantText = overviewLatestActionText(m.latestApplicant);
    const waitingLevel = m.waitingDays == null ? 'info' : (m.waitingDays > 365 ? 'bad' : m.waitingDays > 180 ? 'warn' : 'ok');
    const waitingSummary = m.waitingOn === 'EPO'
      ? `EPO${m.waitingDays != null ? ` · <span class="epoRP-bdg ${waitingLevel}">${formatDaysHuman(m.waitingDays)} since applicant response</span>` : ''}`
      : 'Applicant';

    return `<div class="epoRP-c"><h4>Actionable status</h4><div class="epoRP-g">
      <div class="epoRP-l">Next deadline</div><div class="epoRP-v">${m.nextDeadline ? `<div>${esc(formatDate(m.nextDeadline.date))} · ${esc(m.nextDeadline.label)}${nextDeadlineBadge ? ` · ${nextDeadlineBadge}` : ''}</div>${nextDeadlineMetaHtml}` : '—'}</div>
      <div class="epoRP-l">Latest actions</div><div class="epoRP-v"><div>EPO: ${esc(latestEpoText)}</div><div>Applicant: ${esc(latestApplicantText)}</div></div>
      ${m.recoveryOptions ? `<div class="epoRP-l">Recovery</div><div class="epoRP-v"><div class="epoRP-m">${esc(m.recoveryOptions)}</div></div>` : ''}
      <div class="epoRP-l">Waiting on</div><div class="epoRP-v">${waitingSummary}</div>
    </div>${detailedDeadlinesHtml}</div>`;
  }

  function renderOverviewRenewalsCard(m) {
    const filingDateObj = parseDateString(m.filingDate);
    const yearsFromFiling = filingDateObj ? Math.max(0, Math.floor((Date.now() - filingDateObj.getTime()) / (365.25 * 86400000))) : null;
    const patentYearFromFiling = yearsFromFiling != null ? yearsFromFiling + 1 : null;
    const nextDueDays = m.renewal.nextDue ? Math.ceil((m.renewal.nextDue.getTime() - Date.now()) / 86400000) : null;
    const dueLevel = nextDueDays == null ? 'info' : (nextDueDays < 0 ? 'bad' : nextDueDays <= 30 ? 'bad' : nextDueDays <= 75 ? 'warn' : 'ok');
    const dueText = m.renewal.nextDue
      ? `${esc(formatDate(m.renewal.nextDue))}${nextDueDays != null ? ` · ${nextDueDays >= 0 ? formatDaysHuman(nextDueDays) : `${formatDaysHuman(nextDueDays).slice(1)} overdue`}` : ''}`
      : 'Not available';
    const graceText = m.renewal.graceUntil
      ? `Grace until ${esc(formatDate(m.renewal.graceUntil))}${m.renewal.dueState === 'grace' ? ' (surcharge period active)' : ''}`
      : '';
    const federatedPaidYear = Number(String(m.federated?.renewalFeesPaidUntil || '').match(/Year\s+(\d+)/i)?.[1] || 0) || null;
    const effectivePaidYear = Math.max(Number(m.renewal.highestYear || 0) || 0, Number(federatedPaidYear || 0) || 0) || null;
    const patentYearStatus = effectivePaidYear
      ? `Paid through Year ${effectivePaidYear}${patentYearFromFiling ? ` · current year ${patentYearFromFiling}` : ''}`
      : (patentYearFromFiling ? `Current year ${patentYearFromFiling}` : 'No renewal payment captured yet');
    const latestRenewalNote = m.renewal.latest
      ? `Last payment ${m.renewal.latest.dateStr}${m.renewal.latest.year ? ` · Year ${m.renewal.latest.year}` : ''}`
      : (federatedPaidYear ? `Federated register reports payments through Year ${federatedPaidYear}` : 'No renewal payment event cached.');
    const basisSummary = `${m.renewal.explanatoryBasis} · ${m.renewal.confidence || 'low'} confidence`;

    return `<div class="epoRP-c"><h4>Renewals</h4><div class="epoRP-g">
      <div class="epoRP-l">Status</div><div class="epoRP-v">${esc(patentYearStatus)}<div class="epoRP-m">${esc(latestRenewalNote)}</div></div>
      <div class="epoRP-l">Forum</div><div class="epoRP-v">${esc(m.renewal.feeForum || 'Unknown')}</div>
      <div class="epoRP-l">Next fee</div><div class="epoRP-v">${m.renewal.nextYear ? `Year ${m.renewal.nextYear} · ` : ''}${m.renewal.nextDue ? `<span class="epoRP-bdg ${dueLevel}">${dueText}</span>` : dueText}${graceText ? `<div class="epoRP-m">${graceText}</div>` : ''}</div>
      ${m.renewal.mentionGrantDate ? `<div class="epoRP-l">Grant mention</div><div class="epoRP-v">${esc(m.renewal.mentionGrantDate)}</div>` : ''}
    </div><div class="epoRP-m">${esc(basisSummary)}</div></div>`;
  }

  function renderOverviewFederatedCard(m) {
    if (!(m.federated.status || m.federated.trackedStates || m.federated.upMemberStates)) return '';
    const notableStates = m.federated.notableStates || [];
    const upCount = normalize(m.federated.upMemberStates || '').split(/,\s*/).filter(Boolean).length;

    return `<div class="epoRP-c"><h4>Federated / national</h4><div class="epoRP-g">
      <div class="epoRP-l">Status</div><div class="epoRP-v">${esc(m.federated.status || '—')}</div>
      <div class="epoRP-l">UP coverage</div><div class="epoRP-v">${m.federated.upMemberStates ? `${esc(m.federated.upMemberStates)} <span class="epoRP-bdg ok">${upCount} states</span>` : '—'}</div>
      <div class="epoRP-l">Renewals paid to</div><div class="epoRP-v">${esc(m.federated.renewalFeesPaidUntil || '—')}</div>
      <div class="epoRP-l">Invalidation date</div><div class="epoRP-v">${esc(m.federated.invalidationDate || '—')}</div>
      <div class="epoRP-l">Tracked states</div><div class="epoRP-v">${esc(String(m.federated.trackedStates || 0))}${m.federated.recordUpdated ? `<div class="epoRP-m">Updated ${esc(m.federated.recordUpdated)}</div>` : ''}</div>
    </div>${notableStates.length ? `<div class="epoRP-m">Notable states: ${esc(notableStates.map((s) => `${s.state}${s.notInForceSince ? ` (not in force since ${s.notInForceSince})` : ''}`).join(', '))}</div>` : ''}</div>`;
  }

  function citationCategoryLevel(categories = []) {
    const joined = categories.join(' ');
    if (/\bX/.test(joined)) return 'bad';
    if (/\bY/.test(joined)) return 'warn';
    return 'info';
  }

  function renderOverviewCitationsCard(m) {
    const phases = m.citations.phases || [];
    if (!phases.length) return '';

    let html = `<div class="epoRP-c"><h4>Citations</h4>`;
    html += `<div class="epoRP-m">${esc(`${m.citations.entries.length} citation${m.citations.entries.length === 1 ? '' : 's'} across ${phases.length} phase${phases.length === 1 ? '' : 's'}`)}</div>`;
    for (const phase of phases.slice(0, 3)) {
      html += `<div class="epoRP-m"><b>${esc(phase.name)}</b></div>`;
      html += `<div class="epoRP-pubs">`;
      for (const entry of phase.entries.slice(0, 3)) {
        const catText = entry.categories?.length ? entry.categories.join('/') : 'ref';
        html += `<div class="epoRP-pub"><div><div class="epoRP-pn">${esc(entry.publicationNo)}</div><div class="epoRP-pm">${esc(entry.applicant || entry.type || phase.name)}</div></div><div class="epoRP-d"><span class="epoRP-bdg ${citationCategoryLevel(entry.categories || [])}">${esc(catText)}</span></div></div>`;
      }
      html += `</div>`;
    }
    if (phases.length > 3) html += `<div class="epoRP-m">${esc(`+ ${phases.length - 3} more citation phase${phases.length - 3 === 1 ? '' : 's'}`)}</div>`;
    html += `</div>`;
    return html;
  }

  function renderOverviewUpcUeCard(m) {
    const upStates = normalize(m.federated?.upMemberStates || '');
    const upCount = upStates ? upStates.split(/,\s*/).filter(Boolean).length : 0;
    const trackedStates = Number(m.federated?.trackedStates || 0) || 0;
    const notableStates = Array.isArray(m.federated?.notableStates) ? m.federated.notableStates : [];
    const noteParts = [];
    if (m.upcUe.note) noteParts.push(m.upcUe.note);
    if (/Unitary effect registered/i.test(m.upcUe.ueStatus)) noteParts.push('Opt-out is generally not relevant once unitary effect is registered.');
    if (trackedStates) noteParts.push(`Federated register tracks ${trackedStates} national/UP record${trackedStates === 1 ? '' : 's'}${m.federated?.recordUpdated ? ` (updated ${m.federated.recordUpdated})` : ''}.`);
    if (notableStates.length) noteParts.push(`Notable states: ${notableStates.map((s) => `${s.state}${s.notInForceSince ? ` (not in force since ${s.notInForceSince})` : ''}`).join(', ')}`);

    return `<div class="epoRP-c"><h4>UPC / UE</h4><div class="epoRP-g">
      <div class="epoRP-l">Unitary effect</div><div class="epoRP-v">${esc(m.upcUe.ueStatus)}</div>
      <div class="epoRP-l">Opt-out</div><div class="epoRP-v">${esc(m.upcUe.upcOptOut)}</div>
      <div class="epoRP-l">UP coverage</div><div class="epoRP-v">${upStates ? `${esc(upStates)} <span class="epoRP-bdg ok">${upCount} states</span>` : '—'}</div>
      <div class="epoRP-l">National status</div><div class="epoRP-v">${esc(m.federated?.status || '—')}</div>
      <div class="epoRP-l">Renewals paid to</div><div class="epoRP-v">${esc(m.federated?.renewalFeesPaidUntil || '—')}</div>
      <div class="epoRP-l">Invalidation</div><div class="epoRP-v">${esc(m.federated?.invalidationDate || '—')}</div>
    </div><div class="epoRP-m">${esc(noteParts.filter(Boolean).join(' '))}</div></div>`;
  }

  function renderOverviewPublicationsCard(caseNo, m) {
    let html = `<div class="epoRP-c"><h4>Publications (${m.publications.length})</h4>`;
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

  function renderOverview(caseNo) {
    const opts = options();
    const m = overviewModel(caseNo);

    let html = renderOverviewHeaderCard(m);
    html += renderOverviewActionableCard(m);
    if (opts.showRenewals) html += renderOverviewRenewalsCard(m);
    if (opts.showUpcUe) html += renderOverviewUpcUeCard(m);
    html += renderOverviewPublicationsCard(caseNo, m);
    if (opts.showCitations) html += renderOverviewCitationsCard(m);
    return html;
  }

  function timelineItemHtml(item, compact = false, inGroup = false) {
    const actorClass = item.actor === 'Applicant' ? 'actor-applicant' : item.actor === 'EPO' ? 'actor-epo' : item.actor === 'Third party' ? 'actor-third' : '';
    const classes = ['epoRP-it'];
    if (compact) classes.push('compact');
    if (inGroup) classes.push('in-group');
    return `<div class="${classes.join(' ')}">
      <div class="epoRP-dot ${esc(item.level || 'info')} ${esc(actorClass)}"></div>
      <div class="epoRP-d">${esc(item.dateStr || '—')}</div>
      <div>
        <div class="epoRP-mn">${item.url ? `<a class="epoRP-a" href="${esc(item.url)}">${esc(item.title)}</a>` : esc(item.title)}</div>
        <div class="epoRP-sb">${esc([item.detail, item.source, item.actor].filter(Boolean).join(' · '))}</div>
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
        const actorClass = item.actor === 'Applicant' ? 'actor-applicant' : item.actor === 'EPO' ? 'actor-epo' : item.actor === 'Third party' ? 'actor-third' : '';
        const groupKey = timelineGroupKey(caseNo, item);
        out.push(`<details class="epoRP-grp" data-group-key="${esc(groupKey)}">
          <summary class="epoRP-grph">
            <div class="epoRP-dot ${esc(item.level || 'info')} ${esc(actorClass)}"></div>
            <div class="epoRP-d">${esc(item.dateStr || '—')}</div>
            <div>
              <div class="epoRP-mn">${esc(item.title)} (${(item.items || []).length})</div>
              <div class="epoRP-sb">Grouped items · ${esc(item.source || 'Documents')} · ${esc(item.actor || 'Mixed')}</div>
            </div>
            <div class="epoRP-garrow">▸</div>
          </summary>
          <div class="epoRP-grpi">${(item.items || []).map((x) => timelineItemHtml(x, compact, true)).join('')}</div>
        </details>`);
      } else {
        out.push(timelineItemHtml(item, compact));
      }
    }

    if (!insertedToday) out.unshift(`<div class="epoRP-today"><span>Today · ${esc(today)}</span></div>`);

    const model = overviewModel(caseNo);
    if (model.nextDeadline) {
      const days = Math.ceil((model.nextDeadline.date.getTime() - Date.now()) / 86400000);
      const level = days < 0 ? 'bad' : days <= 14 ? 'bad' : days <= 45 ? 'warn' : 'ok';
      out.unshift(`<div class="epoRP-deadlineRow"><div class="epoRP-dot dotted ${level}"></div><div class="epoRP-d">${esc(formatDate(model.nextDeadline.date))}</div><div><div class="epoRP-mn">Next deadline</div><div class="epoRP-sb">${esc(model.nextDeadline.label)} · ${days >= 0 ? formatDaysHuman(days) : `${formatDaysHuman(days).slice(1)} overdue`}</div></div></div>`);
    }

    if (verbose) out.unshift(`<div class="epoRP-m">Verbose mode shows extended source labels and grouped event bodies.</div>`);

    return `<div class="epoRP-c">${out.join('')}</div>`;
  }

  function renderOptions(caseNo) {
    const o = options();
    const checkbox = (id, key, title, help) => `<label class="epoRP-or"><div><div class="epoRP-ol">${esc(title)}</div><div class="epoRP-oh">${esc(help)}</div></div><input id="${id}" type="checkbox" ${o[key] ? 'checked' : ''}></label>`;

    return `<div class="epoRP-c"><h4>Options</h4>
      ${checkbox('epoRP-opt-shift', 'shiftBody', 'Shift page body', 'Adds right padding so Register content is not hidden under panel.')}
      ${checkbox('epoRP-opt-preload', 'preloadAllTabs', 'Preload all case tabs in background', 'Loads main/doclist/event/family/legal/federated/citations/ueMain in background and fills cache.')}
      ${checkbox('epoRP-opt-pubs', 'showPublications', 'Show publications on timeline', 'Includes publication entries from main + family sources.')}
      ${checkbox('epoRP-opt-events', 'showEventHistory', 'Show event-history rows', 'Includes EP Event history source rows in timeline.')}
      ${checkbox('epoRP-opt-legal', 'showLegalStatusRows', 'Show legal-status rows', 'Includes EP Legal status rows in timeline.')}
      ${checkbox('epoRP-opt-ren', 'showRenewals', 'Show renewals panel', 'Displays pre-/post-grant and UE-sensitive renewal explanation in Overview.')}
      ${checkbox('epoRP-opt-upc', 'showUpcUe', 'Show UPC/UE panel', 'Displays inferred UE + UPC opt-out state with notes.')}
      ${checkbox('epoRP-opt-cit', 'showCitations', 'Show citations panel', 'Displays a compact cited-art summary grouped by phase.')}
      <label class="epoRP-or"><div><div class="epoRP-ol">Timeline density</div><div class="epoRP-oh">Compact / standard / verbose visual density.</div></div>
        <select id="epoRP-opt-density" class="epoRP-in"><option value="compact" ${o.timelineDensity === 'compact' ? 'selected' : ''}>Compact</option><option value="standard" ${o.timelineDensity === 'standard' ? 'selected' : ''}>Standard</option><option value="verbose" ${o.timelineDensity === 'verbose' ? 'selected' : ''}>Verbose</option></select>
      </label>
      <label class="epoRP-or"><div><div class="epoRP-ol">Timeline event importance</div><div class="epoRP-oh">Visual severity for event-history items.</div></div>
        <select id="epoRP-opt-event-level" class="epoRP-in"><option value="info" ${o.timelineEventLevel === 'info' ? 'selected' : ''}>Info</option><option value="warn" ${o.timelineEventLevel === 'warn' ? 'selected' : ''}>Warn</option><option value="bad" ${o.timelineEventLevel === 'bad' ? 'selected' : ''}>High</option><option value="ok" ${o.timelineEventLevel === 'ok' ? 'selected' : ''}>Low</option></select>
      </label>
      <label class="epoRP-or"><div><div class="epoRP-ol">Timeline legal importance</div><div class="epoRP-oh">Visual severity for legal-status items.</div></div>
        <select id="epoRP-opt-legal-level" class="epoRP-in"><option value="warn" ${o.timelineLegalLevel === 'warn' ? 'selected' : ''}>Warn</option><option value="info" ${o.timelineLegalLevel === 'info' ? 'selected' : ''}>Info</option><option value="bad" ${o.timelineLegalLevel === 'bad' ? 'selected' : ''}>High</option><option value="ok" ${o.timelineLegalLevel === 'ok' ? 'selected' : ''}>Low</option></select>
      </label>
      <div class="epoRP-actions"><button class="epoRP-btn" id="epoRP-reload">Reload all background pages</button><button class="epoRP-btn" id="epoRP-clear">Clear this case cache</button><button class="epoRP-btn" id="epoRP-clear-logs">Clear operation console</button></div>
      <div class="epoRP-console-wrap">
        <div class="epoRP-ol">Current option values</div>
        <div class="epoRP-oh">Effective values for all sidebar parameters.</div>
        <div class="epoRP-optvals" id="epoRP-optvals">${renderOptionSnapshot()}</div>
      </div>
      <div class="epoRP-console-wrap">
        <div class="epoRP-ol">Operation console</div>
        <div class="epoRP-oh">Live sidebar activity for this application (latest entries at top).</div>
        <div class="epoRP-log" id="epoRP-log-console">${renderLogConsole(caseNo)}</div>
      </div>
    </div>`;
  }

  function renderBadges(caseNo) {
    const c = getCase(caseNo);
    const counts = sourceStatusCounts(c);
    const mainSource = c.sources.main || {};
    const mainStatus = String(mainSource.status || '').toLowerCase();
    let statusLevel = mainSource.data?.statusLevel || 'info';
    let statusText = mainSource.data?.statusSimple || 'Unknown';

    if (mainStatus === 'notfound') {
      statusLevel = 'bad';
      statusText = 'Not found';
    } else if (mainStatus === 'empty') {
      statusLevel = 'warn';
      statusText = 'No main data';
    }

    return {
      left: `<span class="epoRP-bdg ${esc(statusLevel)}">${esc(statusText)}</span>`,
      right: `<span class="epoRP-bdg ${runtime.fetching ? 'info' : sourceStatusLevel(counts)}">${runtime.fetching ? esc(runtime.fetchLabel) : esc(sourceStatusSummaryText(counts))}</span>`,
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
      <div class="epoRP-row"><div><div class="epoRP-t">EP Register Pro <span class="epoRP-ver">v${VERSION}</span></div><div class="epoRP-st" id="epoRP-sub"></div></div><div class="epoRP-acts"><button class="epoRP-btn" id="epoRP-refresh">↻</button><button class="epoRP-btn" id="epoRP-collapse">−</button></div></div>
      <div class="epoRP-badges"><div id="epoRP-badge-left"></div><div id="epoRP-badge-right"></div></div>
      <div class="epoRP-tabs" role="tablist" aria-label="Sidebar views">
        <button class="epoRP-tab" data-view="overview" role="tab" aria-selected="false"><span class="epoRP-tab-ico">▦</span><span>Overview</span></button>
        <button class="epoRP-tab" data-view="timeline" role="tab" aria-selected="false"><span class="epoRP-tab-ico">◷</span><span>Timeline</span></button>
        <button class="epoRP-tab" data-view="options" role="tab" aria-selected="false"><span class="epoRP-tab-ico">⚙</span><span>Options</span></button>
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
        persistCurrentPanelScroll();
        setUiState({ activeView: btn.dataset.view || 'overview' });
        renderPanel();
      });
    });

    runtime.panel = panel;
    runtime.body = panel.querySelector('#epoRP-body');
    runtime.body?.addEventListener('scroll', () => {
      if (runtime.collapsed || !runtime.appNo) return;
      schedulePanelScrollSave(runtime.appNo, runtime.activeView || 'overview', runtime.body.scrollTop || 0);
    }, { passive: true });
    return panel;
  }

  function wireOptions() {
    const b = runtime.body;
    if (!b) return;

    const wireToggle = (id, key) => {
      const el = b.querySelector(`#${id}`);
      if (!el) return;
      el.checked = !!options()[key];

      const commit = () => {
        const nextValue = !!el.checked;
        if (!!options()[key] === nextValue) return;
        setOptions({ [key]: nextValue });
        applyBodyShift();
        renderPanel();
      };

      el.addEventListener('change', commit);
      el.addEventListener('input', commit);
    };

    wireToggle('epoRP-opt-shift', 'shiftBody');
    wireToggle('epoRP-opt-preload', 'preloadAllTabs');
    wireToggle('epoRP-opt-pubs', 'showPublications');
    wireToggle('epoRP-opt-events', 'showEventHistory');
    wireToggle('epoRP-opt-legal', 'showLegalStatusRows');
    wireToggle('epoRP-opt-ren', 'showRenewals');
    wireToggle('epoRP-opt-upc', 'showUpcUe');
    wireToggle('epoRP-opt-cit', 'showCitations');

    b.querySelector('#epoRP-opt-density')?.addEventListener('change', (event) => {
      setOptions({ timelineDensity: event.target.value || 'standard' });
      renderPanel();
    });

    b.querySelector('#epoRP-opt-event-level')?.addEventListener('change', (event) => {
      setOptions({ timelineEventLevel: event.target.value || 'info' });
      renderPanel();
    });

    b.querySelector('#epoRP-opt-legal-level')?.addEventListener('change', (event) => {
      setOptions({ timelineLegalLevel: event.target.value || 'warn' });
      renderPanel();
    });

    b.querySelector('#epoRP-reload')?.addEventListener('click', () => {
      addLog(runtime.appNo, 'info', 'Manual reload all background pages');
      renderPanel();
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

    b.querySelector('#epoRP-clear-logs')?.addEventListener('click', () => {
      patchCase(runtime.appNo, (c) => {
        c.logs = [];
      });
      flushNow();
      renderPanel();
    });
  }

  function renderPanel() {
    if (!isCasePage()) {
      runtime.panel?.remove();
      runtime.panel = null;
      runtime.body = null;
      runtime.appNo = '';
      runtime.lastViewLogKey = '';
      clearDerivedCaches();
      document.body.classList.remove('epoRP-shifted');
      return;
    }

    const previousCaseNo = runtime.appNo;
    const previousView = runtime.activeView || 'overview';
    if (runtime.body && previousCaseNo && !runtime.collapsed) {
      setPanelScroll(previousCaseNo, previousView, runtime.body.scrollTop || 0);
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

    panel.querySelectorAll('.epoRP-tab').forEach((btn) => {
      const active = btn.dataset.view === runtime.activeView;
      btn.classList.toggle('on', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const body = runtime.body;
    if (!body) return;
    if (runtime.collapsed) {
      body.innerHTML = '';
      return;
    }

    const activeView = runtime.activeView || 'overview';
    logViewContext(caseNo, activeView);
    if (activeView === 'timeline') {
      body.innerHTML = renderTimeline(caseNo);
      restorePanelScroll(caseNo, activeView);
      return;
    }
    if (activeView === 'options') {
      body.innerHTML = renderOptions(caseNo);
      wireOptions();
      restorePanelScroll(caseNo, activeView);
      return;
    }
    body.innerHTML = renderOverview(caseNo);
    restorePanelScroll(caseNo, activeView);
  }

  function init(force = false) {
    if (!isCasePage()) {
      cancelPrefetch();
      resetRouteRuntime();
      renderPanel();
      return;
    }

    const previousCaseNo = runtime.appNo;
    const caseNo = detectAppNo();
    const changed = previousCaseNo !== caseNo;
    if (changed) {
      clearDerivedCaches();
      runtime.lastViewLogKey = '';
    }
    runtime.appNo = caseNo;

    if (changed && runtime.fetchCaseNo && runtime.fetchCaseNo !== caseNo) cancelPrefetch();

    captureLiveSource(caseNo);
    renderPanel();
    enhanceDoclistGrouping();

    if (initTimer) clearTimeout(initTimer);
    initTimer = setTimeout(() => {
      if (runtime.appNo !== caseNo) return;
      captureLiveSource(caseNo);
      flushNow();
      renderPanel();
      enhanceDoclistGrouping();
    }, 1800);

    const registerTab = tabSlug();
    const caseSession = getCaseSession(caseNo);
    if (caseSession.prefetchDoneAt) runtime.autoPrefetchDoneByCase[caseNo] = Number(caseSession.prefetchDoneAt) || Date.now();
    if (caseSession.lastRegisterTab) runtime.lastRegisterTabByCase[caseNo] = String(caseSession.lastRegisterTab);

    const previousRegisterTab = String(runtime.lastRegisterTabByCase[caseNo] || caseSession.lastRegisterTab || '');
    const hasPreviousTab = !!previousRegisterTab;
    const tabChangedWithinCase = hasPreviousTab && previousRegisterTab !== registerTab;
    const sameTabReloadWithinCase = changed && hasPreviousTab && previousRegisterTab === registerTab;
    runtime.lastRegisterTabByCase[caseNo] = registerTab;
    patchCaseSession(caseNo, { lastRegisterTab: registerTab });

    if (force) {
      addLog(caseNo, 'info', 'Forced data reload for case', { source: 'prefetch', registerTab });
      const gateTs = Date.now();
      runtime.autoPrefetchDoneByCase[caseNo] = gateTs;
      patchCaseSession(caseNo, { prefetchDoneAt: gateTs, lastRegisterTab: registerTab });
      prefetchCase(caseNo, true);
      return;
    }

    const staleSources = SOURCES.filter((s) => !isFresh(getCase(caseNo).sources[s.key], options().refreshHours, { allowEmpty: true, allowNotFound: true })).map((s) => s.key);
    const needsRefresh = staleSources.length > 0;

    if (runtime.autoPrefetchDoneByCase[caseNo]) {
      if (needsRefresh) {
        addLog(caseNo, 'warn', 'Prefetch gate bypassed: stale/missing sources detected', {
          source: 'prefetch',
          registerTab,
          staleSources,
        });

        const gateTs = Date.now();
        runtime.autoPrefetchDoneByCase[caseNo] = gateTs;
        patchCaseSession(caseNo, { prefetchDoneAt: gateTs, lastRegisterTab: registerTab });
        prefetchCase(caseNo, false);
        return;
      }

      if (tabChangedWithinCase) {
        addLog(caseNo, 'info', 'Same-case tab switch detected: prefetch gate active', {
          source: 'prefetch',
          fromTab: previousRegisterTab,
          toTab: registerTab,
        });
      } else if (sameTabReloadWithinCase) {
        addLog(caseNo, 'info', 'Same-case page reload detected: prefetch gate active', {
          source: 'prefetch',
          registerTab,
        });
      } else if (changed) {
        addLog(caseNo, 'info', 'Case tab/page changed; auto prefetch skipped for this page session', {
          source: 'prefetch',
          registerTab,
        });
      }
      return;
    }

    const gateTs = Date.now();
    runtime.autoPrefetchDoneByCase[caseNo] = gateTs;
    patchCaseSession(caseNo, { prefetchDoneAt: gateTs, lastRegisterTab: registerTab });

    if (needsRefresh) {
      addLog(caseNo, 'info', 'Initial case load: stale/missing sources detected; running auto prefetch', {
        source: 'prefetch',
        registerTab,
        staleSources,
      });
      prefetchCase(caseNo, false);
      return;
    }

    addLog(caseNo, 'ok', 'Initial case load: cache is fresh; no auto prefetch needed', {
      source: 'prefetch',
      registerTab,
    });
  }

  function installRouteObservers() {
    const handleLocationChange = () => {
      if (location.href === runtime.href) return;
      runtime.href = location.href;
      scheduleInit(false);
    };

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      if (typeof original !== 'function') continue;
      history[method] = function patchedHistoryState(...args) {
        const result = original.apply(this, args);
        handleLocationChange();
        return result;
      };
    }

    addEventListener('popstate', () => {
      runtime.href = location.href;
      scheduleInit(false);
    });

    addEventListener('hashchange', () => {
      runtime.href = location.href;
      scheduleInit(false);
    });

    setInterval(handleLocationChange, 1500);
  }

  GM_addStyle(`
    body.epoRP-shifted{padding-right:${DEFAULTS.pageRightPaddingPx}px !important}
    .epoRP{position:fixed;top:60px;right:10px;z-index:999999;width:${DEFAULTS.panelWidthPx}px;height:calc(100vh - 70px);background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 26px rgba(2,6,23,.18);display:flex;flex-direction:column;color:#0f172a;font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .epoRP.collapsed{height:auto;max-height:55px;overflow:hidden}
    .epoRP-hd{padding:8px 10px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#f8fafc,#f1f5f9)}
    .epoRP-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .epoRP-t{font-size:14px;font-weight:800}
    .epoRP-ver{font-size:11px;font-weight:700;color:#64748b;margin-left:4px}
    .epoRP-st{font-size:11px;color:#475569}
    .epoRP-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px;padding:4px;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:10px}
    .epoRP-tab{display:flex;align-items:center;justify-content:center;gap:5px;border:1px solid transparent;background:transparent;color:#334155;border-radius:8px;padding:5px 6px;font-size:11px;font-weight:700;cursor:pointer;line-height:1}
    .epoRP-tab:hover{background:#f8fafc;border-color:#cbd5e1}
    .epoRP-tab.on{background:#bfdbfe;color:#0f172a;border-color:#93c5fd;box-shadow:0 1px 0 rgba(15,23,42,.10)}
    .epoRP-tab-ico{font-size:11px;opacity:.9}
    .epoRP-tab.on .epoRP-tab-ico{opacity:1}
    .epoRP-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer}
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
    .epoRP-it{display:grid;grid-template-columns:12px 72px 1fr;gap:8px;padding:6px 4px;border-bottom:1px solid #f1f5f9;align-items:center}
    .epoRP-it.compact{padding:4px 2px}
    .epoRP-it:last-child{border-bottom:0}
    .epoRP-it.in-group{background:transparent;border:0;border-radius:0;padding:5px 2px;margin:0}
    .epoRP-it.in-group.compact{padding:3px 2px}
    .epoRP-it.in-group:last-child{border-bottom:0}
    .epoRP-dot{width:9px;height:9px;border-radius:999px;margin-top:0;background:#94a3b8}
    .epoRP-dot.dotted{background:transparent;border:2px dotted #94a3b8;width:10px;height:10px}
    .epoRP-dot.ok{background:#16a34a}
    .epoRP-dot.warn{background:#d97706}
    .epoRP-dot.bad{background:#dc2626}
    .epoRP-dot.info{background:#2563eb}
    .epoRP-dot.actor-epo{background:#2563eb}
    .epoRP-dot.actor-applicant{background:#16a34a}
    .epoRP-dot.actor-third{background:#9333ea}
    .epoRP-dot.dotted.ok{border-color:#16a34a}
    .epoRP-dot.dotted.warn{border-color:#d97706}
    .epoRP-dot.dotted.bad{border-color:#dc2626}
    .epoRP-dot.dotted.info{border-color:#2563eb}
    .epoRP-mn{font-weight:700}
    .epoRP-sb{font-size:11px;color:#64748b;white-space:pre-wrap}
    .epoRP-grp{border:1px solid #e2e8f0;border-radius:10px;padding:0;background:#f8fafc;margin-bottom:7px;overflow:hidden}
    .epoRP-grp[open]{background:#eef6ff;border-color:#bfdbfe;box-shadow:inset 0 0 0 1px #dbeafe}
    .epoRP-grph{display:grid;grid-template-columns:12px 72px 1fr 14px;gap:8px;padding:6px 4px;cursor:pointer;list-style:none;align-items:center;background:transparent;border:0;border-radius:0;appearance:none;-webkit-appearance:none}
    .epoRP-grp[open] .epoRP-grph{background:#e2efff;border-bottom:1px solid #c7dcff}
    .epoRP-grph::marker{content:''}
    .epoRP-grph::-webkit-details-marker{display:none}
    .epoRP-garrow{font-size:16px;font-weight:700;color:#334155;justify-self:end;transition:transform .15s ease}
    .epoRP-grp[open] .epoRP-garrow{transform:rotate(90deg)}
    .epoRP-grp .epoRP-grpi{margin-left:12px;border-left:2px dotted #93c5fd;padding:4px 0 2px 10px;background:transparent}
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
    .epoRP-console-wrap{margin-top:10px}
    .epoRP-optvals{margin-top:6px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;max-height:220px;overflow:auto}
    .epoRP-optval-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:5px 8px;border-bottom:1px solid #e2e8f0;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .epoRP-optval-row:last-child{border-bottom:0}
    .epoRP-optval-k{color:#1e293b;font-weight:700}
    .epoRP-optval-v{color:#334155;text-align:right;white-space:pre-wrap;word-break:break-word}
    .epoRP-log{margin-top:6px;max-height:230px;overflow:auto;border:1px solid #1e293b;border-radius:8px;background:#0f172a;color:#e2e8f0;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .epoRP-log-row{display:grid;grid-template-columns:58px 48px 1fr;gap:8px;padding:4px 6px;border-bottom:1px solid #1e293b;align-items:start}
    .epoRP-log-row:last-child{border-bottom:0}
    .epoRP-log-ts{color:#94a3b8;font-variant-numeric:tabular-nums}
    .epoRP-log-lv{font-weight:700}
    .epoRP-log-row.ok .epoRP-log-lv{color:#86efac}
    .epoRP-log-row.info .epoRP-log-lv{color:#93c5fd}
    .epoRP-log-row.warn .epoRP-log-lv{color:#fcd34d}
    .epoRP-log-row.bad .epoRP-log-lv,.epoRP-log-row.error .epoRP-log-lv{color:#fca5a5}
    .epoRP-log-msg{white-space:pre-wrap;word-break:break-word}
    .epoRP-log-meta{color:#94a3b8}
    .epoRP-log-empty{padding:8px;color:#94a3b8}
    .epoRP-in{border:1px solid #cbd5e1;border-radius:8px;padding:5px 7px;font-size:12px;width:100%}
    .epoRP-deadlineRow{display:grid;grid-template-columns:12px 72px 1fr;gap:8px;padding:6px 4px;border-bottom:1px dashed #cbd5e1;align-items:start;background:#f8fafc}
    tr.epoRP-docgrp td{background:#eff6ff;color:#1e3a8a;font-weight:700;border-top:2px solid #bfdbfe;border-bottom:1px solid #dbeafe;padding:4px 8px}
    tr.epoRP-docgrp td:first-child{box-shadow:inset 3px 0 0 #3b82f6}
    tr.epoRP-docgrp.open td{background:#dbeafe;border-top-color:#93c5fd;border-bottom-color:#bfdbfe}
    .epoRP-docgrp-head{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}
    .epoRP-docgrp-sel{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#1e3a8a;white-space:nowrap;cursor:pointer}
    .epoRP-docgrp-sel input{margin:0}
    .epoRP-docgrp-btn{all:unset;display:flex;justify-content:space-between;align-items:center;width:100%;cursor:pointer;font-weight:700;color:#1e3a8a;background:transparent !important;background-image:none !important;border:0 !important;border-radius:0;box-shadow:none !important;padding:0;appearance:none !important;-webkit-appearance:none !important}
    .epoRP-docgrp-btn::-moz-focus-inner{border:0;padding:0}
    .epoRP-docgrp-btn:focus-visible{outline:2px solid #93c5fd;outline-offset:2px;border-radius:6px}
    .epoRP-docgrp-arrow{font-size:15px;transition:transform .15s ease}
    .epoRP-docgrp-btn[aria-expanded="true"] .epoRP-docgrp-arrow{transform:rotate(90deg)}
    tr.epoRP-docgrp-item.epoRP-docgrp-open td{background:#f8fbff}
    tr.epoRP-docgrp-item.epoRP-docgrp-open td:first-child{box-shadow:inset 3px 0 0 #93c5fd}
    tr.epoRP-docgrp-item.epoRP-docgrp-last.epoRP-docgrp-open td{border-bottom:2px solid #bfdbfe}
    tr.epoRP-docgrp-item.collapsed{display:none}
    .epoRP-doclist-filter-wrap{margin:8px 0}
    .epoRP-doclist-filter{width:100%;max-width:420px;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .epoRP-filter-hidden{display:none !important}
  `);

  installRouteObservers();

  addEventListener('storage', (event) => {
    if (![CACHE_KEY, OPTIONS_KEY, UI_KEY].includes(event.key)) return;
    if (event.key === CACHE_KEY) {
      memory = null;
      clearDerivedCaches();
    }
    if (event.key === OPTIONS_KEY) {
      optionsShadow = null;
      clearDerivedCaches();
    }
    if (event.key === UI_KEY) {
      const ui = uiState();
      runtime.activeView = ui.activeView || runtime.activeView;
      runtime.collapsed = !!ui.collapsed;
    }
    if (isCasePage()) renderPanel();
  });

  addEventListener('focus', () => {
    if (!isCasePage()) return;
    runtime.href = location.href;
    enhanceDoclistGrouping();
    if (runtime.activeView !== 'timeline') renderPanel();
  });

  document.addEventListener('visibilitychange', () => {
    if (!isCasePage()) return;

    if (document.visibilityState === 'hidden') {
      persistCurrentPanelScroll();
      if (runtime.appNo) persistLiveDoclistGroups(runtime.appNo);
      return;
    }

    if (document.visibilityState !== 'visible') return;
    runtime.href = location.href;
    enhanceDoclistGrouping();
    if (runtime.activeView !== 'timeline') renderPanel();
  });

  addEventListener('pageshow', () => {
    runtime.href = location.href;
    scheduleInit(false);
  });

  addEventListener('beforeunload', () => {
    if (runtime.scrollSaveTimer) {
      clearTimeout(runtime.scrollSaveTimer);
      runtime.scrollSaveTimer = null;
    }
    if (runtime.routeTimer) {
      clearTimeout(runtime.routeTimer);
      runtime.routeTimer = null;
    }
    persistCurrentPanelScroll();
    if (runtime.appNo) persistLiveDoclistGroups(runtime.appNo);
    flushNow();
  });

  init(false);
})();
