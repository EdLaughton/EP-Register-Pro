const assert = require('assert');
const { addCalendarMonthsDetailed, buildDeadlineComputationContext, inferProceduralDeadlinesFromSources, isActualGrantMentionText } = require('../lib/epo_v2_deadline_signals');
const { loadUserscriptHooks, loadFixtureDocument, loadFixtureText } = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();
const localDateKey = (date) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '');

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

const syntheticFamilyDeadlines = inferProceduralDeadlinesFromSources({
  main: {
    applicationType: 'PCT application (E/PCT)',
    priorities: [{ dateStr: '01.01.2024' }],
    filingDate: '01.01.2024',
  },
  docs: [
    { dateStr: '10.01.2026', title: 'Invitation under Rule 62a EPC', procedure: 'Search', actor: 'EPO' },
    { dateStr: '11.01.2026', title: 'Communication under Rule 63 EPC', procedure: 'Search', actor: 'EPO' },
    { dateStr: '12.01.2026', title: 'Additional search fee under Rule 64 EPC', procedure: 'Search', actor: 'EPO' },
    { dateStr: '13.01.2026', title: 'Invitation under Rule 70(2) EPC and Rule 70a EPC', procedure: 'Search / examination', actor: 'EPO' },
    { dateStr: '14.01.2026', title: 'Communication under Rules 161 and 162 EPC (mandatory reply required)', procedure: 'Search / examination', actor: 'EPO' },
    { dateStr: '15.01.2026', title: 'Communication under Rule 164(1) EPC – additional search fees', procedure: 'Search / examination', actor: 'EPO' },
    { dateStr: '16.01.2026', title: 'Communication under Rule 164(2) EPC – unsearched inventions', procedure: 'Search / examination', actor: 'EPO' },
    { dateStr: '17.01.2026', title: 'Communication from the Examining Division pursuant to Article 94(3) EPC', procedure: 'Search / examination', actor: 'EPO' },
    { dateStr: '18.01.2026', title: 'Minutes of a consultation by telephone issued as first action', procedure: 'Examination', actor: 'EPO' },
    { dateStr: '20.01.2026', title: 'Invitation to file observations under Rule 79(1) EPC', procedure: 'Opposition', actor: 'EPO' },
    { dateStr: '21.01.2026', title: 'Invitation to reply under Rule 79(3) EPC', procedure: 'Opposition', actor: 'EPO' },
    { dateStr: '22.01.2026', title: 'Communication under Rule 82(1) EPC', procedure: 'Opposition', actor: 'EPO' },
    { dateStr: '23.01.2026', title: 'Communication under Rule 82(2) EPC – file translations of the amended claims and publication fee', procedure: 'Opposition', actor: 'EPO' },
    { dateStr: '24.01.2026', title: 'Further invitation under Rule 82(3) EPC with surcharge', procedure: 'Opposition', actor: 'EPO' },
    { dateStr: '25.01.2026', title: 'Communication under Rule 95(2) EPC', procedure: 'Limitation', actor: 'EPO' },
    { dateStr: '26.01.2026', title: 'Communication under Rule 95(3) EPC', procedure: 'Limitation', actor: 'EPO' },
    { dateStr: '27.01.2026', title: 'Communication under Rule 112(1) EPC (loss of rights)', procedure: 'Examination', actor: 'EPO' },
  ],
  eventHistory: { events: [] },
  legal: {
    events: [],
    codedEvents: [
      { dateStr: '20.05.2026', title: 'Oral proceedings', detail: 'Opposition', originalCode: 'ORAL' },
    ],
    renewals: [],
  },
  pdfData: {
    hints: [
      { label: 'Rule 116 final date', dateStr: '15.04.2026', sourceDate: '19.01.2026', confidence: 'high', evidence: 'PDF parse' },
      { label: 'Opposition oral proceedings date', dateStr: '20.05.2026', sourceDate: '19.01.2026', confidence: 'high', evidence: 'PDF parse' },
    ],
  },
});
assert.strictEqual(syntheticFamilyDeadlines.find((d) => d.label === 'Rule 62a invitation period')?.date?.toISOString().slice(0, 10), '2026-03-20', 'Shared deadline inference should compute Rule 62a from dispatch/communication date + Rule 126(2) 10-day notification fiction + two months');
assert.strictEqual(syntheticFamilyDeadlines.find((d) => d.label === 'Rule 63 invitation period')?.date && syntheticFamilyDeadlines.find((d) => d.label === 'Rule 63 invitation period').date.toISOString().slice(0, 10), '2026-03-21', 'Shared deadline inference should compute Rule 63 from dispatch/communication date + Rule 126(2) 10-day notification fiction + two months');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 64 additional search fees / unity selection' && d.reviewOnly), true, 'Shared deadline inference should surface Rule 64 as a review-only communication-specific search-fee branch');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 70(2) / Rule 70a shared response period'), true, 'Shared deadline inference should collapse paired Rule 70(2)/70a communications into one shared deadline');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 70(2) confirmation/response period'), false, 'Shared deadline inference should suppress the standalone Rule 70(2) clock when a combined Rule 70(2)/70a communication governs');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 161/162 mandatory response period'), true, 'Shared deadline inference should distinguish mandatory Rule 161/162 variants when the communication text says reply required');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 164(1) additional search fees'), true, 'Shared deadline inference should compute Rule 164(1) fee windows as fixed 2-month Euro-PCT deadlines');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 164(2) unsearched-inventions communication (manual review)' && d.reviewOnly), true, 'Shared deadline inference should route Rule 164(2) communications into manual review when the due date is communication-specific');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Art. 94(3) examination communication (manual review)' && d.reviewOnly), true, 'Shared deadline inference should surface explicit Art. 94(3) communications for manual review when the period is not stated in parsed text');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Minutes-as-first-action examination communication (manual review)' && d.reviewOnly), true, 'Shared deadline inference should keep minutes-as-first-action examination communications in the manual-review queue');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 116 final date'), true, 'Shared deadline inference should preserve Rule 116 final dates parsed from summons material');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Opposition oral proceedings date'), true, 'Shared deadline inference should preserve parsed/stored oral-proceedings dates for opposition summons branches');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Opposition Rule 79(1) proprietor reply'), true, 'Shared deadline inference should compute the proprietor’s first opposition reply under Rule 79(1)');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Opposition Rule 79(3) party-reply communication (manual review)' && d.reviewOnly), true, 'Shared deadline inference should surface Rule 79(3) follow-on communications for manual review');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Opposition Rule 82(1) maintenance-text observations'), true, 'Shared deadline inference should compute Rule 82(1) maintenance-text windows');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Opposition Rule 82(2) translations + publication fee' && d.superseded), true, 'Shared deadline inference should supersede Rule 82(2) deadlines when a later Rule 82(3) further invitation appears');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Opposition Rule 82(3) surcharge period'), true, 'Shared deadline inference should compute Rule 82(3) surcharge periods');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Limitation Rule 95(2) correction period'), true, 'Shared deadline inference should compute Rule 95(2) limitation-correction windows');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Limitation Rule 95(3) translations + fee'), true, 'Shared deadline inference should compute Rule 95(3) limitation translation/fee windows');
assert.strictEqual(syntheticFamilyDeadlines.some((d) => d.label === 'Rule 112 decision-request review window' && d.reviewOnly), true, 'Shared deadline inference should surface Rule 112 consequence notices as review-only remedy windows rather than ordinary office-action deadlines');

