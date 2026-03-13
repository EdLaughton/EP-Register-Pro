const assert = require('assert');
const { buildProceduralRecords, postureLossLabel, postureRecoveryLabel, deriveProceduralPosture, deriveProceduralPostureFromSources } = require('../lib/epo_v2_posture_signals');

assert.strictEqual(
  postureLossLabel({ title: 'Application deemed to be withdrawn (non-entry into European phase)', detail: 'Search / examination' }),
  'non-entry into European phase',
  'Posture loss labeling should keep Euro-PCT non-entry reasons first-class',
);

assert.strictEqual(
  postureLossLabel({ title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', detail: 'Search / examination' }),
  'grant-formalities failure',
  'Posture loss labeling should keep grant-formalities failures crisp',
);

assert.strictEqual(
  postureRecoveryLabel({ title: 'Decision on request for further processing', detail: '' }),
  'further processing',
  'Posture recovery labeling should recognize further-processing cures',
);

const builtRecords = buildProceduralRecords(
  [
    { dateStr: '01.10.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', procedure: 'Search / examination', actor: 'EPO' },
  ],
  { events: [{ dateStr: '15.11.2025', title: 'Decision on request for further processing', detail: '' }] },
  { events: [{ dateStr: '15.11.2025', title: 'Decision on request for further processing', detail: '' }], codedEvents: [{ dateStr: '01.01.2026', title: '(Expected) grant', detail: 'published on 04.02.2026 [2026/06]', codexKey: 'EXPECTED_GRANT' }] },
);
assert.deepStrictEqual(builtRecords.map((record) => `${record.dateStr}|${record.source}`), [
  '01.01.2026|Coded legal event',
  '15.11.2025|Event',
  '01.10.2025|Documents',
], 'Shared procedural record building should dedupe duplicate event/legal rows and keep reverse-chronological source records');

const recoveredBeforeGrant = deriveProceduralPostureFromSources({
  statusRaw: 'The patent has been granted',
  docs: [
    { dateStr: '01.10.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', procedure: 'Search / examination', actor: 'EPO' },
  ],
  eventHistory: {
    events: [
      { dateStr: '15.11.2025', title: 'Decision on request for further processing', detail: '' },
    ],
  },
  legal: {
    codedEvents: [
      { dateStr: '01.01.2026', title: '(Expected) grant', detail: 'published on 04.02.2026 [2026/06]', codexKey: 'EXPECTED_GRANT' },
    ],
  },
});
assert.strictEqual(recoveredBeforeGrant.currentLabel, 'Granted', 'Posture derivation should keep the current granted state after a cured adverse event');
assert.strictEqual(recoveredBeforeGrant.recoveredBeforeGrant, true, 'Posture derivation should detect recovery before grant');
assert(/Recovered from earlier grant-formalities failure via further processing before grant\./.test(recoveredBeforeGrant.note), 'Posture derivation should narrate the recovery-before-grant arc clearly');

const recoveredInExamination = deriveProceduralPosture({
  statusRaw: 'Request for examination was made',
  records: [
    { dateStr: '06.10.2025', title: 'Application deemed to be withdrawn (non-reply to Written Opinion)', detail: 'Search / examination', actor: 'EPO', source: 'Documents' },
    { dateStr: '13.12.2025', title: 'Decision on request for further processing', detail: '', actor: 'EPO', source: 'Event', codexKey: 'FURTHER_PROCESSING_DECISION' },
  ],
});
assert.strictEqual(recoveredInExamination.currentLabel, 'Examination', 'Recovered examination files should return to an examination posture');
assert.strictEqual(recoveredInExamination.recovered, true, 'Posture derivation should detect recovery after a written-opinion loss');
assert(/Recovered from earlier no reply to the written opinion via further processing\./.test(recoveredInExamination.note), 'Posture derivation should explain the recovered examination posture');

const pendingFurtherProcessing = deriveProceduralPosture({
  statusRaw: 'Application deemed to be withdrawn (non-entry into European phase)',
  records: [
    { dateStr: '25.06.2024', title: 'Application deemed to be withdrawn (non-entry into European phase)', detail: 'Search / examination', actor: 'EPO', source: 'Documents' },
    { dateStr: '10.07.2024', title: 'Request for further processing', detail: '', actor: 'EPO', source: 'Documents', codexKey: 'FURTHER_PROCESSING_REQUEST' },
  ],
});
assert.strictEqual(pendingFurtherProcessing.recovered, false, 'A further-processing request alone should not mark the posture as already recovered');
assert.strictEqual(pendingFurtherProcessing.recoveryPending, true, 'A further-processing request without a later decision should surface as a pending recovery state');
assert(/Recovery requested via further processing; EPO outcome pending\./.test(pendingFurtherProcessing.note), 'Pending further-processing requests should be narrated as waiting on an EPO outcome rather than as a completed cure');

const terminalNonEntry = deriveProceduralPosture({
  statusRaw: 'Application deemed to be withdrawn (non-entry into European phase)',
  records: [
    { dateStr: '25.06.2024', title: 'Application deemed to be withdrawn (non-entry into European phase)', detail: 'Search / examination', actor: 'EPO', source: 'Documents' },
  ],
});
assert.strictEqual(terminalNonEntry.currentLabel, 'Deemed withdrawn (non-entry)', 'Posture derivation should expose the sharper non-entry loss label');
assert.strictEqual(terminalNonEntry.currentLevel, 'bad', 'Terminal non-entry posture should stay severe');

console.log('epo_v2_posture_signals.test.js passed');
