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

function parseDatedRowsFromDocument(doc, url = '') {
  const rows = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('th,td')].map(text).filter(Boolean);
    if (cells.length < 2) continue;
    const dateCell = cells.find((value) => DATE_RE.test(value));
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
  return dedupe(rows, (row) => `${row.dateStr}|${row.title}|${row.detail}`).sort(compareDateDesc);
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
    if (current.dateStr || current.title || current.detail) blocks.push(current);
    current = null;
  };

  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th,td')].map(text).filter(Boolean);
    if (!cells.length) continue;
    const label = cells[0];
    const value = normalize(cells.slice(1).join(' · '));

    if (/^Event date:?$/i.test(label) && DATE_RE.test(value)) {
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
      };
      continue;
    }

    if (!current) continue;
    if (/^Event description:?$/i.test(label)) {
      current.title = value;
      continue;
    }
    if (/^Free Format Text:?$/i.test(label)) {
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
    if (/^Effective DATE:?$/i.test(label)) {
      current.effectiveDate = value;
      current.detail = current.detail ? `${current.detail} · Effective DATE ${value}` : `Effective DATE ${value}`;
      continue;
    }
    if (/^Original code:?$/i.test(label)) {
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
  }

  pushCurrent();
  return dedupe(blocks, (event) => `${event.dateStr}|${event.title}|${event.detail}|${event.originalCode}`).sort(compareDateDesc);
}

function parseEventHistoryFromDocument(doc, url = '') {
  const events = parseDatedRowsFromDocument(doc, url).map((event) => {
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
  return { events };
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
  return { events, codedEvents, renewals: renewals.sort(compareDateDesc) };
}

module.exports = {
  normalizeCodexDescription,
  legalCodeRecord,
  codexDescriptionRecord,
  normalizeCodexSignal,
  parseDatedRowsFromDocument,
  extractLegalEventBlocksFromDocument,
  parseEventHistoryFromDocument,
  parseLegalFromDocument,
};
