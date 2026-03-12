const assert = require('assert');
const { loadUserscriptHooks, loadFixtureDocument, loadFixtureText } = require('./userscript_fixture_utils');
const { summarizeStatusText, inferStatusStageFromText } = require('../lib/epo_v2_status_signals');
const { classifyDocSignal } = require('../lib/epo_v2_doc_signals');
const { classifyPacketSignal, standalonePacketBundle } = require('../lib/epo_v2_packet_signals');
const { buildProceduralRecords, deriveProceduralPostureFromSources } = require('../lib/epo_v2_posture_signals');
const { inferProceduralDeadlinesFromSources } = require('../lib/epo_v2_deadline_signals');
const { classifyTimelineImportance, docPacketExplanation, timelineSubtitle, shouldAppendSingleRunLabel, compactOverviewTitle } = require('../lib/epo_v2_timeline_signals');
const { parseDoclistFromDocument } = require('../lib/epo_v2_doclist_parser');
const { parseEventHistoryFromDocument, parseLegalFromDocument } = require('../lib/epo_v2_procedural_parser');
const { parseFamilyFromDocument, parseCitationsFromDocument } = require('../lib/epo_v2_reference_parsers');
const { parseUeFromDocument, parseFederatedFromDocument } = require('../lib/epo_v2_territorial_parser');
const { parseMainRawFromDocument } = require('../lib/epo_v2_main_parser');
const { parsePdfDeadlineHints } = require('../lib/epo_v2_pdf_parser');
const { parseUpcOptOutResult } = require('../lib/epo_v2_upc_parser');
const { parseApplicationType, classifyDocument, refineDocumentClassification } = require('../lib/epo_v2_document_classification');
const { resolvedOverviewStatus, deadlinePresentationBuckets, selectNextDeadline, activeDeadlineNoteText, recoveryActionModel, buildActionableOverviewState } = require('../lib/epo_v2_overview_signals');

const hooks = loadUserscriptHooks();
const plain = (value) => JSON.parse(JSON.stringify(value));
const compactText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const partyHead = (value) => {
  const text = compactText(value).replace(/^for all designated states\b[:\s-]*/i, '').trim();
  const entityMatch = text.match(/^(.*?(?:Inc\.?|LLP|PLC|LLC|Ltd\.?|Limited|GmbH|S\.A\.?|B\.V\.?|Corp\.?|Corporation|Company|Co\.?|AG|AB|A\/S|SAS|SRL|S\.r\.l\.|KG|KGaA))(?=\s|$)/i);
  if (entityMatch?.[1]) return entityMatch[1].trim();
  const addressCue = text.match(/\s+\d{1,5}[A-Z]?(?:-\d+)?\s+[A-Z]/);
  if (addressCue && addressCue.index > 6) return text.slice(0, addressCue.index).trim();
  const placeCue = text.match(/\s+(?:Parc|Square|Suite|Building|Street|Road|Avenue|Boulevard|Lane|Way|Campus)\b/i);
  if (placeCue && placeCue.index > 6) return text.slice(0, placeCue.index).trim();
  return text;
};

assert.strictEqual(typeof hooks.summarizeStatus, 'function', 'Runtime hook surface should expose summarizeStatus');
assert.strictEqual(typeof hooks.inferStatusStage, 'function', 'Runtime hook surface should expose inferStatusStage');
assert.strictEqual(typeof hooks.parseApplicationType, 'function', 'Runtime hook surface should expose parseApplicationType');
assert.strictEqual(typeof hooks.normalizedDocSignal, 'function', 'Runtime hook surface should expose normalizedDocSignal');
assert.strictEqual(typeof hooks.normalizedPacketSignal, 'function', 'Runtime hook surface should expose normalizedPacketSignal');
assert.strictEqual(typeof hooks.buildDeadlineRecords, 'function', 'Runtime hook surface should expose buildDeadlineRecords for parity checks');
assert.strictEqual(typeof hooks.proceduralPostureModel, 'function', 'Runtime hook surface should expose proceduralPostureModel');
assert.strictEqual(typeof hooks.timelineAttorneyImportance, 'function', 'Runtime hook surface should expose timelineAttorneyImportance');
assert.strictEqual(typeof hooks.timelineSubtitleText, 'function', 'Runtime hook surface should expose timelineSubtitleText');
assert.strictEqual(typeof hooks.docPacketExplanation, 'function', 'Runtime hook surface should expose docPacketExplanation');
assert.strictEqual(typeof hooks.compactOverviewTitle, 'function', 'Runtime hook surface should expose compactOverviewTitle');
assert.strictEqual(typeof hooks.parsePdfDeadlineHints, 'function', 'Runtime hook surface should expose parsePdfDeadlineHints');

