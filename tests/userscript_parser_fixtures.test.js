const assert = require('assert');
const { JSDOM } = require('jsdom');
const {
  loadFixtureDocument,
  loadFixtureText,
  loadUserscriptHooks,
} = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

const caseNo = 'EP24837586';
const docs = {
  main: loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`),
  doclist: loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`),
  legal: loadFixtureDocument(['cases', caseNo, 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`),
  event: loadFixtureDocument(['cases', caseNo, 'event.html'], `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`),
  family: loadFixtureDocument(['cases', caseNo, 'family.html'], `https://register.epo.org/application?number=${caseNo}&tab=family&lng=en`),
  ueMain: loadFixtureDocument(['cases', caseNo, 'ueMain.html'], `https://register.epo.org/application?number=${caseNo}&tab=ueMain&lng=en`),
};

const main = hooks.parseMain(docs.main, caseNo);
assert.strictEqual(main.appNo, caseNo, 'Main parser should preserve case number');
assert.strictEqual(main.title, 'FACADE', 'Main parser should extract live English title from real Register capture');
assert(main.applicant.includes('Mauer Limited'), 'Main parser should normalize applicant block from real Register capture');
assert(main.representative.includes('J A Kemp LLP'), 'Main parser should extract representative from real Register capture');
assert.strictEqual(main.filingDate, '19.12.2024', 'Main parser should extract filing date from real Register capture');
assert(main.divisionalChildren.includes('EP25203726') && main.divisionalChildren.includes('EP25203732'), 'Main parser should extract live divisional children');
assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Main parser should classify the live case as Euro-PCT regional phase');
assert(main.internationalAppNo === 'WO2024EP87573', 'Main parser should extract the live PCT application number from the real capture');
assert(main.publications.some((p) => p.no === 'EP4623169' && p.kind === 'A1'), 'Main parser should extract real publication number + kind from multi-row publication tables');

const doclist = hooks.parseDoclist(docs.doclist);
assert(doclist.docs.length >= 10, 'Doclist parser should extract a non-trivial document list from the live capture');
assert(doclist.docs.some((d) => /Copy of the international search report/i.test(d.title) && d.bundle === 'Search package' && d.actor === 'EPO'), 'Doclist parser should classify EPO search-report material in the live Euro-PCT capture');
assert(doclist.docs.some((d) => /Amended claims|Amendments received before examination/i.test(d.title) && d.actor === 'Applicant'), 'Doclist parser should classify applicant amendment filings in the live capture');

const legal = hooks.parseLegal(docs.legal, caseNo);
assert(legal.events.some((e) => /Examination fee paid|Despatch of communication/i.test(`${e.title} ${e.detail}`)), 'Legal parser should extract dated legal-status events from the live capture');

const eventHistory = hooks.parseEventHistory(docs.event, caseNo);
assert(eventHistory.events.length >= 3, 'Event-history parser should extract multiple dated rows from the live capture');
assert(eventHistory.events.some((e) => /request for examination/i.test(e.title)), 'Event-history parser should preserve live event titles');

const family = hooks.parseFamily(docs.family);
assert(family.publications.some((p) => p.no === 'EP4623169' && p.kind === 'A1'), 'Family parser should extract publication entries from real family-table HTML');

const ue = hooks.parseUe(docs.ueMain);
assert((ue.ueStatus || ue.statusRaw || '').length > 0, 'UE parser should parse the live ueMain capture without crashing');

const placeholderMainDoc = new JSDOM('<!doctype html><html><body><div>No files were found for your search terms.</div></body></html>', {
  url: 'https://register.epo.org/application?number=EP19205846&tab=main&lng=en',
}).window.document;
const placeholderDoclistDoc = new JSDOM('<!doctype html><html><body><div>No files were found for your search terms.</div></body></html>', {
  url: 'https://register.epo.org/application?number=EP19205846&tab=doclist&lng=en',
}).window.document;
assert.strictEqual(hooks.classifyParsedSourceState('main', placeholderMainDoc, { appNo: 'EP19205846' }).status, 'notFound', 'Main-tab placeholder pages should classify as notFound when no usable case data is present');
assert.strictEqual(hooks.classifyParsedSourceState('doclist', placeholderDoclistDoc, { docs: [] }).status, 'empty', 'Auxiliary placeholder pages should classify as empty instead of healthy ok loads');
assert.strictEqual(hooks.classifyParsedSourceState('main', docs.main, main).status, 'ok', 'Real main Register captures should remain classified as ok');

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
assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Deadline model should derive the R71(3) cycle from live grant-communication material');
assert(deadlines.some((d) => d.label === '20-year term from filing (reference)' && d.reference === true), 'Deadline model should include filing-term reference from real Register data');

console.log('userscript parser fixture checks passed');
