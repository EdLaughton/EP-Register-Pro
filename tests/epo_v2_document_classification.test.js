const assert = require('assert');
const { parseApplicationType, classifyDocument, refineDocumentClassification } = require('../lib/epo_v2_document_classification');

assert.strictEqual(
  parseApplicationType({ appNo: 'EP19871250', internationalAppNo: 'WO2019US55678', priorities: [], statusRaw: '' }),
  'E/PCT regional phase',
  'Shared classification helper should recognize Euro-PCT regional-phase files from international identifiers',
);
assert.strictEqual(
  parseApplicationType({ appNo: 'EP23182542', parentCase: 'EP4070092', priorities: [] }),
  'Divisional',
  'Shared classification helper should recognize divisional files from parent-case linkage',
);
assert.strictEqual(
  parseApplicationType({ appNo: 'EP19205846', priorities: [{ no: 'GB20190017599', dateStr: '02.12.2019' }] }),
  'EP convention filing',
  'Shared classification helper should recognize convention filings from non-WO priorities',
);
assert.strictEqual(
  parseApplicationType({ appNo: 'EP1234567', priorities: [] }),
  'EP direct first filing',
  'Shared classification helper should recognize direct EP first filings when no priority or PCT marker exists',
);

assert.deepStrictEqual(
  classifyDocument('Request for further processing', 'Examination'),
  { bundle: 'Further processing', actor: 'EPO', level: 'warn' },
  'Shared classification helper should use the normalized doc-signal path for further-processing requests',
);
assert.deepStrictEqual(
  classifyDocument('Decision to grant a European patent', 'Examination'),
  { bundle: 'Grant decision', actor: 'EPO', level: 'ok' },
  'Shared classification helper should use the normalized doc-signal path for grant decisions',
);
assert.deepStrictEqual(
  classifyDocument('Text intended for grant (version for approval)', 'Search / examination'),
  { bundle: 'Grant package', actor: 'EPO', level: 'warn' },
  'Shared classification helper should keep grant-intention text inside the broad Grant package runtime bucket',
);
assert.deepStrictEqual(
  classifyDocument('Reply to a communication from the Examining Division', 'Search / examination by applicant'),
  { bundle: 'Applicant filings', actor: 'Applicant', level: 'info' },
  'Shared classification helper should preserve the current runtime treatment for broad applicant reply rows',
);
assert.strictEqual(
  refineDocumentClassification('Communication concerning the reminder according to rule 39(1) EPC and the invitation pursuant to rule 45 EPC', 'Search / examination', { bundle: 'Response to search', actor: 'Applicant', level: 'warn' }).actor,
  'EPO',
  'Shared classification refinement should keep reminder/formalities rows on the EPO side',
);

console.log('epo_v2_document_classification.test.js passed');
