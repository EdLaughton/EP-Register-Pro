const assert = require('assert');
const { loadUserscriptHooks, loadFixtureDocument } = require('./userscript_fixture_utils');
const { summarizeStatusText, inferStatusStageFromText } = require('../lib/epo_v2_status_signals');
const { classifyDocSignal } = require('../lib/epo_v2_doc_signals');
const { classifyPacketSignal, standalonePacketBundle } = require('../lib/epo_v2_packet_signals');
const { buildProceduralRecords, deriveProceduralPostureFromSources } = require('../lib/epo_v2_posture_signals');

const hooks = loadUserscriptHooks();
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.strictEqual(typeof hooks.summarizeStatus, 'function', 'Runtime hook surface should expose summarizeStatus');
assert.strictEqual(typeof hooks.inferStatusStage, 'function', 'Runtime hook surface should expose inferStatusStage');
assert.strictEqual(typeof hooks.normalizedDocSignal, 'function', 'Runtime hook surface should expose normalizedDocSignal');
assert.strictEqual(typeof hooks.normalizedPacketSignal, 'function', 'Runtime hook surface should expose normalizedPacketSignal');
assert.strictEqual(typeof hooks.buildDeadlineRecords, 'function', 'Runtime hook surface should expose buildDeadlineRecords for parity checks');
assert.strictEqual(typeof hooks.proceduralPostureModel, 'function', 'Runtime hook surface should expose proceduralPostureModel');

const statusSample = 'No opposition filed within time limit';
assert.deepStrictEqual(
  plain(hooks.summarizeStatus(statusSample)),
  summarizeStatusText(statusSample),
  'Runtime summarizeStatus should match lib status signals for a no-opposition status',
);
assert.strictEqual(
  hooks.inferStatusStage(statusSample),
  inferStatusStageFromText(statusSample),
  'Runtime inferStatusStage should match lib status signals for a no-opposition status',
);

const docSample = { title: 'Request for further processing', procedure: 'Examination' };
const runtimeDocSignal = plain(hooks.normalizedDocSignal(docSample.title, docSample.procedure));
const libDocSignal = classifyDocSignal(docSample);
assert.strictEqual(runtimeDocSignal.bundle, libDocSignal.bundle, 'Runtime normalizedDocSignal should match lib bundle for a further-processing request');
assert.strictEqual(runtimeDocSignal.level, libDocSignal.level, 'Runtime normalizedDocSignal should match lib level for a further-processing request');

const packetSample = [
  { title: 'Communication regarding the transmission of the European search report', procedure: 'Search / examination' },
  { title: 'Document annexed to the Extended European Search Report', procedure: 'Search / examination' },
  { title: 'European search opinion', procedure: 'Search / examination' },
];
const runtimePacketSignal = plain(hooks.normalizedPacketSignal(packetSample));
const libPacketSignal = classifyPacketSignal(packetSample);
assert.strictEqual(runtimePacketSignal.bundle, libPacketSignal.bundle, 'Runtime normalizedPacketSignal should match lib bundle for an extended-ESR packet');
assert.strictEqual(runtimePacketSignal.family, libPacketSignal.family, 'Runtime normalizedPacketSignal should match lib family for an extended-ESR packet');
assert.strictEqual(
  standalonePacketBundle(runtimePacketSignal),
  standalonePacketBundle(libPacketSignal),
  'Runtime standalone packet policy should match lib packet policy for an extended-ESR packet',
);

for (const caseNo of ['EP22809254', 'EP23182542', 'EP23758527']) {
  const main = hooks.parseMain(loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`), caseNo);
  const doclist = hooks.parseDoclist(loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`));
  const eventHistory = hooks.parseEventHistory(loadFixtureDocument(['cases', caseNo, 'event.html'], `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`), caseNo);
  const legal = hooks.parseLegal(loadFixtureDocument(['cases', caseNo, 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`), caseNo);
  const runtimeRecords = plain(hooks.buildDeadlineRecords(doclist.docs, eventHistory, legal));
  const libRecords = buildProceduralRecords(doclist.docs, eventHistory, legal);
  assert.deepStrictEqual(runtimeRecords, libRecords, `Runtime buildDeadlineRecords should match lib procedural record building for ${caseNo}`);
  const runtimePosture = plain(hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal));
  const libPosture = deriveProceduralPostureFromSources({
    statusRaw: main.statusRaw || '',
    docs: doclist.docs,
    eventHistory,
    legal,
  });
  assert.strictEqual(runtimePosture.currentLabel, libPosture.currentLabel, `Runtime posture label should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(runtimePosture.currentLevel, libPosture.currentLevel, `Runtime posture level should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(!!runtimePosture.recovered, !!libPosture.recovered, `Runtime recovered flag should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(!!runtimePosture.recoveredBeforeGrant, !!libPosture.recoveredBeforeGrant, `Runtime recovered-before-grant flag should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(runtimePosture.note, libPosture.note, `Runtime posture note should match lib posture derivation for ${caseNo}`);
}

console.log('epo_v2_runtime_parity.test.js passed');
