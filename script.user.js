// ==UserScript==
// @name         EPO Register Pro
// @namespace    https://tampermonkey.net/
// @version      7.0.45
// @description  EP patent attorney sidebar for the European Patent Register with cross-tab case cache, timeline, and diagnostics
// @updateURL    https://raw.githubusercontent.com/EdLaughton/EP-Register-Pro/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/EdLaughton/EP-Register-Pro/main/script.user.js
// @match        https://register.epo.org/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      unifiedpatentcourt.org
// @connect      cdnjs.cloudflare.com
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__epoRegisterPro700) return;
  window.__epoRegisterPro700 = true;

  const VERSION = '7.0.45';
  const CACHE_KEY = 'epoRP_700_cache';
  const OPTIONS_KEY = 'epoRP_700_options';
  const UI_KEY = 'epoRP_700_ui';
  const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;

  const CACHE_SCHEMA = 2;
  const MAX_CASES = 30;
  const MAX_LOGS_PER_APP = 180;
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
    scrollSaveTimer: null,
    timelineCache: { key: '', items: [] },
    doclistGroupSigByCase: {},
    pdfjsPromise: null,
  };

  let memory = null;
  let optionsShadow = null;
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
    const logs = (getCase(caseNo).logs || []).slice(-120);
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

  function isFresh(src, refreshHours) {
    const sameParser = src?.parserVersion === VERSION;
    return !!(sameParser && src?.fetchedAt && Date.now() - src.fetchedAt < refreshHours * 3600000);
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

  function getTimelineOpenGroups(caseNo) {
    const byCase = uiState().timelineOpenByCase || {};
    const arr = Array.isArray(byCase[caseNo]) ? byCase[caseNo] : [];
    return new Set(arr.map((v) => String(v)));
  }

  function setTimelineOpenGroups(caseNo, groupSet) {
    const state = uiState();
    const byCase = { ...(state.timelineOpenByCase || {}) };
    byCase[caseNo] = [...groupSet].slice(0, 250);

    const keys = Object.keys(byCase);
    if (keys.length > 20) {
      const keep = new Set(keys.slice(-20));
      for (const k of keys) if (!keep.has(k)) delete byCase[k];
    }

    setUiState({ timelineOpenByCase: byCase });
  }

  function persistLiveTimelineGroups(caseNo) {
    const b = runtime.body;
    if (!b || runtime.activeView !== 'timeline') return;
    const openGroups = getTimelineOpenGroups(caseNo);
    b.querySelectorAll('details.epoRP-grp[data-group-key]').forEach((el) => {
      const key = String(el.getAttribute('data-group-key') || '');
      if (!key) return;
      if (el.open) openGroups.add(key);
      else openGroups.delete(key);
    });
    setTimelineOpenGroups(caseNo, openGroups);
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

  function extractEpNumbersByHeader(doc, headerRegex) {
    const values = [];

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

      const chunk = rows.map((r) => text(r)).join('\n');
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
    const appField = fieldByLabel(doc, [/^Application number/i]);
    const statusField = dedupeMultiline(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
    const priorityField = fieldByLabel(doc, [/^Priority\b/i]);
    const publicationField = fieldByLabel(doc, [/^Publication$/i]);
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

    const internationalField = dedupeMultiline(fieldByLabel(doc, [/^International application\b/i, /^International publication\b/i, /^PCT application\b/i]));
    const internationalSectionFromPage = String(pageText).match(/International\s+application(?:\s+number)?[\s\S]{0,220}/i)?.[0] || '';
    const pctScopeText = `${String(appField || '')}\n${internationalField}\n${internationalSectionFromPage}`;
    const woMatch = pctScopeText.match(/\b(WO\d{4}[A-Z]{2}\d{3,})\b/i);
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
      publications: parsePublications(publicationField, 'EP (this file)'),
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

    if (/by applicant|amendment by applicant|filed by applicant|from applicant/.test(p)) {
      if (isSearchResponseContext && /amend|claims|description|letter|annotations|subsequently filed items/.test(t)) {
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

    if (isSearchResponseContext && /amend|claims|description|letter accompanying subsequently filed items|annotations|amendments received before examination/.test(t)) {
      return { bundle: 'Response to search', level: 'info', actor: 'Applicant' };
    }

    if (/amended claims filed|amendment by applicant|claims and\/or description|filed after receipt/i.test(t)) {
      return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    }

    if (/search report|search opinion|written opinion|search strategy|esr/.test(t)) return { bundle: 'Search package', level: 'info', actor: 'EPO' };
    if (/rule\s*71\(3\)|intention to grant|text intended for grant|mention of grant/.test(t)) return { bundle: 'Grant package', level: 'warn', actor: 'EPO' };
    if (/annex to (?:the )?communication|communication annex|annex.*examining division/.test(t)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    if (/article\s*94\(3\)|art\.\s*94\(3\)|communication from the examining|examining division has become responsible/.test(t)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
    if (/renewal|annual fee/.test(t)) return { bundle: 'Renewal', level: 'ok', actor: 'Applicant' };
    if (/request for grant|description|claims|drawings|designation of inventor|priority document/.test(t)) return { bundle: 'Filing package', level: 'info', actor: 'Applicant' };
    if (/reply|response|arguments|observations|letter|filed by applicant|submission|request/.test(t)) return { bundle: 'Applicant filings', level: 'info', actor: 'Applicant' };
    if (/opposition|third party/.test(t) || /third party/.test(p)) return { bundle: 'Opposition', level: 'warn', actor: 'Third party' };

    if (/examining division|epo|office/.test(p)) return { bundle: 'Examination', level: 'info', actor: 'EPO' };
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

  function enhanceDoclistGrouping() {
    if (tabSlug() !== 'doclist') return;

    const caseNo = detectAppNo() || runtime.appNo || '';
    const table = bestTable(document, ['date', 'document']) || bestTable(document, ['document type']);
    if (!table) return;

    let filterWrap = document.getElementById('epoRP-doclist-filter-wrap');
    if (!filterWrap) {
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
    }

    const currentQuery = (filterWrap.querySelector('#epoRP-doclist-filter')?.value || '');
    const signature = doclistGroupingSignature(table);

    if (runtime.doclistGroupSigByCase[caseNo] === signature && table.querySelector('tr.epoRP-docgrp')) {
      applyDoclistFilter(table, currentQuery);
      return;
    }

    persistLiveDoclistGroups(caseNo);
    const openGroups = getDoclistOpenGroups(caseNo);

    table.querySelectorAll('tr.epoRP-docgrp').forEach((row) => row.remove());
    table.querySelectorAll('tr[data-eporp-group]').forEach((row) => {
      row.classList.remove('epoRP-docgrp-item', 'collapsed', 'epoRP-filter-hidden', 'epoRP-docgrp-open', 'epoRP-docgrp-last');
      row.removeAttribute('data-eporp-group');
    });

    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    const groupable = new Set(['Search package', 'Grant package', 'Examination', 'Filing package', 'Applicant filings', 'Response to search']);

    const runs = [];
    let run = null;

    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')];
      if (!cells.length) continue;
      const title = [...row.querySelectorAll('a')].map(text).filter(Boolean).sort((a, b) => b.length - a.length)[0] || text(cells[1] || cells[0] || row);
      const bundle = classifyDocument(title, text(row)).bundle || 'Other';

      if (!run || run.bundle !== bundle) {
        run = { bundle, rows: [row] };
        runs.push(run);
      } else {
        run.rows.push(row);
      }
    }

    let gid = 0;
    for (const r of runs) {
      if (!groupable.has(r.bundle) || r.rows.length < 2) continue;
      gid += 1;
      const groupId = `g${gid}`;
      const groupKey = doclistGroupKey(caseNo, r.bundle, gid);
      const isOpen = openGroups.has(groupKey);
      const firstRow = r.rows[0];
      const cells = [...firstRow.querySelectorAll('td')];

      const headerRow = document.createElement('tr');
      headerRow.className = 'epoRP-docgrp';
      headerRow.classList.toggle('open', isOpen);

      const td = document.createElement('td');
      td.colSpan = Math.max(1, cells.length);
      td.innerHTML = `<div class="epoRP-docgrp-head"><label class="epoRP-docgrp-sel" title="Select all in this group"><input type="checkbox" class="epoRP-docgrp-check" data-group="${groupId}" data-group-key="${esc(groupKey)}"><span>All</span></label><button type="button" class="epoRP-docgrp-btn" data-group="${groupId}" data-group-key="${esc(groupKey)}" aria-expanded="${isOpen ? 'true' : 'false'}"><span class="epoRP-docgrp-label" data-bundle="${esc(r.bundle)}">${esc(r.bundle)} (${r.rows.length})</span><span class="epoRP-docgrp-arrow">▸</span></button></div>`;
      headerRow.appendChild(td);
      firstRow.parentElement?.insertBefore(headerRow, firstRow);

      const rowCheckboxes = [];
      r.rows.forEach((row, idx) => {
        row.setAttribute('data-eporp-group', groupId);
        row.classList.add('epoRP-docgrp-item');
        row.classList.toggle('collapsed', !isOpen);
        row.classList.toggle('epoRP-docgrp-open', isOpen);
        row.classList.toggle('epoRP-docgrp-last', idx === r.rows.length - 1);
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
          for (const row of r.rows) {
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
          parserVersion: VERSION,
          url: location.href,
          transport: 'dom',
          data,
        };
        if (sourceKey === 'main') {
          c.meta = c.meta || {};
          c.meta.lastMainStatusRaw = String(data?.statusRaw || '');
          c.meta.lastMainStage = String(data?.statusStage || inferStatusStage(data?.statusRaw || '') || '');
        }
      });
    } catch (error) {
      addLog(caseNo, 'error', `Live parse failure: ${error?.message || error}`, { source: sourceKey, transport: 'dom' });
      patchCase(caseNo, (c) => {
        c.sources[sourceKey] = {
          key: sourceKey,
          title: sourceTitle(sourceKey),
          status: 'error',
          fetchedAt: Date.now(),
          parserVersion: VERSION,
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

  function fetchBinaryCrossOrigin(url, signal) {
    if (typeof GM_xmlhttpRequest !== 'function') return fetchBinaryWithRetry(url, signal);
    return new Promise((resolve, reject) => {
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: FETCH_TIMEOUT_MS,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400 && res.response) resolve(res.response);
          else reject(new Error(`HTTP ${res.status}`));
        },
        onerror: () => reject(new Error('Cross-origin binary request failed')),
        ontimeout: () => reject(new Error('Cross-origin binary request timed out')),
      });

      const onAbort = () => {
        try { req?.abort?.(); } catch {}
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
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

  async function ensurePdfJs(signal) {
    if (window.pdfjsLib?.getDocument) return window.pdfjsLib;
    if (runtime.pdfjsPromise) return runtime.pdfjsPromise;

    runtime.pdfjsPromise = (async () => {
      const pdfJsUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      const workerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      const code = await loadExternalScriptText(pdfJsUrl, signal);
      // eslint-disable-next-line no-new-func
      Function(code)();
      if (!window.pdfjsLib?.getDocument) throw new Error('pdf.js global not available after load');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return window.pdfjsLib;
    })().catch((error) => {
      runtime.pdfjsPromise = null;
      throw error;
    });

    return runtime.pdfjsPromise;
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
      || /\b(?:register(?:ed)?|enter(?:ed)?|effective)(?:\s+\w+){0,8}\s+opt(?:ed)?[\s-]*out\b/.test(t);
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
    const c = getCase(caseNo);
    const main = c.sources.main?.data || {};
    const picks = [];

    // Use case-specific publication numbers only (avoid family-wide false positives).
    for (const p of (main.publications || [])) {
      const m = String(p.no || '').toUpperCase().match(/^(EP\d{6,})/);
      if (m?.[1]) picks.push(m[1]);
    }

    // Conservative fallback only for published/granted status and EP-like number.
    const statusText = String(main.statusRaw || '').toLowerCase();
    if (!picks.length && /^EP\d{6,}$/i.test(caseNo || '') && /(published|granted)/.test(statusText)) {
      picks.push(String(caseNo).toUpperCase());
    }

    return [...new Set(picks)].slice(0, 4);
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

  function monthNumber(name) {
    const n = String(name || '').toLowerCase();
    if (!n) return 0;
    const m = {
      january: 1, jan: 1,
      february: 2, feb: 2,
      march: 3, mar: 3,
      april: 4, apr: 4,
      may: 5,
      june: 6, jun: 6,
      july: 7, jul: 7,
      august: 8, aug: 8,
      september: 9, sep: 9, sept: 9,
      october: 10, oct: 10,
      november: 11, nov: 11,
      december: 12, dec: 12,
    };
    return m[n] || 0;
  }

  function extractDateCandidates(textBlock) {
    const out = [];
    const t = String(textBlock || '');

    for (const m of t.matchAll(/\b(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})\b/g)) {
      const d = normalizeDateString(m[1]);
      if (d) out.push(d);
    }

    for (const m of t.matchAll(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/gi)) {
      const day = String(m[1] || '').padStart(2, '0');
      const mon = String(monthNumber(m[2] || '')).padStart(2, '0');
      const year = String(m[3] || '');
      if (mon !== '00') out.push(`${day}.${mon}.${year}`);
    }

    return dedupe(out, (d) => d);
  }

  function parsePdfDeadlineHints(pdfText, context = {}) {
    const textRaw = String(pdfText || '');
    const textLower = textRaw.toLowerCase();
    if (!textLower) return [];

    const hints = [];
    const docDateStr = normalizeDateString(context.docDateStr || '');
    const docDate = parseDateString(docDateStr);

    const pushHint = (hint) => {
      const date = parseDateString(hint?.dateStr || '');
      if (!date) return;
      hints.push({
        label: hint.label,
        dateStr: formatDate(date),
        sourceDate: docDateStr || hint.sourceDate || '',
        confidence: hint.confidence || 'high',
        level: hint.level || 'bad',
        resolved: false,
        source: 'PDF parse',
        evidence: hint.evidence || '',
      });
    };

    const category = /rule\s*71\(3\)|intention to grant/.test(textLower)
      ? 'R71(3) response period'
      : /rule\s*116|summons to oral proceedings/.test(textLower)
        ? 'Rule 116 final date'
        : /article\s*94\(3\)|art\.\s*94\(3\)/.test(textLower)
          ? 'Art. 94(3) response period'
          : /rule\s*161|rule\s*162/.test(textLower)
            ? 'Rule 161/162 response period'
            : '';

    const dateRegion = textRaw.match(/(?:final date|time limit|within)[\s\S]{0,260}/i)?.[0] || textRaw.slice(0, 1200);
    const dateCandidates = extractDateCandidates(dateRegion);

    // Prefer explicit final dates near deadline language.
    if (category && dateCandidates.length) {
      const explicitDate = dateCandidates
        .map((d) => ({ d, ts: parseDateString(d)?.getTime() || 0 }))
        .filter((x) => x.ts)
        .sort((a, b) => b.ts - a.ts)[0]?.d;

      if (explicitDate) {
        pushHint({
          label: category,
          dateStr: explicitDate,
          confidence: 'high',
          level: /rule\s*116/i.test(category) ? 'warn' : 'bad',
          evidence: 'Explicit date found in PDF communication text',
        });
      }
    }

    // Fallback: "within X months" from document date.
    const monthMatch = textLower.match(/within\s+(\d{1,2})\s+months?/i);
    if (category && monthMatch?.[1] && docDate) {
      const months = Number(monthMatch[1]);
      if (Number.isFinite(months) && months > 0 && months <= 12) {
        const calc = addCalendarMonthsDetailed(docDate, months);
        const due = calc.date;
        const already = hints.some((h) => h.label === category && h.dateStr === formatDate(due));
        if (!already) {
          pushHint({
            label: category,
            dateStr: formatDate(due),
            confidence: 'medium',
            level: 'bad',
            evidence: `Derived from "within ${months} months" in PDF text${calc.rolledOver ? ` (rollover ${calc.fromDay}→${calc.toDay})` : ''}`,
            rolledOver: calc.rolledOver,
            rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
          });
        }
      }
    }

    return dedupe(hints, (h) => `${h.label}|${h.dateStr}`);
  }

  async function resolvePdfUrl(url, signal) {
    if (!url) return '';
    if (/\.pdf(?:\?|$)/i.test(url)) return url;

    try {
      const html = await fetchWithRetry(url, signal);
      const doc = parseHtml(html);
      const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
      const pdfHref = links.find((href) => /\.pdf(?:\?|$)/i.test(href));
      if (!pdfHref) return '';
      return new URL(pdfHref, url).toString();
    } catch {
      return '';
    }
  }

  async function extractPdfText(url, signal) {
    const pdfjs = await ensurePdfJs(signal);
    const binary = await fetchBinaryWithRetry(url, signal);
    const data = new Uint8Array(binary);
    const loadingTask = pdfjs.getDocument({ data, disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
    const pdf = await loadingTask.promise;

    try {
      const maxPages = Math.min(pdf.numPages || 0, 8);
      const chunks = [];
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const txt = (content.items || []).map((it) => String(it.str || '')).join(' ');
        if (txt) chunks.push(txt);
      }
      return chunks.join('\n');
    } finally {
      try { await pdf.destroy(); } catch {}
    }
  }

  async function refreshPdfDeadlines(caseNo, signal, force = false) {
    if (!caseNo) return;
    const c = getCase(caseNo);
    const cached = c.sources.pdfDeadlines;
    if (!force && isFresh(cached, options().refreshHours)) return;

    const docs = [...(c.sources.doclist?.data?.docs || [])].sort(compareDateDesc);
    if (!docs.length) return;

    const candidates = docs.filter((d) => /rule\s*71\(3\)|rule\s*116|summons to oral proceedings|article\s*94\(3\)|art\.\s*94\(3\)|rule\s*161|rule\s*162|communication from the examining/i.test(`${d.title || ''} ${d.procedure || ''}`)).slice(0, 5);
    if (!candidates.length) return;

    const hints = [];
    const scanned = [];

    for (const doc of candidates) {
      if (signal?.aborted) return;
      try {
        const resolvedUrl = await resolvePdfUrl(doc.url, signal);
        if (!resolvedUrl) continue;
        const text = await extractPdfText(resolvedUrl, signal);
        if (!text) continue;

        const parsedHints = parsePdfDeadlineHints(text, { docDateStr: doc.dateStr });
        if (parsedHints.length) {
          hints.push(...parsedHints);
          scanned.push({ title: doc.title, dateStr: doc.dateStr, url: resolvedUrl, hintCount: parsedHints.length });
        }
      } catch (error) {
        addLog(caseNo, 'warn', `PDF deadline parse skipped: ${error?.message || error}`, { source: 'pdfDeadlines', doc: doc.title || '' });
      }
    }

    patchCase(caseNo, (entry) => {
      entry.sources.pdfDeadlines = {
        key: 'pdfDeadlines',
        title: 'PDF-derived deadlines',
        status: hints.length ? 'ok' : 'empty',
        fetchedAt: Date.now(),
        parserVersion: VERSION,
        transport: 'fetch+pdfjs',
        data: { hints: dedupe(hints, (h) => `${h.label}|${h.dateStr}`), scanned },
      };
    });

    addLog(caseNo, hints.length ? 'ok' : 'info', `PDF deadline parse ${hints.length ? `found ${hints.length} hint(s)` : 'found no explicit hints'}`, { source: 'pdfDeadlines' });
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
              parserVersion: VERSION,
              url,
              transport: 'fetch',
              data: parsed,
            };
            if (src.key === 'main') {
              c.meta = c.meta || {};
              c.meta.lastMainStatusRaw = String(parsed?.statusRaw || '');
              c.meta.lastMainStage = String(parsed?.statusStage || inferStatusStage(parsed?.statusRaw || '') || '');
            }
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
              parserVersion: VERSION,
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

        try {
          await refreshPdfDeadlines(caseNo, controller.signal, force);
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

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
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

  function inferProceduralDeadlines(main, docs, eventHistory = {}, legal = {}, pdfData = {}) {
    const out = [];
    const sortedDocs = [...(docs || [])].sort(compareDateDesc);
    const sortedEvents = dedupe([...(eventHistory.events || []), ...(legal.events || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}`).sort(compareDateDesc);
    const records = dedupe([
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

    const appType = normalize(main.applicationType || '').toLowerCase();
    const isEuroPct = /e\/pct/.test(appType);
    const isDivisional = /divisional/.test(appType);

    const pdfHints = (Array.isArray(pdfData?.hints) ? pdfData.hints : [])
      .map((h) => ({
        ...h,
        date: parseDateString(h.dateStr),
      }))
      .filter((h) => h.date);

    const hasPdfHint = (regex) => pdfHints.some((h) => regex.test(String(h.label || '')));

    const push = (entry) => {
      if (!entry?.date || Number.isNaN(entry.date.getTime())) return;
      out.push(entry);
    };

    const latestRecord = (regex) => records.find((r) => regex.test(`${r.title || ''} ${r.detail || ''}`));

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

    for (const hint of pdfHints) {
      push({
        label: String(hint.label || 'PDF-derived deadline'),
        date: hint.date,
        level: String(hint.level || 'bad'),
        confidence: String(hint.confidence || 'high'),
        sourceDate: String(hint.sourceDate || ''),
        resolved: !!hint.resolved,
        fromPdf: true,
        method: String(hint.evidence || 'PDF parse'),
      });
    }

    // Core prosecution communications (notification-based, computed as calendar-month periods)
    addMonthsDeadline({
      triggerRegex: /rule\s*71\(3\)|intention to grant|text intended for grant/i,
      label: 'R71(3) response period',
      months: 4,
      level: 'bad',
      confidence: 'high',
      resolvedBy: (anchor) => hasFeeSignalAfter(anchor, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections/i) || hasApplicantResponseAfter(anchor),
    });

    addMonthsDeadline({
      triggerRegex: /article\s*94\(3\)|art\.\s*94\(3\)|communication from (?:the )?examining/i,
      label: 'Art. 94(3) response period',
      months: 4,
      level: 'warn',
      confidence: 'medium',
    });

    addMonthsDeadline({
      triggerRegex: /rule\s*70\(2\)|confirm.*proceed|wish to proceed|proceed further/i,
      label: 'Rule 70(2) confirmation/response period',
      months: 6,
      level: 'warn',
      confidence: 'high',
    });

    addMonthsDeadline({
      triggerRegex: /rule\s*161|rule\s*162|communication pursuant to rule 161|rules?\s*161.*162/i,
      label: 'Rule 161/162 response period',
      months: 6,
      level: 'bad',
      confidence: 'high',
      resolvedBy: (anchor) => hasApplicantResponseAfter(anchor, /reply|response|amend|claims|observations|arguments/i) || hasFeeSignalAfter(anchor, /claims fee|fee payment received/i),
    });

    // EP direct/divisional: 6 months from ESR publication mention for exam/designation/search-opinion response bundle.
    if (!isEuroPct) {
      const esrMention = latestRecord(/mention of publication of (?:the )?european search report|publication of (?:the )?european search report/i);
      if (esrMention) {
        const anchor = parseDateString(esrMention.dateStr);
        if (anchor) {
          const calc = addCalendarMonthsDetailed(anchor, 6);
          push({
            label: `${isDivisional ? 'Divisional ' : ''}exam/designation + search-opinion bundle`,
            date: calc.date,
            level: 'bad',
            confidence: 'high',
            sourceDate: esrMention.dateStr,
            resolved: hasFeeSignalAfter(anchor, /request for examination|examination fee|designation fee|extension fee|validation fee|fee payment received/i) || hasApplicantResponseAfter(anchor),
            method: 'Rule-based: +6 months from ESR publication mention',
            rolledOver: calc.rolledOver,
            rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
          });
        }
      }
    }

    // Euro-PCT later-of formula for exam/designation and core 31-month entry stop.
    const priorityDate = main.priorities?.[0] ? parseDateString(main.priorities[0].dateStr) : null;
    const filingDate = parseDateString(main.filingDate);
    const base31Date = priorityDate || filingDate;

    if (isEuroPct && base31Date) {
      const calc31 = addCalendarMonthsDetailed(base31Date, 31);
      const due31 = calc31.date;
      const isr = latestRecord(/international search report|\bisr\b|written opinion/i);
      const isrDate = parseDateString(isr?.dateStr || '');
      const calcIsr = isrDate ? addCalendarMonthsDetailed(isrDate, 6) : null;
      const isrPlus6 = calcIsr?.date || null;
      const dueLater = isrPlus6 && isrPlus6 > due31 ? isrPlus6 : due31;
      const dueLaterRolled = isrPlus6 && isrPlus6 > due31 ? !!calcIsr?.rolledOver : calc31.rolledOver;
      const dueLaterRollNote = isrPlus6 && isrPlus6 > due31
        ? (calcIsr?.rolledOver ? `day ${calcIsr.fromDay}→${calcIsr.toDay}` : '')
        : (calc31.rolledOver ? `day ${calc31.fromDay}→${calc31.toDay}` : '');

      push({
        label: 'Euro-PCT entry acts (31-month stop)',
        date: due31,
        level: 'bad',
        confidence: 'high',
        sourceDate: priorityDate ? main.priorities?.[0]?.dateStr || '' : main.filingDate || '',
        resolved: hasFeeSignalAfter(base31Date, /translation|entry into european phase|rule 159|filing fee|page fee|request for examination/i),
        method: 'Rule-based: priority/filing date +31 months',
        rolledOver: calc31.rolledOver,
        rolloverNote: calc31.rolledOver ? `day ${calc31.fromDay}→${calc31.toDay}` : '',
      });

      push({
        label: 'Euro-PCT exam/designation deadline (later-of formula)',
        date: dueLater,
        level: 'bad',
        confidence: isrDate ? 'high' : 'medium',
        sourceDate: isrDate ? `${formatDate(base31Date)} / ${isr?.dateStr || ''}` : formatDate(base31Date),
        resolved: hasFeeSignalAfter(base31Date, /request for examination|examination fee|designation fee|extension fee|validation fee/i),
        method: isrDate ? 'Rule-based: max(31 months from priority/filing, ISR +6 months)' : 'Rule-based: 31 months from priority/filing (ISR date unavailable)',
        rolledOver: dueLaterRolled,
        rolloverNote: dueLaterRollNote,
      });
    }

    // Post-grant monitors.
    const grantMention = latestRecord(/mention of grant|patent has been granted|granted/i);
    if (grantMention) {
      const anchor = parseDateString(grantMention.dateStr);
      if (anchor) {
        const calcOpp = addCalendarMonthsDetailed(anchor, 9);
        push({
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
        push({
          label: 'Unitary effect request window',
          date: calcUe.date,
          level: 'warn',
          confidence: 'high',
          sourceDate: grantMention.dateStr,
          resolved: hasAfter(anchor, (r) => /unitary effect/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: grant mention +1 month',
          rolledOver: calcUe.rolledOver,
          rolloverNote: calcUe.rolledOver ? `day ${calcUe.fromDay}→${calcUe.toDay}` : '',
        });
      }
    }

    // Appeal windows from decisions.
    const decision = latestRecord(/\bdecision\b.*(?:refus|grant|revok|maintain)|\bdecision\b/i);
    if (decision) {
      const anchor = parseDateString(decision.dateStr);
      if (anchor) {
        const calcNotice = addCalendarMonthsDetailed(anchor, 2);
        push({
          label: 'Appeal notice + fee',
          date: calcNotice.date,
          level: 'bad',
          confidence: 'high',
          sourceDate: decision.dateStr,
          resolved: hasAfter(anchor, (r) => /notice of appeal|appeal fee/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: decision date +2 months',
          rolledOver: calcNotice.rolledOver,
          rolloverNote: calcNotice.rolledOver ? `day ${calcNotice.fromDay}→${calcNotice.toDay}` : '',
        });
        const calcGrounds = addCalendarMonthsDetailed(anchor, 4);
        push({
          label: 'Appeal grounds',
          date: calcGrounds.date,
          level: 'bad',
          confidence: 'high',
          sourceDate: decision.dateStr,
          resolved: hasAfter(anchor, (r) => /grounds of appeal|statement of grounds/i.test(`${r.title} ${r.detail}`)),
          method: 'Rule-based: decision date +4 months',
          rolledOver: calcGrounds.rolledOver,
          rolloverNote: calcGrounds.rolledOver ? `day ${calcGrounds.fromDay}→${calcGrounds.toDay}` : '',
        });
      }
    }

    // Priority + patent-term references.
    if (priorityDate) {
      const calcPriority = addCalendarMonthsDetailed(priorityDate, 12);
      const due = calcPriority.date;
      if (due > new Date()) {
        push({
          label: 'Priority year ends',
          date: due,
          level: 'warn',
          confidence: 'high',
          sourceDate: main.priorities?.[0]?.dateStr || '',
          resolved: false,
          method: 'Rule-based: earliest priority date +12 months',
          rolledOver: calcPriority.rolledOver,
          rolloverNote: calcPriority.rolledOver ? `day ${calcPriority.fromDay}→${calcPriority.toDay}` : '',
        });
      }
    }

    if (filingDate) {
      const calcTerm = addCalendarMonthsDetailed(filingDate, 12 * 20);
      push({
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

    return dedupe(out, (d) => `${d.label}|${formatDate(d.date)}|${d.sourceDate || ''}`);
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

  function overviewModel(caseNo) {
    const c = getCase(caseNo);
    const main = c.sources.main?.data || {};
    const doclist = c.sources.doclist?.data || {};
    const family = c.sources.family?.data || {};
    const legal = c.sources.legal?.data || {};
    const eventHistory = c.sources.event?.data || {};
    const ue = c.sources.ueMain?.data || {};
    const upcRegistry = c.sources.upcRegistry?.data || null;
    const pdfDeadlines = c.sources.pdfDeadlines?.data || {};

    const docs = [...(doclist.docs || [])].sort(compareDateDesc);
    const latestEpo = docs.find((d) => d.actor === 'EPO' && d.bundle !== 'Other') || docs.find((d) => d.actor === 'EPO') || null;
    const applicantDocs = docs.filter((d) => d.actor === 'Applicant');
    const latestApplicant = applicantDocs.find((d) => d.bundle !== 'Other') || applicantDocs[0] || null;
    const publicationsPrimary = dedupe([...(main.publications || []), ...(family.publications || [])], (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`);
    const publicationFallback = publicationsPrimary.length ? [] : inferPublicationsFromDocs(docs);
    const publications = dedupe([...publicationsPrimary, ...publicationFallback], (p) => `${p.no}${p.kind}|${p.dateStr}|${p.role}`).sort(compareDateDesc);

    const storedStatusRaw = c.meta?.lastMainStatusRaw || '';
    const stageText = normalize(main.statusRaw || storedStatusRaw).toLowerCase();
    const statusStage = main.statusStage || c.meta?.lastMainStage || inferStatusStage(stageText);

    const stage = statusStage
      || (docs.some((d) => d.bundle === 'Grant package')
        ? 'Grant / post-grant'
        : docs.some((d) => d.bundle === 'Examination')
          ? 'Examination'
          : docs.some((d) => d.bundle === 'Search package')
            ? 'Search'
            : docs.some((d) => d.bundle === 'Filing package')
              ? 'Filing'
              : 'Unknown');

    const deadlines = inferProceduralDeadlines(main, docs, eventHistory, legal, pdfDeadlines);

    const renewal = inferRenewalModel(main, legal, ue);

    const latestEpoDate = parseDateString(latestEpo?.dateStr);
    const latestApplicantDate = parseDateString(latestApplicant?.dateStr);
    const waitingOn = latestApplicantDate && (!latestEpoDate || latestApplicantDate > latestEpoDate) ? 'EPO' : 'Applicant';
    const waitingDays = waitingOn === 'EPO' && latestApplicantDate ? Math.floor((Date.now() - latestApplicantDate.getTime()) / 86400000) : null;

    const actionableDeadlines = deadlines.filter((d) => !d.reference && !d.resolved);
    const nextDeadline = actionableDeadlines.find((d) => d.date > new Date())
      || actionableDeadlines[0]
      || null;

    const daysToDeadline = nextDeadline ? Math.ceil((nextDeadline.date.getTime() - Date.now()) / 86400000) : null;

    return {
      title: main.title || '—',
      applicant: main.applicant || '—',
      representative: main.representative || '—',
      appNo: caseNo,
      filingDate: main.filingDate || '—',
      priority: main.priorityText || '—',
      stage,
      status: (main.statusRaw || storedStatusRaw || '—').split('\n')[0],
      statusSimple: main.statusSimple || 'Unknown',
      statusLevel: main.statusLevel || 'warn',
      applicationType: main.applicationType || parseApplicationType(main),
      parentCase: main.parentCase || '',
      divisionalChildren: main.divisionalChildren || [],
      hasDivisionals: !!main.hasDivisionals,
      recentMainEvent: main.recentEvents?.[0] || (legal.events || [])[0] || null,
      latestEpo,
      latestApplicant,
      waitingOn,
      waitingDays,
      nextDeadline,
      daysToDeadline,
      publications,
      deadlines: deadlines.sort((a, b) => a.date - b.date),
      renewal,
      upcUe: {
        ueStatus: ue.ueStatus || 'Unknown',
        upcOptOut: upcRegistry ? (upcRegistry.status || (upcRegistry.optedOut ? 'Opted out' : 'No opt-out found')) : (ue.upcOptOut || 'Unknown'),
        note: upcRegistry
          ? `UPC opt-out checked against registry for ${upcRegistry.patentNumber}.`
          : (ue.ueStatus
            ? 'UE/UPC inferred from UP tab and legal data where available.'
            : 'UE/UPC data unavailable in current cache; will populate when source loads.'),
      },
      docs,
    };
  }

  function topLevel(levels) {
    if (levels.includes('bad')) return 'bad';
    if (levels.includes('warn')) return 'warn';
    if (levels.includes('ok')) return 'ok';
    return 'info';
  }

  function sourceStamp(c, key) {
    const src = c?.sources?.[key] || {};
    return `${key}:${src.status || 'na'}:${src.fetchedAt || 0}:${src.parserVersion || ''}`;
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
    const c = getCase(caseNo);
    const cacheKey = timelineCacheKey(caseNo, opts, c);
    if (runtime.timelineCache.key === cacheKey && Array.isArray(runtime.timelineCache.items)) {
      return runtime.timelineCache.items;
    }

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
        actor: 'EPO',
        url: sourceUrl(caseNo, 'main'),
      });
    }

    const docsSorted = [...(doclist.docs || [])].sort(compareDateDesc);
    const groupableBundles = new Set(['Search package', 'Grant package', 'Examination', 'Filing package', 'Applicant filings', 'Response to search']);

    const docItems = [];
    const groupedByKey = new Map();

    for (const d of docsSorted) {
      const actor = d.actor || 'Other';
      const shouldGroup = groupableBundles.has(d.bundle);
      if (!shouldGroup) {
        docItems.push({
          type: 'item',
          dateStr: d.dateStr,
          title: d.title,
          detail: [d.procedure, 'All documents'].filter(Boolean).join(' · '),
          source: 'Documents',
          level: d.level || 'info',
          actor,
          url: d.url,
        });
        continue;
      }

      // Group by exact document date + bundle + actor to avoid fragmented filing-package rows.
      const groupKey = `${d.dateStr || 'nodate'}|${d.bundle}|${actor}`;
      if (!groupedByKey.has(groupKey)) {
        const group = { type: 'group', _key: groupKey, dateStr: d.dateStr, title: d.bundle, source: 'Documents', level: d.level || 'info', actor, items: [] };
        groupedByKey.set(groupKey, group);
        docItems.push(group);
      }

      const group = groupedByKey.get(groupKey);
      group.items.push({ dateStr: d.dateStr, title: d.title, detail: d.procedure || 'All documents', source: 'Documents', level: d.level || 'info', actor, url: d.url });
      group.level = topLevel([group.level, d.level || 'info']);
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
        items.push({ type: 'item', dateStr: e.dateStr, title: e.title, detail: [e.detail, 'Event history'].filter(Boolean).join('\n'), source: 'Event history', level: opts.timelineEventLevel || 'info', actor: 'EPO', url: e.url || sourceUrl(caseNo, 'event') });
      }
    }

    if (opts.showLegalStatusRows) {
      for (const e of legal.events || []) {
        items.push({ type: 'item', dateStr: e.dateStr, title: e.title, detail: [e.detail, 'Legal status'].filter(Boolean).join('\n'), source: 'Legal status', level: opts.timelineLegalLevel || 'warn', actor: 'EPO', url: e.url || sourceUrl(caseNo, 'legal') });
      }
    }

    if (opts.showPublications) {
      for (const p of dedupe([...(main.publications || []), ...(family.publications || [])], (x) => `${x.no}${x.kind}|${x.dateStr}|${x.role}`)) {
        items.push({ type: 'item', dateStr: p.dateStr, title: `${p.no}${p.kind || ''} publication`, detail: p.role || 'Publication', source: 'Publications', level: 'info', actor: 'EPO', url: sourceUrl(caseNo, 'main') });
      }
    }

    const built = dedupe(items, (i) => {
      if (i.type === 'group') return `g|${i.dateStr}|${i.title}|${(i.items || []).map((x) => `${x.title}|${x.url}`).join('||')}`;
      return `i|${i.dateStr}|${i.title}|${i.detail}|${i.url}`;
    }).sort(compareDateDesc).slice(0, opts.timelineMaxEntries);

    runtime.timelineCache = { key: cacheKey, items: built };
    return built;
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
      ${m.divisionalChildren?.length ? `<div class="epoRP-l">Divisionals</div><div class="epoRP-v">${m.divisionalChildren.map((ep) => `<a class="epoRP-a" href="${esc(sourceUrl(ep, 'main'))}">${esc(ep)}</a>`).join(', ')}</div>` : ''}
      <div class="epoRP-l">Stage</div><div class="epoRP-v">${esc(m.stage)}</div>
      <div class="epoRP-l">Representative</div><div class="epoRP-v">${esc(m.representative)}</div>
    </div></div>`;

    if (m.deadlines.length) {
      html += `<div class="epoRP-c"><h4>Deadlines & clocks</h4><div class="epoRP-dl">`;
      for (const d of m.deadlines) {
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
        html += `<div class="epoRP-dr"><div class="epoRP-dn">${esc(d.label)}</div><div class="epoRP-dd"><span class="epoRP-bdg ${esc(proximity)}">${esc(ds)}${Number.isFinite(dd) ? ` · ${dd >= 0 ? formatDaysHuman(dd) : `${formatDaysHuman(dd).slice(1)} overdue`}` : ''}</span>${!d.reference ? `<div class="epoRP-m">${esc(`(${metaParts.join(' · ')})`)}</div>` : ''}</div></div>`;
      }
      html += `</div><div class="epoRP-m">Procedural due dates are heuristic unless the Register provides explicit legal due dates.</div></div>`;
    }

    const nextDeadlineMeta = m.nextDeadline
      ? [
        `From ${m.nextDeadline.sourceDate || 'procedural event'}`,
        m.nextDeadline.confidence ? `${m.nextDeadline.confidence} confidence` : '',
        m.nextDeadline.method || '',
        m.nextDeadline.rolledOver ? `rolled over${m.nextDeadline.rolloverNote ? ` (${m.nextDeadline.rolloverNote})` : ''}` : '',
        m.nextDeadline.resolved ? 'responded' : '',
      ].filter(Boolean).join(' · ')
      : '';

    const nextDeadlineBadge = m.daysToDeadline != null
      ? `<span class="epoRP-bdg ${m.daysToDeadline < 0 ? 'bad' : m.daysToDeadline <= 14 ? 'bad' : m.daysToDeadline <= 45 ? 'warn' : 'ok'}">${m.daysToDeadline >= 0 ? formatDaysHuman(m.daysToDeadline) : `${formatDaysHuman(m.daysToDeadline).slice(1)} overdue`}</span>`
      : '';

    html += `<div class="epoRP-c"><h4>Actionable status</h4><div class="epoRP-g">
      <div class="epoRP-l">Next deadline</div><div class="epoRP-v">${m.nextDeadline ? `${esc(formatDate(m.nextDeadline.date))} · ${esc(m.nextDeadline.label)}${nextDeadlineBadge ? ` · ${nextDeadlineBadge}` : ''}${nextDeadlineMeta ? `<div class="epoRP-m">${esc(`(${nextDeadlineMeta})`)}</div>` : ''}` : '—'}</div>
      <div class="epoRP-l">EPO last action</div><div class="epoRP-v">${m.latestEpo ? `${esc(m.latestEpo.dateStr)} · ${esc(m.latestEpo.title)}` : '—'}</div>
      <div class="epoRP-l">Applicant last filing</div><div class="epoRP-v">${m.latestApplicant ? `${esc(m.latestApplicant.dateStr)} · ${esc(m.latestApplicant.title)}` : '—'}</div>
      ${m.waitingOn === 'EPO' ? `<div class="epoRP-l">Days since applicant response</div><div class="epoRP-v">${m.waitingDays != null ? `<span class="epoRP-bdg ${m.waitingDays > 365 ? 'bad' : m.waitingDays > 180 ? 'warn' : 'ok'}">${formatDaysHuman(m.waitingDays)}</span>` : '—'}</div>` : ''}
    </div></div>`;

    if (opts.showRenewals) {
      const filingDateObj = parseDateString(m.filingDate);
      const yearsFromFiling = filingDateObj ? Math.max(0, Math.floor((Date.now() - filingDateObj.getTime()) / (365.25 * 86400000))) : null;
      const patentYearFromFiling = yearsFromFiling != null ? yearsFromFiling + 1 : null;
      const nextDueDays = m.renewal.nextDue ? Math.ceil((m.renewal.nextDue.getTime() - Date.now()) / 86400000) : null;
      const dueLevel = nextDueDays == null ? 'info' : (nextDueDays < 0 ? 'bad' : nextDueDays <= 30 ? 'bad' : nextDueDays <= 75 ? 'warn' : 'ok');
      const dueText = m.renewal.nextDue
        ? `${esc(formatDate(m.renewal.nextDue))}${nextDueDays != null ? ` · ${nextDueDays >= 0 ? formatDaysHuman(nextDueDays) : `${formatDaysHuman(nextDueDays).slice(1)} overdue`}` : ''}`
        : 'Not available';
      const graceText = m.renewal.graceUntil
        ? `${esc(formatDate(m.renewal.graceUntil))}${m.renewal.dueState === 'grace' ? ' (surcharge period active)' : ''}`
        : '—';

      html += `<div class="epoRP-c"><h4>Renewals</h4><div class="epoRP-g">
        <div class="epoRP-l">Patent year status</div><div class="epoRP-v">${patentYearFromFiling ? `Current year ${patentYearFromFiling}${m.renewal.highestYear ? ` · paid through Year ${m.renewal.highestYear}` : ''}` : (m.renewal.highestYear ? `Paid through Year ${m.renewal.highestYear}` : 'No renewal payment captured yet')}</div>
        <div class="epoRP-l">Fee forum</div><div class="epoRP-v">${esc(m.renewal.feeForum || 'Unknown')}</div>
        <div class="epoRP-l">Next fee year / due</div><div class="epoRP-v">${m.renewal.nextYear ? `Year ${m.renewal.nextYear} · ` : ''}${m.renewal.nextDue ? `<span class="epoRP-bdg ${dueLevel}">${dueText}</span>` : dueText}</div>
        <div class="epoRP-l">Grace period until</div><div class="epoRP-v">${graceText}</div>
        <div class="epoRP-l">Model confidence</div><div class="epoRP-v">${esc(m.renewal.confidence || 'low')}</div>
        <div class="epoRP-l">Latest renewal</div><div class="epoRP-v">${m.renewal.latest ? `${esc(m.renewal.latest.dateStr)} · ${esc(m.renewal.latest.title)}` : 'No renewal events cached.'}</div>
        ${m.renewal.mentionGrantDate ? `<div class="epoRP-l">Mention of grant</div><div class="epoRP-v">${esc(m.renewal.mentionGrantDate)}</div>` : ''}
      </div><div class="epoRP-m">${esc(m.renewal.explanatoryBasis)}</div></div>`;
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
    const openGroups = getTimelineOpenGroups(caseNo);

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
        const openAttr = openGroups.has(groupKey) ? ' open' : '';
        out.push(`<details class="epoRP-grp" data-group-key="${esc(groupKey)}"${openAttr}>
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
      ${checkbox('epoRP-opt-preload', 'preloadAllTabs', 'Preload all case tabs in background', 'Loads main/doclist/event/family/legal/ueMain in background and fills cache.')}
      ${checkbox('epoRP-opt-pubs', 'showPublications', 'Show publications on timeline', 'Includes publication entries from main + family sources.')}
      ${checkbox('epoRP-opt-events', 'showEventHistory', 'Show event-history rows', 'Includes EP Event history source rows in timeline.')}
      ${checkbox('epoRP-opt-legal', 'showLegalStatusRows', 'Show legal-status rows', 'Includes EP Legal status rows in timeline.')}
      ${checkbox('epoRP-opt-ren', 'showRenewals', 'Show renewals panel', 'Displays pre-/post-grant and UE-sensitive renewal explanation in Overview.')}
      ${checkbox('epoRP-opt-upc', 'showUpcUe', 'Show UPC/UE panel', 'Displays inferred UE + UPC opt-out state with notes.')}
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
        <div class="epoRP-oh">Live sidebar activity for this application (latest 120 entries).</div>
        <div class="epoRP-log" id="epoRP-log-console">${renderLogConsole(caseNo)}</div>
      </div>
    </div>`;
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

  function wireTimeline(caseNo) {
    const b = runtime.body;
    if (!b) return;

    const openGroups = getTimelineOpenGroups(caseNo);
    b.querySelectorAll('details.epoRP-grp[data-group-key]').forEach((el) => {
      el.addEventListener('toggle', () => {
        const key = String(el.getAttribute('data-group-key') || '');
        if (!key) return;
        if (el.open) openGroups.add(key);
        else openGroups.delete(key);
        setTimelineOpenGroups(caseNo, openGroups);
      });
    });
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
      document.body.classList.remove('epoRP-shifted');
      return;
    }

    const previousCaseNo = runtime.appNo;
    const previousView = runtime.activeView || 'overview';
    if (runtime.body && previousCaseNo && !runtime.collapsed) {
      setPanelScroll(previousCaseNo, previousView, runtime.body.scrollTop || 0);
      if (previousView === 'timeline') persistLiveTimelineGroups(previousCaseNo);
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
    if (activeView === 'timeline') {
      body.innerHTML = renderTimeline(caseNo);
      wireTimeline(caseNo);
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
      renderPanel();
      return;
    }

    const caseNo = detectAppNo();
    const changed = runtime.appNo !== caseNo;
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
    .epoRP-ver{font-size:11px;font-weight:700;color:#64748b;margin-left:4px}
    .epoRP-st{font-size:11px;color:#475569}
    .epoRP-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px;padding:4px;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:10px}
    .epoRP-tab{display:flex;align-items:center;justify-content:center;gap:5px;border:1px solid transparent;background:transparent;color:#334155;border-radius:8px;padding:5px 6px;font-size:11px;font-weight:700;cursor:pointer;line-height:1}
    .epoRP-tab:hover{background:#f8fafc;border-color:#cbd5e1}
    .epoRP-tab.on{background:#1d4ed8;color:#fff;border-color:#1d4ed8;box-shadow:0 1px 0 rgba(15,23,42,.15)}
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
    tr.epoRP-docgrp-item.epoRP-docgrp-last.epoRP-docgrp-open td{border-bottom:2px solid #bfdbfe}
    tr.epoRP-docgrp-item.collapsed{display:none}
    .epoRP-doclist-filter-wrap{margin:8px 0}
    .epoRP-doclist-filter{width:100%;max-width:420px;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .epoRP-filter-hidden{display:none !important}
  `);

  setInterval(() => {
    if (location.href !== runtime.href) {
      runtime.href = location.href;
      init(false);
    }
  }, 1000);

  addEventListener('storage', (event) => {
    if (![CACHE_KEY, OPTIONS_KEY, UI_KEY].includes(event.key)) return;
    if (event.key === CACHE_KEY) memory = null;
    if (event.key === OPTIONS_KEY) optionsShadow = null;
    if (isCasePage()) renderPanel();
  });

  addEventListener('focus', () => {
    if (!isCasePage()) return;
    enhanceDoclistGrouping();
    const needsRefresh = SOURCES.some((s) => !isFresh(getCase(runtime.appNo).sources[s.key], options().refreshHours));
    if (needsRefresh) {
      renderPanel();
      prefetchCase(runtime.appNo, false);
      return;
    }
    if (runtime.activeView !== 'timeline') renderPanel();
  });

  document.addEventListener('visibilitychange', () => {
    if (!isCasePage()) return;

    if (document.visibilityState === 'hidden') {
      persistCurrentPanelScroll();
      if (runtime.appNo && runtime.activeView === 'timeline') persistLiveTimelineGroups(runtime.appNo);
      if (runtime.appNo) persistLiveDoclistGroups(runtime.appNo);
      return;
    }

    if (document.visibilityState !== 'visible') return;
    enhanceDoclistGrouping();
    if (runtime.activeView !== 'timeline') renderPanel();
  });

  addEventListener('pageshow', () => init(false));
  addEventListener('beforeunload', () => {
    if (runtime.scrollSaveTimer) {
      clearTimeout(runtime.scrollSaveTimer);
      runtime.scrollSaveTimer = null;
    }
    persistCurrentPanelScroll();
    if (runtime.appNo && runtime.activeView === 'timeline') persistLiveTimelineGroups(runtime.appNo);
    if (runtime.appNo) persistLiveDoclistGroups(runtime.appNo);
    flushNow();
  });

  init(false);
})();
