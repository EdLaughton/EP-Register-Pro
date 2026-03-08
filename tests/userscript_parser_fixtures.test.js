const assert = require('assert');
const {
  loadFixtureDocument,
  loadFixtureText,
  loadUserscriptHooks,
} = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

const caseNo = 'EP24837586';
const docs = {
  main: loadFixtureDocument(['register', 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`),
  doclist: loadFixtureDocument(['register', 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`),
  legal: loadFixtureDocument(['register', 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`),
  event: loadFixtureDocument(['register', 'event.html'], `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`),
  family: loadFixtureDocument(['register', 'family.html'], `https://register.epo.org/application?number=${caseNo}&tab=family&lng=en`),
  ueMain: loadFixtureDocument(['register', 'ueMain.html'], `https://register.epo.org/application?number=${caseNo}&tab=ueMain&lng=en`),
};

const main = hooks.parseMain(docs.main, caseNo);
assert.strictEqual(main.appNo, caseNo, 'Main parser should preserve case number');
assert.strictEqual(main.title, 'Facade system', 'Main parser should extract English title');
assert.strictEqual(main.applicant, 'Mauer Limited', 'Main parser should normalize applicant block');
assert.strictEqual(main.representative, 'J A Kemp LLP', 'Main parser should extract representative');
assert.strictEqual(main.filingDate, '18.09.2023', 'Main parser should extract filing date from application number row');
assert.strictEqual(main.parentCase, 'EP11111111', 'Main parser should extract parent application from scoped header rows');
assert.deepStrictEqual(Array.from(main.divisionalChildren || []), ['EP22222222'], 'Main parser should extract divisional children from scoped header rows');
assert.strictEqual(main.applicationType, 'Divisional', 'Main parser should prioritize divisional classification when parent/divisional links are present');
assert(main.publications.some((p) => p.no === 'EP1234567' && p.kind === 'A1'), 'Main parser should extract publication number + kind from publication field');

const doclist = hooks.parseDoclist(docs.doclist);
assert.strictEqual(doclist.docs.length, 5, 'Doclist parser should extract all checkbox-backed document rows');
assert(doclist.docs.some((d) => d.title.includes('Communication about intention to grant') && d.bundle === 'Grant package' && d.actor === 'EPO'), 'Doclist parser should classify intention-to-grant communication as EPO grant-package material');
assert(doclist.docs.some((d) => d.title.includes('Amendments/corrections to the text proposed for grant') && d.bundle === 'Grant package' && d.actor === 'Applicant'), 'Doclist parser should classify applicant grant-text corrections as grant-package filings');
assert(doclist.docs.some((d) => d.title.includes('Article 94(3)') && d.bundle === 'Examination'), 'Doclist parser should classify Article 94(3) communications as examination material');

const legal = hooks.parseLegal(docs.legal, caseNo);
assert(legal.events.some((e) => e.title === 'Mention of grant'), 'Legal parser should extract dated legal-status events');
assert(legal.renewals.some((r) => r.year === 7), 'Legal parser should detect renewal year from annual-fee event text');

const eventHistory = hooks.parseEventHistory(docs.event, caseNo);
assert.strictEqual(eventHistory.events.length, 2, 'Event-history parser should extract dated rows');
assert(eventHistory.events.some((e) => /Applicant observations filed/.test(e.title)), 'Event-history parser should preserve event titles');

const family = hooks.parseFamily(docs.family);
assert(family.publications.some((p) => p.no === 'EP1234567' && p.kind === 'A1'), 'Family parser should extract publication entries from page text');

const ue = hooks.parseUe(docs.ueMain);
assert.strictEqual(ue.ueStatus, 'Unitary effect registered', 'UE parser should normalize unitary-effect registration status');
assert.strictEqual(ue.upcOptOut, 'Opt-out withdrawn', 'UE parser should detect withdrawn UPC opt-out wording');

const pdfR71 = hooks.parsePdfDeadlineHints(loadFixtureText('pdf', 'r71_communication.txt'), {
  docDateStr: '10.01.2026',
  docTitle: 'Communication about intention to grant',
  docProcedure: 'Examining division',
});
assert.strictEqual(pdfR71.hints.length, 1, 'PDF parser should emit one R71(3) deadline hint for the sample communication');
assert.strictEqual(pdfR71.hints[0].label, 'R71(3) response period', 'PDF parser should classify Rule 71(3) communication correctly');
assert.strictEqual(pdfR71.hints[0].dateStr, '10.05.2026', 'PDF parser should derive the R71(3) deadline from communication date + 4 months');
assert.strictEqual(pdfR71.diagnostics.communicationDate, '10.01.2026', 'PDF parser should extract the communication date from the fixture letter header');

const pdfArt94Fallback = hooks.parsePdfDeadlineHints(loadFixtureText('pdf', 'art94_generic.txt'), {
  docDateStr: '01.09.2025',
  docTitle: 'Communication from the Examining Division pursuant to Article 94(3) EPC',
  docProcedure: 'Examining division',
});
assert.strictEqual(pdfArt94Fallback.hints.length, 1, 'PDF parser should produce a fallback Art. 94(3) deadline hint from metadata + communication date');
assert.strictEqual(pdfArt94Fallback.hints[0].label, 'Art. 94(3) response period', 'PDF parser should use metadata fallback to infer Art. 94(3) category');
assert.strictEqual(pdfArt94Fallback.hints[0].dateStr, '01.01.2026', 'PDF parser should apply the default 4-month Art. 94(3) period when months are not explicit');
assert(/Default 4-month period inferred/.test(pdfArt94Fallback.diagnostics.responseEvidence), 'PDF parser should record default-period fallback evidence for metadata-derived categories');

const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, pdfR71);
assert(deadlines.some((d) => d.label === 'R71(3) response period' && d.resolved === true), 'Deadline model should mark the R71(3) cycle resolved when later applicant grant-response activity exists');
assert(deadlines.some((d) => d.label === 'Opposition period (third-party monitor)'), 'Deadline model should derive post-grant opposition monitor from mention of grant');
assert(deadlines.some((d) => d.label === '20-year term from filing (reference)' && d.reference === true), 'Deadline model should include filing-term reference from fixture data');

console.log('userscript parser fixture checks passed');
