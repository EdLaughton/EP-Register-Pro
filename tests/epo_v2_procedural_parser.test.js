const assert = require('assert');
const { JSDOM } = require('jsdom');
const {
  normalizeCodexSignal,
  normalizeStructuredDate,
  parseStructuredTimeLimit,
  parseDatedRowsFromDocument,
  extractLegalEventBlocksFromDocument,
  parseEventHistoryFromDocument,
  parseLegalFromDocument,
} = require('../lib/epo_v2_procedural_parser');
const { loadFixtureDocument } = require('./userscript_fixture_utils');

const mapped = normalizeCodexSignal({ sourceDescription: '(Expected) grant' });
assert.strictEqual(mapped.codexRecord.internalKey, 'EXPECTED_GRANT', 'Procedural parser should normalize event descriptions through the codex description map');
assert.strictEqual(normalizeStructuredDate('20260204'), '04.02.2026', 'Procedural parser should normalize compact ST.36-style yyyymmdd dates');
assert.deepStrictEqual(parseStructuredTimeLimit('4 months'), { raw: '4 months', months: 4, dateStr: '' }, 'Procedural parser should parse month-based ST.36 time-limit values');

const syntheticEventDoc = new JSDOM(`<!doctype html><html><body><table><tbody>
  <tr><th>Date</th><th>Event</th><th>Status</th></tr>
  <tr><td>01.01.2026</td><td>(Expected) grant</td><td>published on 04.02.2026 [2026/06]</td></tr>
  <tr><td>01.01.2026</td><td>(Expected) grant</td><td>published on 04.02.2026 [2026/06]</td></tr>
</tbody></table></body></html>`, { url: 'https://register.epo.org/application?number=EP00000000&tab=event&lng=en' }).window.document;
const syntheticEventRows = parseDatedRowsFromDocument(syntheticEventDoc, 'https://register.epo.org/application?number=EP00000000&tab=event&lng=en');
assert.deepStrictEqual(syntheticEventRows, [{
  dateStr: '01.01.2026',
  title: '(Expected) grant',
  detail: 'published on 04.02.2026 [2026/06]',
  url: 'https://register.epo.org/application?number=EP00000000&tab=event&lng=en',
}], 'Procedural parser should extract and dedupe dated event/legal rows');
assert.deepStrictEqual(
  syntheticEventRows.parseStats,
  {
    source: 'procedural-rows',
    rowsSeen: 2,
    rowsAccepted: 1,
    rowsDropped: 1,
    rowsDroppedByReason: { duplicate: 1 },
  },
  'Procedural parser should expose duplicate/drop diagnostics for dated event/legal rows',
);

const syntheticLegalDoc = new JSDOM(`<!doctype html><html><body><table><tbody>
  <tr><th>Event date</th><td>01.01.2026</td></tr>
  <tr><th>Event description</th><td>(EXPECTED) GRANT</td></tr>
  <tr><th>Free Format Text</th><td>ORIGINAL CODE: 0009210</td></tr>
  <tr><th>Effective DATE</th><td>20260204</td></tr>
</tbody></table></body></html>`, { url: 'https://register.epo.org/application?number=EP00000000&tab=legal&lng=en' }).window.document;
const syntheticBlocks = extractLegalEventBlocksFromDocument(syntheticLegalDoc, 'https://register.epo.org/application?number=EP00000000&tab=legal&lng=en');
assert.strictEqual(syntheticBlocks.length, 1, 'Procedural parser should build one legal-event block from a legal-status form block');
assert.strictEqual(syntheticBlocks[0].codexKey, 'EXPECTED_GRANT', 'Procedural parser should map original legal codes through the codex code map');
assert.strictEqual(syntheticBlocks[0].effectiveDate, '04.02.2026', 'Procedural parser should normalize effective-date payloads from legal-status blocks');

const syntheticStructuredDoc = new JSDOM(`<!doctype html><html><body><table><tbody>
  <tr><th>Event date</th><td>05.02.2026</td></tr>
  <tr><th>Event description</th><td>Communication from the opposition division</td></tr>
  <tr><th>Original code</th><td>OREX</td></tr>
  <tr><th>STEP_DESCRIPTION_NAME</th><td>Invitation to file observations under Rule 79(1) EPC</td></tr>
  <tr><th>DATE_OF_DISPATCH</th><td>20260206</td></tr>
  <tr><th>DATE_OF_REPLY</th><td>20260301</td></tr>
  <tr><th>DATE_OF_PAYMENT1</th><td>20260302</td></tr>
  <tr><th>DATE_OF_REQUEST</th><td>20260205</td></tr>
  <tr><th>RESULT_DATE</th><td>20260303</td></tr>
  <tr><th>time-limit</th><td>4 months</td></tr>
</tbody></table></body></html>`, { url: 'https://register.epo.org/application?number=EP00000000&tab=legal&lng=en' }).window.document;
const structuredBlocks = extractLegalEventBlocksFromDocument(syntheticStructuredDoc, 'https://register.epo.org/application?number=EP00000000&tab=legal&lng=en');
assert.strictEqual(structuredBlocks[0].originalCode, 'OREX', 'Procedural parser should preserve explicit structured original-code rows');
assert.strictEqual(structuredBlocks[0].dispatchDate, '06.02.2026', 'Procedural parser should normalize ST.36 DATE_OF_DISPATCH fields');
assert.strictEqual(structuredBlocks[0].replyDate, '01.03.2026', 'Procedural parser should normalize ST.36 DATE_OF_REPLY fields');
assert.deepStrictEqual(structuredBlocks[0].paymentDates, ['02.03.2026'], 'Procedural parser should collect ST.36 DATE_OF_PAYMENT fields');
assert.strictEqual(structuredBlocks[0].requestDate, '05.02.2026', 'Procedural parser should normalize ST.36 DATE_OF_REQUEST fields');
assert.strictEqual(structuredBlocks[0].resultDate, '03.03.2026', 'Procedural parser should normalize ST.36 RESULT_DATE fields');
assert.strictEqual(structuredBlocks[0].timeLimitMonths, 4, 'Procedural parser should parse ST.36 time-limit values into month counts');
assert.strictEqual(structuredBlocks[0].stepDescriptionName, 'Invitation to file observations under Rule 79(1) EPC', 'Procedural parser should preserve STEP_DESCRIPTION_NAME for missed-act/deadline routing');

const caseNo = 'EP23182542';
const eventDoc = loadFixtureDocument(['cases', caseNo, 'event.html'], `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`);
const legalDoc = loadFixtureDocument(['cases', caseNo, 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`);
const eventHistory = parseEventHistoryFromDocument(eventDoc, `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`);
const legal = parseLegalFromDocument(legalDoc, `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`);
assert(eventHistory.events.some((event) => event.codexKey === 'EXPECTED_GRANT'), 'Procedural event-history parser should preserve codex-mapped expected-grant events on real fixtures');
assert(legal.codedEvents.some((event) => event.originalCode === '0009210' && event.codexKey === 'EXPECTED_GRANT'), 'Procedural legal parser should preserve coded legal events and exact code mappings on real fixtures');
assert(legal.renewals.some((renewal) => renewal.year === 6), 'Procedural legal parser should derive renewal-year helper rows from real legal fixtures');

console.log('epo_v2_procedural_parser.test.js passed');