const structuredFieldDeadlines = inferProceduralDeadlinesFromSources({
  main: { applicationType: 'PCT application (E/PCT)', filingDate: '01.01.2024', priorities: [{ dateStr: '01.01.2024' }] },
  docs: [],
  eventHistory: {
    events: [
      { dateStr: '05.03.2026', title: 'Publication of mention of grant', detail: '' },
    ],
  },
  legal: {
    events: [],
    codedEvents: [
      { dateStr: '05.02.2026', title: 'Communication from the opposition division', detail: '', originalCode: 'OREX', codexPhase: 'opposition', dispatchDate: '06.02.2026', timeLimitMonths: 4 },
      { dateStr: '07.02.2026', title: 'Communication from the examining division in a limitation procedure', detail: '', originalCode: 'LIRE', codexPhase: 'limitation', dispatchDate: '08.02.2026', timeLimitDate: '10.05.2026' },
      { dateStr: '09.02.2026', title: 'Communication from the Examining Division pursuant to Article 94(3) EPC', detail: '', codexPhase: 'examination', dispatchDate: '10.02.2026', timeLimitMonths: 4 },
      { dateStr: '11.02.2026', title: 'Minutes of a consultation by telephone issued as first action', detail: '', codexPhase: 'examination', dispatchDate: '12.02.2026', timeLimitDate: '15.05.2026' },
      { dateStr: '13.02.2026', title: 'Summons to oral proceedings', detail: 'Examining Division', codexPhase: 'examination', dispatchDate: '14.02.2026', timeLimitDate: '20.04.2026' },
      { dateStr: '14.02.2026', title: 'Summons to oral proceedings', detail: 'Opposition Division', codexPhase: 'opposition', dispatchDate: '15.02.2026', timeLimitDate: '25.04.2026' },
      { dateStr: '16.02.2026', title: 'Communication under Rules 161 and 162 EPC', detail: 'No reply required; voluntary amendment window', codexPhase: 'regional_phase_entry', dispatchDate: '17.02.2026' },
      { dateStr: '18.02.2026', title: 'Communication about intention to grant a European patent', detail: '', codexKey: 'GRANT_R71_3', dispatchDate: '19.02.2026' },
      { dateStr: '20.02.2026', title: 'Disapproval of the communication of intention to grant the patent', detail: '', originalCode: 'IGRE', codexKey: 'GRANT_R71_6_DISAPPROVAL', dispatchDate: '20.02.2026' },
      { dateStr: '25.02.2026', title: 'Communication about intention to grant a European patent', detail: '', codexKey: 'GRANT_R71_3', dispatchDate: '26.02.2026' },
      { dateStr: '01.03.2026', title: 'Refusal of the application', detail: '', dispatchDate: '02.03.2026' },
    ],
    renewals: [],
  },
  pdfData: {},
});
assert.strictEqual(localDateKey(structuredFieldDeadlines.find((d) => d.label === 'Opposition division communication')?.date), '2026-06-16', 'Shared deadline inference should consume ST.36 DATE_OF_DISPATCH + Rule 126(2) 10-day notification fiction + time-limit fields for OREX-style opposition communications');
assert.strictEqual(structuredFieldDeadlines.find((d) => d.label === 'Opposition division communication')?.reviewOnly, false, 'Shared deadline inference should upgrade structured OREX-style deadlines out of the manual-review bucket');
assert.strictEqual(localDateKey(structuredFieldDeadlines.find((d) => d.label === 'Limitation communication')?.date), '2026-05-10', 'Shared deadline inference should consume exact ST.36 time-limit dates for limitation communications');
assert.strictEqual(localDateKey(structuredFieldDeadlines.find((d) => d.label === 'Art. 94(3) response period')?.date), '2026-06-20', 'Shared deadline inference should convert structured Art. 94(3) time-limit data into a real due date using Rule 126(2) 10-day notification fiction');
assert.strictEqual(localDateKey(structuredFieldDeadlines.find((d) => d.label === 'Minutes-as-first-action examination communication')?.date), '2026-05-15', 'Shared deadline inference should consume explicit structured due dates for minutes-as-first-action records without reapplying notification fiction');
assert.strictEqual(structuredFieldDeadlines.filter((d) => d.label === 'Rule 116 final date').length, 2, 'Shared deadline inference should keep distinct examination and opposition Rule 116 final dates when structured summons data exists');
assert.strictEqual(structuredFieldDeadlines.some((d) => d.label === 'Rule 161/162 voluntary amendment / claims-fee period'), true, 'Shared deadline inference should distinguish voluntary Rule 161/162 variants when the communication text says no reply is required');
assert.strictEqual(structuredFieldDeadlines.find((d) => d.label === 'R71(3) response period')?.internalKey, 'GRANT_POST_71_3_AMENDMENT', 'Shared deadline inference should tag fresh post-disapproval Rule 71(3) issuances explicitly as GRANT_POST_71_3_AMENDMENT branches');
assert.strictEqual(structuredFieldDeadlines.find((d) => d.label === 'R71(3) response period')?.supersedesKey, 'GRANT_R71_3', 'Shared deadline inference should mark post-71(3) amendment branches as superseding the earlier grant cycle');
assert.strictEqual(structuredFieldDeadlines.some((d) => d.internalKey === 'DECISION_REFUSAL' && d.anchorOnly), true, 'Shared deadline inference should represent refusal decisions explicitly as appeal-branch anchors');
assert.strictEqual(structuredFieldDeadlines.some((d) => d.label === 'Appeal notice + fee' && d.internalKey === 'APPEAL_EVENT' && d.anchorInternalKey === 'DECISION_REFUSAL' && localDateKey(d.date) === '2026-05-12'), true, 'Shared deadline inference should tag appeal clocks explicitly and link refusal decisions to the appeal branch using decision dispatch + Rule 126(2) 10-day notification fiction');
assert.strictEqual(structuredFieldDeadlines.some((d) => d.label === 'Unitary effect request window' && d.internalKey === 'UNITARY_PATENT_EVENT'), true, 'Shared deadline inference should tag unitary-effect windows explicitly in the separate UP namespace');

