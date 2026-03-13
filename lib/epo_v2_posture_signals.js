const { summarizeStatusText } = require('./epo_v2_status_signals');

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDateString(value = '') {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareDateDesc(a, b) {
  return (parseDateString(b?.dateStr)?.getTime() || 0) - (parseDateString(a?.dateStr)?.getTime() || 0);
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

function inferRecordActor(entry = {}) {
  return /applicant|filed by applicant|by applicant/i.test(`${entry.title || ''} ${entry.detail || ''}`) ? 'Applicant' : 'EPO';
}

function buildProceduralRecords(docs = [], eventHistory = {}, legal = {}) {
  const sortedDocs = [...(docs || [])].sort(compareDateDesc);
  const sortedEvents = dedupe([...(eventHistory.events || []), ...(legal.events || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}`).sort(compareDateDesc);
  const sortedCodedEvents = dedupe([...(legal.codedEvents || [])], (e) => `${e.dateStr}|${e.title}|${e.detail}|${e.originalCode}|${e.codexKey}`).sort(compareDateDesc);
  return dedupe([
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
      actor: inferRecordActor(e),
      source: 'Event',
      codexKey: e.codexKey || '',
      codexPhase: e.codexPhase || '',
      codexClass: e.codexClass || '',
    })),
    ...sortedCodedEvents.map((e) => ({
      dateStr: e.dateStr,
      title: e.title || '',
      detail: e.detail || '',
      actor: inferRecordActor(e),
      source: 'Coded legal event',
      codexKey: e.codexKey || '',
      codexPhase: e.codexPhase || '',
      codexClass: e.codexClass || '',
      originalCode: e.originalCode || '',
      effectiveDate: e.effectiveDate || '',
      freeFormatText: e.freeFormatText || '',
      stepDescriptionName: e.stepDescriptionName || '',
      dispatchDate: e.dispatchDate || '',
      replyDate: e.replyDate || '',
      paymentDate: e.paymentDate || '',
      paymentDates: Array.isArray(e.paymentDates) ? [...e.paymentDates] : [],
      requestDate: e.requestDate || '',
      resultDate: e.resultDate || '',
      timeLimitRaw: e.timeLimitRaw || '',
      timeLimitMonths: Number(e.timeLimitMonths || 0),
      timeLimitDate: e.timeLimitDate || '',
    })),
  ], (r) => `${r.dateStr}|${r.title}|${r.detail}|${r.source}|${r.codexKey || ''}`).sort(compareDateDesc);
}

function postureRecord(records = [], regex) {
  return (records || []).find((record) => regex.test(`${record.title || ''} ${record.detail || ''}`.toLowerCase())) || null;
}

function postureRecordByCodex(records = [], internalKeys = []) {
  const keys = new Set((internalKeys || []).filter(Boolean));
  return (records || []).find((record) => record.codexKey && keys.has(record.codexKey)) || null;
}

function postureRecordDate(record) {
  return parseDateString(record?.dateStr || '');
}

const POSTURE_LOSS_LABEL_RULES = Object.freeze([
  { test: (text) => /non-entry into european phase/.test(text), value: 'non-entry into European phase' },
  { test: (text) => /translations of claims\/payment missing/.test(text), value: 'grant-formalities failure' },
  { test: (text) => /non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(text), value: 'fees / written-opinion failure' },
  { test: (text) => /non-reply to written opinion/.test(text), value: 'no reply to the written opinion' },
  { test: (text) => /loss of rights|rule\s*112\(1\)/.test(text), value: 'loss-of-rights communication' },
  { test: (text) => /withdrawn/.test(text), value: 'withdrawn posture' },
]);

const POSTURE_RECOVERY_LABEL_RULES = Object.freeze([
  { test: (text) => /further processing/.test(text), value: 'further processing' },
  { test: (text) => /re-establishment|rights re-established/.test(text), value: 're-establishment' },
]);

function matchRule(text = '', rules = [], fallback = '') {
  const low = normalize(text).toLowerCase();
  for (const rule of rules) {
    if (rule.test(low, text)) return typeof rule.value === 'function' ? rule.value(text, low) : rule.value;
  }
  return fallback;
}

function postureLossLabel(record) {
  return matchRule(`${record?.title || ''} ${record?.detail || ''}`, POSTURE_LOSS_LABEL_RULES, 'adverse procedural posture');
}

function postureRecoveryLabel(record) {
  return matchRule(`${record?.title || ''} ${record?.detail || ''}`, POSTURE_RECOVERY_LABEL_RULES, 'recovery procedure');
}

function deriveProceduralPosture({ statusRaw = '', records = [] } = {}) {
  const normalizedStatusRaw = normalize(statusRaw);
  const statusSummary = summarizeStatusText(normalizedStatusRaw);
  const statusLow = normalizedStatusRaw.toLowerCase();
  const latestLoss = postureRecordByCodex(records, ['LOSS_OF_RIGHTS_EVENT', 'APPLICATION_DEEMED_WITHDRAWN'])
    || postureRecord(records, /application deemed to be withdrawn|deemed to be withdrawn|loss of rights|rule\s*112\(1\)|application refused|application rejected|revoked|withdrawn by applicant|application withdrawn/);
  const detailedLoss = postureRecord(records, /non-entry into european phase|translations of claims\/payment missing|non-payment of examination fee\/designation fee\/non-reply to written opinion|non-reply to written opinion/);
  const effectiveLoss = detailedLoss || latestLoss;
  const latestRecoveryDecision = postureRecordByCodex(records, ['FURTHER_PROCESSING_DECISION'])
    || postureRecord(records, /decision on request for further processing|decision to allow further processing|re-establishment|rights re-established/);
  const latestRecoveryRequest = postureRecordByCodex(records, ['FURTHER_PROCESSING_REQUEST'])
    || postureRecord(records, /request for further processing/);
  const latestRecovery = latestRecoveryDecision || latestRecoveryRequest;
  const latestGrantDecision = postureRecordByCodex(records, ['EXPECTED_GRANT'])
    || postureRecord(records, /decision to grant a european patent|mention of grant|patent granted|the patent has been granted/);
  const latestNoOpposition = postureRecordByCodex(records, ['NO_OPPOSITION_FILED'])
    || postureRecord(records, /no opposition filed within time limit/);
  const latestR71 = postureRecordByCodex(records, ['GRANT_R71_3_EVENT'])
    || postureRecord(records, /grant of patent is intended|intention to grant|rule\s*71\(3\)|text intended for grant/);
  const latestSearchPublication = postureRecordByCodex(records, ['SEARCH_REPORT_PUBLICATION']);

  const latestLossDate = postureRecordDate(latestLoss);
  const latestRecoveryDecisionDate = postureRecordDate(latestRecoveryDecision);
  const latestRecoveryRequestDate = postureRecordDate(latestRecoveryRequest);
  const latestGrantDecisionDate = postureRecordDate(latestGrantDecision);
  const recovered = !!(latestLossDate && latestRecoveryDecisionDate && latestRecoveryDecisionDate >= latestLossDate);
  const recoveryPending = !!(latestLossDate && latestRecoveryRequestDate && latestRecoveryRequestDate >= latestLossDate && !recovered);
  const recoveredBeforeGrant = !!(recovered && latestGrantDecisionDate && latestGrantDecisionDate >= latestRecoveryDecisionDate);
  const currentClosed = statusSummary.level === 'bad';
  const currentNoOpposition = /granted \(no opposition\)/i.test(statusSummary.simple || '') || /no opposition filed within time limit/i.test(statusLow) || !!latestNoOpposition;
  const currentGranted = currentNoOpposition || /^granted$/i.test(statusSummary.simple || '') || /patent has been granted|the patent has been granted/i.test(statusLow) || !!latestGrantDecision;
  const currentGrantIntended = /grant intended/i.test(statusSummary.simple || '') || /grant of patent is intended|rule\s*71\(3\)|intention to grant/i.test(statusLow) || !!latestR71;
  const currentExamination = /request for examination was made|examination/.test(statusLow) && !currentClosed;
  const currentSearch = (/published|search/.test(statusLow) || !!latestSearchPublication) && !currentClosed && !currentGrantIntended && !currentGranted;

  let currentLabel = statusSummary.simple;
  let currentLevel = statusSummary.level;
  if (currentClosed && effectiveLoss) {
    const lossText = `${effectiveLoss.title || ''} ${effectiveLoss.detail || ''}`.toLowerCase();
    if (/non-entry into european phase/.test(lossText)) {
      currentLabel = 'Deemed withdrawn (non-entry)';
      currentLevel = 'bad';
    } else if (/translations of claims\/payment missing/.test(lossText)) {
      currentLabel = 'Deemed withdrawn (grant formalities)';
      currentLevel = 'bad';
    } else if (/non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(lossText)) {
      currentLabel = 'Deemed withdrawn (fees / no WO reply)';
      currentLevel = 'bad';
    } else if (/non-reply to written opinion/.test(lossText)) {
      currentLabel = 'Deemed withdrawn (no WO reply)';
      currentLevel = 'bad';
    }
  } else if (currentNoOpposition) {
    currentLabel = 'Granted (no opposition)';
    currentLevel = 'ok';
  } else if (currentGranted) {
    currentLabel = 'Granted';
    currentLevel = 'ok';
  } else if (currentGrantIntended) {
    currentLabel = 'Grant intended (R71(3))';
    currentLevel = 'warn';
  } else if (currentExamination) {
    currentLabel = 'Examination';
    currentLevel = 'info';
  } else if (currentSearch) {
    currentLabel = 'Search';
    currentLevel = 'info';
  }

  let note = '';
  if (recoveredBeforeGrant) {
    note = `Recovered from earlier ${postureLossLabel(effectiveLoss)} via ${postureRecoveryLabel(latestRecoveryDecision)} before grant.`;
  } else if (recovered) {
    note = `Recovered from earlier ${postureLossLabel(effectiveLoss)} via ${postureRecoveryLabel(latestRecoveryDecision)}.`;
  } else if (recoveryPending) {
    note = `Recovery requested via ${postureRecoveryLabel(latestRecoveryRequest)}; EPO outcome pending.`;
  } else if (currentClosed && effectiveLoss) {
    note = `Current controlling posture is ${postureLossLabel(effectiveLoss)}.`;
  } else if (currentGrantIntended && latestR71) {
    note = 'Current controlling posture is Rule 71(3) / intention-to-grant.';
  } else if (currentNoOpposition) {
    note = 'Current controlling posture is granted with the opposition period closed.';
  } else if (currentGranted) {
    note = 'Current controlling posture is granted / post-grant.';
  } else if (currentExamination) {
    note = 'Current controlling posture is active examination.';
  } else if (currentSearch) {
    note = 'Current controlling posture is search / publication stage.';
  }

  return {
    label: currentLabel,
    level: currentLevel,
    currentLabel,
    currentLevel,
    note,
    recovered,
    recoveryPending,
    recoveredBeforeGrant,
    currentClosed,
    currentGranted,
    currentNoOpposition,
    currentGrantIntended,
    currentExamination,
    currentSearch,
    latestLoss: effectiveLoss,
    latestRecovery,
    latestRecoveryDecision,
    latestRecoveryRequest,
    latestGrantDecision,
    latestNoOpposition,
    latestR71,
  };
}

function deriveProceduralPostureFromSources({ statusRaw = '', docs = [], eventHistory = {}, legal = {} } = {}) {
  return deriveProceduralPosture({
    statusRaw,
    records: buildProceduralRecords(docs, eventHistory, legal),
  });
}

module.exports = {
  POSTURE_LOSS_LABEL_RULES,
  POSTURE_RECOVERY_LABEL_RULES,
  buildProceduralRecords,
  postureLossLabel,
  postureRecoveryLabel,
  postureRecord,
  postureRecordByCodex,
  postureRecordDate,
  deriveProceduralPosture,
  deriveProceduralPostureFromSources,
};
