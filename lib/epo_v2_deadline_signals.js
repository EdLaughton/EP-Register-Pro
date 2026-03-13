const { buildProceduralRecords } = require('./epo_v2_posture_signals');

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDateString(value = '') {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
}

function compareDateDesc(a, b) {
  return (parseDateString(b?.dateStr)?.getTime() || 0) - (parseDateString(a?.dateStr)?.getTime() || 0);
}

function endOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
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

function addCalendarDaysDetailed(date, days) {
  const src = new Date(date);
  if (Number.isNaN(src.getTime())) return { date: new Date(NaN), days: Number(days || 0) };
  const next = new Date(src);
  next.setDate(next.getDate() + Number(days || 0));
  return { date: next, days: Number(days || 0) };
}

function addRule126NotificationFiction(date, days = 10) {
  return addCalendarDaysDetailed(date, days);
}

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

function pdfHintsWithParsedDates(pdfData = {}) {
  return (Array.isArray(pdfData?.hints) ? pdfData.hints : [])
    .map((h) => ({
      ...h,
      date: parseDateString(h.dateStr),
    }))
    .filter((h) => h.date);
}

function isTerminalEpoOutcomeText(textValue = '') {
  return /deemed to be withdrawn|application deemed to be withdrawn|loss of rights|communication under rule\s*112\(1\)|rule\s*112\(1\)|application refused|application rejected|revoked|revocation|not maintained|rights restored refused|re-establishment.*rejected/.test(String(textValue || '').toLowerCase());
}

