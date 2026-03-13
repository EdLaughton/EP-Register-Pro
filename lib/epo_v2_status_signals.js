const { normalize } = require('./epo_v2_utils');

function matchStatusRule(text, rules, fallback) {
  const low = normalize(text).toLowerCase();
  for (const rule of rules) {
    if (rule.test(low, text)) return typeof rule.value === 'function' ? rule.value(text, low) : rule.value;
  }
  return typeof fallback === 'function' ? fallback(text, low) : fallback;
}

const STATUS_STAGE_RULES = Object.freeze([
  { test: (low) => /revoked|refused|withdrawn|deemed to be withdrawn|lapsed|expired|closed/.test(low), value: 'Closed' },
  { test: (low) => /no opposition filed within time limit/.test(low), value: 'Post-grant' },
  { test: (low) => /patent has been granted|the patent has been granted|grant decision|decision to grant/.test(low), value: 'Granted' },
  { test: (low) => /grant of patent is intended|rule\s*71\(3\)|intention to grant/.test(low), value: 'R71 / grant intended' },
  { test: (low) => /article\s*94\(3\)|art\.\s*94\(3\)|examining division|request for examination was made|examination/.test(low), value: 'Examination' },
  { test: (low) => /search report|search opinion|written opinion|\bsearch\b/.test(low), value: 'Search' },
  { test: (low) => /filing/.test(low), value: 'Filing' },
  { test: (low) => /published|publication/.test(low), value: 'Post-publication' },
]);

const STATUS_SUMMARY_RULES = Object.freeze([
  { test: (low) => !low, value: { simple: 'Unknown', level: 'warn' } },
  { test: (low) => /no opposition filed within time limit/.test(low), value: { simple: 'Granted (no opposition)', level: 'ok' } },
  { test: (low, raw) => /grant of patent is intended|rule\s*71\(3\)/i.test(raw), value: { simple: 'Grant intended (R71(3))', level: 'warn' } },
  { test: (low) => /patent has been granted|the patent has been granted/.test(low), value: { simple: 'Granted', level: 'ok' } },
  { test: (low) => /application deemed to be withdrawn.*non-entry into european phase/.test(low), value: { simple: 'Deemed withdrawn (non-entry)', level: 'bad' } },
  { test: (low) => /application deemed to be withdrawn.*translations of claims\/payment missing/.test(low), value: { simple: 'Deemed withdrawn (grant formalities)', level: 'bad' } },
  { test: (low) => /application deemed to be withdrawn.*non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(low), value: { simple: 'Deemed withdrawn (fees / no WO reply)', level: 'bad' } },
  { test: (low) => /application deemed to be withdrawn.*non-reply to written opinion/.test(low), value: { simple: 'Deemed withdrawn (no WO reply)', level: 'bad' } },
  { test: (low) => /deemed to be withdrawn/.test(low), value: { simple: 'Deemed withdrawn', level: 'bad' } },
  { test: (low) => /withdrawn by applicant|application withdrawn/.test(low), value: { simple: 'Withdrawn', level: 'bad' } },
  { test: (low) => /revoked|refused|expired|lapsed/.test(low), value: { simple: 'Closed', level: 'bad' } },
  { test: (low) => /application has been published|has been published/.test(low), value: { simple: 'Published', level: 'info' } },
  { test: (low) => /request for examination was made|examination/.test(low), value: { simple: 'Examination', level: 'info' } },
  { test: (low) => /search/.test(low), value: { simple: 'Search', level: 'info' } },
]);

function inferStatusStageFromText(statusRaw = '') {
  return matchStatusRule(statusRaw, STATUS_STAGE_RULES, '');
}

function summarizeStatusText(statusRaw = '') {
  return matchStatusRule(statusRaw, STATUS_SUMMARY_RULES, (raw) => {
    const oneLine = normalize(String(raw || '').split('\n')[0] || raw);
    return { simple: oneLine || 'Unknown', level: 'info' };
  });
}

module.exports = {
  STATUS_STAGE_RULES,
  STATUS_SUMMARY_RULES,
  inferStatusStageFromText,
  summarizeStatusText,
};
