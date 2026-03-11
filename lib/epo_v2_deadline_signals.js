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

function buildDeadlineComputationContext({ main = {}, docs = [], eventHistory = {}, legal = {}, pdfData = {} } = {}) {
  const out = [];
  const records = buildProceduralRecords(docs, eventHistory, legal);
  const pdfHints = pdfHintsWithParsedDates(pdfData);
  const appType = normalize(main.applicationType || '').toLowerCase();
  const isEuroPct = /e\/pct/.test(appType);
  const isDivisional = /divisional/.test(appType);
  const priorityDate = main.priorities?.[0] ? parseDateString(main.priorities[0].dateStr) : null;
  const filingDate = parseDateString(main.filingDate);

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
    terminalEpoOutcomeAfter,
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
};