const summonsReviewDeadlines = inferProceduralDeadlinesFromSources({
  main: { applicationType: 'European patent application', filingDate: '01.01.2020' },
  docs: [
    { dateStr: '01.04.2026', title: 'Summons to oral proceedings', procedure: 'Examining division', actor: 'EPO' },
    { dateStr: '02.04.2026', title: 'Summons to oral proceedings', procedure: 'Opposition Division', actor: 'EPO' },
  ],
  eventHistory: { events: [] },
  legal: { events: [], codedEvents: [], renewals: [] },
  pdfData: {},
});
assert.strictEqual(summonsReviewDeadlines.some((d) => d.label === 'Examination summons / Rule 116 review' && d.reviewOnly), true, 'Shared deadline inference should keep naked examination summons in the review bucket when no parsed annex date or ST.36 time-limit is available');
assert.strictEqual(summonsReviewDeadlines.some((d) => d.label === 'Opposition summons / Rule 116 review' && d.reviewOnly), true, 'Shared deadline inference should keep naked opposition summons in the review bucket when no parsed annex date or ST.36 time-limit is available');

const codexGenericDeadlines = inferProceduralDeadlinesFromSources({
  main: { applicationType: 'European patent application', filingDate: '01.01.2020' },
  docs: [],
  eventHistory: { events: [] },
  legal: {
    events: [],
    codedEvents: [
      { dateStr: '01.02.2026', title: 'Communication from the opposition division', detail: '', originalCode: 'OREX' },
      { dateStr: '02.02.2026', title: 'Preparation for maintenance of the patent in an amended form', detail: '', originalCode: 'PMAP' },
      { dateStr: '03.02.2026', title: 'Communication from the examining division in a limitation procedure', detail: '', originalCode: 'LIRE' },
      { dateStr: '04.02.2026', title: 'Oral proceedings', detail: 'Opposition', originalCode: 'ORAL' },
    ],
    renewals: [],
  },
  pdfData: {},
});
assert.strictEqual(codexGenericDeadlines.some((d) => d.label === 'Opposition division communication (manual review)' && d.reviewOnly), true, 'Shared deadline inference should use OREX-style procedural-step markers as opposition manual-review anchors');
assert.strictEqual(codexGenericDeadlines.some((d) => d.label === 'Opposition Rule 82 branch (manual review)' && d.reviewOnly), true, 'Shared deadline inference should use PMAP-style procedural-step markers as Rule 82 branch anchors');
assert.strictEqual(codexGenericDeadlines.some((d) => d.label === 'Limitation communication (manual review)' && d.reviewOnly), true, 'Shared deadline inference should use LIRE-style procedural-step markers as limitation manual-review anchors');
assert.strictEqual(codexGenericDeadlines.some((d) => d.label === 'Opposition oral proceedings date'), true, 'Shared deadline inference should store ORAL-coded opposition hearing dates directly from coded procedural events');

console.log('epo_v2_deadline_signals.test.js passed');
