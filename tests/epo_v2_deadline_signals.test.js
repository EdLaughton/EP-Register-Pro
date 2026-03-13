const assert = require('assert');
const { addCalendarMonthsDetailed, buildDeadlineComputationContext, inferProceduralDeadlinesFromSources, isActualGrantMentionText } = require('../lib/epo_v2_deadline_signals');
const { loadUserscriptHooks, loadFixtureDocument, loadFixtureText } = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

const rolled = addCalendarMonthsDetailed(new Date('2025-01-31T00:00:00Z'), 1);
assert.strictEqual(rolled.rolledOver, true, 'Shared deadline helpers should preserve end-of-month rollover diagnostics');
assert.strictEqual(rolled.toDay, 28, 'Shared deadline helpers should clamp 31 Jan +1 month to the last day of February');
assert.strictEqual(isActualGrantMentionText('European patent granted'), true, 'Grant-mention helper should recognize actual grant events');
assert.strictEqual(isActualGrantMentionText('Request for grant of a European patent'), false, 'Grant-mention helper should not mistake request-for-grant paperwork for post-grant status');

const syntheticCtx = buildDeadlineComputationContext({
  main: {
    applicationType: 'PCT application (E/PCT)',
    priorities: [{ dateStr: '01.01.2024' }],
    filingDate: '01.01.2024',
  },
  docs: [
    { dateStr: '10.01.2025', title: 'Communication about intention to grant a European patent', procedure: 'Examination', actor: 'EPO' },
    { dateStr: '25.02.2025', title: 'Approval of the text proposed for grant', procedure: 'Examination', actor: 'Applicant' },
  ],
  eventHistory: {
    events: [
      { dateStr: '01.07.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', detail: 'Examination' },
    ],
  },
  legal: {},
  pdfData: {
    hints: [
      { label: 'R71(3) response period', dateStr: '10.05.2025', sourceDate: '10.01.2025', confidence: 'high', evidence: 'PDF parse' },
    ],
  },
});
assert.strictEqual(syntheticCtx.isEuroPct, true, 'Deadline context should retain Euro-PCT application-type awareness');
assert.strictEqual(syntheticCtx.hasPdfHint(/R71\(3\)/i), true, 'Deadline context should surface parsed PDF hint labels');
assert.strictEqual(syntheticCtx.resolveHintByActivity('R71(3) response period', new Date('2025-01-10T00:00:00Z')), true, 'Deadline context should mark R71 periods resolved when later grant-approval activity exists');
assert.deepStrictEqual(
  syntheticCtx.terminalEpoOutcomeAfter(new Date('2025-01-10T00:00:00Z'), new Date('2025-05-10T00:00:00Z')),
  { dateStr: '01.07.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', detail: 'Examination' },
  'Deadline context should detect later EPO terminal outcomes after an inferred deadline',
);

