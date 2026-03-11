const assert = require('assert');
const { postureLossLabel, postureRecoveryLabel, deriveProceduralPosture } = require('../lib/epo_v2_posture_signals');

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

const recoveredBeforeGrant = deriveProceduralPosture({
  statusRaw: 'The patent has been granted',
  records: [
    { dateStr: '01.10.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', detail: 'Search / examination', actor: 'EPO', source: 'Documents' },
    { dateStr: '15.11.2025', title: 'Decision on request for further processing', detail: '', actor: 'EPO', source: 'Event', codexKey: 'FURTHER_PROCESSING_DECISION' },
    { dateStr: '01.01.2026', title: '(Expected) grant', detail: 'published on 04.02.2026 [2026/06]', actor: 'EPO', source: 'Event', codexKey: 'EXPECTED_GRANT' },
  ],
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

const terminalNonEntry = deriveProceduralPosture({
  statusRaw: 'Application deemed to be withdrawn (non-entry into European phase)',
  records: [
    { dateStr: '25.06.2024', title: 'Application deemed to be withdrawn (non-entry into European phase)', detail: 'Search / examination', actor: 'EPO', source: 'Documents' },
  ],
});
assert.strictEqual(terminalNonEntry.currentLabel, 'Deemed withdrawn (non-entry)', 'Posture derivation should expose the sharper non-entry loss label');
assert.strictEqual(terminalNonEntry.currentLevel, 'bad', 'Terminal non-entry posture should stay severe');

console.log('epo_v2_posture_signals.test.js passed');
