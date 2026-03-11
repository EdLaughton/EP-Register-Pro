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
  const latestRecovery = postureRecordByCodex(records, ['FURTHER_PROCESSING_DECISION', 'FURTHER_PROCESSING_REQUEST'])
    || postureRecord(records, /decision to allow further processing|further processing|request for further processing|re-establishment|rights re-established/);
  const latestGrantDecision = postureRecordByCodex(records, ['EXPECTED_GRANT'])
    || postureRecord(records, /decision to grant a european patent|mention of grant|patent granted|the patent has been granted/);
  const latestNoOpposition = postureRecordByCodex(records, ['NO_OPPOSITION_FILED'])
    || postureRecord(records, /no opposition filed within time limit/);
  const latestR71 = postureRecordByCodex(records, ['GRANT_R71_3_EVENT'])
    || postureRecord(records, /grant of patent is intended|intention to grant|rule\s*71\(3\)|text intended for grant/);
  const latestSearchPublication = postureRecordByCodex(records, ['SEARCH_REPORT_PUBLICATION']);

  const latestLossDate = postureRecordDate(latestLoss);
  const latestRecoveryDate = postureRecordDate(latestRecovery);
  const latestGrantDecisionDate = postureRecordDate(latestGrantDecision);
  const recovered = !!(latestLossDate && latestRecoveryDate && latestRecoveryDate >= latestLossDate);
  const recoveredBeforeGrant = !!(recovered && latestGrantDecisionDate && latestGrantDecisionDate >= latestRecoveryDate);
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
    note = `Recovered from earlier ${postureLossLabel(effectiveLoss)} via ${postureRecoveryLabel(latestRecovery)} before grant.`;
  } else if (recovered) {
    note = `Recovered from earlier ${postureLossLabel(effectiveLoss)} via ${postureRecoveryLabel(latestRecovery)}.`;
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
    recoveredBeforeGrant,
    currentClosed,
    currentGranted,
    currentNoOpposition,
    currentGrantIntended,
    currentExamination,
    currentSearch,
    latestLoss: effectiveLoss,
    latestRecovery,
    latestGrantDecision,
    latestNoOpposition,
    latestR71,
  };
}

module.exports = {
  POSTURE_LOSS_LABEL_RULES,
  POSTURE_RECOVERY_LABEL_RULES,
  postureLossLabel,
  postureRecoveryLabel,
  postureRecord,
  postureRecordByCodex,
  postureRecordDate,
  deriveProceduralPosture,
};
