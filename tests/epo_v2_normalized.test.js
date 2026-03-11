const assert = require('assert');
const {
  EPO_CODEX_DATA,
  legalCodeRecord,
  codexDescriptionRecord,
  extractLegalEventBlocksFromHtml,
  deriveCurrentPosture,
  buildNormalizedCaseFromDocuments,
} = require('../lib/epo_v2_normalized');
const { loadFixtureDocument, loadFixtureText, loadUserscriptHooks } = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

assert(EPO_CODEX_DATA.byCode.EPIDOSNIGR1, 'v2 normalized core should vendor the full generated codex map');
assert.strictEqual(legalCodeRecord('EPIDOSNIGR1').internalKey, 'GRANT_R71_3_EVENT', 'v2 normalized core should vendor the R71 code map');
assert.strictEqual(legalCodeRecord('0009261').internalKey, 'NO_OPPOSITION_FILED', 'v2 normalized core should vendor the no-opposition code map');
assert.strictEqual(legalCodeRecord('RFPR').internalKey, 'FURTHER_PROCESSING_REQUEST', 'v2 normalized core should include procedural-step mappings that are not yet surfaced as visible legal-event codes');
assert.strictEqual(codexDescriptionRecord('Request for further processing').internalKey, 'FURTHER_PROCESSING_REQUEST', 'v2 normalized core should support description-based fallback for mapped procedural descriptions from the codex data');

const legalBlocks = extractLegalEventBlocksFromHtml(loadFixtureText('cases', 'EP24163939', 'legal.html'));
assert(legalBlocks.some((event) => event.originalCode === 'EPIDOSNIGR1' && event.codexKey === 'GRANT_R71_3_EVENT'), 'v2 normalized core should extract and map legal ORIGINAL CODE markers from raw legal HTML');

for (const caseNo of ['EP24163939', 'EP23182542', 'EP25193159', 'EP22809254', 'EP22209859']) {
  const main = hooks.parseMain(loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`), caseNo);
  const doclist = hooks.parseDoclist(loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`));
  const legal = hooks.parseLegal(loadFixtureDocument(['cases', caseNo, 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`), caseNo);
  const posture = deriveCurrentPosture({ main, docs: doclist.docs, legal });
  if (caseNo === 'EP24163939') {
    assert.strictEqual(posture.currentPosture, 'Grant intended (R71(3))', 'v2 normalized core should classify the live R71 control correctly');
  }
  if (caseNo === 'EP23182542') {
    assert.strictEqual(posture.currentPosture, 'Granted', 'v2 normalized core should classify the recovered-then-granted control as granted');
    assert.strictEqual(posture.signals.recoverySeen, true, 'v2 normalized core should preserve further-processing/recovery signals');
  }
  if (caseNo === 'EP25193159') {
    assert.strictEqual(posture.currentPosture, 'Search published', 'v2 normalized core should classify the extended-ESR control as search-stage');
  }
  if (caseNo === 'EP22809254') {
    assert.strictEqual(posture.currentPosture, 'Deemed withdrawn (non-entry)', 'v2 normalized core should classify the Euro-PCT non-entry control correctly');
  }
  if (caseNo === 'EP22209859') {
    assert.strictEqual(posture.currentPosture, 'Granted (no opposition)', 'v2 normalized core should classify the no-opposition control correctly');
  }
}

const normalizedCase = buildNormalizedCaseFromDocuments({
  caseNo: 'EP23182542',
  mainDoc: loadFixtureDocument(['cases', 'EP23182542', 'main.html'], 'https://register.epo.org/application?number=EP23182542&tab=main&lng=en'),
  doclistDoc: loadFixtureDocument(['cases', 'EP23182542', 'doclist.html'], 'https://register.epo.org/application?number=EP23182542&tab=doclist&lng=en'),
  eventDoc: loadFixtureDocument(['cases', 'EP23182542', 'event.html'], 'https://register.epo.org/application?number=EP23182542&tab=event&lng=en'),
  legalDoc: loadFixtureDocument(['cases', 'EP23182542', 'legal.html'], 'https://register.epo.org/application?number=EP23182542&tab=legal&lng=en'),
  familyDoc: loadFixtureDocument(['cases', 'EP23182542', 'family.html'], 'https://register.epo.org/application?number=EP23182542&tab=family&lng=en'),
});
assert.strictEqual(normalizedCase.main.applicationType, 'Divisional', 'v2 normalized core should compose the shared main parser and classification helper into a divisional application type');
assert.strictEqual(normalizedCase.currentPosture.currentPosture, 'Granted', 'v2 normalized core should compose the shared posture helper into the normalized case pipeline');
assert.strictEqual(normalizedCase.posture.recoveredBeforeGrant, true, 'v2 normalized core should preserve recovered-before-grant posture state in the composed pipeline');
assert(normalizedCase.doclist.docs.some((doc) => doc.bundle === 'Further processing'), 'v2 normalized core should compose shared doc classification into the normalized case pipeline');
assert(normalizedCase.family.publications.some((publication) => publication.no === 'EP4070092'), 'v2 normalized core should preserve shared family parsing inside the normalized case pipeline');
assert.strictEqual(normalizedCase.overviewActionable.status.simple, 'Granted', 'v2 normalized core should compose the shared overview helper into the normalized case pipeline');
assert.strictEqual(normalizedCase.overviewActionable.recoveryAction.badge, 'Recovered before grant', 'v2 normalized core should surface the recovered-before-grant overview state from the shared overview helper');

console.log('epo_v2_normalized.test.js passed');
