const assert = require('assert');
const { loadFixtureText } = require('./userscript_fixture_utils');
const {
  normalizeDateString,
  parseSmallNumberToken,
  extractRegisteredLetterProofLine,
  extractCommunicationDateFromPdf,
  extractResponseMonthsFromPdf,
  extractExplicitDeadlineDateFromPdf,
  extractOralProceedingsDateFromPdf,
  inferDeadlineCategoryFromContext,
  defaultResponseMonthsForCategory,
  parsePdfDeadlineHints,
} = require('../lib/epo_v2_pdf_parser');

assert.strictEqual(normalizeDateString('1/2/26'), '01.02.2026', 'PDF parser should normalize short slash dates into dd.mm.yyyy');
assert.strictEqual(parseSmallNumberToken('six'), 6, 'PDF parser should read small spelled-out month counts');
assert.strictEqual(defaultResponseMonthsForCategory('Art. 94(3) response period'), 0, 'PDF parser should not invent a default Art. 94(3) period without explicit communication text');
assert.strictEqual(defaultResponseMonthsForCategory('Rule 62a invitation period'), 2, 'PDF parser should preserve fixed two-month defaults for Rule 62a communications');
assert.strictEqual(defaultResponseMonthsForCategory('Opposition Rule 82(2) translations + publication fee'), 3, 'PDF parser should preserve fixed three-month defaults for Rule 82(2) communications');
assert.deepStrictEqual(
  inferDeadlineCategoryFromContext({ docTitle: 'Communication about intention to grant', docProcedure: 'Examining division' }),
  {
    category: 'R71(3) response period',
    evidence: 'Inferred from document title/procedure metadata (Rule 71(3) / intention to grant signal)',
  },
  'PDF parser should infer the grant-intention category from document metadata when the text is generic',
);
assert.deepStrictEqual(
  inferDeadlineCategoryFromContext({ docTitle: 'Invitation under Rule 62a EPC', docProcedure: 'Search' }),
  {
    category: 'Rule 62a invitation period',
    evidence: 'Inferred from document title/procedure metadata (Rule 62a search-stage signal)',
  },
  'PDF parser should infer Rule 62a search invitations from document metadata',
);

const registeredLetter = extractRegisteredLetterProofLine('Registered Letter\nEPO FORM 2936 10.01.2026\nProof of dispatch');
assert.strictEqual(registeredLetter.registeredLetterLine, 'Registered Letter', 'PDF parser should preserve the registered-letter anchor line');
assert.strictEqual(registeredLetter.proofLine, 'EPO FORM 2936 10.01.2026', 'PDF parser should recover the dispatch-proof line below a registered-letter marker');

const r71Text = loadFixtureText('pdf', 'r71_communication.txt');
const r71Communication = extractCommunicationDateFromPdf(r71Text, { docDateStr: '10.01.2026' });
assert.strictEqual(r71Communication.dateStr, '10.01.2026', 'PDF parser should recover the communication date from the Rule 71 communication header');
assert(/Application\/Ref\/Date header table|Date of communication|Date field found/.test(r71Communication.evidence), 'PDF parser should retain evidence for the recovered communication date');

const art94Text = loadFixtureText('pdf', 'art94_generic.txt');
const art94Months = extractResponseMonthsFromPdf(art94Text);
assert.strictEqual(art94Months.months, 0, 'Generic Art. 94 fixture should force the default-period fallback when no explicit month count is present');
const art94Explicit = extractExplicitDeadlineDateFromPdf(art94Text);
assert.deepStrictEqual(art94Explicit, { dateStr: '', evidence: '' }, 'Generic Art. 94 fixture should not fake an explicit deadline date when the text has none');

