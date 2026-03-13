const { DATE_RE, normalize, text, dedupe } = require('./epo_v2_utils');
const { parsePublications } = require('./epo_v2_reference_parsers');
const { bodyText, fieldByLabel } = require('./epo_v2_territorial_parser');

function dedupeMultiline(raw = '') {
  return String(raw || '')
    .split('\n')
    .map((line) => normalize(line))
    .filter(Boolean)
    .filter((line, idx, arr) => arr.findIndex((other) => other.toLowerCase() === line.toLowerCase()) === idx)
    .join('\n');
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
  return dedupe(sectionRowsByHeader(doc, headerRegex).map((rows) => rows.map((row) => text(row)).join('\n').trim()).filter(Boolean), (value) => value);
}

function parseApplicationField(raw) {
  const match = normalize(raw).match(/(\d{6,10}\.\d)[\s\S]{0,70}?(\d{2}\.\d{2}\.\d{4})\b/);
  return { filingDate: match?.[2] || '' };
}

function pairCandidates(doc) {
  const out = [];
  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th,td')].map(text).map(normalize).filter(Boolean);
    if (cells.length < 2) continue;
    const label = cells[0];
    const value = cells.slice(1).join('\n').trim();
    if (!value) continue;
    out.push({ label, value, lowLabel: label.toLowerCase(), lowValue: value.toLowerCase() });
  }
  for (const dl of doc.querySelectorAll('dl')) {
    const children = [...dl.children];
    for (let i = 0; i < children.length; i++) {
      if (children[i]?.tagName !== 'DT') continue;
      const label = normalize(text(children[i]));
      const values = [];
      for (let j = i + 1; j < children.length && children[j]?.tagName !== 'DT'; j++) {
        if (children[j]?.tagName === 'DD') values.push(normalize(text(children[j])));
      }
      const value = values.filter(Boolean).join('\n').trim();
      if (!value) continue;
      out.push({ label, value, lowLabel: label.toLowerCase(), lowValue: value.toLowerCase() });
    }
  }
  return out;
}

function firstPairValue(doc, predicate) {
  return pairCandidates(doc).find((pair) => predicate(pair))?.value || '';
}

function fallbackAppField(doc, pageText = '') {
  return firstPairValue(doc, ({ value }) => /(\d{6,10}\.\d)[\s\S]{0,70}?(\d{2}\.\d{2}\.\d{4})\b/.test(value))
    || normalize(pageText).match(/(\d{6,10}\.\d[\s\S]{0,70}?\d{2}\.\d{2}\.\d{4})/)?.[1]
    || '';
}

function fallbackPriorityField(doc, pageText = '') {
  return firstPairValue(doc, ({ value, lowLabel }) => !/publication|event|status|title/.test(lowLabel) && /\d{2}\.\d{2}\.\d{4}/.test(value) && /[A-Z]{2}\d+|PCT\/|WO\d{4}|priority/i.test(value))
    || (String(pageText).match(/priority[\s\S]{0,320}/i)?.[0] || '');
}

function fallbackPublicationField(doc, pageText = '') {
  return firstPairValue(doc, ({ value, lowLabel }) => !/priority|event/.test(lowLabel)
      && /\d{2}\.\d{2}\.\d{4}/.test(value)
      && !/\b\d{6,10}\.\d\b/.test(value)
      && (/\b(?:EP\s*\d{6,12}|WO\d{4}[A-Z]{0,2}\d{3,})\b[\s\S]{0,24}\b[A-Z]\d\b/i.test(value) || /\bpublication\b/i.test(value)))
    || firstPairValue(doc, ({ value, lowLabel }) => !/priority|event/.test(lowLabel) && /\d{2}\.\d{2}\.\d{4}/.test(value) && /(WO\d{4}|[AB]\d\b|publication)/i.test(value))
    || (String(pageText).match(/publication[\s\S]{0,360}/i)?.[0] || '');
}

function fallbackRecentEventField(doc) {
  return firstPairValue(doc, ({ value, lowLabel }) => !/publication|priority|applic|represent|title|status|former/.test(lowLabel) && /^\s*\d{2}\.\d{2}\.\d{4}\b/.test(value) && String(value).replace(/^\s*\d{2}\.\d{2}\.\d{4}\b\s*/, '').length >= 8);
}

