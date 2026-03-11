const assert = require('assert');
const { JSDOM } = require('jsdom');
const { doclistTable, doclistEntryFromRow, parseDoclistFromDocument } = require('../lib/epo_v2_doclist_parser');
const { loadFixtureDocument } = require('./userscript_fixture_utils');

const syntheticDoc = new JSDOM(`<!doctype html><html><body>
  <table id="decoy"><thead><tr><th>Foo</th><th>Bar</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>
  <table id="real"><thead><tr><th><input type="checkbox"></th><th>Date</th><th>Document type</th><th>Procedure</th><th>Number of pages</th></tr></thead><tbody>
    <tr><td>not a data row</td><td>01.01.2024</td><td>Ignored row</td><td>Search / examination</td><td>1</td></tr>
    <tr><td><input type="checkbox"></td><td>11.12.2023</td><td><a href="/doc/a">Reply to a communication from the Examining Division</a></td><td>Search / examination</td><td>3</td></tr>
    <tr><td><input type="checkbox"></td><td>07.08.2023</td><td></td><td>Search / examination</td><td>5</td><td><a href="/doc/b">Communication from the Examining Division pursuant to Article 94(3) EPC</a></td></tr>
  </tbody></table>
</body></html>`, { url: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en' }).window.document;

const pickedTable = doclistTable(syntheticDoc);
assert.strictEqual(pickedTable.id, 'real', 'Doclist parser should prefer the table with date/document hints over unrelated tables');

const rows = [...pickedTable.querySelectorAll('tr')];
const ignored = doclistEntryFromRow(rows[1], { date: 1, document: 2, procedure: 3, pages: 4 }, { fallbackUrl: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en', rowOrder: 0 });
assert.strictEqual(ignored, null, 'Doclist row parsing should ignore rows without the Register checkbox marker');

const parsedSynthetic = parseDoclistFromDocument(syntheticDoc, { fallbackUrl: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en' });
assert.deepStrictEqual(
  parsedSynthetic.docs.map((doc) => ({ dateStr: doc.dateStr, title: doc.title, procedure: doc.procedure, pages: doc.pages, rowOrder: doc.rowOrder })),
  [
    { dateStr: '11.12.2023', title: 'Reply to a communication from the Examining Division', procedure: 'Search / examination', pages: '3', rowOrder: 0 },
    { dateStr: '07.08.2023', title: 'Communication from the Examining Division pursuant to Article 94(3) EPC', procedure: 'Search / examination', pages: '5', rowOrder: 1 },
  ],
  'Doclist parser should extract ordered raw rows from the Register-style document table',
);

const caseNo = 'EP23182542';
const fixtureDoc = loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`);
const parsedFixture = parseDoclistFromDocument(fixtureDoc, { fallbackUrl: `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en` });
assert(parsedFixture.docs.length > 0, 'Doclist parser should extract rows from real Register fixtures');
assert(parsedFixture.docs.some((doc) => /Decision to allow further processing|Request for further processing/i.test(doc.title)), 'Doclist parser should preserve real document titles needed for downstream posture/recovery logic');
assert(parsedFixture.docs.every((doc) => doc.dateStr && doc.title), 'Doclist parser should keep required raw date/title fields on all parsed rows');

console.log('epo_v2_doclist_parser.test.js passed');
