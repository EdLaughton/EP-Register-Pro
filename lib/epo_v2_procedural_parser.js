const { EPO_CODEX_DATA } = require('./epo_codex_data');
const { DATE_RE, normalize, text, compareDateDesc } = require('./epo_v2_doclist_parser');

function dedupe(items = [], keyFn = (item) => item) {
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

function normalizeCodexDescription(value = '') {
  return normalize(value).toLowerCase();
}

function normalizeStructuredLabel(value = '') {
  return normalize(value).toLowerCase().replace(/[_-]+/g, ' ');
}

function normalizeStructuredDate(value = '') {
  const raw = normalize(value);
  if (!raw) return '';
  const compact = raw.match(/^(19|20)\d{6}$/)?.[0] || '';
  if (compact) return `${compact.slice(6, 8)}.${compact.slice(4, 6)}.${compact.slice(0, 4)}`;
  const dated = raw.match(/(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})/);
  if (!dated) return '';
  const dd = String(dated[1] || '').padStart(2, '0');
  const mm = String(dated[2] || '').padStart(2, '0');
  const yyRaw = String(dated[3] || '');
  const yyyy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  return `${dd}.${mm}.${yyyy}`;
}

function parseSmallNumberToken(token = '') {
  const t = normalize(String(token || '')).toLowerCase();
  if (!t) return 0;
  if (/^\d{1,2}$/.test(t)) return Number(t);
  return {
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
  }[t] || 0;
}

function parseStructuredTimeLimit(value = '') {
  const raw = normalize(value);
  if (!raw) return { raw: '', months: 0, dateStr: '' };
  const dateStr = normalizeStructuredDate(raw);
  const monthToken = raw.match(/(?:within\s+)?(?:a\s+)?(?:period|time\s+limit)?\s*(?:of\s+)?([a-z]+|\d{1,2})\s+months?/i)?.[1] || '';
  const months = parseSmallNumberToken(monthToken);
  return { raw, months, dateStr };
}

function legalCodeRecord(code) {
  return code ? (EPO_CODEX_DATA.byCode[String(code).toUpperCase()] || null) : null;
}

function codexDescriptionRecord(description = '') {
  const key = normalizeCodexDescription(description);
  return key ? (EPO_CODEX_DATA.byDescription[key] || null) : null;
}

function normalizeCodexSignal(raw = {}) {
  const sourceCode = normalize(raw.sourceCode || '').toUpperCase();
  const sourceDescription = normalize(raw.sourceDescription || '');
  const exact = legalCodeRecord(sourceCode);
  if (exact) return { ...raw, matchStrategy: 'exact-code', codexRecord: exact };
  const fallback = codexDescriptionRecord(sourceDescription);
  if (fallback) return { ...raw, matchStrategy: 'description-fallback', codexRecord: fallback };
  return { ...raw, matchStrategy: 'unmapped', codexRecord: null };
}

function createParseStats(source = 'procedural') {
  return {
    source,
    rowsSeen: 0,
    rowsAccepted: 0,
    rowsDropped: 0,
    rowsDroppedByReason: {},
  };
}

function noteParseDrop(parseStats, reason = 'unknown') {
  if (!parseStats) return;
  parseStats.rowsDropped += 1;
  parseStats.rowsDroppedByReason[reason] = (parseStats.rowsDroppedByReason[reason] || 0) + 1;
}

