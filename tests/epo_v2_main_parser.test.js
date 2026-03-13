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
assert.deepStrictEqual(
  parseRecentEvents('30.01.2026\nLapse of the patent in a contracting state New state(s): CY\npublished on 04.03.2026 [2026/10]'),
  [{ dateStr: '30.01.2026', title: 'Lapse of the patent in a contracting state', detail: 'New state(s): CY · published on 04.03.2026 [2026/10]', source: 'Main page' }],
  'Main parser should move trailing state-change qualifiers out of the recent-event title and into the detail line',
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

const nonEnglishMainDoc = new (require('jsdom').JSDOM)(`<!doctype html><html><body>
  <h1>Tragbares medizinisches Gerät mit wiederverwendbaren Komponenten</h1>
  <table>
    <tr><th>Anmeldenummer</th><td>EP19871250.6 10.10.2019</td></tr>
    <tr><th>Anmelder</th><td>Acme Medical GmbH</td></tr>
    <tr><th>Vertreter</th><td>Smith IP LLP</td></tr>
    <tr><th>Priorität</th><td>US201862743963P 10.10.2018</td></tr>
    <tr><th>Veröffentlichung</th><td>EP3863511 A1 12.05.2021</td></tr>
    <tr><th>Letztes Ereignis</th><td>01.01.2026\n(Expected) grant\npublished on 04.02.2026 [2026/06]</td></tr>
  </table>
</body></html>`, { url: 'https://register.epo.org/application?number=EP19871250&tab=main&lng=de' }).window.document;
const nonEnglishMain = parseMainRawFromDocument(nonEnglishMainDoc, 'EP19871250');
assert.strictEqual(nonEnglishMain.filingDate, '10.10.2019', 'Main parser should recover the filing date from structurally identifiable non-English application rows');
assert.strictEqual(nonEnglishMain.applicant, 'Acme Medical GmbH', 'Main parser should recover the applicant from non-English main-page rows instead of silently dropping party data');
assert(nonEnglishMain.publications.some((publication) => publication.no === 'EP3863511' && publication.kind === 'A1'), 'Main parser should recover publications from structurally identifiable non-English publication rows');
assert.strictEqual(nonEnglishMain.recentEvents.length, 1, 'Main parser should still recover recent events from structurally identifiable non-English rows');

console.log('epo_v2_main_parser.test.js passed');
