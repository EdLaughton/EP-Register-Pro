const { parseDateString, normalize } = require('./epo_v2_doclist_parser');
const { addCalendarMonthsDetailed, addRule126NotificationFiction } = require('./epo_v2_deadline_signals');

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

function formatDate(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
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

  for (const m of textRaw.matchAll(/(?:\bfinal\s+date\b[\s\S]{0,96}?)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
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
    .map((candidate) => ({ ...candidate, ts: parseDateString(candidate.dateStr)?.getTime() || 0 }))
    .sort((a, b) => (b.score - a.score) || (b.ts - a.ts))[0];

  return { dateStr: best?.dateStr || '', evidence: best?.evidence || '' };
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
      return { registeredLetterLine: current, proofLine: tail.slice(0, 180) };
    }

    for (let i = idx + 1; i < Math.min(lines.length, idx + 10); i++) {
      const line = normalize(lines[i]);
      if (!line) continue;
      if (/\bregistered\s+letter\b/i.test(line)) continue;
      return { registeredLetterLine: current, proofLine: line };
    }

    for (let i = Math.max(0, idx - 4); i < idx; i++) {
      const line = normalize(lines[i]);
      if (!line) continue;
      if (/\bregistered\s+letter\b/i.test(line)) continue;
      if (/\bepo\s*form\b|\(\d{2}\.\d{2}\.\d{4}\)/i.test(line)) {
        return { registeredLetterLine: current, proofLine: line };
      }
    }

    return { registeredLetterLine: current, proofLine: '' };
  }

  const inline = normalize(raw).match(/registered\s+letter\s*[:\-]?\s*([^\n\r]{3,180})/i);
  if (inline?.[1]) {
    const proof = normalize(String(inline[1] || '').split(/\s{2,}/)[0]);
    if (proof) return { registeredLetterLine: 'Registered Letter', proofLine: proof };
  }

  const nearby = normalize(raw).match(/(epo\s*form[^\n\r]{0,140}\(\d{2}\.\d{2}\.\d{4}\))/i);
  if (nearby?.[1]) {
    return { registeredLetterLine: 'Registered Letter', proofLine: normalize(nearby[1]) };
  }

  return { registeredLetterLine: '', proofLine: '' };
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
  const proofDate = normalizeDateString(String(registered.proofLine || '').match(/\b(\d{2}\.\d{2}\.\d{4})\b/)?.[1] || '');
  if (proofDate) push(proofDate, 105, 'Date extracted from line below "Registered Letter" in PDF (dispatch proof context)');

  const registeredLineDate = normalizeDateString(String(registered.registeredLetterLine || '').match(/\b(\d{2}\.\d{2}\.\d{4})\b/)?.[1] || '');
  if (registeredLineDate) push(registeredLineDate, 95, 'Date extracted from "Registered Letter" line in PDF (dispatch proof context)');

  for (const m of textRaw.matchAll(/epo\s*form[^\n\r]{0,80}\((\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})\)/gi)) {
    push(m[1], 100, 'Date extracted from EPO form stamp near Registered Letter (dispatch proof context)');
  }

  if (docDateStr) push(docDateStr, 30, 'Doclist date fallback for communication date');
  if (!candidates.length) return { dateStr: '', evidence: '' };

  const best = candidates
    .map((candidate) => ({
      ...candidate,
      bonus: docDateStr && candidate.dateStr === docDateStr ? 8 : 0,
      ts: parseDateString(candidate.dateStr)?.getTime() || 0,
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
  for (const m of textRaw.matchAll(/\b((?:2|3|4|5|6|two|three|four|five|six))\s+months?\b/gi)) {
    push(m[1], `Derived from fragmented target phrase "${String(m[0] || '').trim()}" in PDF text`, 62);
  }
  for (const m of textRaw.matchAll(/\bmonths?\s*(?:of|:|-)?\s*((?:2|3|4|5|6|two|three|four|five|six))\b/gi)) {
    push(m[1], `Derived from reversed fragmented target phrase "${String(m[0] || '').trim()}" in PDF text`, 58);
  }

  if (!candidates.length) return { months: 0, evidence: '' };
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return { months: best?.months || 0, evidence: best?.evidence || '' };
}

function extractOralProceedingsDateFromPdf(textBlock) {
  const textRaw = String(textBlock || '');
  if (!textRaw) return { dateStr: '', evidence: '' };

  const candidates = [];
  const push = (rawDate, evidence, score = 100) => {
    const dateStr = normalizeDateString(rawDate);
    if (!dateStr) return;
    candidates.push({ dateStr, evidence, score, ts: parseDateString(dateStr)?.getTime() || 0 });
  };

  for (const m of textRaw.matchAll(/oral proceedings(?:\s+will)?(?:\s+take\s+place|\s+be\s+held|\s+are\s+appointed)?(?:\s+on|\s+for)?[^\d]{0,24}(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
    push(m[1], 'Oral-proceedings date found in PDF text', 140);
  }
  for (const m of textRaw.matchAll(/proceedings are appointed for[^\d]{0,24}(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
    push(m[1], 'Oral-proceedings appointment date found in PDF text', 145);
  }
  for (const m of textRaw.matchAll(/summons to oral proceedings[\s\S]{0,80}?(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/gi)) {
    push(m[1], 'Date found near summons-to-oral-proceedings heading in PDF text', 90);
  }

  if (!candidates.length) return { dateStr: '', evidence: '' };
  const best = candidates.sort((a, b) => (b.score - a.score) || (a.ts - b.ts))[0];
  return { dateStr: best?.dateStr || '', evidence: best?.evidence || '' };
}

function inferDeadlineCategoryFromContext(context = {}) {
  const low = `${String(context.docTitle || '')} ${String(context.docProcedure || '')}`.toLowerCase();
  if (!normalize(low)) return { category: '', evidence: '' };
  if (/rule\s*71\s*\(\s*3\s*\)|intention to grant|text intended for grant/.test(low)) {
    return { category: 'R71(3) response period', evidence: 'Inferred from document title/procedure metadata (Rule 71(3) / intention to grant signal)' };
  }
  if (/rule\s*62a|plurality of independent claims|indicate.*claim.*search/.test(low)) {
    return { category: 'Rule 62a invitation period', evidence: 'Inferred from document title/procedure metadata (Rule 62a search-stage signal)' };
  }
  if (/rule\s*63|incomplete search|meaningful search|subject-matter to be searched/.test(low)) {
    return { category: 'Rule 63 invitation period', evidence: 'Inferred from document title/procedure metadata (Rule 63 search-stage signal)' };
  }
  if (/rule\s*64|additional search fee|further search fees|lack of unity/.test(low)) {
    return { category: 'Rule 64 additional search fees / unity selection', evidence: 'Inferred from document title/procedure metadata (Rule 64 search-fee signal)' };
  }
  if (/rule\s*70a|reply to the search opinion|invitation to respond to the european search opinion/.test(low)) {
    return { category: 'Rule 70a reply to search opinion', evidence: 'Inferred from document title/procedure metadata (Rule 70a search-opinion reply signal)' };
  }
  if (/rule\s*70\(2\)|wish to proceed further|desire to proceed further/.test(low)) {
    return { category: 'Rule 70(2) confirmation/response period', evidence: 'Inferred from document title/procedure metadata (Rule 70(2) proceed-further signal)' };
  }
  if (/\brule\s*116\b|summons to oral proceedings/.test(low)) {
    return { category: 'Rule 116 final date', evidence: 'Inferred from document title/procedure metadata (Rule 116 / summons signal)' };
  }
  if (/\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)|communication pursuant to article 94\(3\)/.test(low)) {
    return { category: 'Art. 94(3) response period', evidence: 'Inferred from document title/procedure metadata (explicit Art. 94(3) signal)' };
  }
  if (/minutes.*consultation|consultation by telephone|minutes issued as first action/.test(low)) {
    return { category: 'Minutes-as-first-action examination communication', evidence: 'Inferred from document title/procedure metadata (minutes / consultation first-action signal)' };
  }
  if (/\brule\s*161\b|\brule\s*162\b/.test(low)) {
    return { category: 'Rule 161/162 response period', evidence: 'Inferred from document title/procedure metadata (Rule 161/162 signal)' };
  }
  if (/rule\s*164\(1\)|additional search fees|further search fees/.test(low)) {
    return { category: 'Rule 164(1) additional search fees', evidence: 'Inferred from document title/procedure metadata (Rule 164(1) Euro-PCT search-fee signal)' };
  }
  if (/rule\s*164\(2\)|unsearched invention/.test(low)) {
    return { category: 'Rule 164(2) unsearched-inventions communication', evidence: 'Inferred from document title/procedure metadata (Rule 164(2) unsearched-inventions signal)' };
  }
  if (/rule\s*79\(1\)|invitation to file observations|proprietor.*comments|communication of opposition/.test(low)) {
    return { category: 'Opposition Rule 79(1) proprietor reply', evidence: 'Inferred from document title/procedure metadata (Rule 79(1) opposition signal)' };
  }
  if (/rule\s*79\(3\)|invite.*reply|observations and amendments filed by the proprietor/.test(low)) {
    return { category: 'Opposition Rule 79(3) party-reply communication', evidence: 'Inferred from document title/procedure metadata (Rule 79(3) opposition signal)' };
  }
  if (/rule\s*82\(1\)|text in which it intends to maintain|maintain the patent as amended/.test(low)) {
    return { category: 'Opposition Rule 82(1) maintenance-text observations', evidence: 'Inferred from document title/procedure metadata (Rule 82(1) opposition signal)' };
  }
  if (/rule\s*82\(2\)|file translations of the amended claims|publication fee/.test(low)) {
    return { category: 'Opposition Rule 82(2) translations + publication fee', evidence: 'Inferred from document title/procedure metadata (Rule 82(2) opposition signal)' };
  }
  if (/rule\s*82\(3\)|further invitation|surcharge/.test(low)) {
    return { category: 'Opposition Rule 82(3) surcharge period', evidence: 'Inferred from document title/procedure metadata (Rule 82(3) opposition signal)' };
  }
  if (/rule\s*95\(2\)|deficiencies in the request for limitation|request for limitation/.test(low)) {
    return { category: 'Limitation Rule 95(2) correction period', evidence: 'Inferred from document title/procedure metadata (Rule 95(2) limitation signal)' };
  }
  if (/rule\s*95\(3\)|allowable request|translations of the amended claims/.test(low)) {
    return { category: 'Limitation Rule 95(3) translations + fee', evidence: 'Inferred from document title/procedure metadata (Rule 95(3) limitation signal)' };
  }
  if (/\bcommunication\b|\bnotification\b|\bsummons\b|\binvitation\b|\bofficial communication\b|\boffice action\b/.test(low)) {
    return { category: 'Communication response period', evidence: 'Inferred from document title/procedure metadata (generic communication signal)' };
  }
  return { category: '', evidence: '' };
}

function defaultResponseMonthsForCategory(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('rule 62a')) return 2;
  if (c.includes('rule 63')) return 2;
  if (c.includes('r71(3)')) return 4;
  if (c.includes('rule 70(2)')) return 6;
  if (c.includes('rule 161/162')) return 6;
  if (c.includes('rule 164(1)')) return 2;
  if (c.includes('rule 79(1)')) return 4;
  if (c.includes('rule 82(1)')) return 2;
  if (c.includes('rule 82(2)')) return 3;
  if (c.includes('rule 82(3)')) return 2;
  if (c.includes('rule 95(2)')) return 2;
  if (c.includes('rule 95(3)')) return 3;
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
    oralProceedingsDate: '',
    oralProceedingsEvidence: '',
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
    : /rule\s*62a|plurality of independent claims|indicate.*claim.*search/.test(textLower)
      ? 'Rule 62a invitation period'
      : /rule\s*63|incomplete search|meaningful search|subject-matter to be searched/.test(textLower)
        ? 'Rule 63 invitation period'
        : /rule\s*64|additional search fee|further search fees|lack of unity/.test(textLower)
          ? 'Rule 64 additional search fees / unity selection'
          : /rule\s*70a|reply to the search opinion|invitation to respond to the european search opinion/.test(textLower)
            ? 'Rule 70a reply to search opinion'
            : /rule\s*70\(2\)|wish to proceed further|desire to proceed further/.test(textLower)
              ? 'Rule 70(2) confirmation/response period'
              : /\brule\s*116\b|summons to oral proceedings/.test(textLower)
                ? 'Rule 116 final date'
                : /\barticle\s*94\s*\(\s*3\s*\)|\bart\.?\s*94\s*\(\s*3\s*\)/.test(textLower)
                  ? 'Art. 94(3) response period'
                  : /minutes.*consultation|consultation by telephone|minutes issued as first action/.test(textLower)
                    ? 'Minutes-as-first-action examination communication'
                    : /\brule\s*161\b|\brule\s*162\b/.test(textLower)
                      ? 'Rule 161/162 response period'
                      : /rule\s*164\(1\)|additional search fees|further search fees/.test(textLower)
                        ? 'Rule 164(1) additional search fees'
                        : /rule\s*164\(2\)|unsearched invention/.test(textLower)
                          ? 'Rule 164(2) unsearched-inventions communication'
                          : /rule\s*79\(1\)|invitation to file observations|proprietor.*comments|communication of opposition/.test(textLower)
                            ? 'Opposition Rule 79(1) proprietor reply'
                            : /rule\s*79\(3\)|invite.*reply|observations and amendments filed by the proprietor/.test(textLower)
                              ? 'Opposition Rule 79(3) party-reply communication'
                              : /rule\s*82\(1\)|text in which it intends to maintain|maintain the patent as amended/.test(textLower)
                                ? 'Opposition Rule 82(1) maintenance-text observations'
                                : /rule\s*82\(2\)|file translations of the amended claims|publication fee/.test(textLower)
                                  ? 'Opposition Rule 82(2) translations + publication fee'
                                  : /rule\s*82\(3\)|further invitation|surcharge/.test(textLower)
                                    ? 'Opposition Rule 82(3) surcharge period'
                                    : /rule\s*95\(2\)|deficiencies in the request for limitation|request for limitation/.test(textLower)
                                      ? 'Limitation Rule 95(2) correction period'
                                      : /rule\s*95\(3\)|allowable request|translations of the amended claims/.test(textLower)
                                        ? 'Limitation Rule 95(3) translations + fee'
                                        : '';

  const categoryFromContext = inferDeadlineCategoryFromContext(context);
  let category = categoryFromText || categoryFromContext.category;
  diagnostics.category = category;
  diagnostics.categoryEvidence = categoryFromText ? 'Detected from communication text' : (categoryFromContext.evidence || '');

  const registeredLetter = extractRegisteredLetterProofLine(textRaw);
  diagnostics.registeredLetterLine = registeredLetter.registeredLetterLine || '';
  diagnostics.registeredLetterProofLine = registeredLetter.proofLine || '';

  const communication = extractCommunicationDateFromPdf(textRaw, { docDateStr });
  const communicationDateStr = communication.dateStr || docDateStr;
  const communicationDate = parseDateString(communicationDateStr);
  diagnostics.communicationDate = communicationDateStr || '';
  diagnostics.communicationEvidence = communication.evidence || (docDateStr ? 'Doclist date fallback for communication date' : '');

  const oralProceedings = extractOralProceedingsDateFromPdf(textRaw);
  diagnostics.oralProceedingsDate = oralProceedings.dateStr || '';
  diagnostics.oralProceedingsEvidence = oralProceedings.evidence || '';

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

  if (oralProceedings.dateStr) {
    pushHint({
      label: /opposition/i.test(String(context.docProcedure || '')) ? 'Opposition oral proceedings date' : 'Oral proceedings date',
      dateStr: oralProceedings.dateStr,
      sourceDate: communicationDateStr || docDateStr,
      confidence: 'high',
      level: 'warn',
      evidence: oralProceedings.evidence,
    });
  }

  if (!category) return { hints: dedupe(hints, (hint) => `${hint.label}|${hint.dateStr}`), diagnostics };

  let explicitAdded = false;
  if (explicitDue.dateStr) {
    pushHint({
      label: category,
      dateStr: explicitDue.dateStr,
      sourceDate: communicationDateStr || docDateStr,
      confidence: 'high',
      level: /rule\s*116|oral proceedings/i.test(category) ? 'warn' : 'bad',
      evidence: explicitDue.evidence,
    });
    explicitAdded = true;
  }

  if (!explicitAdded && responseMonths && communicationDate) {
    const notified = addRule126NotificationFiction(communicationDate, 10);
    const calc = addCalendarMonthsDetailed(notified.date, responseMonths);
    const communicationFromDocFallback = /doclist date fallback/i.test(String(diagnostics.communicationEvidence || ''));
    const confidence = monthPeriod.months ? (communicationFromDocFallback ? 'medium' : 'high') : 'low';
    pushHint({
      label: category,
      dateStr: formatDate(calc.date),
      sourceDate: communicationDateStr,
      notificationDate: formatDate(notified.date),
      confidence,
      level: /rule\s*116|oral proceedings/i.test(category) ? 'warn' : 'bad',
      evidence: `${responseEvidence || `Derived from ${responseMonths} month response period`} from communication date ${communicationDateStr} + Rule 126(2) 10-day notification fiction${calc.rolledOver ? ` (rollover ${calc.fromDay}→${calc.toDay})` : ''}`,
    });
  }

  return { hints: dedupe(hints, (hint) => `${hint.label}|${hint.dateStr}`), diagnostics };
}

module.exports = {
  normalizeDateString,
  parseSmallNumberToken,
  extractExplicitDeadlineDateFromPdf,
  extractRegisteredLetterProofLine,
  extractCommunicationDateFromPdf,
  extractResponseMonthsFromPdf,
  extractOralProceedingsDateFromPdf,
  inferDeadlineCategoryFromContext,
  defaultResponseMonthsForCategory,
  parsePdfDeadlineHints,
};