const statusSample = 'No opposition filed within time limit';
assert.deepStrictEqual(
  plain(hooks.summarizeStatus(statusSample)),
  summarizeStatusText(statusSample),
  'Runtime summarizeStatus should match lib status signals for a no-opposition status',
);
assert.strictEqual(
  hooks.inferStatusStage(statusSample),
  inferStatusStageFromText(statusSample),
  'Runtime inferStatusStage should match lib status signals for a no-opposition status',
);

const docSample = { title: 'Request for further processing', procedure: 'Examination' };
const runtimeDocSignal = plain(hooks.normalizedDocSignal(docSample.title, docSample.procedure));
const libDocSignal = classifyDocSignal(docSample);
assert.strictEqual(runtimeDocSignal.bundle, libDocSignal.bundle, 'Runtime normalizedDocSignal should match lib bundle for a further-processing request');
assert.strictEqual(runtimeDocSignal.level, libDocSignal.level, 'Runtime normalizedDocSignal should match lib level for a further-processing request');

const packetSample = [
  { title: 'Communication regarding the transmission of the European search report', procedure: 'Search / examination' },
  { title: 'Document annexed to the Extended European Search Report', procedure: 'Search / examination' },
  { title: 'European search opinion', procedure: 'Search / examination' },
];
const runtimePacketSignal = plain(hooks.normalizedPacketSignal(packetSample));
const libPacketSignal = classifyPacketSignal(packetSample);
assert.strictEqual(runtimePacketSignal.bundle, libPacketSignal.bundle, 'Runtime normalizedPacketSignal should match lib bundle for an extended-ESR packet');
assert.strictEqual(runtimePacketSignal.family, libPacketSignal.family, 'Runtime normalizedPacketSignal should match lib family for an extended-ESR packet');
assert.strictEqual(
  standalonePacketBundle(runtimePacketSignal),
  standalonePacketBundle(libPacketSignal),
  'Runtime standalone packet policy should match lib packet policy for an extended-ESR packet',
);

const timelineImportanceSamples = [
  ['Application deemed to be withdrawn (non-entry into European phase)', 'Search / examination', 'Legal status', 'EPO', 'info'],
  ['Communication about intention to grant a European patent', 'Examination', 'Documents', 'EPO', 'info'],
  ['Mention of grant', 'Publication', 'Legal status', 'EPO', 'info'],
];
for (const sample of timelineImportanceSamples) {
  assert.strictEqual(
    hooks.timelineAttorneyImportance(...sample),
    classifyTimelineImportance(...sample),
    `Runtime timeline importance should match lib helper for: ${sample[0]}`,
  );
}

const timelineSubtitleSample = { detail: 'published on 17.07.2024 [2024/29]\nEvent history', source: 'Event history', actor: 'EPO' };
assert.strictEqual(hooks.timelineSubtitleText(timelineSubtitleSample), timelineSubtitle(timelineSubtitleSample), 'Runtime timeline subtitle helper should match lib subtitle deduping');
assert.strictEqual(hooks.docPacketExplanation('Further processing'), docPacketExplanation('Further processing'), 'Runtime packet explanation helper should match lib timeline explanation text');
assert.strictEqual(hooks.compactOverviewTitle('Communication about intention to grant a European patent'), compactOverviewTitle('Communication about intention to grant a European patent'), 'Runtime compact-title helper should match lib title compaction');
assert.strictEqual(hooks.shouldAppendSingleRunLabel('Loss-of-rights communication', 'Examination'), shouldAppendSingleRunLabel('Loss-of-rights communication', 'Examination'), 'Runtime single-run-label policy should match lib timeline helper');