function fallbackPartyField(doc, kind = 'applicant') {
  const lowKind = String(kind || '').toLowerCase();
  const lowBlock = lowKind === 'representative' ? /(representative|represent|attor|agent|mandat|vertreter|vertret|bevollm|avocat)/i : /(applicant|anmelder|demandeur|antragsteller|inhaber|proprietor)/i;
  const fallback = firstPairValue(doc, ({ label, value }) => lowBlock.test(label) && value.length >= 3);
  if (fallback) return fallback;
  return firstPairValue(doc, ({ value, lowLabel }) => {
    if (/date|priority|publication|event|status|title|number/.test(lowLabel)) return false;
    if (/\d{2}\.\d{2}\.\d{4}/.test(value)) return false;
    if (/\bep\d{6,10}|\d{6,10}\.\d\b/i.test(value)) return false;
    return value.split(/\n+/).filter(Boolean).length >= 1 && value.length >= 8;
  });
}

function parseMainPublications(doc, role = 'EP (this file)') {
  const out = [];
  const push = (rawNo, rawKind, rawDate) => {
    const parsed = parsePublications(`${rawNo} ${rawKind} ${rawDate}`, role)[0];
    if (parsed) out.push(parsed);
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
        if (/^Type:?$/i.test(label)) currentType = value.match(/\b([A-Z]\d)\b/)?.[1] || currentType;
        else if (/^No\.:?$/i.test(label)) currentNo = value;
        else if (/^Date:?$/i.test(label)) {
          currentDate = value;
          flush();
        }
      }
    }

    flush();
  }

  return dedupe(out, (publication) => `${publication.no}${publication.kind}|${publication.dateStr}|${publication.role}`);
}

function extractEpNumbersByHeader(doc, headerRegex) {
  const values = [];
  for (const chunk of sectionTextsByHeader(doc, headerRegex)) {
    for (const match of chunk.matchAll(/\b(EP\d{6,12})(?:\.\d)?\b/gi)) {
      values.push(String(match[1] || '').toUpperCase());
    }
  }
  return dedupe(values, (value) => value);
}

