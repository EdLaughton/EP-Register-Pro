const assert = require('assert');
const {
  loadCodexData,
  extractLegalEventBlocks,
  deriveCodexPrototype,
} = require('../spikes/epo-codex-prototype');
const { loadFixtureText } = require('./userscript_fixture_utils');

const codex = loadCodexData();

assert(codex.byCode.get('EPIDOSNIGR1'), 'Codex prototype should load GRANT_R71_3_EVENT mapping data');
assert.strictEqual(codex.byCode.get('EPIDOSNIGR1').internal_key, 'GRANT_R71_3_EVENT', 'Codex prototype should map EPIDOSNIGR1 to the R71 internal key');
assert.strictEqual(codex.byCode.get('RFPR').internal_key, 'FURTHER_PROCESSING_REQUEST', 'Codex prototype should load procedural-step mappings as well as main-event codes');

const legalBlocks24163939 = extractLegalEventBlocks(loadFixtureText('cases', 'EP24163939', 'legal.html'));
assert(legalBlocks24163939.some((block) => /ORIGINAL CODE:\s*EPIDOSNIGR1/i.test(block.freeFormatText || '')), 'Codex prototype should extract ORIGINAL CODE markers from raw legal HTML');
assert(legalBlocks24163939.some((block) => /STATUS: GRANT OF PATENT IS INTENDED/i.test(block.freeFormatText || '')), 'Codex prototype should retain legal status text blocks alongside coded events');

const grantIntended = deriveCodexPrototype('EP24163939', codex);
assert.strictEqual(grantIntended.currentPosture, 'Grant intended (R71(3))', 'Codex prototype should classify EP24163939 as grant-intended from the coded/legal signals');
assert(grantIntended.mappedKeys.includes('GRANT_R71_3_EVENT'), 'Codex prototype should map EP24163939 legal codes to the R71 internal key');
assert(/R71\/intention-to-grant/.test(grantIntended.story), 'Codex prototype story should mention the R71 branch for EP24163939');

const grantedAfterRecovery = deriveCodexPrototype('EP23182542', codex);
assert.strictEqual(grantedAfterRecovery.currentPosture, 'Granted', 'Codex prototype should recognise EP23182542 as currently granted despite earlier loss-of-rights history');
assert.strictEqual(grantedAfterRecovery.signals.lossSeen, true, 'Codex prototype should preserve prior loss-of-rights signals for EP23182542');
assert.strictEqual(grantedAfterRecovery.signals.recoverySeen, true, 'Codex prototype should detect further-processing recovery signals for EP23182542');
assert.strictEqual(grantedAfterRecovery.signals.grantSeen, true, 'Codex prototype should detect the later grant state for EP23182542');
assert(/loss-of-rights/.test(grantedAfterRecovery.story) && /further processing \/ recovery/.test(grantedAfterRecovery.story) && /grant/.test(grantedAfterRecovery.story), 'Codex prototype story should show the loss → recovery → grant arc for EP23182542');

const extendedSearch = deriveCodexPrototype('EP25193159', codex);
assert.strictEqual(extendedSearch.currentPosture, 'Search published', 'Codex prototype should classify EP25193159 as a search-stage/published posture');
assert.strictEqual(extendedSearch.signals.searchSeen, true, 'Codex prototype should detect search-publication/search-packet posture for EP25193159');

const nonEntry = deriveCodexPrototype('EP22809254', codex);
assert.strictEqual(nonEntry.currentPosture, 'Deemed withdrawn (non-entry)', 'Codex prototype should classify EP22809254 as deemed withdrawn for non-entry into EP phase');
assert.strictEqual(nonEntry.signals.lossSeen, true, 'Codex prototype should detect loss-of-rights posture for EP22809254');

const noOpposition = deriveCodexPrototype('EP22209859', codex);
assert.strictEqual(noOpposition.currentPosture, 'Granted (no opposition)', 'Codex prototype should classify EP22209859 as granted with no opposition filed');
assert(noOpposition.mappedKeys.includes('NO_OPPOSITION_FILED'), 'Codex prototype should map the no-opposition event code for EP22209859');

console.log('epo_codex_prototype.test.js passed');
