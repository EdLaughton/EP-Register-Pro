const assert = require('assert');
const { loadFixtureDocument, loadFixtureText } = require('./userscript_fixture_utils');
const { parseUeFromDocument, parseFederatedFromDocument } = require('../lib/epo_v2_territorial_parser');
const { parseUpcOptOutResult } = require('../lib/epo_v2_upc_parser');
const { upcRegistryNoteText, territorialStatusLevel, territorialPresentationModel } = require('../lib/epo_v2_territorial_signals');

assert.strictEqual(upcRegistryNoteText(null), 'UPC registry check unavailable.', 'Territorial signals should surface an explicit unavailable message when no UPC result is present');
assert.strictEqual(upcRegistryNoteText({ status: 'No opt-out found' }), 'No UPC opt-out found.', 'Territorial signals should turn UPC no-result states into a concise note');
assert.strictEqual(upcRegistryNoteText({ status: 'Opted out' }), 'UPC opt-out registered.', 'Territorial signals should turn positive opt-out states into a concise note');
assert.strictEqual(upcRegistryNoteText({ status: 'Opt-out withdrawn' }), 'UPC opt-out withdrawn.', 'Territorial signals should distinguish withdrawn opt-outs');

assert.strictEqual(territorialStatusLevel({ ueStatus: 'Unitary effect registered', upcNote: 'No UPC opt-out found.', notableStates: [] }), 'ok', 'Territorial signals should treat registered unitary effect as an ok state');
assert.strictEqual(territorialStatusLevel({ ueStatus: 'Request for examination was made', upcNote: 'UPC opt-out registered.', notableStates: [] }), 'warn', 'Territorial signals should elevate UPC opt-out / pre-registration territorial states to warn');

const ue198 = parseUeFromDocument(loadFixtureDocument(['cases', 'EP19871250', 'ueMain.html'], 'https://register.epo.org/application?number=EP19871250&tab=ueMain&lng=en'));
const fed198 = parseFederatedFromDocument(loadFixtureDocument(['cases', 'EP19871250', 'federated.html'], 'https://register.epo.org/application?number=EP19871250&tab=federated&lng=en'), 'EP19871250');
const upc381 = parseUpcOptOutResult(loadFixtureText('upc', 'EP3816364.html'), 'EP3816364');
const model198 = territorialPresentationModel(ue198, upc381, fed198);
assert.strictEqual(model198.ueStatus, 'Unitary effect registered', 'Territorial presentation should preserve the unitary-effect status from UE fixtures');
assert(/AT, BE, BG/.test(model198.coverageStates), 'Territorial presentation should preserve covered member states');
assert.strictEqual(model198.upcNote, 'No UPC opt-out found.', 'Territorial presentation should carry the normalized UPC note');
assert.strictEqual(model198.level, 'ok', 'Territorial presentation should surface a healthy level for registered UE with no opt-out');
assert(model198.nationalStates.length >= 5, 'Territorial presentation should preserve federated state rows for downstream rendering');

const ue248 = parseUeFromDocument(loadFixtureDocument(['cases', 'EP24837586', 'ueMain.html'], 'https://register.epo.org/application?number=EP24837586&tab=ueMain&lng=en'));
const upc443 = parseUpcOptOutResult(loadFixtureText('upc', 'EP4438108.html'), 'EP4438108');
const model248 = territorialPresentationModel(ue248, upc443, { states: [], notableStates: [] });
assert(/Request for examination was made/.test(model248.ueStatus), 'Territorial presentation should preserve fallback UE status text when no unitary registration exists yet');
assert.strictEqual(model248.upcNote, 'UPC opt-out registered.', 'Territorial presentation should carry the positive UPC note from the real opt-out fixture');
assert.strictEqual(model248.level, 'warn', 'Territorial presentation should elevate active territorial/opt-out states to warn');

console.log('epo_v2_territorial_signals.test.js passed');