function parsePriority(raw, pageText = '') {
  const out = [];
  const rawText = dedupeMultiline(raw);
  const rawLines = String(rawText || '').split('\n').map((value) => value.trim()).filter(Boolean);

  const push = (no, dateStr) => {
    const n = String(no || '').replace(/\s+/g, '').toUpperCase();
    const d = String(dateStr || '').trim();
    if (!n || !d) return;
    out.push({ no: n, dateStr: d });
  };

  const parseLine = (line, loose = false) => {
    const re = loose
      ? /\b([A-Z]{2}[0-9A-Z/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/i
      : /\b([A-Z]{2}\d[0-9A-Z/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/i;
    const match = String(line || '').match(re);
    if (!match) return null;
    return { no: match[1], dateStr: match[2] };
  };

  for (const line of rawLines) {
    const parsed = parseLine(line, false) || parseLine(line, true);
    if (parsed) push(parsed.no, parsed.dateStr);
  }

  if (!out.length && rawText) {
    for (const match of rawText.matchAll(/\b([A-Z]{2}\d[0-9A-Z/\-]{4,})\b[\s\S]{0,120}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) push(match[1], match[2]);
    if (!out.length) {
      const ids = [...rawText.matchAll(/\b([A-Z]{2}\d[0-9A-Z/\-]{4,})\b/gi)].map((match) => String(match[1] || ''));
      const dates = [...rawText.matchAll(/\b(\d{2}\.\d{2}\.\d{4})\b/g)].map((match) => String(match[1] || ''));
      if (ids[0] && dates[0]) push(ids[0], dates[0]);
    }
  }

  if (!out.length && pageText) {
    const section = String(pageText).match(/Priority\s+number,\s*date([\s\S]{0,500}?)(?=\b(?:Filing language|Procedural language|Publication|Applicant|Representative|Status|Most recent event)\b|$)/i)?.[1] || '';
    for (const match of section.matchAll(/\b([A-Z]{2}\d[0-9A-Z/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) push(match[1], match[2]);
    if (!out.length) {
      for (const match of section.matchAll(/\b([A-Z]{2}[0-9A-Z/\-]{4,})\b[\s\S]{0,80}?\b(\d{2}\.\d{2}\.\d{4})\b/gi)) push(match[1], match[2]);
    }
  }

  return dedupe(out, (item) => `${item.no}|${item.dateStr}`);
}

function normalizeRecentEventEntry(entry) {
  if (!entry || !entry.title) return entry;
  let title = String(entry.title || '').trim();
  const detailParts = entry.detail ? [entry.detail] : [];

  const movedState = title.match(/^(.*?)(\s+New state\(s\):\s*.+)$/i);
  if (movedState?.[1] && movedState?.[2]) {
    title = movedState[1].trim();
    detailParts.unshift(movedState[2].trim());
  }

  const movedPublication = title.match(/^(.*?)(\s+published on\s+\d{2}\.\d{2}\.\d{4}.*)$/i);
  if (movedPublication?.[1] && movedPublication?.[2]) {
    title = movedPublication[1].trim();
    detailParts.unshift(movedPublication[2].trim());
  }

  return {
    ...entry,
    title,
    detail: detailParts.filter(Boolean).join(' · '),
  };
}

function parseRecentEvents(raw) {
  const lines = String(raw || '').split('\n').map((value) => value.trim()).filter(Boolean);
  const out = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^\s*(\d{2}\.\d{2}\.\d{4})\b\s*(.*)$/);
    if (match) {
      if (current?.dateStr && current?.title) out.push(normalizeRecentEventEntry(current));
      current = { dateStr: match[1], title: String(match[2] || '').trim(), detail: '', source: 'Main page' };
      continue;
    }
    if (!current) continue;
    if (!current.title) current.title = line;
    else current.detail = current.detail ? `${current.detail} · ${line}` : line;
  }
  if (current?.dateStr && current?.title) out.push(normalizeRecentEventEntry(current));
  return dedupe(out, (event) => `${event.dateStr}|${event.title}|${event.detail}`);
}

function cleanTitle(raw) {
  return dedupeMultiline(raw)
    .replace(/^\s*(?:English|German|French)\s*:\s*/i, '')
    .replace(/\s*\[[^\]]+\]\s*$/g, '')
    .trim();
}

function trimPartyAddress(line = '') {
  const normalizedLine = normalize(line).replace(/^for all designated states\b[:\s-]*/i, '').trim();
  const entityMatch = normalizedLine.match(/^(.*?(?:Inc\.?|LLP|PLC|LLC|Ltd\.?|Limited|GmbH|S\.A\.?|B\.V\.?|Corp\.?|Corporation|Company|Co\.?|AG|AB|A\/S|SAS|SRL|S\.r\.l\.|KG|KGaA))(?=\s|$)/i);
  if (entityMatch?.[1]) return entityMatch[1].trim();
  const addressCue = normalizedLine.match(/\s+\d{1,5}[A-Z]?(?:-\d+)?\s+[A-Z]/);
  if (addressCue && addressCue.index > 6) return normalizedLine.slice(0, addressCue.index).trim();
  const placeCue = normalizedLine.match(/\s+(?:Parc|Square|Suite|Building|Street|Road|Avenue|Boulevard|Lane|Way|Campus)\b/i);
  if (placeCue && placeCue.index > 6) return normalizedLine.slice(0, placeCue.index).trim();
  return normalizedLine;
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
    out.push(trimPartyAddress(line));
  }

  return out[0] || '';
}

function extractTitle(doc) {
  const rawTitle = dedupeMultiline(fieldByLabel(doc, [/^Title$/i]));
  const page = bodyText(doc);
  if (rawTitle) {
    const englishLine = rawTitle.split('\n').map((value) => value.trim()).find((line) => /^English\s*:/i.test(line));
    if (englishLine) return cleanTitle(englishLine.replace(/^English\s*:\s*/i, ''));
    const englishFromPage = page.match(/\bEnglish\s*:\s*([^\n\r\[]+)/i);
    if (englishFromPage?.[1]) return cleanTitle(englishFromPage[1]);
  }

  for (const el of [...doc.querySelectorAll('h1,h2,h3,strong,b,a')].slice(0, 120)) {
    const match = text(el).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
    if (match?.[1]) return cleanTitle(match[1]);
  }

  if (rawTitle) {
    const cleanedLines = rawTitle.split('\n').map((line) => line.trim()).filter((line) => line && !/^(German|French)\s*:/i.test(line));
    if (cleanedLines.length) return cleanTitle(cleanedLines[0]);
  }

  const fromBody = bodyText(doc).match(/\bEP\d{6,12}\s*-\s*([^\[\n\r]+?)(?:\s*\[|$)/i);
  return cleanTitle(fromBody?.[1] || '');
}

function parseMainRawFromDocument(doc, caseNo) {
  const pageText = bodyText(doc);
  const appSections = sectionTextsByHeader(doc, /^Application number/i);
  const publicationSections = sectionTextsByHeader(doc, /^Publication\b/i);
  const appField = appSections[0] || fieldByLabel(doc, [/^Application number/i]) || fallbackAppField(doc, pageText);
  const statusField = dedupeMultiline(fieldByLabel(doc, [/^Status$/i, /^Procedural status$/i]));
  const priorityField = fieldByLabel(doc, [/^Priority\b/i]) || fallbackPriorityField(doc, pageText);
  const publicationField = publicationSections.join('\n') || fieldByLabel(doc, [/^Publication\b/i]) || fallbackPublicationField(doc, pageText);
  const recentEventField = fieldByLabel(doc, [/^Most recent event\b/i]) || fallbackRecentEventField(doc);

  const appInfo = parseApplicationField(appField);
  const priorities = parsePriority(priorityField, pageText);

  const parentCandidates = extractEpNumbersByHeader(doc, /\bParent application(?:\(s\))?\b/i);
  const parentMatch = pageText.match(/\bparent\s+application(?:\(s\))?[^\n]{0,140}\b(EP\d{6,12})\b/i);
  const parentCase = parentCandidates[0] || (parentMatch ? parentMatch[1].toUpperCase() : '');

  const divisionalChildrenFromHeader = extractEpNumbersByHeader(doc, /\bDivisional application(?:\(s\))?\b/i);
  const divisionalSection = String(pageText).match(/Divisional\s+application(?:\(s\))?[\s\S]{0,400}/i)?.[0] || '';
  const divisionalChildAppsFromText = [...divisionalSection.matchAll(/\b(EP\d{8})(?:\.\d)?\b\s*(?:&nbsp;|\s)*\//gi)].map((match) => String(match[1] || '').toUpperCase());
  const divisionalChildrenFromText = [...divisionalSection.matchAll(/\b(EP\d{6,12})(?:\.\d)?\b/gi)].map((match) => String(match[1] || '').toUpperCase());
  const divisionalChildren = dedupe((divisionalChildAppsFromText.length ? divisionalChildAppsFromText : [...divisionalChildrenFromHeader, ...divisionalChildrenFromText]), (value) => value);
  const mainPublications = parseMainPublications(doc, 'EP (this file)');

  const internationalField = dedupeMultiline(fieldByLabel(doc, [/^International application\b/i, /^International publication\b/i, /^PCT application\b/i]));
  const internationalSectionFromPage = String(pageText).match(/International\s+application(?:\s+number)?[\s\S]{0,220}/i)?.[0] || '';
  const pctScopeText = `${appSections.join('\n')}\n${String(appField || '')}\n${internationalField}\n${internationalSectionFromPage}\n${pageText}`;
  const woMatch = pctScopeText.match(/\b(WO\d{4}(?:[A-Z]{2})?\d{3,})\b/i);
  const pctMatch = pctScopeText.match(/\b(PCT\/[A-Z]{2}\d{4}\/\d{5,})\b/i);
  const internationalAppNo = (woMatch?.[1] || pctMatch?.[1] || '').toUpperCase();
  const isEuroPct = !!internationalAppNo;

  const titleField = normalize(fieldByLabel(doc, [/^Title$/i]));
  const applicantField = normalize(fieldByLabel(doc, [/^Applicant/i]) || fallbackPartyField(doc, 'applicant'));
  const representativeField = normalize(fieldByLabel(doc, [/^Representative/i]) || fallbackPartyField(doc, 'representative'));
  const fallbackApplicant = normalize((pageText.match(/\bApplicant\s*(?:\n|:)\s*([^\n]+)/i)?.[1]) || '');
  const divisionalMarker = /\bdivisional application\b/i.test(`${String(statusField || '')}\n${pageText}`);

  return {
    appNo: caseNo,
    title: extractTitle(doc) || cleanTitle(titleField),
    applicant: pickApplicantLine(applicantField) || normalize(applicantField.split('\n').find(Boolean) || '') || fallbackApplicant,
    representative: trimPartyAddress(representativeField.split('\n').find(Boolean) || ''),
    filingDate: appInfo.filingDate,
    priorities,
    priorityText: priorities.map((priority) => `${priority.no} · ${priority.dateStr}`).join('\n'),
    statusRaw: normalize(statusField),
    recentEvents: parseRecentEvents(recentEventField),
    publications: mainPublications.length ? mainPublications : parsePublications(publicationField, 'EP (this file)'),
    internationalAppNo,
    isEuroPct,
    isDivisional: !!parentCase || divisionalMarker,
    parentCase,
    divisionalChildren: divisionalChildren.filter((ep) => ep !== caseNo),
  };
}

module.exports = {
  dedupeMultiline,
  sectionRowsByHeader,
  sectionTextsByHeader,
  parseApplicationField,
  parseMainPublications,
  extractEpNumbersByHeader,
  parsePriority,
  parseRecentEvents,
  cleanTitle,
  pickApplicantLine,
  extractTitle,
  parseMainRawFromDocument,
};