const caseNo = 'EP24163939';
const main = hooks.parseMain(loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`), caseNo);
const doclist = hooks.parseDoclist(loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`));
const eventHistory = hooks.parseEventHistory(loadFixtureDocument(['cases', caseNo, 'event.html'], `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`), caseNo);
const legal = hooks.parseLegal(loadFixtureDocument(['cases', caseNo, 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`), caseNo);
const pdfR71 = hooks.parsePdfDeadlineHints(loadFixtureText('pdf', 'r71_communication.txt'), {
  docDateStr: '10.01.2026',
  docTitle: 'Communication about intention to grant',
  docProcedure: 'Examining division',
});
const deadlines = inferProceduralDeadlinesFromSources({ main, docs: doclist.docs, eventHistory, legal, pdfData: pdfR71 });
assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Shared deadline inference should derive the R71 cycle from live grant-communication material');
assert(deadlines.some((d) => d.label === '20-year term from filing (reference)' && d.reference === true), 'Shared deadline inference should include the filing-term reference row');

const publishedDivisionalDeadlines = inferProceduralDeadlinesFromSources({
  main: {
    applicationType: 'Divisional',
    statusRaw: 'The application has been published',
    priorities: [{ dateStr: '21.12.2023' }],
    filingDate: '19.12.2024',
  },
  docs: [
    { dateStr: '25.11.2025', title: 'Communication regarding the transmission of the European search report', procedure: 'Search / examination', actor: 'EPO' },
    { dateStr: '08.10.2025', title: 'Notification of forthcoming publication', procedure: 'Formalities', actor: 'EPO' },
    { dateStr: '22.09.2025', title: 'Acknowledgement of receipt of electronic submission of the request for grant of a European patent', procedure: 'Search / examination', actor: 'Applicant' },
    { dateStr: '22.09.2025', title: 'Request for grant of a European patent', procedure: 'Search / examination', actor: 'Applicant' },
  ],
  eventHistory: {
    events: [
      { dateStr: '21.11.2025', title: 'Publication of search report', detail: 'published on 24.12.2025 [2025/52]' },
      { dateStr: '03.10.2025', title: 'Publication in section I.1 EP Bulletin', detail: 'published on 05.11.2025 [2025/45]' },
      { dateStr: '23.09.2025', title: 'Change - representative', detail: '' },
    ],
  },
  legal: { events: [], codedEvents: [], renewals: [] },
  pdfData: {},
});
assert(!publishedDivisionalDeadlines.some((d) => d.label === 'Unitary effect request window'), 'Shared deadline inference should not invent unitary-effect windows for a published divisional that only has request-for-grant/search-publication signals');
assert(!publishedDivisionalDeadlines.some((d) => d.label === 'Opposition period (third-party monitor)'), 'Shared deadline inference should not invent opposition windows for a published divisional without an actual grant mention');

const grantCaseNo = 'EP20816706';
const grantMain = hooks.parseMain(loadFixtureDocument(['cases', grantCaseNo, 'main.html'], `https://register.epo.org/application?number=${grantCaseNo}&tab=main&lng=en`), grantCaseNo);
const grantDoclist = hooks.parseDoclist(loadFixtureDocument(['cases', grantCaseNo, 'doclist.html'], `https://register.epo.org/application?number=${grantCaseNo}&tab=doclist&lng=en`));
const grantEventHistory = hooks.parseEventHistory(loadFixtureDocument(['cases', grantCaseNo, 'event.html'], `https://register.epo.org/application?number=${grantCaseNo}&tab=event&lng=en`), grantCaseNo);
const grantLegal = hooks.parseLegal(loadFixtureDocument(['cases', grantCaseNo, 'legal.html'], `https://register.epo.org/application?number=${grantCaseNo}&tab=legal&lng=en`), grantCaseNo);
const grantDeadlines = inferProceduralDeadlinesFromSources({ main: grantMain, docs: grantDoclist.docs, eventHistory: grantEventHistory, legal: grantLegal, pdfData: {} });
assert.strictEqual(grantDeadlines.find((d) => d.label === 'R71(3) response period')?.sourceDate, '06.12.2024', 'Shared deadline inference should anchor Rule 71(3) to the underlying communication date rather than the later announcement row');
assert.strictEqual(grantDeadlines.find((d) => d.label === 'Euro-PCT exam/designation deadline (later-of formula)')?.sourceDate, '04.11.2019 / 14.05.2021', 'Shared deadline inference should anchor the later-of formula to the qualifying ISR/WO packet rather than later loss-of-rights rows');

const conflictCaseNo = 'EP23182542';
const conflictMain = hooks.parseMain(loadFixtureDocument(['cases', conflictCaseNo, 'main.html'], `https://register.epo.org/application?number=${conflictCaseNo}&tab=main&lng=en`), conflictCaseNo);
const conflictDoclist = hooks.parseDoclist(loadFixtureDocument(['cases', conflictCaseNo, 'doclist.html'], `https://register.epo.org/application?number=${conflictCaseNo}&tab=doclist&lng=en`));
const conflictEventHistory = hooks.parseEventHistory(loadFixtureDocument(['cases', conflictCaseNo, 'event.html'], `https://register.epo.org/application?number=${conflictCaseNo}&tab=event&lng=en`), conflictCaseNo);
const conflictLegal = hooks.parseLegal(loadFixtureDocument(['cases', conflictCaseNo, 'legal.html'], `https://register.epo.org/application?number=${conflictCaseNo}&tab=legal&lng=en`), conflictCaseNo);
const conflictDeadlines = inferProceduralDeadlinesFromSources({ main: conflictMain, docs: conflictDoclist.docs, eventHistory: conflictEventHistory, legal: conflictLegal, pdfData: {} });
assert.strictEqual(conflictDeadlines.find((d) => d.label === 'R71(3) response period')?.sourceDate, '13.05.2025', 'Shared deadline inference should prefer the actual Rule 71(3) communication packet over later grant-announcement rows');
assert.strictEqual(conflictDeadlines.some((d) => d.label === 'Art. 94(3) response period'), false, 'Shared deadline inference should not fabricate Art. 94(3) dates from applicant reply packets or generic examining-division rows');

const recoveryCaseNo = 'EP23721286';
const recoveryMain = hooks.parseMain(loadFixtureDocument(['cases', recoveryCaseNo, 'main.html'], `https://register.epo.org/application?number=${recoveryCaseNo}&tab=main&lng=en`), recoveryCaseNo);
const recoveryDoclist = hooks.parseDoclist(loadFixtureDocument(['cases', recoveryCaseNo, 'doclist.html'], `https://register.epo.org/application?number=${recoveryCaseNo}&tab=doclist&lng=en`));
const recoveryEventHistory = hooks.parseEventHistory(loadFixtureDocument(['cases', recoveryCaseNo, 'event.html'], `https://register.epo.org/application?number=${recoveryCaseNo}&tab=event&lng=en`), recoveryCaseNo);
const recoveryLegal = hooks.parseLegal(loadFixtureDocument(['cases', recoveryCaseNo, 'legal.html'], `https://register.epo.org/application?number=${recoveryCaseNo}&tab=legal&lng=en`), recoveryCaseNo);
const recoveryDeadlines = inferProceduralDeadlinesFromSources({ main: recoveryMain, docs: recoveryDoclist.docs, eventHistory: recoveryEventHistory, legal: recoveryLegal, pdfData: {} });
assert.strictEqual(recoveryDeadlines.some((d) => d.label === 'Appeal notice + fee'), false, 'Shared deadline inference should not fabricate appeal clocks from further-processing decisions');

console.log('epo_v2_deadline_signals.test.js passed');
