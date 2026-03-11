const assert = require('assert');
const {
  STATUS_STAGE_RULES,
  STATUS_SUMMARY_RULES,
  inferStatusStageFromText,
  summarizeStatusText,
} = require('../lib/epo_v2_status_signals');

assert(STATUS_STAGE_RULES.length > 4, 'status-signal core should expose a non-trivial stage rule table');
assert(STATUS_SUMMARY_RULES.length > 8, 'status-signal core should expose a non-trivial summary rule table');

assert.strictEqual(inferStatusStageFromText('No opposition filed within time limit'), 'Post-grant', 'status-signal core should classify no-opposition status as post-grant');
assert.strictEqual(inferStatusStageFromText('Grant of patent is intended'), 'R71 / grant intended', 'status-signal core should classify R71/intention statuses');
assert.strictEqual(inferStatusStageFromText('The patent has been granted'), 'Granted', 'status-signal core should classify granted statuses');
assert.strictEqual(inferStatusStageFromText('Application deemed to be withdrawn (non-entry into European phase)'), 'Closed', 'status-signal core should classify deemed-withdrawn states as closed');

assert.deepStrictEqual(summarizeStatusText('No opposition filed within time limit'), { simple: 'Granted (no opposition)', level: 'ok' }, 'status-signal core should summarize no-opposition status clearly');
assert.deepStrictEqual(summarizeStatusText('Grant of patent is intended'), { simple: 'Grant intended (R71(3))', level: 'warn' }, 'status-signal core should summarize R71/intention status clearly');
assert.deepStrictEqual(summarizeStatusText('Application deemed to be withdrawn (non-entry into European phase)'), { simple: 'Deemed withdrawn (non-entry)', level: 'bad' }, 'status-signal core should summarize Euro-PCT non-entry losses clearly');
assert.deepStrictEqual(summarizeStatusText('Application deemed to be withdrawn ( translations of claims/payment missing)'), { simple: 'Deemed withdrawn (grant formalities)', level: 'bad' }, 'status-signal core should summarize grant-formality failures clearly');
assert.deepStrictEqual(summarizeStatusText('Application deemed to be withdrawn (non-payment of examination fee/designation fee/non-reply to Written Opinion)'), { simple: 'Deemed withdrawn (fees / no WO reply)', level: 'bad' }, 'status-signal core should summarize mixed fee/non-reply losses clearly');
assert.deepStrictEqual(summarizeStatusText('The application has been published'), { simple: 'Published', level: 'info' }, 'status-signal core should summarize published states');

console.log('epo_v2_status_signals.test.js passed');