function attachParseStats(result, parseStats) {
  Object.defineProperty(result, 'parseStats', {
    value: parseStats,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return result;
}

function parseDatedRowsFromDocument(doc, url = '') {
  const parseStats = createParseStats('procedural-rows');
  const rows = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('th,td')].map(text).filter(Boolean);
    if (cells.length < 2) continue;
    const dateCell = cells.find((value) => DATE_RE.test(value));
    if (!dateCell) continue;
    parseStats.rowsSeen += 1;
    const dateStr = dateCell.match(DATE_RE)[1];
    let payload = cells.filter((value, idx) => {
      if (idx === 0 && DATE_RE.test(value)) return false;
      return !/^(date|event|status|publication|document|document type)$/i.test(value);
    });
    if (!payload[0]) {
      noteParseDrop(parseStats, 'missing-payload');
      continue;
    }
    if (/^event\s*date\s*:?$/i.test(payload[0]) && payload[1]) payload = payload.slice(1);
    if (!payload[0] || /^\d{2}\.\d{2}\.\d{4}$/.test(payload[0])) {
      noteParseDrop(parseStats, 'missing-title');
      continue;
    }
    rows.push({ dateStr, title: payload[0], detail: payload.slice(1).join(' · '), url });
  }
  const deduped = dedupe(rows, (row) => `${row.dateStr}|${row.title}|${row.detail}`).sort(compareDateDesc);
  parseStats.rowsAccepted = deduped.length;
  if (rows.length > deduped.length) {
    const duplicateCount = rows.length - deduped.length;
    parseStats.rowsDropped += duplicateCount;
    parseStats.rowsDroppedByReason.duplicate = (parseStats.rowsDroppedByReason.duplicate || 0) + duplicateCount;
  }
  return attachParseStats(deduped, parseStats);
}

function extractLegalEventBlocksFromDocument(doc, url = '') {
  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    if (!current.codexKey && current.title) {
      const matched = normalizeCodexSignal({ sourceDescription: current.title });
      current.matchStrategy = current.matchStrategy || matched.matchStrategy;
      if (matched.codexRecord) {
        current.codexKey = matched.codexRecord.internalKey;
        current.codexPhase = matched.codexRecord.phase;
        current.codexClass = matched.codexRecord.classification;
      }
    }
    if (current.paymentDates?.length) current.paymentDate = current.paymentDates[current.paymentDates.length - 1] || '';
    if (current.dateStr || current.title || current.detail) blocks.push(current);
    current = null;
  };

  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th,td')].map(text).filter(Boolean);
    if (!cells.length) continue;
    const label = cells[0];
    const value = normalize(cells.slice(1).join(' · '));
    const labelKey = normalizeStructuredLabel(label);

    if (/^event date:?$/i.test(label) && DATE_RE.test(value)) {
      pushCurrent();
      current = {
        dateStr: value.match(DATE_RE)?.[1] || '',
        title: '',
        detail: '',
        url,
        freeFormatText: '',
        effectiveDate: '',
        originalCode: '',
        codexKey: '',
        codexPhase: '',
        codexClass: '',
        stepDescriptionName: '',
        dispatchDate: '',
        replyDate: '',
        paymentDate: '',
        paymentDates: [],
        requestDate: '',
        resultDate: '',
        timeLimitRaw: '',
        timeLimitMonths: 0,
        timeLimitDate: '',
      };
      continue;
    }

    if (!current) continue;
    if (/^event description:?$/i.test(label)) {
      current.title = value;
      continue;
    }
    if (/^free format text:?$/i.test(label)) {
      current.freeFormatText = value;
      current.detail = current.detail ? `${current.detail} · ${value}` : value;
      const originalCode = normalize(value.match(/ORIGINAL CODE:\s*([A-Z0-9]+)/i)?.[1] || '').toUpperCase();
      const matched = normalizeCodexSignal({ sourceCode: originalCode, sourceDescription: current.title || value });
      if (originalCode) current.originalCode = originalCode;
      current.matchStrategy = matched.matchStrategy;
      if (matched.codexRecord) {
        current.codexKey = matched.codexRecord.internalKey;
        current.codexPhase = matched.codexRecord.phase;
        current.codexClass = matched.codexRecord.classification;
      }
      continue;
    }
    if (/^effective date:?$/i.test(label)) {
      current.effectiveDate = normalizeStructuredDate(value) || value;
      current.detail = current.detail ? `${current.detail} · Effective DATE ${value}` : `Effective DATE ${value}`;
      continue;
    }
    if (/^original code:?$/i.test(label)) {
      const originalCode = value.toUpperCase();
      const matched = normalizeCodexSignal({ sourceCode: originalCode, sourceDescription: current.title || current.detail || value });
      current.originalCode = originalCode;
      current.matchStrategy = matched.matchStrategy;
      if (matched.codexRecord) {
        current.codexKey = matched.codexRecord.internalKey;
        current.codexPhase = matched.codexRecord.phase;
        current.codexClass = matched.codexRecord.classification;
      }
      continue;
    }
    if (/^step description name:?$/.test(labelKey)) {
      current.stepDescriptionName = value;
      continue;
    }
    if (/^date of dispatch:?$/.test(labelKey) || /^dispatch date:?$/.test(labelKey)) {
      current.dispatchDate = normalizeStructuredDate(value) || value;
      continue;
    }
    if (/^date of reply:?$/.test(labelKey)) {
      current.replyDate = normalizeStructuredDate(value) || value;
      continue;
    }
    if (/^date of payment\d*:?$/.test(labelKey) || /^date of payment:?$/.test(labelKey)) {
      const dateStr = normalizeStructuredDate(value) || value;
      if (dateStr) current.paymentDates.push(dateStr);
      current.paymentDate = current.paymentDates[current.paymentDates.length - 1] || '';
      continue;
    }
    if (/^date of request:?$/.test(labelKey)) {
      current.requestDate = normalizeStructuredDate(value) || value;
      continue;
    }
    if (/^result date:?$/.test(labelKey)) {
      current.resultDate = normalizeStructuredDate(value) || value;
      continue;
    }
    if (/^time limit:?$/.test(labelKey) || /^time limit in record:?$/.test(labelKey) || /^time limit value:?$/.test(labelKey)) {
      const parsed = parseStructuredTimeLimit(value);
      current.timeLimitRaw = parsed.raw;
      current.timeLimitMonths = parsed.months;
      current.timeLimitDate = parsed.dateStr;
      continue;
    }
  }

  pushCurrent();
  return dedupe(blocks, (event) => `${event.dateStr}|${event.title}|${event.detail}|${event.originalCode}|${event.dispatchDate}|${event.timeLimitRaw}`).sort(compareDateDesc);
}