const applicationTypeSamples = [
  { appNo: 'EP19871250', internationalAppNo: 'WO2019US55678', priorities: [], statusRaw: '' },
  { appNo: 'EP23182542', parentCase: 'EP4070092', priorities: [] },
  { appNo: 'EP19205846', priorities: [{ no: 'GB20190017599', dateStr: '02.12.2019' }] },
  { appNo: 'EP1234567', priorities: [] },
];
for (const sample of applicationTypeSamples) {
  assert.strictEqual(hooks.parseApplicationType(sample), parseApplicationType(sample), `Runtime parseApplicationType should match lib classification helper for ${sample.appNo}`);
}

assert.deepStrictEqual(
  plain(hooks.classifyDocument('Request for further processing', 'Examination')),
  classifyDocument('Request for further processing', 'Examination'),
  'Runtime classifyDocument should match lib classification helper for further-processing requests',
);
assert.deepStrictEqual(
  plain(hooks.classifyDocument('Text intended for grant (version for approval)', 'Search / examination')),
  classifyDocument('Text intended for grant (version for approval)', 'Search / examination'),
  'Runtime classifyDocument should match lib classification helper for grant-package text-for-approval rows',
);
assert.deepStrictEqual(
  plain(hooks.refineDocumentClassification('Communication concerning the reminder according to rule 39(1) EPC and the invitation pursuant to rule 45 EPC', 'Search / examination', { bundle: 'Response to search', actor: 'Applicant', level: 'warn' })),
  refineDocumentClassification('Communication concerning the reminder according to rule 39(1) EPC and the invitation pursuant to rule 45 EPC', 'Search / examination', { bundle: 'Response to search', actor: 'Applicant', level: 'warn' }),
  'Runtime refineDocumentClassification should match lib refinement helper for EPO reminder rows',
);

