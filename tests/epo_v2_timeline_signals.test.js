const assert = require('assert');
const {
  classifyTimelineImportance,
  docPacketExplanation,
  timelineSubtitle,
  shouldAppendSingleRunLabel,
  compactOverviewTitle,
} = require('../lib/epo_v2_timeline_signals');

assert.strictEqual(
  classifyTimelineImportance('Application deemed to be withdrawn (non-entry into European phase)', 'Search / examination', 'Legal status', 'EPO', 'info'),
  'bad',
  'Timeline importance should mark loss-of-rights transitions as bad',
);

assert.strictEqual(
  classifyTimelineImportance('Communication about intention to grant a European patent', 'Examination', 'Documents', 'EPO', 'info'),
  'warn',
  'Timeline importance should elevate Rule 71/intention-to-grant milestones',
);

assert.strictEqual(
  classifyTimelineImportance('Mention of grant', 'Publication', 'Legal status', 'EPO', 'info'),
  'ok',
  'Timeline importance should elevate grant/post-grant confirmations to ok',
);

assert.strictEqual(
  timelineSubtitle({ detail: 'published on 17.07.2024 [2024/29]\nEvent history', source: 'Event history', actor: 'EPO' }),
  'published on 17.07.2024 [2024/29] · Event history · EPO',
  'Timeline subtitle helper should dedupe repeated source/detail labels even when split across lines',
);

assert.strictEqual(
  timelineSubtitle({ detail: 'Formalities / other', source: 'Documents', actor: 'Other' }),
  'Formalities / other · Documents',
  'Timeline subtitle helper should omit actor=Other when it adds no value',
);

assert.strictEqual(
  docPacketExplanation('Further processing'),
  'Recovery packet showing further processing after a missed time limit.',
  'Timeline packet explanations should explain further-processing packets in plain language',
);

assert.strictEqual(
  compactOverviewTitle('Communication about intention to grant a European patent'),
  'Intention to grant',
  'Compact-title helper should map long grant-intention labels to a concise overview title',
);

assert.strictEqual(
  shouldAppendSingleRunLabel('Loss-of-rights communication', 'Examination'),
  false,
  'Timeline helper should not append broad run labels when a stronger upgraded label already exists',
);

console.log('epo_v2_timeline_signals.test.js passed');
