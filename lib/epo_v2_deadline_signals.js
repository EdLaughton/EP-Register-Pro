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

  const push = (entry) => {
    if (!entry?.date || Number.isNaN(entry.date.getTime())) return;
    const dueDate = entry.date;
    const anchorDate = parseDateString(entry.sourceDate || '') || dueDate;
    const terminal = terminalEpoOutcomeAfter(anchorDate, dueDate);
    const next = { ...entry };
    if (terminal && !next.resolved) {
      next.superseded = true;
      next.supersededBy = terminal;
      next.method = normalize([next.method || '', `superseded by later EPO outcome on ${terminal.dateStr}`].filter(Boolean).join(' · '));
    }
    out.push(next);
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

    if (/rule 116/.test(l)) {
      return hasApplicantResponseAfter(anchorDate, /response|request|submission|oral proceedings|withdrawal/i);
    }

    return hasApplicantResponseAfter(anchorDate);
  };

  const rawItemDetail = (item = {}) => item.detail || item.procedure || item.freeFormatText || '';
  const anchorRecordFromItem = (item = {}, source = '') => ({
    dateStr: item.dateStr || '',
    title: item.title || '',
    detail: rawItemDetail(item),
    actor: item.actor || '',
    source: source || item.source || '',
    codexKey: item.codexKey || '',
    originalCode: item.originalCode || '',
    effectiveDate: item.effectiveDate || '',
  });

  const pickPreferredAnchor = (plans = []) => {
    for (const plan of plans) {
      const items = Array.isArray(plan?.items) ? plan.items : [];
      const predicate = typeof plan?.predicate === 'function' ? plan.predicate : null;
      if (!predicate) continue;
      const match = items.find((item) => predicate(item, normalize(`${item?.title || ''} ${rawItemDetail(item)}`.toLowerCase())));
      if (match) return anchorRecordFromItem(match, plan.source);
    }
    return null;
  };

  const addMonthsDeadline = ({ record = null, triggerRegex = null, label, months, level, confidence = 'medium', resolvedBy }) => {
    if (hasPdfHint(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) return;
    const rec = record || (triggerRegex ? latestRecord(triggerRegex) : null);
    if (!rec) return;
    const anchor = parseDateString(rec.dateStr);
    if (!anchor) return;

    const resolved = typeof resolvedBy === 'function'
      ? !!resolvedBy(anchor, rec)
      : hasApplicantResponseAfter(anchor);

    const calc = addCalendarMonthsDetailed(anchor, months);
    const sourceLabel = normalize(String(rec.source || 'preferred source')).toLowerCase() || 'preferred source';
    push({
      label,
      date: calc.date,
      level,
      confidence,
      sourceDate: rec.dateStr,
      resolved,
      method: `Heuristic: +${months} month(s) from ${sourceLabel} trigger`,
      rolledOver: calc.rolledOver,
      rolloverNote: calc.rolledOver ? `day ${calc.fromDay}→${calc.toDay}` : '',
    });
  };

  const findNoOppositionRecord = () => pickPreferredAnchor([
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.codexKey === 'NO_OPPOSITION_FILED' || /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => e.codexKey === 'NO_OPPOSITION_FILED' || /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
    { items: records, source: 'Event', predicate: (r, low) => /no opposition filed within time limit|\bno opposition filed\b/.test(low) },
  ]);

  const findR71Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /communication about intention to grant a european patent|communication of intention to grant a patent/.test(low) },
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /text intended for grant|intention to grant \(signatures\)|annex to the communication about intention to grant/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => e.originalCode === 'EPIDOSNIGR1' || /despatch of communication of intention to grant a patent/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => e.codexKey === 'GRANT_R71_3_EVENT' || /new entry: communication of intention to grant a patent|communication of intention to grant a patent/.test(low) },
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => /despatch of communication of intention to grant a patent/.test(low) },
  ]);

  const findArt94Anchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /article\s*94\(3\)|art\.\s*94\(3\)|communication pursuant to article 94\(3\)/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /article\s*94\(3\)|art\.\s*94\(3\)|communication pursuant to article 94\(3\)/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /article\s*94\(3\)|art\.\s*94\(3\)|communication pursuant to article 94\(3\)/.test(low) },
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

  const findEuroPctSearchAnchor = () => pickPreferredAnchor([
    {
      items: docsDesc,
      source: 'Documents',
      predicate: (d, low) => d.actor === 'EPO'
        && (/copy of the international search report|international publication of the international search report|written opinion of the isa|partial international search report|\bisr:\b/.test(low))
        && !(/non-reply to written opinion|correction of deficiencies in written opinion|reply to|communication concerning|reminder period|deemed to be withdrawn/.test(low)),
    },
  ]);

  const findGrantMentionAnchor = () => pickPreferredAnchor([
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => isActualGrantMentionText(low) && !(/expected grant|information on the status/.test(low)) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => isActualGrantMentionText(low) && !(/expected grant|information on the status/.test(low)) },
    { items: records, source: 'Event', predicate: (r, low) => isActualGrantMentionText(low) && !(/expected grant|information on the status/.test(low)) },
  ]);

  const findAppealableDecisionAnchor = () => pickPreferredAnchor([
    { items: docsDesc, source: 'Documents', predicate: (d, low) => d.actor === 'EPO' && /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain/.test(low) },
    { items: codedEventsDesc, source: 'Coded legal event', predicate: (e, low) => /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain/.test(low) },
    { items: eventDesc, source: 'Event', predicate: (e, low) => /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain/.test(low) },
    { items: legalEventsDesc, source: 'Event', predicate: (e, low) => /decision to grant a european patent|decision to refuse|decision to revoke|decision to maintain/.test(low) },
  ]);

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
    terminalEpoOutcomeAfter,
    resolveHintByActivity,
    addMonthsDeadline,
    findNoOppositionRecord,
    findR71Anchor,
    findArt94Anchor,
    findRule702Anchor,
    findRule161162Anchor,
    findEuroPctSearchAnchor,
    findGrantMentionAnchor,
    findAppealableDecisionAnchor,
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
    record: ctx.findR71Anchor(),
    label: 'R71(3) response period',
    months: 4,
    level: 'bad',
    confidence: 'high',
    resolvedBy: (anchor) => ctx.hasFeeSignalAfter(anchor, /grant and (?:publishing|publication) fee|claims translation|excess claims fee|rule\s*71\(6\)|amendments\/corrections/i) || ctx.hasApplicantResponseAfter(anchor),
  });

  if (ctx.findArt94Anchor() && ctx.hasPdfHint(/Art\. 94\(3\) response period/i)) {
    // Keep explicit Art. 94(3) deadline computation tied to parsed communication text/PDF evidence.
  }

  ctx.addMonthsDeadline({
    record: ctx.findRule702Anchor(),
    label: 'Rule 70(2) confirmation/response period',
    months: 6,
    level: 'warn',
    confidence: 'high',
  });

  ctx.addMonthsDeadline({
    record: ctx.findRule161162Anchor(),
    label: 'Rule 161/162 response period',
    months: 6,
    level: 'bad',
    confidence: 'high',
    resolvedBy: (anchor) => ctx.hasApplicantResponseAfter(anchor, /reply|response|amend|claims|observations|arguments/i) || ctx.hasFeeSignalAfter(anchor, /claims fee|fee payment received/i),
  });
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
  });

  ctx.push({
    label: 'Euro-PCT exam/designation deadline (later-of formula)',
    date: dueLater,
    level: 'bad',
    confidence: isrDate ? 'medium' : 'low',
    sourceDate: isrDate ? `${formatDate(base31Date)} / ${isr?.dateStr || ''}` : formatDate(base31Date),
    resolved: ctx.hasFeeSignalAfter(base31Date, /request for examination|examination fee|designation fee|extension fee|validation fee/i),
    method: isrDate ? 'Heuristic: max(31 months from priority/filing, qualifying ISR/WO issue date +6 months)' : 'Rule-based: 31 months from priority/filing (no qualifying ISR/WO date found)',
    rolledOver: dueLaterRolled,
    rolloverNote: dueLaterRollNote,
  });
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
      });
    }
  }

  const decision = ctx.findAppealableDecisionAnchor();
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
        resolved: ctx.hasAfter(anchor, (r) => /notice of appeal|appeal fee/i.test(`${r.title} ${r.detail}`)) || closedByNoOpposition(calcNotice.date),
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
        resolved: ctx.hasAfter(anchor, (r) => /grounds of appeal|statement of grounds/i.test(`${r.title} ${r.detail}`)) || closedByNoOpposition(calcGrounds.date),
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

function inferProceduralDeadlinesFromSources({ main = {}, docs = [], eventHistory = {}, legal = {}, pdfData = {} } = {}) {
  const ctx = buildDeadlineComputationContext({ main, docs, eventHistory, legal, pdfData });
  appendPdfDerivedDeadlines(ctx);
  appendCoreCommunicationDeadlines(ctx);
  appendDirectOrPctDeadlines(ctx);
  appendPostGrantDeadlines(ctx);
  appendReferenceDeadlines(ctx);
  return dedupe(ctx.out, (d) => `${d.label}|${formatDate(d.date)}|${d.sourceDate || ''}`);
}

module.exports = {
  addCalendarMonthsDetailed,
  pdfHintsWithParsedDates,
  isTerminalEpoOutcomeText,
  buildDeadlineComputationContext,
  appendPdfDerivedDeadlines,
  appendCoreCommunicationDeadlines,
  appendDirectOrPctDeadlines,
  appendPostGrantDeadlines,
  appendReferenceDeadlines,
  inferProceduralDeadlinesFromSources,
  isActualGrantMentionText,
};