const rule62aText = 'Date of communication: 10.01.2026\nInvitation under Rule 62a EPC\nThe applicant is invited to indicate the claims to be searched.';
const parsedRule62a = parsePdfDeadlineHints(rule62aText, {
  docDateStr: '10.01.2026',
  docTitle: 'Invitation under Rule 62a EPC',
  docProcedure: 'Search',
});
assert.strictEqual(parsedRule62a.hints.length, 1, 'Shared PDF parser should emit one fallback hint for fixed-period Rule 62a communications');
assert.strictEqual(parsedRule62a.hints[0].label, 'Rule 62a invitation period', 'Shared PDF parser should classify Rule 62a communications correctly');
assert.strictEqual(parsedRule62a.hints[0].dateStr, '10.03.2026', 'Shared PDF parser should derive Rule 62a deadlines from communication date + two months when the title gives the rule family');
assert.strictEqual(parsedRule62a.hints[0].confidence, 'low', 'Shared PDF parser should keep metadata-only default-period inference in the low-confidence review bucket');

const summonsText = 'Summons to oral proceedings\nDate of this communication: 19.01.2026\nThe oral proceedings will take place on 20.05.2026.\nFinal date for making written submissions: 15.04.2026.';
const oralDate = extractOralProceedingsDateFromPdf(summonsText);
assert.strictEqual(oralDate.dateStr, '20.05.2026', 'PDF parser should recover the oral-proceedings hearing date from summons text');
const parsedSummons = parsePdfDeadlineHints(summonsText, {
  docDateStr: '19.01.2026',
  docTitle: 'Summons to oral proceedings',
  docProcedure: 'Opposition',
});
assert.strictEqual(parsedSummons.hints.some((hint) => hint.label === 'Rule 116 final date' && hint.dateStr === '15.04.2026'), true, 'Shared PDF parser should preserve explicit Rule 116 final dates from summons text');
assert.strictEqual(parsedSummons.hints.some((hint) => hint.label === 'Opposition oral proceedings date' && hint.dateStr === '20.05.2026'), true, 'Shared PDF parser should store oral-proceedings hearing dates alongside Rule 116 final dates');
assert.strictEqual(parsedSummons.diagnostics.oralProceedingsDate, '20.05.2026', 'Shared PDF parser should record oral-proceedings dates in diagnostics');

const parsedR71 = parsePdfDeadlineHints(r71Text, {
  docDateStr: '10.01.2026',
  docTitle: 'Communication about intention to grant',
  docProcedure: 'Examining division',
});
assert.strictEqual(parsedR71.hints.length, 1, 'Shared PDF parser should emit one hint for the Rule 71 communication fixture');
assert.strictEqual(parsedR71.hints[0].label, 'R71(3) response period', 'Shared PDF parser should classify Rule 71 communications correctly');
assert.strictEqual(parsedR71.hints[0].dateStr, '10.05.2026', 'Shared PDF parser should derive the Rule 71 deadline from communication date + four months');
assert.strictEqual(parsedR71.diagnostics.communicationDate, '10.01.2026', 'Shared PDF parser should preserve the extracted communication date in diagnostics');

const parsedArt94 = parsePdfDeadlineHints(art94Text, {
  docDateStr: '01.09.2025',
  docTitle: 'Communication from the Examining Division pursuant to Article 94(3) EPC',
  docProcedure: 'Examining division',
});
assert.strictEqual(parsedArt94.hints.length, 0, 'Shared PDF parser should not emit a dated Art. 94 hint when the generic fixture lacks an explicit period or deadline');
assert.strictEqual(parsedArt94.diagnostics.category, 'Art. 94(3) response period', 'Shared PDF parser should still classify the generic fixture as Art. 94(3) for downstream review');
assert.strictEqual(parsedArt94.diagnostics.responseMonths, 0, 'Shared PDF parser should leave Art. 94(3) at zero months when the communication text gives no express period');
assert.strictEqual(parsedArt94.diagnostics.responseEvidence, '', 'Shared PDF parser should avoid fabricating fallback-period evidence for generic Art. 94 metadata');

console.log('epo_v2_pdf_parser.test.js passed');
