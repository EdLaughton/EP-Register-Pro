const assert = require('assert');
const {
  resolvedOverviewStatus,
  deadlinePresentationBuckets,
  selectNextDeadline,
  activeDeadlineNoteText,
  recoveryActionModel,
  buildActionableOverviewState,
} = require('../lib/epo_v2_overview_signals');

assert.deepStrictEqual(
  resolvedOverviewStatus('ok', { simple: 'Published', level: 'info' }, { currentLabel: 'Grant intended (R71(3))', currentLevel: 'warn' }),
  { simple: 'Grant intended (R71(3))', level: 'warn' },
  'Overview helper should prefer posture-derived headline status over raw status summary when both exist',
);
assert.deepStrictEqual(
  resolvedOverviewStatus('notfound', { simple: 'Published', level: 'info' }, { currentLabel: 'Granted', currentLevel: 'ok' }),
  { simple: 'Not found', level: 'bad' },
  'Overview helper should keep not-found main-state precedence above posture/status summaries',
);

const monitoringOnly = [
  { label: 'Opposition period (third-party monitor)', date: new Date('2026-11-04T00:00:00Z'), resolved: false, superseded: false },
];
assert.deepStrictEqual(
  deadlinePresentationBuckets(monitoringOnly, false),
  { active: [], monitoring: monitoringOnly, review: [], historical: [] },
  'Overview helper should bucket monitoring windows separately from active procedural clocks',
);
assert.strictEqual(
  selectNextDeadline(monitoringOnly, false, new Date('2026-03-01T00:00:00Z')),
  null,
  'Overview helper should not promote monitoring-only windows as the active next deadline',
);
assert.strictEqual(
  activeDeadlineNoteText(monitoringOnly, false),
  'No active applicant/EPO deadline detected; remaining clocks are third-party monitoring windows.',
  'Overview helper should explain monitoring-only states distinctly from active deadlines',
);

assert.strictEqual(
  activeDeadlineNoteText([{ label: 'R71(3) response period', date: new Date('2024-02-10T00:00:00Z'), resolved: false, superseded: true }], true),
  'No active procedural deadline detected; later loss-of-rights events superseded earlier response periods.',
  'Overview helper should keep the closed-posture superseded-deadline explanation',
);

const reviewOnly = [
  { label: 'Art. 94(3) examination communication (manual review)', date: null, resolved: false, superseded: false, reviewOnly: true, confidence: 'low' },
];
assert.deepStrictEqual(
  deadlinePresentationBuckets(reviewOnly, false),
  { active: [], monitoring: [], review: reviewOnly, historical: [] },
  'Overview helper should isolate low-confidence/manual-review items from auto-remindable active deadlines',
);
assert.strictEqual(
  selectNextDeadline(reviewOnly, false, new Date('2026-03-01T00:00:00Z')),
  null,
  'Overview helper should not promote review-only items as the active next deadline',
);
assert.strictEqual(
  activeDeadlineNoteText(reviewOnly, false),
  'No auto-remindable deadline detected; 1 low-confidence or manual-review item remain.',
  'Overview helper should explain review-only states distinctly from actionable deadlines',
);

const anchorOnly = [
  { label: 'Refusal decision / appeal anchor', date: new Date('2026-03-02T00:00:00Z'), anchorOnly: true, internalKey: 'DECISION_REFUSAL' },
];
assert.deepStrictEqual(
  deadlinePresentationBuckets(anchorOnly, false),
  { active: [], monitoring: [], review: [], historical: [] },
  'Overview helper should ignore anchor-only branch markers when presenting actionable deadlines',
);

const recoveredBeforeGrant = recoveryActionModel({
  recovered: true,
  recoveredBeforeGrant: true,
  latestLoss: { dateStr: '01.10.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', detail: 'Search / examination' },
  latestRecovery: { dateStr: '15.11.2025', title: 'Decision on request for further processing', detail: '' },
  latestGrantDecision: { dateStr: '01.01.2026', title: '(Expected) grant', detail: 'published on 04.02.2026 [2026/06]' },
}, 'Applicant', null, null);
assert.strictEqual(recoveredBeforeGrant.badge, 'Recovered before grant', 'Overview helper should expose recovered-before-grant as a first-class recovery state');
assert(/01\.10\.2025/.test(recoveredBeforeGrant.summary) && /15\.11\.2025/.test(recoveredBeforeGrant.summary) && /01\.01\.2026/.test(recoveredBeforeGrant.summary), 'Overview helper should summarize the loss → recovery → grant path');

const recoveryPending = recoveryActionModel({
  currentClosed: true,
  latestLoss: { dateStr: '25.06.2024', title: 'Application deemed to be withdrawn (non-entry into European phase)', detail: 'Search / examination' },
}, 'EPO recovery outcome', 12, { dateStr: '10.07.2024', title: 'Request for further processing' });
assert.strictEqual(recoveryPending.badge, 'Recovery pending', 'Overview helper should distinguish pending EPO recovery outcomes');
assert(/12 days since applicant reply/i.test(recoveryPending.note), 'Overview helper should preserve the recovery-pending age note');

const composed = buildActionableOverviewState({
  mainSourceStatus: 'ok',
  statusSummary: { simple: 'Published', level: 'info' },
  posture: { currentLabel: 'Granted', currentLevel: 'ok', currentClosed: false, recovered: false },
  deadlines: monitoringOnly,
  waitingOn: 'Applicant',
  waitingDays: 3,
});
assert.strictEqual(composed.status.simple, 'Granted', 'Overview helper composition should expose the resolved headline status');
assert.strictEqual(composed.nextDeadline, null, 'Overview helper composition should preserve the monitoring-only next-deadline suppression');
assert.strictEqual(composed.nextDeadlineNote, 'No active applicant/EPO deadline detected; remaining clocks are third-party monitoring windows.', 'Overview helper composition should surface the monitoring explanation');

console.log('epo_v2_overview_signals.test.js passed');
