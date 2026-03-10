const assert = require('assert');
const {
  LEGAL_EVENT_CODE_MAP,
  extractLegalEventBlocksFromHtml,
  deriveCurrentPosture,
} = require('../lib/epo_v2_normalized');
const { loadFixtureDocument, loadFixtureText, loadUserscriptHooks } = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

assert.strictEqual(LEGAL_EVENT_CODE_MAP.EPIDOSNIGR1.internalKey, 'GRANT_R71_3_EVENT', 'v2 normalized core should vendor the R71 code map');
assert.strictEqual(LEGAL_EVENT_CODE_MAP['0009261'].internalKey, 'NO_OPPOSITION_FILED', 'v2 normalized core should vendor the no-opposition code map');

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

console.log('epo_v2_normalized.test.js passed');
