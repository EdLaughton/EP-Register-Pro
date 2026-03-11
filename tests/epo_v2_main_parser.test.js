const assert = require('assert');
const {
  parseApplicationField,
  parsePriority,
  parseMainPublications,
  extractEpNumbersByHeader,
  parseRecentEvents,
  parseMainRawFromDocument,
} = require('../lib/epo_v2_main_parser');
const { loadFixtureDocument } = require('./userscript_fixture_utils');

assert.deepStrictEqual(
  parseApplicationField('EP19871250.6 10.10.2019'),
  { filingDate: '10.10.2019' },
  'Main parser should recover the filing date from the application-number section',
);

assert.deepStrictEqual(
  parsePriority('US201862743963P 10.10.2018\nGB20190017599 02.12.2019'),
  [
    { no: 'US201862743963P', dateStr: '10.10.2018' },
    { no: 'GB20190017599', dateStr: '02.12.2019' },
  ],
  'Main parser should recover line-level priority numbers and dates',
);

assert.deepStrictEqual(
  parseRecentEvents('01.01.2026\n(Expected) grant\npublished on 04.02.2026 [2026/06]'),
  [{ dateStr: '01.01.2026', title: '(Expected) grant', detail: 'published on 04.02.2026 [2026/06]', source: 'Main page' }],
  'Main parser should recover dated recent-event entries from the main tab',
);

const main19871250Doc = loadFixtureDocument(['cases', 'EP19871250', 'main.html'], 'https://register.epo.org/application?number=EP19871250&tab=main&lng=en');
const main19871250 = parseMainRawFromDocument(main19871250Doc, 'EP19871250');
assert.strictEqual(main19871250.title, 'WEARABLE MEDICAL DEVICE WITH DISPOSABLE AND REUSABLE COMPONENTS', 'Main parser should preserve the real main-tab title');
assert.strictEqual(main19871250.filingDate, '10.10.2019', 'Main parser should preserve the filing date from the real main fixture');
assert(main19871250.publications.some((publication) => publication.no === 'EP3863511' && publication.kind === 'A1'), 'Main parser should preserve real publication rows extracted from the publication section');
assert.strictEqual(main19871250.internationalAppNo, 'WO2019US55678', 'Main parser should preserve the international/PCT identifier used by the current main-page parser to detect Euro-PCT files');
assert.deepStrictEqual(main19871250.divisionalChildren, ['EP24189818'], 'Main parser should preserve divisional-child links from the real main fixture');

const main23182542Doc = loadFixtureDocument(['cases', 'EP23182542', 'main.html'], 'https://register.epo.org/application?number=EP23182542&tab=main&lng=en');
const main23182542 = parseMainRawFromDocument(main23182542Doc, 'EP23182542');
assert.strictEqual(main23182542.parentCase, 'EP4070092', 'Main parser should preserve parent-case links from divisional main fixtures');
assert.deepStrictEqual(main23182542.divisionalChildren, ['EP25215625'], 'Main parser should preserve downstream divisional application links from divisional main fixtures');
assert.strictEqual(main23182542.isDivisional, true, 'Main parser should preserve divisional posture markers from real main fixtures');
assert(extractEpNumbersByHeader(main23182542Doc, /\bParent application(?:\(s\))?\b/i).includes('EP4070092'), 'Main parser should extract EP numbers from labeled parent-application sections');

const main19205846Doc = loadFixtureDocument(['cases', 'EP19205846', 'main.html'], 'https://register.epo.org/application?number=EP19205846&tab=main&lng=en');
assert.deepStrictEqual(
  parseMainPublications(main19205846Doc, 'EP (this file)'),
  [{ no: 'EP3816364', kind: 'A1', dateStr: '05.05.2021', role: 'EP (this file)' }],
  'Main parser should recover publication rows from the structured publication section',
);

console.log('epo_v2_main_parser.test.js passed');