function isActualGrantMentionText(textValue = '') {
  const low = normalize(textValue).toLowerCase();
  if (!low) return false;
  if (/request for grant/.test(low)) return false;
  return /publication of (?:the )?mention of grant|mention of grant|european patent granted|patent has been granted|the patent has been granted|\bpatent granted\b/.test(low);
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function sameDay(a, b) {
  return !!(a && b && String(a.dateStr || '') === String(b.dateStr || ''));
}

function structuredAnchorDate(record = {}) {
  return parseDateString(record?.dispatchDate || '')
    || parseDateString(record?.dateStr || '')
    || parseDateString(record?.effectiveDate || '')
    || null;
}

function structuredExactDueDate(record = {}) {
  return parseDateString(record?.timeLimitDate || '') || null;
}

function structuredReplyOrPaymentSeen(record = {}) {
  return !!(
    parseDateString(record?.replyDate || '')
    || parseDateString(record?.paymentDate || '')
    || (Array.isArray(record?.paymentDates) && record.paymentDates.some((value) => parseDateString(value)))
    || parseDateString(record?.resultDate || '')
  );
}

function inferProceduralPhase(item = {}) {
  const source = normalize(`${item?.title || ''} ${item?.detail || item?.procedure || ''} ${item?.codexPhase || ''} ${item?.freeFormatText || ''}`).toLowerCase();
  const code = normalize(item?.originalCode || '').toUpperCase();
  if (!source && !code) return '';
  if (/appeal|board of appeal/.test(source)) return 'appeal';
  if (/opposition/.test(source) || ['OREX', 'PMAP', 'DOBS', 'IDOP'].includes(code)) return 'opposition';
  if (/limitation|revocation request/.test(source) || ['LIRE', 'REJR'].includes(code)) return 'limitation';
  if (/grant|rule\s*71/.test(source) || ['IGRA', 'IGRE', 'ACOR', 'CDEC'].includes(code)) return 'grant';
  if (/search|supplementary search|rule\s*62a|rule\s*63|rule\s*64|rule\s*70a/.test(source)) return 'search';
  if (/examin|art\.\s*94\(3\)|article\s*94\(3\)|rule\s*116|minutes/.test(source)) return 'examination';
  return '';
}

function inferMissedActFromReason(textValue = '') {
  const low = normalize(textValue).toLowerCase();
  if (!low) return '';
  if (/non-entry into european phase|rule\s*159|regional phase/.test(low)) return 'Euro-PCT entry acts';
  if (/rule\s*62a/.test(low)) return 'Rule 62a invitation';
  if (/rule\s*63/.test(low)) return 'Rule 63 invitation';
  if (/rule\s*64|additional search fee|lack of unity/.test(low)) return 'Rule 64 search-fee branch';
  if (/written opinion|search opinion|eesr|rule\s*70a/.test(low)) return 'search-opinion / Rule 70a reply';
  if (/article\s*94\(3\)|art\.\s*94\(3\)|examination report|communication from the examining division/.test(low)) return 'Art. 94(3) examination reply';
  if (/rule\s*71\(3\)|intention to grant|translations of claims|grant and publication fee|grant and publishing fee/.test(low)) return 'Rule 71(3) grant formalities';
  if (/prior art/.test(low)) return 'prior-art information response';
  if (/renewal fee|examination fee|designation fee/.test(low)) return 'fee payment';
  return '';
}

function doclistDateMayStandInForDispatch(record = {}) {
  const sourceLow = normalize(record?.source || '').toLowerCase();
  const actorLow = normalize(record?.actor || '').toLowerCase();
  const textLow = normalize(`${record?.title || ''} ${record?.detail || record?.procedure || ''}`).toLowerCase();
  if (!/documents|all documents/.test(sourceLow)) return false;
  if (actorLow && !/epo|examining|opposition|board/.test(actorLow)) return false;
  return /communication|invitation|summons|decision|intention to grant|rule\s*62a|rule\s*63|rule\s*70\(?2\)?|rule\s*70a|rule\s*71\(?3\)?|rule\s*79|rule\s*82|rule\s*95|rule\s*112|rule\s*161|rule\s*162|rule\s*164|art\.?\s*94\(?3\)?|article\s*94\(?3\)?|loss of rights|refusal/.test(textLow);
}

function notificationAnchorContext(record = {}, baseDate = null, applyNotificationFiction = true) {
  const rawAnchor = baseDate || structuredAnchorDate(record);
  if (!rawAnchor) return { anchorDate: null, sourceDate: String(record?.dispatchDate || record?.dateStr || ''), notificationDate: '', usedNotificationFiction: false };
  const dispatchDate = parseDateString(record?.dispatchDate || '');
  const surrogateDispatchDate = !dispatchDate && doclistDateMayStandInForDispatch(record) ? parseDateString(record?.dateStr || '') : null;
  const dispatchLikeDate = dispatchDate || surrogateDispatchDate;
  const sourceDate = String(record?.dispatchDate || (surrogateDispatchDate ? record?.dateStr : '') || record?.dateStr || '');
  if (!applyNotificationFiction || !dispatchLikeDate) {
    return {
      anchorDate: rawAnchor,
      sourceDate,
      notificationDate: '',
      usedNotificationFiction: false,
    };
  }
  const fiction = addRule126NotificationFiction(dispatchLikeDate, 10);
  return {
    anchorDate: fiction.date,
    sourceDate,
    notificationDate: formatDate(fiction.date),
    usedNotificationFiction: true,
  };
}

function buildDeadlineComputationContext({ main = {}, docs = [], eventHistory = {}, legal = {}, pdfData = {} } = {}) {
  const out = [];
  const records = buildProceduralRecords(docs, eventHistory, legal);
  const pdfHints = pdfHintsWithParsedDates(pdfData);
  const appType = normalize(main.applicationType || '').toLowerCase();
  const isEuroPct = /e\/pct/.test(appType);
  const isDivisional = /divisional/.test(appType);
  const priorityDate = main.priorities?.[0] ? parseDateString(main.priorities[0].dateStr) : null;
  const filingDate = parseDateString(main.filingDate);

  const docsDesc = [...(docs || [])].sort(compareDateDesc);
  const eventDesc = dedupe([...(eventHistory.events || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}|${e.codexKey || ''}`).sort(compareDateDesc);
  const legalEventsDesc = dedupe([...(legal.events || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}|${e.codexKey || ''}`).sort(compareDateDesc);
  const codedEventsDesc = dedupe([...(legal.codedEvents || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}|${e.originalCode || ''}|${e.codexKey || ''}`).sort(compareDateDesc);

  const latestRecord = (regex) => records.find((r) => regex.test(`${r.title || ''} ${r.detail || ''}`));
  const hasPdfHint = (regex) => pdfHints.some((h) => regex.test(String(h.label || '')));

  const rawItemDetail = (item = {}) => item.detail || item.procedure || item.freeFormatText || '';
  const anchorRecordFromItem = (item = {}, source = '') => ({
    dateStr: item.dateStr || '',
    title: item.title || '',
    detail: rawItemDetail(item),
    actor: item.actor || '',
    source: source || item.source || '',
    codexKey: item.codexKey || '',
    codexPhase: item.codexPhase || '',
    originalCode: item.originalCode || '',
    effectiveDate: item.effectiveDate || '',
    freeFormatText: item.freeFormatText || '',
    stepDescriptionName: item.stepDescriptionName || '',
    dispatchDate: item.dispatchDate || '',
    replyDate: item.replyDate || '',
    paymentDate: item.paymentDate || '',
    paymentDates: Array.isArray(item.paymentDates) ? [...item.paymentDates] : [],
    requestDate: item.requestDate || '',
    resultDate: item.resultDate || '',
    timeLimitRaw: item.timeLimitRaw || '',
    timeLimitMonths: Number(item.timeLimitMonths || 0),
    timeLimitDate: item.timeLimitDate || '',
  });

  const collectPreferredAnchors = (plans = []) => {
    const found = [];
    for (const plan of plans) {
      const items = Array.isArray(plan?.items) ? plan.items : [];
      const predicate = typeof plan?.predicate === 'function' ? plan.predicate : null;
      if (!predicate) continue;
      for (const item of items) {
        if (!predicate(item, normalize(`${item?.title || ''} ${rawItemDetail(item)}`.toLowerCase()))) continue;
        found.push(anchorRecordFromItem(item, plan.source));
      }
    }
    return dedupe(found, (item) => `${item.dateStr}|${item.title}|${item.detail}|${item.source}|${item.originalCode || ''}|${item.codexKey || ''}`)
      .sort(compareDateDesc);
  };

  const pickPreferredAnchor = (plans = []) => collectPreferredAnchors(plans)[0] || null;

  const hasAfter = (anchorDate, predicate) => {
    const ts = anchorDate?.getTime?.() || 0;
    if (!ts) return false;
    return records.some((r) => {
      const dt = structuredAnchorDate(r);
      return dt && dt.getTime() > ts && predicate(r, dt);
    });
  };

  const findLaterRecordAfter = (anchorDate, predicate) => {
    const ts = anchorDate?.getTime?.() || 0;
    if (!ts) return null;
    return [...records]
      .sort((a, b) => (structuredAnchorDate(a)?.getTime?.() || 0) - (structuredAnchorDate(b)?.getTime?.() || 0))
      .find((r) => {
        const dt = structuredAnchorDate(r);
        return !!(dt && dt.getTime() > ts && predicate(r, dt));
      }) || null;
  };

  const hasApplicantResponseAfter = (anchorDate, regex = /reply|response|observations|arguments|amended|amendment|claims|request|translation|appeal/i) =>
    hasAfter(anchorDate, (r) => r.actor === 'Applicant' && regex.test(`${r.title} ${r.detail}`));

  const hasFeeSignalAfter = (anchorDate, regex = /payment|fee paid|paid|examination fee|designation fee|grant and publishing fee|grant and publication fee|renewal fee/i) =>
    hasAfter(anchorDate, (r) => regex.test(`${r.title} ${r.detail}`));

  const terminalEpoOutcomeAfter = (anchorDate, dueDate = null) => {
    const anchorTs = anchorDate?.getTime?.() || 0;
    const dueTs = dueDate?.getTime?.() || 0;
    let match = null;
    for (const r of [...records].sort((a, b) => (parseDateString(a.dateStr)?.getTime?.() || 0) - (parseDateString(b.dateStr)?.getTime?.() || 0))) {
      const dt = parseDateString(r.dateStr);
      if (!dt || r.actor !== 'EPO') continue;
      if (anchorTs && dt.getTime() <= anchorTs) continue;
      if (dueTs && dt.getTime() <= dueTs) continue;
      if (!isTerminalEpoOutcomeText(`${r.title} ${r.detail}`)) continue;
      match = { dateStr: r.dateStr, title: r.title || '', detail: r.detail || '' };
      break;
    }
    return match;
  };

  const recordConfidence = (record = null, fallback = 'medium') => {
    const source = normalize(record?.source || '').toLowerCase();
    if (record?.dispatchDate && (record?.timeLimitDate || record?.timeLimitMonths || record?.replyDate || record?.paymentDate || record?.requestDate)) return 'high';
    if (record?.dispatchDate && source === 'coded legal event') return 'high';
    if (!source) return fallback;
    if (source === 'documents') return 'high';
    if (source === 'coded legal event') return 'medium';
    if (source === 'event') return 'low';
    return fallback;
  };

  const push = (entry) => {
    const validDate = isValidDate(entry?.date);
    if (!validDate && !entry?.reviewOnly) return;

    const next = { ...entry };
    if (validDate) {
      const dueDate = next.date;
      const anchorDate = parseDateString(next.sourceDate || '') || dueDate;
      const terminal = terminalEpoOutcomeAfter(anchorDate, dueDate);
      if (terminal && !next.resolved && !next.superseded) {
        next.superseded = true;
        next.supersededBy = terminal;
        next.method = normalize([next.method || '', `superseded by later EPO outcome on ${terminal.dateStr}`].filter(Boolean).join(' · '));
      }
    } else {
      next.date = null;
    }
    out.push(next);
  };

  const pushReviewItem = ({ label, record = null, level = 'warn', confidence = '', method = '', namespace = '', internalKey = '', phase = '', date = null, resolved = false, extra = {} }) => {
    const derivedConfidence = confidence || recordConfidence(record, 'low');
    push({
      label,
      date,
      level,
      confidence: derivedConfidence,
      sourceDate: String(record?.dispatchDate || record?.dateStr || ''),
      resolved,
      reviewOnly: true,
      namespace,
      internalKey,
      phase,
      method,
      ...extra,
    });
  };

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

    if (/rule 116|oral proceedings/.test(l)) {
      return hasApplicantResponseAfter(anchorDate, /response|request|submission|oral proceedings|withdrawal/i);
    }

    return hasApplicantResponseAfter(anchorDate);
  };

  const addMonthsDeadline = ({ record = null, triggerRegex = null, label, months, level, confidence = '', resolvedBy, reviewOnly = false, methodPrefix = 'Heuristic', namespace = '', internalKey = '', phase = '', supersededBy = null, reference = false, extra = {}, applyNotificationFiction = true }) => {
    if (hasPdfHint(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) return null;
    const rec = record || (triggerRegex ? latestRecord(triggerRegex) : null);
    if (!rec) return null;
    const anchorContext = notificationAnchorContext(rec, structuredAnchorDate(rec), applyNotificationFiction);
    const anchor = anchorContext.anchorDate;
    if (!anchor) return null;

    const resolved = typeof resolvedBy === 'function'
      ? !!resolvedBy(anchor, rec)
      : (structuredReplyOrPaymentSeen(rec) || hasApplicantResponseAfter(anchor));

    const calc = addCalendarMonthsDetailed(anchor, months);
    const derivedConfidence = confidence || (rec.dispatchDate ? 'high' : recordConfidence(rec, 'medium'));
    const sourceLabel = normalize(String(rec.source || 'preferred source')).toLowerCase() || 'preferred source';
    const anchorLabel = anchorContext.usedNotificationFiction ? 'DATE_OF_DISPATCH + Rule 126(2) 10-day notification fiction' : (rec.dispatchDate ? 'DATE_OF_DISPATCH' : 'trigger');
    const entry = {
      label,
      date: calc.date,
      level,
      confidence: derivedConfidence,
      sourceDate: anchorContext.sourceDate,
      notificationDate: anchorContext.notificationDate,
      resolved,
      reviewOnly: !!reviewOnly || derivedConfidence === 'low',
      method: `${methodPrefix}: +${months} month(s) from ${sourceLabel} ${anchorLabel}`,
      rolledOver: calc.rolledOver,
      rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
      namespace,
      internalKey,
      phase,
      reference,
      ...extra,
    };

    if (typeof supersededBy === 'function') {
      const superseding = supersededBy(anchor, rec);
      if (superseding) {
        entry.superseded = true;
        entry.supersededBy = { dateStr: superseding.dateStr, title: superseding.title || '', detail: superseding.detail || '' };
        entry.method = normalize([entry.method, `superseded by ${superseding.title || 'later governing communication'} on ${superseding.dateStr}`].filter(Boolean).join(' · '));
      }
    }

    push(entry);
    return entry;
  };

  const addStructuredOrReviewDeadline = ({ record = null, label, reviewLabel = '', level = 'warn', fixedMonths = 0, confidence = '', namespace = '', internalKey = '', phase = '', resolvedBy, method = '', reviewMethod = '', supersededBy = null, extra = {} }) => {
    const rec = record || null;
    if (!rec) return null;
    const exactDue = structuredExactDueDate(rec);
    const anchor = structuredAnchorDate(rec);
    if (exactDue) {
      const derivedConfidence = confidence || (rec.dispatchDate ? 'high' : recordConfidence(rec, 'medium'));
      const resolved = typeof resolvedBy === 'function'
        ? !!resolvedBy(anchor || exactDue, rec)
        : (structuredReplyOrPaymentSeen(rec) || (anchor ? hasApplicantResponseAfter(anchor) : false));
      const entry = {
        label,
        date: exactDue,
        level,
        confidence: derivedConfidence,
        sourceDate: rec.dispatchDate || rec.dateStr || rec.timeLimitDate,
        resolved,
        reviewOnly: derivedConfidence === 'low',
        namespace,
        internalKey,
        phase,
        method: method || 'Structured ST.36 time-limit date',
        ...extra,
      };
      if (typeof supersededBy === 'function') {
        const superseding = supersededBy(anchor || exactDue, rec);
        if (superseding) {
          entry.superseded = true;
          entry.supersededBy = { dateStr: superseding.dateStr, title: superseding.title || '', detail: superseding.detail || '' };
          entry.method = normalize([entry.method, `superseded by ${superseding.title || 'later governing communication'} on ${superseding.dateStr}`].filter(Boolean).join(' · '));
        }
      }
      push(entry);
      return entry;
    }
    if (Number(rec?.timeLimitMonths || 0) > 0 && anchor) {
      return addMonthsDeadline({
        record: rec,
        label,
        months: Number(rec.timeLimitMonths || 0),
        level,
        confidence: confidence || (rec.dispatchDate ? 'high' : recordConfidence(rec, 'medium')),
        resolvedBy,
        methodPrefix: 'Structured ST.36 time-limit',
        namespace,
        internalKey,
        phase,
        supersededBy,
        extra,
      });
    }
    if (fixedMonths > 0 && anchor) {
      return addMonthsDeadline({
        record: rec,
        label,
        months: fixedMonths,
        level,
        confidence,
        resolvedBy,
        methodPrefix: rec.dispatchDate ? 'Structured ST.36 DATE_OF_DISPATCH' : 'Rule-based',
        namespace,
        internalKey,
        phase,
        supersededBy,
        extra,
      });
    }
    pushReviewItem({
      label: reviewLabel || label,
      record: rec,
      level,
      confidence: confidence || recordConfidence(rec, 'low'),
      method: reviewMethod || method || 'Review communication text / ST.36 fields for the governing deadline.',
      namespace,
      internalKey,
      phase,
      extra,
    });
    return null;
  };

  const addAbsoluteDateEntry = ({ record = null, label, level = 'warn', confidence = '', namespace = '', internalKey = '', phase = '', method = '', resolved = false, reference = false, reviewOnly = false, extra = {} }) => {
    const rec = record || null;
    const date = structuredAnchorDate(rec);
    push({
      label,
      date,
      level,
      confidence: confidence || recordConfidence(rec, 'medium'),
      sourceDate: String(rec?.dispatchDate || rec?.dateStr || ''),
      resolved,
      reference,
      reviewOnly,
      namespace,
      internalKey,
      phase,
      method,
      ...extra,
    });
  };

  const findNoOppositionRecord = () => pickPreferredAnchor([
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.codexKey === 'NO_OPPOSITION_FILED' || /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => e.codexKey === 'NO_OPPOSITION_FILED' || /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
    { items: records, source: 'Event', predicate: (r, low) => /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
  ]);

  const r71AnchorPlans = [
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /communication about intention to grant a european patent|communication of intention to grant a patent/.test(low) },
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /text intended for grant|intention to grant \(signatures\)|annex to the communication about intention to grant/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.originalCode === 'EPIDOSNIGR1' || e.codexKey === 'GRANT_R71_3' || /despatch of communication of intention to grant a patent/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => e.codexKey === 'GRANT_R71_3_EVENT' || /new entry: communication of intention to grant a patent|communication of intention to grant a patent/.test(low) },
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => /despatch of communication of intention to grant a patent/.test(low) },
  ];
  const findR71Anchors = () => collectPreferredAnchors(r71AnchorPlans);
  const findR71Anchor = () => findR71Anchors()[0] || null;

  const findRule716DisapprovalAnchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'Applicant' && /disapproval of the communication of intention to grant|rule\s*71\(6\)|disapproval.*intention to grant/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.originalCode === 'IGRE' || e.codexKey === 'GRANT_R71_6_DISAPPROVAL' || /disapproval of the communication of intention to grant|rule\s*71\(6\)/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /disapproval of the communication of intention to grant|rule\s*71\(6\)/.test(low) },
  ]);

  const findRule62aAnchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*62a|plurality of independent claims|indicate.*claim.*search/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*62a|plurality of independent claims|indicate.*claim.*search/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*62a|plurality of independent claims|indicate.*claim.*search/.test(low) },
  ]);

  const findRule63Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*63|incomplete search|meaningful search|subject-matter to be searched/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*63|incomplete search|meaningful search|subject-matter to be searched/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*63|incomplete search|meaningful search|subject-matter to be searched/.test(low) },
  ]);

  const findRule64Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /additional search fee|lack of unity.*search|rule\s*64|further search fees/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /additional search fee|lack of unity.*search|rule\s*64|further search fees/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /additional search fee|lack of unity.*search|rule\s*64|further search fees/.test(low) },
  ]);

  const findRule70aAnchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*70a|reply to the search opinion|invitation to respond to the european search opinion/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*70a|reply to the search opinion|invitation to respond to the european search opinion/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*70a|reply to the search opinion|invitation to respond to the european search opinion/.test(low) },
  ]);

  const findArt94Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /article\s*94\(3\)|art\.\s*94\(3\)|communication pursuant to article 94\(3\)/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /article\s*94\(3\)|art\.\s*94\(3\)|communication pursuant to article 94\(3\)/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /article\s*94\(3\)|art\.\s*94\(3\)|communication pursuant to article 94\(3\)/.test(low) },
  ]);

  const findMinutesFirstActionAnchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /minutes.*consultation|consultation by telephone|minutes issued as first action/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /minutes.*consultation|consultation by telephone|minutes issued as first action/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /minutes.*consultation|consultation by telephone|minutes issued as first action/.test(low) },
  ]);

  const findRule702Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*70\(2\)|wish to proceed further|desire to proceed further|confirm.*proceed/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*70\(2\)|wish to proceed further|desire to proceed further|confirm.*proceed/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*70\(2\)|wish to proceed further|desire to proceed further|confirm.*proceed/.test(low) },
  ]);

  const findRule161162Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /\brule\s*161\b|\brule\s*162\b|communication pursuant to rule 161|rules?\s*161.*162/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /\brule\s*161\b|\brule\s*162\b|communication pursuant to rule 161|rules?\s*161.*162/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /\brule\s*161\b|\brule\s*162\b|communication pursuant to rule 161|rules?\s*161.*162/.test(low) },
  ]);

  const findRule1641Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*164\(1\)|additional search fees|further search fees|lack of unity/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*164\(1\)|additional search fees|further search fees|lack of unity/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*164\(1\)|additional search fees|further search fees|lack of unity/.test(low) },
  ]);

  const findRule1642Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*164\(2\)|unsearched invention|further search fees/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*164\(2\)|unsearched invention|further search fees/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*164\(2\)|unsearched invention|further search fees/.test(low) },
  ]);

  const findEuroPctSearchAnchor = () => pickPreferredAnchor([
    {
      items: docsDesc,
      source: 'Documents',
      predicate: (d, low) => d.actor === 'EPO'
        && (/copy of the international search report|international publication of the international search report|written opinion of the isa|partial international search report|\bisr:\b/.test(low))
        && !(/non-reply to written opinion|correction of deficiencies in written opinion|reply to|communication concerning|reminder period|deemed to be withdrawn/.test(low)),
    },
  ]);

  const findSummonsAnchor = (phase = 'all') => pickPreferredAnchor([
    {
      items: docsDesc,
      source: 'Documents',
      predicate: (d, low) => d.actor === 'EPO'
        && /summons to oral proceedings/.test(low)
        && (phase === 'all' || inferProceduralPhase({ ...d, detail: rawItemDetail(d) }) === phase),
    },
    {
      items: codedEventsDesc,
      source: 'Coded legal event',
      predicate: (e, low) => /summons to oral proceedings/.test(low)
        && (phase === 'all' || inferProceduralPhase(e) === phase),
    },
    {
      items: eventDesc,
      source: 'Event',
      predicate: (e, low) => /summons to oral proceedings/.test(low)
        && (phase === 'all' || inferProceduralPhase(e) === phase),
    },
  ]);

  const findOralProceedingsEvent = (phase = 'all') => pickPreferredAnchor([
    {
      items: codedEventsDesc,
      source: 'Coded legal event',
      predicate: (e, low) => (e.originalCode === 'ORAL' || /^oral proceedings\b/.test(low) || /\boral proceedings\b/.test(low))
        && !/summons/.test(low)
        && (phase === 'all' || inferProceduralPhase(e) === phase),
    },
    {
      items: eventDesc,
      source: 'Event',
      predicate: (e, low) => /\boral proceedings\b/.test(low)
        && !/summons/.test(low)
        && (phase === 'all' || inferProceduralPhase(e) === phase),
    },
  ]);

  const findRule112Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*112|loss of rights|noting of loss of rights/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.codexKey === 'LOSS_OF_RIGHTS_R112' || /rule\s*112|loss of rights|noting of loss of rights/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*112|loss of rights|noting of loss of rights/.test(low) },
  ]);

  const findGrantPublicationAnchor = () => {
    const publications = Array.isArray(main?.publications) ? main.publications : [];
    const grantPub = [...publications]
      .filter((publication) => /^b/i.test(String(publication?.kind || '')) && parseDateString(publication?.dateStr || ''))
      .sort(compareDateDesc)[0];
    if (!grantPub) return null;
    return {
      dateStr: grantPub.dateStr || '',
      title: `B1 publication ${grantPub.no || ''}`.trim(),
      detail: 'European Patent Bulletin publication',
      actor: 'EPO',
      source: 'Main publication',
    };
  };

  const findGrantMentionAnchor = () => findGrantPublicationAnchor() || pickPreferredAnchor([
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => isActualGrantMentionText(low) && !(/expected grant|information on the status/.test(low)) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => isActualGrantMentionText(low) && !(/expected grant|information on the status/.test(low)) },
    { items: records, source: 'Event', predicate: (r, low) => isActualGrantMentionText(low) && !(/expected grant|information on the status/.test(low)) },
  ]);

  const findAppealableDecisionAnchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain|refusal of the application/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain|refusal of the application/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain|refusal of the application/.test(low) },
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain|refusal of the application/.test(low) },
  ]);

  const findOppositionRule791Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*79\(1\)|invitation to file observations|proprietor.*comments|communication of opposition/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*79\(1\)|invitation to file observations|proprietor.*comments|communication of opposition/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*79\(1\)|invitation to file observations|proprietor.*comments|communication of opposition/.test(low) },
  ]);

  const findOppositionRule793Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*79\(3\)|invite.*reply|observations and amendments filed by the proprietor/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*79\(3\)|invite.*reply|observations and amendments filed by the proprietor/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*79\(3\)|invite.*reply|observations and amendments filed by the proprietor/.test(low) },
  ]);

  const findOppositionOrexAnchor = () => pickPreferredAnchor([
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.originalCode === 'OREX' || /communication from the opposition division/.test(low) },
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /communication from the opposition division/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /communication from the opposition division/.test(low) },
  ]);

  const findOppositionRule821Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*82\(1\)|text in which it intends to maintain|maintain the patent as amended/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*82\(1\)|text in which it intends to maintain|maintain the patent as amended/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*82\(1\)|text in which it intends to maintain|maintain the patent as amended/.test(low) },
  ]);

  const findOppositionRule822Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*82\(2\)|file translations of the amended claims|publication fee/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*82\(2\)|file translations of the amended claims|publication fee/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*82\(2\)|file translations of the amended claims|publication fee/.test(low) },
  ]);

  const findOppositionRule823Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*82\(3\)|further invitation|surcharge/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*82\(3\)|further invitation|surcharge/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*82\(3\)|further invitation|surcharge/.test(low) },
  ]);

  const findOppositionPmapAnchor = () => pickPreferredAnchor([
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.originalCode === 'PMAP' || /preparation for maintenance of the patent in an amended form/.test(low) },
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /preparation for maintenance of the patent in an amended form/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /preparation for maintenance of the patent in an amended form/.test(low) },
  ]);

  const findLimitationRule952Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*95\(2\)|deficiencies in the request for limitation|request for limitation/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*95\(2\)|deficiencies in the request for limitation|request for limitation/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*95\(2\)|deficiencies in the request for limitation|request for limitation/.test(low) },
  ]);

  const findLimitationRule953Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /rule\s*95\(3\)|allowable request|translations of the amended claims/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /rule\s*95\(3\)|allowable request|translations of the amended claims/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /rule\s*95\(3\)|allowable request|translations of the amended claims/.test(low) },
  ]);

  const findLimitationLireAnchor = () => pickPreferredAnchor([
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.originalCode === 'LIRE' || /communication from the examining division in a limitation procedure|limitation procedure/.test(low) },
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /limitation procedure|request for limitation/.test(low) },
  ]);

  const rule161162Variant = (record = null) => {
    const low = normalize(`${record?.title || ''} ${record?.detail || ''} ${record?.stepDescriptionName || ''}`).toLowerCase();
    if (!low) return 'generic';
    if (/mandatory|required reply|must reply|mandatory reply|non-extendable.*reply/.test(low)) return 'mandatory';
    if (/voluntary|no mandatory substantive reply|no reply required|amendment window|claims fee consequences/.test(low)) return 'voluntary';
    return 'generic';
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
    pushReviewItem,
    latestRecord,
    hasPdfHint,
    hasAfter,
    findLaterRecordAfter,
    hasApplicantResponseAfter,
    hasFeeSignalAfter,
    terminalEpoOutcomeAfter,
    resolveHintByActivity,
    recordConfidence,
    addMonthsDeadline,
    addStructuredOrReviewDeadline,
    addAbsoluteDateEntry,
    findNoOppositionRecord,
    findR71Anchors,
    findR71Anchor,
    findRule716DisapprovalAnchor,
    findRule62aAnchor,
    findRule63Anchor,
    findRule64Anchor,
    findRule70aAnchor,
    findArt94Anchor,
    findMinutesFirstActionAnchor,
    findRule702Anchor,
    findRule161162Anchor,
    findRule1641Anchor,
    findRule1642Anchor,
    findEuroPctSearchAnchor,
    findSummonsAnchor,
    findOralProceedingsEvent,
    findRule112Anchor,
    findGrantMentionAnchor,
    findAppealableDecisionAnchor,
    findOppositionRule791Anchor,
    findOppositionRule793Anchor,
    findOppositionOrexAnchor,
    findOppositionRule821Anchor,
    findOppositionRule822Anchor,
    findOppositionRule823Anchor,
    findOppositionPmapAnchor,
    findLimitationRule952Anchor,
    findLimitationRule953Anchor,
    findLimitationLireAnchor,
    rule161162Variant,
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
      reviewOnly: String(hint.confidence || '').toLowerCase() === 'low',
      method: resolvedByActivity && !hint.resolved
        ? `${baseMethod} · resolved by subsequent activity`
        : baseMethod,
    });
  }
}

function appendSearchStageDeadlines(ctx) {
  ctx.addMonthsDeadline({
    record: ctx.findRule62aAnchor(),
    label: 'Rule 62a invitation period',
    months: 2,
    level: 'bad',
    internalKey: 'SEARCH_R62A_INVITATION',
    phase: 'search',
    namespace: 'first_instance',
  });

  ctx.addMonthsDeadline({
    record: ctx.findRule63Anchor(),
    label: 'Rule 63 invitation period',
    months: 2,
    level: 'bad',
    internalKey: 'SEARCH_R63_INVITATION',
    phase: 'search',
    namespace: 'first_instance',
  });

  const rule64 = ctx.findRule64Anchor();
  if (rule64 && !ctx.hasPdfHint(/Rule 64 additional search/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: rule64,
      label: 'Rule 64 additional search fees / unity selection',
      level: 'bad',
      internalKey: 'SEARCH_R64_ADDITIONAL_FEES',
      phase: 'search',
      namespace: 'first_instance',
      method: 'Structured ST.36 Rule 64 deadline from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'Communication-specific fee/choice deadline; review explicit time limit from the communication/PDF.',
    });
  }

  const rule70a = ctx.findRule70aAnchor();
  const rule702 = ctx.findRule702Anchor();
  const combined70 = rule70a && rule702 && (sameDay(rule70a, rule702) || /rule\s*70\(2\)/i.test(`${rule70a.title} ${rule70a.detail}`));
  if (combined70) {
    ctx.addMonthsDeadline({
      record: rule702,
      label: 'Rule 70(2) / Rule 70a shared response period',
      months: 6,
      level: 'bad',
      internalKey: 'POST_SEARCH_R70A_REPLY',
      phase: 'post_search',
      namespace: 'first_instance',
      methodPrefix: 'Rule-based',
    });
    ctx._skipStandaloneRule702 = true;
  } else if (rule70a && !ctx.hasPdfHint(/Rule 70a/i)) {
    ctx.pushReviewItem({
      label: 'Rule 70a reply to search opinion (manual review)',
      record: rule70a,
      level: 'warn',
      internalKey: 'POST_SEARCH_R70A_REPLY',
      phase: 'post_search',
      namespace: 'first_instance',
      method: 'Derived from the paired Rule 70 communication; review the governing communication/PDF for the actual shared due date.',
    });
  }
}

function appendCoreCommunicationDeadlines(ctx) {
  const r71Anchors = ctx.findR71Anchors();
  const latestR71 = r71Anchors[0] || null;
  const previousR71 = r71Anchors[1] || null;
  const rule716 = ctx.findRule716DisapprovalAnchor();
  const latestR71Date = structuredAnchorDate(latestR71);
  const previousR71Date = structuredAnchorDate(previousR71);
  const rule716Date = structuredAnchorDate(rule716);
  const post713Branch = !!(latestR71 && ((previousR71Date && latestR71Date && previousR71Date.getTime() < latestR71Date.getTime()) || (rule716Date && latestR71Date && rule716Date.getTime() < latestR71Date.getTime())));

  ctx.addMonthsDeadline({
    record: latestR71,
    label: 'R71(3) response period',
    months: 4,
    level: 'bad',
    confidence: 'high',
    internalKey: post713Branch ? 'GRANT_POST_71_3_AMENDMENT' : 'GRANT_R71_3',
    phase: 'grant',
    namespace: 'first_instance',
    extra: post713Branch ? { supersedesKey: 'GRANT_R71_3', branchContext: 'fresh Rule 71(3) issued after disapproval / amendment' } : {},
    resolvedBy: (anchor, rec) => structuredReplyOrPaymentSeen(rec) || ctx.hasFeeSignalAfter(anchor, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections/i) || ctx.hasApplicantResponseAfter(anchor),
  });

  const art94 = ctx.findArt94Anchor();
  if (art94 && !ctx.hasPdfHint(/Art\. 94\(3\) response period/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: art94,
      label: 'Art. 94(3) response period',
      reviewLabel: 'Art. 94(3) examination communication (manual review)',
      level: 'warn',
      internalKey: 'EXAMINATION_ART94_COMM',
      phase: 'examination',
      namespace: 'first_instance',
      method: 'Structured ST.36 Art. 94(3) deadline from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'The communication is response-bearing, but the period is communication-specific unless the parsed document text or ST.36 fields yield an explicit date/period.',
      resolvedBy: (anchor, rec) => structuredReplyOrPaymentSeen(rec) || ctx.hasApplicantResponseAfter(anchor, /reply|response|observations|arguments|amend|claims|request|further processing|re-establishment/i),
    });
  }

  const minutes = ctx.findMinutesFirstActionAnchor();
  if (minutes) {
    ctx.addStructuredOrReviewDeadline({
      record: minutes,
      label: 'Minutes-as-first-action examination communication',
      reviewLabel: 'Minutes-as-first-action examination communication (manual review)',
      level: 'warn',
      internalKey: 'EXAMINATION_MINUTES_AS_FIRST_ACTION',
      phase: 'examination',
      namespace: 'first_instance',
      method: 'Structured ST.36 deadline from first-action minutes / consultation record',
      reviewMethod: 'Review the minutes/consultation text or structured fields to confirm whether they replace the first Art. 94(3) action and set a response period.',
    });
  }

  if (!ctx._skipStandaloneRule702) {
    ctx.addMonthsDeadline({
      record: ctx.findRule702Anchor(),
      label: 'Rule 70(2) confirmation/response period',
      months: 6,
      level: 'warn',
      internalKey: 'POST_SEARCH_R70_2_PROCEED',
      phase: 'post_search',
      namespace: 'first_instance',
      methodPrefix: 'Rule-based',
    });
  }

  const rule161162 = ctx.findRule161162Anchor();
  if (rule161162) {
    const variant = ctx.rule161162Variant(rule161162);
    const label = variant === 'mandatory'
      ? 'Rule 161/162 mandatory response period'
      : (variant === 'voluntary'
        ? 'Rule 161/162 voluntary amendment / claims-fee period'
        : 'Rule 161/162 response period');
    ctx.addMonthsDeadline({
      record: rule161162,
      label,
      months: 6,
      level: 'bad',
      confidence: variant === 'generic' ? 'low' : '',
      internalKey: variant === 'mandatory' ? 'EUROPCT_R161_162_MANDATORY' : (variant === 'voluntary' ? 'EUROPCT_R161_162_VOLUNTARY' : 'EUROPCT_R161_162'),
      phase: 'regional_phase_entry',
      namespace: 'first_instance',
      resolvedBy: (anchor, rec) => structuredReplyOrPaymentSeen(rec) || ctx.hasApplicantResponseAfter(anchor, /reply|response|amend|claims|observations|arguments/i) || ctx.hasFeeSignalAfter(anchor, /claims fee|fee payment received/i),
      methodPrefix: 'Rule-based',
      reviewOnly: variant === 'generic',
    });
  }

  const rule1641 = ctx.findRule1641Anchor();
  if (ctx.isEuroPct && rule1641) {
    ctx.addMonthsDeadline({
      record: rule1641,
      label: 'Rule 164(1) additional search fees',
      months: 2,
      level: 'bad',
      internalKey: 'EUROPCT_R164_1_FEES',
      phase: 'supplementary_search',
      namespace: 'first_instance',
      methodPrefix: 'Rule-based',
    });
  }

  const rule1642 = ctx.findRule1642Anchor();
  if (ctx.isEuroPct && rule1642) {
    ctx.addStructuredOrReviewDeadline({
      record: rule1642,
      label: 'Rule 164(2) unsearched-inventions communication',
      reviewLabel: 'Rule 164(2) unsearched-inventions communication (manual review)',
      level: 'bad',
      internalKey: 'EUROPCT_R164_2_UNSEARCHED',
      phase: 'examination_start',
      namespace: 'first_instance',
      method: 'Structured ST.36 Rule 164(2) deadline from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'The fee/selection period is communication-specific; review the communication/PDF or ST.36 fields for the governing due date.',
    });
  }

  const examSummons = ctx.findSummonsAnchor('examination');
  if (examSummons && !ctx.hasPdfHint(/Rule 116 final date|Oral proceedings date/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: examSummons,
      label: 'Rule 116 final date',
      reviewLabel: 'Examination summons / Rule 116 review',
      level: 'warn',
      internalKey: 'EXAMINATION_SUMMONS',
      phase: 'examination',
      namespace: 'first_instance',
      method: 'Structured ST.36 summons final date from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'Summons require annex parsing: store the oral-proceedings date and any Rule 116 final written-submissions date.',
    });
  }

  const examOral = ctx.findOralProceedingsEvent('examination');
  if (examOral && !ctx.hasPdfHint(/Oral proceedings date/i)) {
    ctx.addAbsoluteDateEntry({
      record: examOral,
      label: 'Oral proceedings date',
      level: 'warn',
      internalKey: 'ORAL_PROCEEDINGS_EVENT',
      phase: 'examination',
      namespace: 'first_instance',
      method: 'Stored from oral-proceedings event chronology.',
    });
  }
}

function appendDirectOrPctDeadlines(ctx) {
  if (!ctx.isEuroPct) {
    return;
  }

  const base31Date = ctx.priorityDate || ctx.filingDate;
  if (!base31Date) return;

  const calc31 = addCalendarMonthsDetailed(base31Date, 31);
  const due31 = calc31.date;
  const isr = ctx.findEuroPctSearchAnchor();
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
    namespace: 'first_instance',
    phase: 'regional_phase_entry',
  });

  ctx.push({
    label: 'Euro-PCT exam/designation deadline (later-of formula)',
    date: dueLater,
    level: 'bad',
    confidence: isrDate ? 'medium' : 'low',
    sourceDate: isrDate ? `${formatDate(base31Date)} / ${isr?.dateStr || ''}` : formatDate(base31Date),
    resolved: ctx.hasFeeSignalAfter(base31Date, /request for examination|examination fee|designation fee|extension fee|validation fee/i),
    reviewOnly: !isrDate,
    method: isrDate ? 'Heuristic: max(31 months from priority/filing, qualifying ISR/WO issue date +6 months)' : 'Rule-based: 31 months from priority/filing (no qualifying ISR/WO date found)',
    rolledOver: dueLaterRolled,
    rolloverNote: dueLaterRollNote,
    namespace: 'first_instance',
    phase: 'regional_phase_entry',
  });
}

function appendLossOfRightsAndRemedyDeadlines(ctx) {
  const rule112 = ctx.findRule112Anchor();
  if (rule112) {
    const underlyingMissedAct = inferMissedActFromReason(`${rule112.stepDescriptionName || ''} ${rule112.detail || ''} ${rule112.title || ''}`);
    ctx.addMonthsDeadline({
      record: rule112,
      label: 'Rule 112 decision-request review window',
      months: 2,
      level: 'warn',
      confidence: 'low',
      reviewOnly: true,
      internalKey: 'LOSS_OF_RIGHTS_R112',
      phase: 'loss_of_rights',
      namespace: 'first_instance',
      methodPrefix: 'Conditional EPC remedy',
      extra: underlyingMissedAct ? { underlyingMissedAct } : {},
      resolvedBy: (anchor, rec) => structuredReplyOrPaymentSeen(rec) || ctx.hasApplicantResponseAfter(anchor, /request for decision|further processing|re-establishment|decision request/i),
    });
  }
}

function appendOppositionAndLimitationDeadlines(ctx) {
  const r791 = ctx.findOppositionRule791Anchor();
  if (r791) {
    ctx.addMonthsDeadline({
      record: r791,
      label: 'Opposition Rule 79(1) proprietor reply',
      months: 4,
      level: 'bad',
      internalKey: 'OPPOSITION_R79_1_PROPRIETOR_REPLY',
      phase: 'opposition',
      namespace: 'opposition',
      methodPrefix: 'Rule-based',
    });
  }

  const r793 = ctx.findOppositionRule793Anchor();
  if (r793 && !ctx.hasPdfHint(/Rule 79\(3\)/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: r793,
      label: 'Opposition Rule 79(3) party-reply communication',
      reviewLabel: 'Opposition Rule 79(3) party-reply communication (manual review)',
      level: 'warn',
      internalKey: 'OPPOSITION_R79_3_OTHER_PARTIES_REPLY',
      phase: 'opposition',
      namespace: 'opposition',
      method: 'Structured ST.36 opposition reply deadline from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'The party-reply period is communication-specific; review the communication/PDF or ST.36 fields for the due date.',
    });
  }

  const orex = ctx.findOppositionOrexAnchor();
  if (orex && !r791 && !r793 && !ctx.hasPdfHint(/Opposition/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: orex,
      label: 'Opposition division communication',
      reviewLabel: 'Opposition division communication (manual review)',
      level: 'warn',
      internalKey: 'OPPOSITION_DIVISION_COMMUNICATION',
      phase: 'opposition',
      namespace: 'opposition',
      method: 'Structured ST.36 opposition deadline from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'Generic OREX-style opposition communication detected; review the communication text or ST.36 fields for the governing deadline.',
    });
  }

  const oppSummons = ctx.findSummonsAnchor('opposition');
  if (oppSummons && !ctx.hasPdfHint(/Rule 116 final date|Oral proceedings date/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: oppSummons,
      label: 'Rule 116 final date',
      reviewLabel: 'Opposition summons / Rule 116 review',
      level: 'warn',
      internalKey: 'OPPOSITION_SUMMONS',
      phase: 'opposition',
      namespace: 'opposition',
      method: 'Structured ST.36 summons final date from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'Summons require annex parsing: store the oral-proceedings date and any Rule 116 final written-submissions date.',
    });
  }

  const oppOral = ctx.findOralProceedingsEvent('opposition');
  if (oppOral && !ctx.hasPdfHint(/Oral proceedings date/i)) {
    ctx.addAbsoluteDateEntry({
      record: oppOral,
      label: 'Opposition oral proceedings date',
      level: 'warn',
      internalKey: 'ORAL_PROCEEDINGS_EVENT',
      phase: 'opposition',
      namespace: 'opposition',
      method: 'Stored from opposition oral-proceedings event chronology.',
    });
  }

  const r821 = ctx.findOppositionRule821Anchor();
  if (r821) {
    ctx.addMonthsDeadline({
      record: r821,
      label: 'Opposition Rule 82(1) maintenance-text observations',
      months: 2,
      level: 'warn',
      internalKey: 'OPPOSITION_R82_1_TEXT',
      phase: 'opposition_endgame',
      namespace: 'opposition',
      methodPrefix: 'Rule-based',
    });
  }

  const r823 = ctx.findOppositionRule823Anchor();
  const r822 = ctx.findOppositionRule822Anchor();
  if (r822) {
    ctx.addMonthsDeadline({
      record: r822,
      label: 'Opposition Rule 82(2) translations + publication fee',
      months: 3,
      level: 'bad',
      internalKey: 'OPPOSITION_R82_2_TRANSLATIONS_FEE',
      phase: 'opposition_endgame',
      namespace: 'opposition',
      methodPrefix: 'Rule-based',
      supersededBy: (anchor, rec) => ctx.findLaterRecordAfter(structuredAnchorDate(rec) || anchor, (r) => /rule\s*82\(3\)|further invitation|surcharge/.test(`${r.title} ${r.detail}`)),
    });
  }

  if (r823) {
    ctx.addMonthsDeadline({
      record: r823,
      label: 'Opposition Rule 82(3) surcharge period',
      months: 2,
      level: 'bad',
      internalKey: 'OPPOSITION_R82_3_SURCHARGE',
      phase: 'opposition_endgame',
      namespace: 'opposition',
      methodPrefix: 'Rule-based',
    });
  }

  const pmap = ctx.findOppositionPmapAnchor();
  if (pmap && !r821 && !r822 && !r823 && !ctx.hasPdfHint(/Rule 82/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: pmap,
      label: 'Opposition Rule 82 branch',
      reviewLabel: 'Opposition Rule 82 branch (manual review)',
      level: 'bad',
      internalKey: 'OPPOSITION_R82_BRANCH',
      phase: 'opposition_endgame',
      namespace: 'opposition',
      method: 'Structured ST.36 Rule 82 branch from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'PMAP-style maintenance branch detected; review the communication text or ST.36 fields to distinguish Rule 82(1)/(2)/(3) and its governing due date.',
    });
  }

  const l952 = ctx.findLimitationRule952Anchor();
  if (l952) {
    ctx.addMonthsDeadline({
      record: l952,
      label: 'Limitation Rule 95(2) correction period',
      months: 2,
      level: 'warn',
      internalKey: 'LIMITATION_R95_2_DEFICIENCIES',
      phase: 'limitation',
      namespace: 'limitation',
      methodPrefix: 'Rule-based',
    });
  }

  const l953 = ctx.findLimitationRule953Anchor();
  if (l953) {
    ctx.addMonthsDeadline({
      record: l953,
      label: 'Limitation Rule 95(3) translations + fee',
      months: 3,
      level: 'bad',
      internalKey: 'LIMITATION_R95_3_ALLOWABLE',
      phase: 'limitation',
      namespace: 'limitation',
      methodPrefix: 'Rule-based',
    });
  }

  const lire = ctx.findLimitationLireAnchor();
  if (lire && !l952 && !l953 && !ctx.hasPdfHint(/Rule 95/i)) {
    ctx.addStructuredOrReviewDeadline({
      record: lire,
      label: 'Limitation communication',
      reviewLabel: 'Limitation communication (manual review)',
      level: 'warn',
      internalKey: 'LIMITATION_COMMUNICATION',
      phase: 'limitation',
      namespace: 'limitation',
      method: 'Structured ST.36 limitation deadline from DATE_OF_DISPATCH + time-limit in record',
      reviewMethod: 'Limitation communication detected; review the communication text or ST.36 fields to distinguish the applicable Rule 95 branch and due date.',
    });
  }
}

function appendPostGrantDeadlines(ctx) {
  const noOpposition = ctx.findNoOppositionRecord();
  const noOppositionDate = parseDateString(noOpposition?.dateStr || '');
  const closedByNoOpposition = (dueDate) => !!(noOppositionDate && dueDate && noOppositionDate.getTime() >= dueDate.getTime());

  const grantMention = ctx.findGrantMentionAnchor();
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
        resolved: closedByNoOpposition(calcOpp.date),
        method: 'Rule-based: grant mention +9 months',
        rolledOver: calcOpp.rolledOver,
        rolloverNote: calcOpp.rolledOver ? `day ${calcOpp.fromDay}→${calcOpp.toDay}` : '',
        namespace: 'opposition',
        phase: 'post_grant',
      });
      const calcUe = addCalendarMonthsDetailed(anchor, 1);
      ctx.push({
        label: 'Unitary effect request window',
        date: calcUe.date,
        level: 'warn',
        confidence: 'high',
        sourceDate: grantMention.dateStr,
        resolved: ctx.hasAfter(anchor, (r) => /unitary effect/i.test(`${r.title} ${r.detail}`)) || closedByNoOpposition(calcUe.date),
        method: 'Rule-based: grant mention +1 month',
        rolledOver: calcUe.rolledOver,
        rolloverNote: calcUe.rolledOver ? `day ${calcUe.fromDay}→${calcUe.toDay}` : '',
        namespace: 'unitary_patent',
        internalKey: 'UNITARY_PATENT_EVENT',
        phase: 'up',
      });
    }
  }

  const decision = ctx.findAppealableDecisionAnchor();
  if (decision) {
    const anchorContext = notificationAnchorContext(decision, structuredAnchorDate(decision), true);
    const anchor = anchorContext.anchorDate;
    if (anchor) {
      const decisionLow = normalize(`${decision.title || ''} ${decision.detail || ''}`).toLowerCase();
      const decisionAnchorKey = /refusal|decision to refuse|refusal of the application/.test(decisionLow) ? 'DECISION_REFUSAL' : '';
      if (decisionAnchorKey) {
        ctx.push({
          label: 'Refusal decision / appeal anchor',
          date: anchor,
          level: 'info',
          confidence: ctx.recordConfidence ? ctx.recordConfidence(decision, 'high') : 'high',
          sourceDate: anchorContext.sourceDate,
          notificationDate: anchorContext.notificationDate,
          resolved: false,
          anchorOnly: true,
          namespace: 'appeal',
          internalKey: decisionAnchorKey,
          phase: 'decision',
          method: anchorContext.usedNotificationFiction ? 'Decision anchor routed to appeal branch (dispatch date + Rule 126(2) 10-day notification fiction).' : 'Decision anchor routed to appeal branch.',
        });
      }
      const calcNotice = addCalendarMonthsDetailed(anchor, 2);
      ctx.push({
        label: 'Appeal notice + fee',
        date: calcNotice.date,
        level: 'bad',
        confidence: 'high',
        sourceDate: anchorContext.sourceDate,
        notificationDate: anchorContext.notificationDate,
        resolved: ctx.hasAfter(anchor, (r) => /notice of appeal|appeal fee/i.test(`${r.title} ${r.detail}`)) || closedByNoOpposition(calcNotice.date),
        method: anchorContext.usedNotificationFiction ? 'Rule-based: decision dispatch + Rule 126(2) 10-day notification fiction +2 months' : 'Rule-based: decision date +2 months',
        rolledOver: calcNotice.rolledOver,
        rolloverNote: calcNotice.rolledOver ? `day ${calcNotice.fromDay}→${calcNotice.toDay}` : '',
        namespace: 'appeal',
        internalKey: 'APPEAL_EVENT',
        anchorInternalKey: decisionAnchorKey,
        phase: 'appeal',
      });
      const calcGrounds = addCalendarMonthsDetailed(anchor, 4);
      ctx.push({
        label: 'Appeal grounds',
        date: calcGrounds.date,
        level: 'bad',
        confidence: 'high',
        sourceDate: anchorContext.sourceDate,
        notificationDate: anchorContext.notificationDate,
        resolved: ctx.hasAfter(anchor, (r) => /grounds of appeal|statement of grounds/i.test(`${r.title} ${r.detail}`)) || closedByNoOpposition(calcGrounds.date),
        method: anchorContext.usedNotificationFiction ? 'Rule-based: decision dispatch + Rule 126(2) 10-day notification fiction +4 months' : 'Rule-based: decision date +4 months',
        rolledOver: calcGrounds.rolledOver,
        rolloverNote: calcGrounds.rolledOver ? `day ${calcGrounds.fromDay}→${calcGrounds.toDay}` : '',
        namespace: 'appeal',
        internalKey: 'APPEAL_EVENT',
        anchorInternalKey: decisionAnchorKey,
        phase: 'appeal',
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

function inferProceduralDeadlinesFromSources({ main = {}, docs = [], eventHistory = {}, legal = {}, pdfData = {} } = {}) {
  const ctx = buildDeadlineComputationContext({ main, docs, eventHistory, legal, pdfData });
  appendPdfDerivedDeadlines(ctx);
  appendSearchStageDeadlines(ctx);
  appendCoreCommunicationDeadlines(ctx);
  appendDirectOrPctDeadlines(ctx);
  appendLossOfRightsAndRemedyDeadlines(ctx);
  appendOppositionAndLimitationDeadlines(ctx);
  appendPostGrantDeadlines(ctx);
  appendReferenceDeadlines(ctx);
  return dedupe(ctx.out, (d) => `${d.label}|${formatDate(d.date)}|${d.sourceDate || ''}|${d.reviewOnly ? 'review' : ''}|${d.internalKey || ''}|${d.namespace || ''}|${d.anchorOnly ? 'anchor' : ''}`);
}

module.exports = {
  addCalendarMonthsDetailed,
  addCalendarDaysDetailed,
  addRule126NotificationFiction,
  pdfHintsWithParsedDates,
  isTerminalEpoOutcomeText,
  buildDeadlineComputationContext,
  appendPdfDerivedDeadlines,
  appendSearchStageDeadlines,
  appendCoreCommunicationDeadlines,
  appendDirectOrPctDeadlines,
  appendLossOfRightsAndRemedyDeadlines,
  appendOppositionAndLimitationDeadlines,
  appendPostGrantDeadlines,
  appendReferenceDeadlines,
  inferProceduralDeadlinesFromSources,
  isActualGrantMentionText,
};
