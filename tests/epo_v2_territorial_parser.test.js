const assert = require('assert');
const { JSDOM } = require('jsdom');
const { rowLabelValuePairs, fieldByLabel, parseUeFromDocument, parseFederatedFromDocument } = require('../lib/epo_v2_territorial_parser');
const { loadFixtureDocument } = require('./userscript_fixture_utils');

const syntheticDoc = new JSDOM(`<!doctype html><html><body>
<table><tbody>
  <tr><th>Status</th><td>Unitary effect registered</td></tr>
  <tr><th>Member States covered by Unitary Patent Protection</th><td>AT, BE, DE</td></tr>
</tbody></table>
</body></html>`).window.document;

assert.deepStrictEqual(
  rowLabelValuePairs(syntheticDoc.querySelector('tr')),
  { Status: 'Unitary effect registered' },
  'Territorial parser should build label/value pairs from TH/TD rows',
);
assert.strictEqual(
  fieldByLabel(syntheticDoc, [/^Member States covered/i]),
  'AT, BE, DE',
  'Territorial parser should resolve table values by label',
);

const ue19871250 = parseUeFromDocument(loadFixtureDocument(['cases', 'EP19871250', 'ueMain.html'], 'https://register.epo.org/application?number=EP19871250&tab=ueMain&lng=en'));
assert.strictEqual(ue19871250.ueStatus, 'Unitary effect registered', 'Territorial parser should preserve a positive registered UE status from real fixtures');
assert.strictEqual(ue19871250.memberStates, 'AT, BE, BG, DE, DK, EE, FI, FR, IT, LT, LU, LV, MT, NL, PT, RO, SE, SI', 'Territorial parser should preserve only the covered-member-state list from real UE fixtures without the registration date or bulletin reference');
assert.deepStrictEqual(ue19871250.renewalPaidYears, [7, 6], 'Territorial parser should extract real UP renewal-fee years from ueMain fixtures');
assert.strictEqual(ue19871250.highestRenewalPaidYear, 7, 'Territorial parser should preserve the latest UP renewal-fee year from ueMain fixtures');

const ue24837586 = parseUeFromDocument(loadFixtureDocument(['cases', 'EP24837586', 'ueMain.html'], 'https://register.epo.org/application?number=EP24837586&tab=ueMain&lng=en'));
assert.strictEqual(ue24837586.ueStatus, 'Request for examination was made', 'Territorial parser should fall back to the actual visible UE status text without trailing status/database-update metadata when no positive UE registration/request state is present');
assert.strictEqual(ue24837586.statusRaw, 'Request for examination was made', 'Territorial parser should strip administrative update metadata from the raw UE status field as well');
assert.strictEqual(ue24837586.memberStates, '', 'Territorial parser should not mistake generic designated-contracting-state lists for UP member-state coverage on non-unitary cases');

const federated = parseFederatedFromDocument(loadFixtureDocument(['cases', 'EP19871250', 'federated.html'], 'https://register.epo.org/application?number=EP19871250&tab=federated&lng=en'), 'EP19871250');
assert.strictEqual(federated.fullPublicationNo, 'EP3863511B1', 'Territorial parser should preserve the federated-register summary publication number');
assert.strictEqual(federated.states.length >= 5, true, 'Territorial parser should extract state rows from real federated fixtures');
assert.strictEqual(federated.states.some((state) => state.state === 'UP' && /No opposition filed within time limit/.test(state.status)), true, 'Territorial parser should preserve per-state federated rows including UP status');

console.log('epo_v2_territorial_parser.test.js passed');