function parseEventHistoryFromDocument(doc, url = '') {
  const rawEvents = parseDatedRowsFromDocument(doc, url);
  const events = rawEvents.map((event) => {
    const matched = normalizeCodexSignal({ sourceDescription: event.title || '' });
    if (!matched.codexRecord) return event;
    return {
      ...event,
      codexKey: matched.codexRecord.internalKey,
      codexPhase: matched.codexRecord.phase,
      codexClass: matched.codexRecord.classification,
      matchStrategy: matched.matchStrategy,
    };
  });
  return {
    events,
    parseStats: { ...(rawEvents.parseStats || createParseStats('event')), source: 'event' },
  };
}

function parseLegalFromDocument(doc, url = '') {
  const events = parseDatedRowsFromDocument(doc, url);
  const codedEvents = extractLegalEventBlocksFromDocument(doc, url);
  const renewals = [];
  for (const event of events) {
    const low = `${event.title} ${event.detail}`.toLowerCase();
    if (!/renewal|annual fee|year\s*\d+/.test(low)) continue;
    const ym = low.match(/year\s*(\d+)/i) || low.match(/(\d+)(?:st|nd|rd|th)\s*year/i);
    renewals.push({ dateStr: event.dateStr, title: event.title, detail: event.detail, year: ym ? +ym[1] : null });
  }
  return {
    events,
    codedEvents,
    renewals: renewals.sort(compareDateDesc),
    parseStats: { ...(events.parseStats || createParseStats('legal')), source: 'legal' },
  };
}

module.exports = {
  normalizeCodexDescription,
  normalizeStructuredLabel,
  normalizeStructuredDate,
  parseSmallNumberToken,
  parseStructuredTimeLimit,
  legalCodeRecord,
  codexDescriptionRecord,
  normalizeCodexSignal,
  parseDatedRowsFromDocument,
  extractLegalEventBlocksFromDocument,
  parseEventHistoryFromDocument,
  parseLegalFromDocument,
};
