const assert = require('assert');
const { JSDOM } = require('jsdom');
const {
  splitPublicationNumber,
  parsePublications,
  parseFamilyFromDocument,
  parseCitationsFromDocument,
} = require('../lib/epo_v2_reference_parsers');
const { loadFixtureDocument } = require('./userscript_fixture_utils');

assert.deepStrictEqual(
  splitPublicationNumber('EP4671766A2', ''),
  { no: 'EP4671766', kind: 'A2' },
  'Reference parser should split compact publication numbers into publication no + kind code',
);

assert.deepStrictEqual(
  parsePublications('EP4623169 A1 31.12.2025\nEP4644110 A3 15.01.2026', 'Family'),
  [
    { no: 'EP4623169', kind: 'A1', dateStr: '31.12.2025', role: 'Family' },
    { no: 'EP4644110', kind: 'A3', dateStr: '15.01.2026', role: 'Family' },
  ],
  'Reference parser should recover publication rows from fallback family text blocks',
);

const syntheticFamily = new JSDOM(`<!doctype html><html><body><table><tbody>
  <tr><th>Publication No.</th><th>Kind</th><th>Date</th></tr>
  <tr><td>EP4671766</td><td>A2</td><td>31.12.2025</td></tr>
  <tr><td>EP4070092</td><td>B1</td><td>30.08.2023</td></tr>
  <tr><th>Priority number</th><td>US123</td><td>01.01.2020</td></tr>
</tbody></table></body></html>`).window.document;
assert.deepStrictEqual(
  parseFamilyFromDocument(syntheticFamily).publications,
  [
    { no: 'EP4671766', kind: 'A2', dateStr: '31.12.2025', role: 'Family' },
    { no: 'EP4070092', kind: 'B1', dateStr: '30.08.2023', role: 'Family' },
  ],
  'Reference parser should extract family publication rows only within the publication block',
);

const syntheticCitations = new JSDOM(`<!doctype html><html><body><table><tbody>
  <tr><th>Cited in</th><td>Search</td></tr>
  <tr><th>Type</th><td>Patent literature</td></tr>
  <tr><th>Publication No.</th><td>WO2017035502 [XYI] (ELEMENT SCIENCE INC et al.)</td></tr>
  <tr><th>Cited in</th><td>by applicant</td></tr>
  <tr><th>Publication No.</th><td>WO2017035502</td></tr>
</tbody></table></body></html>`).window.document;
const syntheticCitationResult = parseCitationsFromDocument(syntheticCitations);
assert.strictEqual(syntheticCitationResult.entries.length, 2, 'Reference parser should extract citation rows across citation phases');
assert.deepStrictEqual(syntheticCitationResult.entries[0], {
  phase: 'Search',
  type: 'Patent literature',
  publicationNo: 'WO2017035502',
  categories: ['XYI'],
  applicant: 'ELEMENT SCIENCE INC et al.',
  detail: 'WO2017035502 [XYI] (ELEMENT SCIENCE INC et al.)',
}, 'Reference parser should preserve citation phase/type/publication/category/applicant details');
assert.deepStrictEqual(
  syntheticCitationResult.phases.map((phase) => phase.name),
  ['Search', 'by applicant'],
  'Reference parser should keep citation phases in the intended order',
);

const familyFixture = parseFamilyFromDocument(loadFixtureDocument(['cases', 'EP19205846', 'family.html'], 'https://register.epo.org/application?number=EP19205846&tab=family&lng=en'));
assert(familyFixture.publications.some((publication) => publication.no === 'EP3816364' && publication.kind === 'A1'), 'Reference parser should preserve real family publications used by downstream family-role/publication logic');

const citationsFixture = parseCitationsFromDocument(loadFixtureDocument(['cases', 'EP19871250', 'citations.html'], 'https://register.epo.org/application?number=EP19871250&tab=citations&lng=en'));
assert(citationsFixture.entries.some((entry) => entry.phase === 'Search' && entry.publicationNo === 'WO2017035502'), 'Reference parser should preserve real citation rows from Register citation fixtures');
assert(citationsFixture.phases.some((phase) => phase.name === 'International search'), 'Reference parser should preserve grouped citation phases from real fixtures');

console.log('epo_v2_reference_parsers.test.js passed');
