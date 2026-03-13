const { DATE_RE, normalize, text, compareDateDesc, dedupe } = require('./epo_v2_utils');

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
    const match = no.match(/^(.*?)([A-Z]\d)$/);
    if (match && match[1].length >= 7) {
      no = match[1];
      kind = match[2];
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

  const textValue = String(textBlock || '');
  const numberPattern = '((?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)(?:[\\s.\\-\\/]*[A-Z0-9]){5,18})';
  let match;

  const strictNumberBeforeDate = new RegExp(`\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\b`, 'gi');
  while ((match = strictNumberBeforeDate.exec(textValue)) !== null) {
    push(match[1], match[2], match[3]);
  }

  if (!out.length) {
    const strictDateBeforeNumber = new RegExp(`\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b\\s+${numberPattern}\\b(?:\\s+([A-Z]\\d))?`, 'gi');
    while ((match = strictDateBeforeNumber.exec(textValue)) !== null) {
      push(match[2], match[3], match[1]);
    }
  }

  if (!out.length) {
    const reNumberBeforeDate = new RegExp(`\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?[\\s\\S]{0,50}?\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b`, 'gi');
    while ((match = reNumberBeforeDate.exec(textValue)) !== null) {
      push(match[1], match[2], match[3]);
    }

    const reDateBeforeNumber = new RegExp(`\\b(\\d{2}\\.\\d{2}\\.\\d{4})\\b[\\s\\S]{0,50}?\\b${numberPattern}\\b(?:\\s+([A-Z]\\d))?`, 'gi');
    while ((match = reDateBeforeNumber.exec(textValue)) !== null) {
      push(match[2], match[3], match[1]);
    }
  }

  return dedupe(out, (publication) => `${publication.no}${publication.kind}|${publication.dateStr}|${publication.role}`);
}

function bodyText(doc) {
  return normalize(doc?.body?.innerText || doc?.body?.textContent || '');
}

function parseFamilyFromDocument(doc) {
  const publications = [];
  const rows = [...doc.querySelectorAll('tr')];
  let inPublicationBlock = false;

  for (const row of rows) {
    const cells = [...row.querySelectorAll('td,th')].map((cell) => normalize(text(cell)));
    if (!cells.length) continue;

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

  return {
    publications: publications.length
      ? dedupe(publications, (publication) => `${publication.no}${publication.kind}|${publication.dateStr}|${publication.role}`)
      : parsePublications(bodyText(doc), 'Family'),
  };
}

const CITATION_PHASE_ORDER = ['Search', 'International search', 'Examination', 'Opposition', 'Appeal', 'by applicant'];

function parseCitationsFromDocument(doc) {
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
    const categoryMatches = [...raw.matchAll(/\[([A-Z]{1,4})\]/g)].map((match) => String(match[1] || ''));
    const applicant = raw.match(/\(([^)]+)\)/)?.[1] || '';
    entries.push({
      phase: phase || 'Other',
      type: currentType || 'Patent literature',
      publicationNo: String(pubMatch[1] || '').toUpperCase(),
      categories: dedupe(categoryMatches, (category) => category),
      applicant,
      detail: raw,
    });
  }

  const byPhase = {};
  for (const entry of entries) (byPhase[entry.phase] ||= []).push(entry);
  const phases = Object.keys(byPhase)
    .sort((a, b) => {
      const ai = CITATION_PHASE_ORDER.indexOf(a);
      const bi = CITATION_PHASE_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    })
    .map((name) => ({ name, entries: byPhase[name] }));

  return { entries, phases };
}

module.exports = {
  CITATION_PHASE_ORDER,
  normalizePublicationNumber,
  splitPublicationNumber,
  parsePublications,
  parseFamilyFromDocument,
  parseCitationsFromDocument,
};
