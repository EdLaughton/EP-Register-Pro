const assert = require('assert');
const { classifyDocSignal } = require('../lib/epo_v2_doc_signals');

assert.strictEqual(classifyDocSignal({ title: 'Decision to allow further processing' }).bundle, 'Further processing', 'doc-signal core should normalize further-processing decisions');
assert.strictEqual(classifyDocSignal({ title: 'Decision to grant a European patent' }).bundle, 'Grant decision', 'doc-signal core should normalize grant decisions');
assert.strictEqual(classifyDocSignal({ title: 'Transmission of the certificate for a European patent pursuant to Rule 74 EPC' }).bundle, 'Patent certificate', 'doc-signal core should normalize rule-74 certificate transmissions');
assert.strictEqual(classifyDocSignal({ title: 'Application deemed to be withdrawn (non-entry into European phase)' }).bundle, 'Euro-PCT non-entry failure', 'doc-signal core should normalize Euro-PCT non-entry losses');
assert.strictEqual(classifyDocSignal({ title: 'Application deemed to be withdrawn ( translations of claims/payment missing)' }).bundle, 'Grant-formalities failure', 'doc-signal core should normalize grant-formality failures');
assert.strictEqual(classifyDocSignal({ title: 'Application deemed to be withdrawn (non-payment of examination fee/designation fee/non-reply to Written Opinion)' }).bundle, 'Fees / written-opinion failure', 'doc-signal core should normalize mixed fee/non-reply losses');
assert.strictEqual(classifyDocSignal({ title: 'Document annexed to the Extended European Search Report' }).bundle, 'Extended European search package', 'doc-signal core should normalize extended ESR annex packets');
assert.strictEqual(classifyDocSignal({ title: 'International preliminary report on patentability' }).bundle, 'International search / IPRP', 'doc-signal core should normalize IPRP packets');
assert.strictEqual(classifyDocSignal({ title: 'Partial international search report' }).bundle, 'Partial international search', 'doc-signal core should normalize partial ISR packets');
assert.strictEqual(classifyDocSignal({ title: 'Communication regarding the transmission of the European search report' }).bundle, 'European search package', 'doc-signal core should normalize ESR packets');
assert.strictEqual(classifyDocSignal({ title: 'Communication about intention to grant a European patent' }).bundle, 'Intention to grant (R71(3) EPC)', 'doc-signal core should normalize R71 packets');
assert.strictEqual(classifyDocSignal({ title: 'Notice of opposition filed by third party', procedure: 'Third party observations / opposition' }).bundle, 'Opposition', 'doc-signal core should normalize opposition packets');

console.log('epo_v2_doc_signals.test.js passed');