const overviewStatusSample = resolvedOverviewStatus('ok', { simple: 'Published', level: 'info' }, { currentLabel: 'Grant intended (R71(3))', currentLevel: 'warn' });
assert.deepStrictEqual(
  plain(hooks.resolvedOverviewStatus('ok', { simple: 'Published', level: 'info' }, { currentLabel: 'Grant intended (R71(3))', currentLevel: 'warn' })),
  overviewStatusSample,
  'Runtime resolvedOverviewStatus should match lib overview headline-status precedence',
);
const monitoringDeadlines = [
  { label: 'Opposition period (third-party monitor)', date: new Date('2026-11-04T00:00:00Z'), resolved: false, superseded: false },
];
assert.deepStrictEqual(
  plain(hooks.deadlinePresentationBuckets(monitoringDeadlines, false)),
  plain(deadlinePresentationBuckets(monitoringDeadlines, false)),
  'Runtime deadlinePresentationBuckets should match lib overview deadline bucketing',
);
assert.deepStrictEqual(
  plain(hooks.selectNextDeadline(monitoringDeadlines, false, new Date('2026-03-01T00:00:00Z'))),
  plain(selectNextDeadline(monitoringDeadlines, false, new Date('2026-03-01T00:00:00Z'))),
  'Runtime selectNextDeadline should match lib overview next-deadline selection for monitoring-only windows',
);
assert.strictEqual(
  hooks.activeDeadlineNoteText(monitoringDeadlines, false),
  activeDeadlineNoteText(monitoringDeadlines, false),
  'Runtime activeDeadlineNoteText should match lib monitoring-only messaging',
);
const recoveryOverviewSample = {
  recovered: true,
  recoveredBeforeGrant: true,
  latestLoss: { dateStr: '01.10.2025', title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', detail: 'Search / examination' },
  latestRecovery: { dateStr: '15.11.2025', title: 'Decision on request for further processing', detail: '' },
  latestGrantDecision: { dateStr: '01.01.2026', title: '(Expected) grant', detail: 'published on 04.02.2026 [2026/06]' },
};
assert.deepStrictEqual(
  plain(hooks.recoveryActionModel(recoveryOverviewSample, 'Applicant', null, null)),
  plain(recoveryActionModel(recoveryOverviewSample, 'Applicant', null, null)),
  'Runtime recoveryActionModel should match lib recovery-path modeling',
);
assert.deepStrictEqual(
  plain(buildActionableOverviewState({
    mainSourceStatus: 'ok',
    statusSummary: { simple: 'Published', level: 'info' },
    posture: { currentLabel: 'Granted', currentLevel: 'ok', currentClosed: false, recovered: false },
    deadlines: monitoringDeadlines,
    waitingOn: '',
    waitingDays: null,
    latestApplicant: null,
  })),
  plain({
    status: { simple: 'Granted', level: 'ok' },
    deadlineBuckets: { active: [], monitoring: monitoringDeadlines, historical: [] },
    nextDeadline: null,
    nextDeadlineNote: 'No active applicant/EPO deadline detected; remaining clocks are third-party monitoring windows.',
    recoveryAction: null,
  }),
  'Lib overview composition helper should produce the expected monitoring-only actionable state',
);

const pdfR71Text = loadFixtureText('pdf', 'r71_communication.txt');
assert.deepStrictEqual(
  plain(hooks.parsePdfDeadlineHints(pdfR71Text, {
    docDateStr: '10.01.2026',
    docTitle: 'Communication about intention to grant',
    docProcedure: 'Examining division',
  })),
  plain(parsePdfDeadlineHints(pdfR71Text, {
    docDateStr: '10.01.2026',
    docTitle: 'Communication about intention to grant',
    docProcedure: 'Examining division',
  })),
  'Runtime parsePdfDeadlineHints should match lib PDF parsing for the Rule 71 communication fixture',
);

const pdfArt94Text = loadFixtureText('pdf', 'art94_generic.txt');
assert.deepStrictEqual(
  plain(hooks.parsePdfDeadlineHints(pdfArt94Text, {
    docDateStr: '01.09.2025',
    docTitle: 'Communication from the Examining Division pursuant to Article 94(3) EPC',
    docProcedure: 'Examining division',
  })),
  plain(parsePdfDeadlineHints(pdfArt94Text, {
    docDateStr: '01.09.2025',
    docTitle: 'Communication from the Examining Division pursuant to Article 94(3) EPC',
    docProcedure: 'Examining division',
  })),
  'Runtime parsePdfDeadlineHints should match lib PDF parsing for the generic Art. 94 fixture',
);

assert.deepStrictEqual(
  plain(hooks.parseUpcOptOutResult('<div>EP3816364 Opted-out application registered</div>', 'EP3816364')),
  plain(parseUpcOptOutResult('<div>EP3816364 Opted-out application registered</div>', 'EP3816364')),
  'Runtime parseUpcOptOutResult should match lib UPC parsing for a positive opt-out signal',
);
for (const [patentNumber, fixtureName] of [['EP3816364', 'EP3816364.html'], ['EP4438108', 'EP4438108.html']]) {
  const upcHtml = loadFixtureText('upc', fixtureName);
  assert.deepStrictEqual(
    plain(hooks.parseUpcOptOutResult(upcHtml, patentNumber)),
    plain(parseUpcOptOutResult(upcHtml, patentNumber)),
    `Runtime parseUpcOptOutResult should match lib UPC parsing for ${fixtureName}`,
  );
}

for (const caseNo of ['EP19871250', 'EP23182542', 'EP19205846']) {
  const mainDoc = loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`);
  const runtimeMain = plain(hooks.parseMain(mainDoc, caseNo));
  const libMain = plain(parseMainRawFromDocument(mainDoc, caseNo));
  assert.deepStrictEqual(
    {
      appNo: runtimeMain.appNo,
      title: compactText(runtimeMain.title),
      applicant: partyHead(runtimeMain.applicant),
      representative: partyHead(runtimeMain.representative),
      filingDate: runtimeMain.filingDate,
      priorities: runtimeMain.priorities,
      priorityText: compactText(runtimeMain.priorityText),
      statusRaw: compactText(runtimeMain.statusRaw),
      recentEvents: runtimeMain.recentEvents,
      publications: runtimeMain.publications,
      internationalAppNo: runtimeMain.internationalAppNo,
      isEuroPct: !!runtimeMain.isEuroPct,
      isDivisional: !!runtimeMain.isDivisional,
      parentCase: runtimeMain.parentCase,
      divisionalChildren: runtimeMain.divisionalChildren,
    },
    {
      appNo: libMain.appNo,
      title: compactText(libMain.title),
      applicant: partyHead(libMain.applicant),
      representative: partyHead(libMain.representative),
      filingDate: libMain.filingDate,
      priorities: libMain.priorities,
      priorityText: compactText(libMain.priorityText),
      statusRaw: compactText(libMain.statusRaw),
      recentEvents: libMain.recentEvents,
      publications: libMain.publications,
      internationalAppNo: libMain.internationalAppNo,
      isEuroPct: !!libMain.isEuroPct,
      isDivisional: !!libMain.isDivisional,
      parentCase: libMain.parentCase,
      divisionalChildren: libMain.divisionalChildren,
    },
    `Runtime parseMain raw extraction should match lib main parsing for ${caseNo}`,
  );
}

const citationsCaseNo = 'EP19871250';
const citationsDoc = loadFixtureDocument(['cases', citationsCaseNo, 'citations.html'], `https://register.epo.org/application?number=${citationsCaseNo}&tab=citations&lng=en`);
const runtimeCitations = plain(hooks.parseCitations(citationsDoc));
const libCitations = plain(parseCitationsFromDocument(citationsDoc));
assert.deepStrictEqual(runtimeCitations, libCitations, `Runtime parseCitations raw extraction should match lib reference parsing for ${citationsCaseNo}`);

for (const caseNo of ['EP19871250', 'EP24837586']) {
  const ueDoc = loadFixtureDocument(['cases', caseNo, 'ueMain.html'], `https://register.epo.org/application?number=${caseNo}&tab=ueMain&lng=en`);
  assert.deepStrictEqual(
    ((ue) => ({
      statusRaw: compactText(ue.statusRaw),
      ueStatus: compactText(ue.ueStatus),
      upcOptOut: compactText(ue.upcOptOut),
      memberStates: compactText(ue.memberStates),
      renewalPaidYears: Array.isArray(ue.renewalPaidYears) ? ue.renewalPaidYears : [],
      highestRenewalPaidYear: ue.highestRenewalPaidYear || null,
      text: compactText(ue.text),
    }))(plain(hooks.parseUe(ueDoc))),
    ((ue) => ({
      statusRaw: compactText(ue.statusRaw),
      ueStatus: compactText(ue.ueStatus),
      upcOptOut: compactText(ue.upcOptOut),
      memberStates: compactText(ue.memberStates),
      renewalPaidYears: Array.isArray(ue.renewalPaidYears) ? ue.renewalPaidYears : [],
      highestRenewalPaidYear: ue.highestRenewalPaidYear || null,
      text: compactText(ue.text),
    }))(plain(parseUeFromDocument(ueDoc))),
    `Runtime parseUe raw extraction should match lib territorial parsing for ${caseNo}`,
  );
}

const federatedCaseNo = 'EP19871250';
const federatedDoc = loadFixtureDocument(['cases', federatedCaseNo, 'federated.html'], `https://register.epo.org/application?number=${federatedCaseNo}&tab=federated&lng=en`);
assert.deepStrictEqual(
  plain(hooks.parseFederated(federatedDoc, federatedCaseNo)),
  plain(parseFederatedFromDocument(federatedDoc, federatedCaseNo)),
  `Runtime parseFederated raw extraction should match lib territorial parsing for ${federatedCaseNo}`,
);

for (const caseNo of ['EP22809254', 'EP23182542', 'EP23758527']) {
  const doclistUrl = `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`;
  const familyUrl = `https://register.epo.org/application?number=${caseNo}&tab=family&lng=en`;
  const main = hooks.parseMain(loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`), caseNo);
  const doclistDoc = loadFixtureDocument(['cases', caseNo, 'doclist.html'], doclistUrl);
  const familyDoc = loadFixtureDocument(['cases', caseNo, 'family.html'], familyUrl);
  const doclist = hooks.parseDoclist(doclistDoc);
  const family = hooks.parseFamily(familyDoc);
  const libDoclist = parseDoclistFromDocument(doclistDoc, { fallbackUrl: doclistUrl });
  const libFamily = parseFamilyFromDocument(familyDoc);
  assert.deepStrictEqual(
    plain(doclist.docs).map((doc) => ({
      dateStr: doc.dateStr,
      title: doc.title,
      procedure: doc.procedure,
      pages: doc.pages,
      rowOrder: doc.rowOrder,
      url: doc.url,
      source: doc.source,
    })),
    plain(libDoclist.docs).map((doc) => ({
      dateStr: doc.dateStr,
      title: doc.title,
      procedure: doc.procedure,
      pages: doc.pages,
      rowOrder: doc.rowOrder,
      url: doc.url,
      source: doc.source,
    })),
    `Runtime parseDoclist raw extraction should match lib doclist parsing for ${caseNo}`,
  );
  assert.deepStrictEqual(
    plain(family.publications),
    plain(libFamily.publications),
    `Runtime parseFamily raw extraction should match lib reference parsing for ${caseNo}`,
  );
  const eventUrl = `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`;
  const legalUrl = `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`;
  const eventDoc = loadFixtureDocument(['cases', caseNo, 'event.html'], eventUrl);
  const legalDoc = loadFixtureDocument(['cases', caseNo, 'legal.html'], legalUrl);
  const eventHistory = hooks.parseEventHistory(eventDoc, caseNo);
  const legal = hooks.parseLegal(legalDoc, caseNo);
  const libEventHistory = parseEventHistoryFromDocument(eventDoc, eventUrl);
  const libLegal = parseLegalFromDocument(legalDoc, legalUrl);
  assert.deepStrictEqual(
    plain(eventHistory.events).map((event) => ({
      dateStr: event.dateStr,
      title: compactText(event.title),
      detail: compactText(event.detail),
      codexKey: event.codexKey || '',
      codexPhase: event.codexPhase || '',
      codexClass: event.codexClass || '',
      matchStrategy: event.matchStrategy || '',
    })),
    plain(libEventHistory.events).map((event) => ({
      dateStr: event.dateStr,
      title: compactText(event.title),
      detail: compactText(event.detail),
      codexKey: event.codexKey || '',
      codexPhase: event.codexPhase || '',
      codexClass: event.codexClass || '',
      matchStrategy: event.matchStrategy || '',
    })),
    `Runtime parseEventHistory raw extraction should match lib procedural parsing for ${caseNo}`,
  );
  assert.deepStrictEqual(
    plain(legal.events).map((event) => ({
      dateStr: event.dateStr,
      title: compactText(event.title),
      detail: compactText(event.detail),
    })),
    plain(libLegal.events).map((event) => ({
      dateStr: event.dateStr,
      title: compactText(event.title),
      detail: compactText(event.detail),
    })),
    `Runtime parseLegal dated-row extraction should match lib procedural parsing for ${caseNo}`,
  );
  assert.deepStrictEqual(
    plain(legal.codedEvents).map((event) => ({
      dateStr: event.dateStr,
      title: compactText(event.title),
      detail: compactText(event.detail),
      freeFormatText: compactText(event.freeFormatText || ''),
      effectiveDate: compactText(event.effectiveDate || ''),
      originalCode: event.originalCode || '',
      codexKey: event.codexKey || '',
      codexPhase: event.codexPhase || '',
      codexClass: event.codexClass || '',
      matchStrategy: event.matchStrategy || '',
    })),
    plain(libLegal.codedEvents).map((event) => ({
      dateStr: event.dateStr,
      title: compactText(event.title),
      detail: compactText(event.detail),
      freeFormatText: compactText(event.freeFormatText || ''),
      effectiveDate: compactText(event.effectiveDate || ''),
      originalCode: event.originalCode || '',
      codexKey: event.codexKey || '',
      codexPhase: event.codexPhase || '',
      codexClass: event.codexClass || '',
      matchStrategy: event.matchStrategy || '',
    })),
    `Runtime parseLegal coded-event extraction should match lib procedural parsing for ${caseNo}`,
  );
  assert.deepStrictEqual(plain(legal.renewals), plain(libLegal.renewals), `Runtime parseLegal renewal extraction should match lib procedural parsing for ${caseNo}`);
  const runtimeRecords = plain(hooks.buildDeadlineRecords(doclist.docs, eventHistory, legal));
  const libRecords = buildProceduralRecords(doclist.docs, eventHistory, legal);
  assert.deepStrictEqual(runtimeRecords, libRecords, `Runtime buildDeadlineRecords should match lib procedural record building for ${caseNo}`);
  const runtimePosture = plain(hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal));
  const libPosture = deriveProceduralPostureFromSources({
    statusRaw: main.statusRaw || '',
    docs: doclist.docs,
    eventHistory,
    legal,
  });
  assert.strictEqual(runtimePosture.currentLabel, libPosture.currentLabel, `Runtime posture label should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(runtimePosture.currentLevel, libPosture.currentLevel, `Runtime posture level should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(!!runtimePosture.recovered, !!libPosture.recovered, `Runtime recovered flag should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(!!runtimePosture.recoveredBeforeGrant, !!libPosture.recoveredBeforeGrant, `Runtime recovered-before-grant flag should match lib posture derivation for ${caseNo}`);
  assert.strictEqual(runtimePosture.note, libPosture.note, `Runtime posture note should match lib posture derivation for ${caseNo}`);

  const runtimeDeadlines = plain(hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {})).map((deadline) => ({
    label: deadline.label,
    date: deadline.date,
    level: deadline.level,
    confidence: deadline.confidence,
    sourceDate: deadline.sourceDate || '',
    resolved: !!deadline.resolved,
    superseded: !!deadline.superseded,
    supersededBy: deadline.supersededBy || null,
    reference: !!deadline.reference,
    method: deadline.method || '',
    rolledOver: !!deadline.rolledOver,
    rolloverNote: deadline.rolloverNote || '',
  }));
  const libDeadlines = plain(inferProceduralDeadlinesFromSources({
    main,
    docs: doclist.docs,
    eventHistory,
    legal,
    pdfData: {},
  })).map((deadline) => ({
    label: deadline.label,
    date: deadline.date,
    level: deadline.level,
    confidence: deadline.confidence,
    sourceDate: deadline.sourceDate || '',
    resolved: !!deadline.resolved,
    superseded: !!deadline.superseded,
    supersededBy: deadline.supersededBy || null,
    reference: !!deadline.reference,
    method: deadline.method || '',
    rolledOver: !!deadline.rolledOver,
    rolloverNote: deadline.rolloverNote || '',
  }));
  assert.deepStrictEqual(runtimeDeadlines, libDeadlines, `Runtime deadline inference should match lib deadline inference for ${caseNo}`);
}

console.log('epo_v2_runtime_parity.test.js passed');
