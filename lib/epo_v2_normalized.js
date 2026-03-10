const { JSDOM } = require('jsdom');
const { EPO_CODEX_DATA } = require('./epo_codex_data');

const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function text(node) {
  return normalize(node && node.textContent);
}

function normalizeCodexDescription(value = '') {
  return normalize(value).toLowerCase();
}

function legalCodeRecord(code) {
  return code ? (EPO_CODEX_DATA.byCode[String(code).toUpperCase()] || null) : null;
}

function codexDescriptionRecord(description) {
  const key = normalizeCodexDescription(description);
  return key ? (EPO_CODEX_DATA.byDescription[key] || null) : null;
}

function normaliseSignal(raw = {}) {
  const sourceCode = normalize(raw.sourceCode || '').toUpperCase();
  const sourceDescription = normalize(raw.sourceDescription || '');
  const exact = legalCodeRecord(sourceCode);
  if (exact) return { ...raw, matchStrategy: 'exact-code', codexRecord: exact };
  const fallback = codexDescriptionRecord(sourceDescription);
  if (fallback) return { ...raw, matchStrategy: 'pattern-fallback', codexRecord: fallback };
  return { ...raw, matchStrategy: 'unmapped', codexRecord: null };
}

function extractLegalOriginalCode(textValue = '') {
  return normalize(String(textValue || '').match(/ORIGINAL CODE:\s*([A-Z0-9]+)/i)?.[1] || '').toUpperCase();
}

function extractLegalEventBlocks(doc, url = '') {
  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
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
      const originalCode = extractLegalOriginalCode(value);
      const matched = normaliseSignal({ sourceCode: originalCode, sourceDescription: current.title || value });
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
    }
  }

  pushCurrent();
  return blocks;
}

function extractLegalEventBlocksFromHtml(html, url = 'https://register.epo.org/application?number=EP00000000&lng=en&tab=legal') {
  const doc = new JSDOM(html, { url }).window.document;
  return extractLegalEventBlocks(doc, url);
}

function lossReasonLabel(textValue = '') {
  const low = normalize(textValue).toLowerCase();
  if (!low) return '';
  if (/non-entry into european phase/.test(low)) return 'non-entry';
  if (/translations of claims\/payment missing/.test(low)) return 'grant formalities';
  if (/non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(low)) return 'fees / no WO reply';
  if (/non-reply to written opinion/.test(low)) return 'no WO reply';
  return 'generic loss of rights';
}

function deriveCurrentPosture({ main = {}, docs = [], legal = {} } = {}) {
  const statusRaw = normalize(main.statusRaw || '');
  const statusLow = statusRaw.toLowerCase();
  const codedEvents = Array.isArray(legal.codedEvents) ? legal.codedEvents : [];
  const docText = docs.map((doc) => `${doc.title || ''} ${doc.detail || ''}`).join('\n').toLowerCase();
  const legalText = codedEvents.map((event) => `${event.title || ''}\n${event.detail || ''}`).join('\n').toLowerCase();
  const hasKey = (key) => codedEvents.some((event) => event.codexKey === key);

  const signals = {
    grantIntendedSeen: hasKey('GRANT_R71_3_EVENT') || /grant of patent is intended|intention to grant|rule\s*71\(3\)/.test(`${statusLow}\n${legalText}\n${docText}`),
    searchSeen: hasKey('SEARCH_REPORT_PUBLICATION') || /search report|extended european search report/.test(`${statusLow}\n${legalText}\n${docText}`),
    grantSeen: hasKey('EXPECTED_GRANT') || /patent has been granted|the patent has been granted|decision to grant/.test(`${statusLow}\n${legalText}\n${docText}`),
    noOppositionSeen: hasKey('NO_OPPOSITION_FILED') || /no opposition filed within time limit/.test(`${statusLow}\n${legalText}`),
    lossSeen: hasKey('LOSS_OF_RIGHTS_EVENT') || /deemed to be withdrawn|loss of rights|rule\s*112\(1\)/.test(`${statusLow}\n${legalText}\n${docText}`),
    recoverySeen: /further processing|re-establishment/.test(`${legalText}\n${docText}`),
  };

  let currentPosture = 'Needs manual classification';
  if (signals.noOppositionSeen) currentPosture = 'Granted (no opposition)';
  else if (signals.grantSeen) currentPosture = 'Granted';
  else if (signals.grantIntendedSeen) currentPosture = 'Grant intended (R71(3))';
  else if (signals.lossSeen) {
    const reason = lossReasonLabel(`${statusRaw}\n${legalText}\n${docText}`);
    currentPosture = reason === 'generic loss of rights' ? 'Deemed withdrawn' : `Deemed withdrawn (${reason})`;
  } else if (signals.searchSeen) currentPosture = 'Search published';

  const story = [];
  if (signals.grantIntendedSeen) story.push('R71/intention-to-grant');
  if (signals.lossSeen) story.push(`loss-of-rights (${lossReasonLabel(`${statusRaw}\n${legalText}\n${docText}`)})`);
  if (signals.recoverySeen) story.push('further processing / recovery');
  if (signals.grantSeen) story.push('grant');
  if (signals.noOppositionSeen) story.push('no opposition');
  if (!story.length && signals.searchSeen) story.push('search publication');

  return {
    currentPosture,
    signals,
    story: story.join(' → '),
  };
}

module.exports = {
  EPO_CODEX_DATA,
  normalize,
  normalizeCodexDescription,
  legalCodeRecord,
  codexDescriptionRecord,
  normaliseSignal,
  extractLegalOriginalCode,
  extractLegalEventBlocks,
  extractLegalEventBlocksFromHtml,
  lossReasonLabel,
  deriveCurrentPosture,
};
