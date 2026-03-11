const assert = require('assert');
const { addCalendarMonthsDetailed, buildDeadlineComputationContext, inferProceduralDeadlinesFromSources } = require('../lib/epo_v2_deadline_signals');
const { loadUserscriptHooks, loadFixtureDocument, loadFixtureText } = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

const rolled = addCalendarMonthsDetailed(new Date('2025-01-31T00:00:00Z'), 1);
assert.strictEqual(rolled.rolledOver, true, 'Shared deadline helpers should preserve end-of-month rollover diagnostics');
assert.strictEqual(rolled.toDay, 28, 'Shared deadline helpers should clamp 31 Jan +1 month to the last day of February');

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

console.log('epo_v2_deadline_signals.test.js passed');
