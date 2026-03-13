const { JSDOM } = require('jsdom');
const { EPO_CODEX_DATA } = require('./epo_codex_data');
const { normalize } = require('./epo_v2_utils');
const { parseDoclistFromDocument } = require('./epo_v2_doclist_parser');
const {
  normalizeCodexDescription,
  legalCodeRecord,
  codexDescriptionRecord,
  normalizeCodexSignal: normaliseSignal,
  extractLegalEventBlocksFromDocument,
  parseEventHistoryFromDocument,
  parseLegalFromDocument,
} = require('./epo_v2_procedural_parser');
const { parseMainRawFromDocument } = require('./epo_v2_main_parser');
const { parseApplicationType, classifyDocument, refineDocumentClassification } = require('./epo_v2_document_classification');
const { parseFamilyFromDocument, parseCitationsFromDocument } = require('./epo_v2_reference_parsers');
const { parseUeFromDocument, parseFederatedFromDocument } = require('./epo_v2_territorial_parser');
const { territorialPresentationModel } = require('./epo_v2_territorial_signals');
const { summarizeStatusText, inferStatusStageFromText } = require('./epo_v2_status_signals');
const { deriveProceduralPostureFromSources } = require('./epo_v2_posture_signals');
const { inferProceduralDeadlinesFromSources } = require('./epo_v2_deadline_signals');
const { parsePdfDeadlineHints } = require('./epo_v2_pdf_parser');
const { buildActionableOverviewState } = require('./epo_v2_overview_signals');

function extractLegalEventBlocks(doc, url = '') {
  return extractLegalEventBlocksFromDocument(doc, url);
}

function extractLegalEventBlocksFromHtml(html, url = 'https://register.epo.org/application?number=EP00000000&lng=en&tab=legal') {
  const doc = new JSDOM(html, { url }).window.document;
  return extractLegalEventBlocksFromDocument(doc, url);
}

function lossReasonLabel(textValue = '') {
  const low = normalize(textValue).toLowerCase();
  if (!low) return '';
  if (/non-entry into european phase/.test(low)) return 'non-entry';
  if (/translations of claims\/payment missing/.test(low)) return 'grant formalities';
  if (/non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(low)) return 'fees / no WO reply';
  if (/non-reply to written opinion/.test(low)) return 'no WO reply';
  return 'generic loss of rights';
}

function classifyDoclistEntries(rawDocs = []) {
  return (rawDocs || []).map((doc) => ({
    ...doc,
    ...refineDocumentClassification(doc.title, doc.procedure, classifyDocument(doc.title, doc.procedure)),
  }));
}

function enrichMain(rawMain = {}) {
  const statusSummary = summarizeStatusText(rawMain.statusRaw || '');
  return {
    ...rawMain,
    applicationType: parseApplicationType(rawMain),
    statusSimple: statusSummary.simple,
    statusLevel: statusSummary.level,
    statusStage: inferStatusStageFromText(rawMain.statusRaw || ''),
  };
}

function deriveCurrentPosture({ main = {}, docs = [], legal = {}, eventHistory = {} } = {}) {
  const posture = deriveProceduralPostureFromSources({ statusRaw: normalize(main.statusRaw || ''), docs, legal, eventHistory });
  const signals = {
    grantIntendedSeen: !!posture.currentGrantIntended,
    searchSeen: !!posture.currentSearch,
    grantSeen: !!posture.currentGranted,
    noOppositionSeen: !!posture.currentNoOpposition,
    lossSeen: !!posture.latestLoss,
    recoverySeen: !!posture.latestRecovery,
  };

  const story = [];
  if (signals.grantIntendedSeen) story.push('R71/intention-to-grant');
  if (signals.lossSeen) story.push(`loss-of-rights (${lossReasonLabel(`${posture.latestLoss?.title || ''}\n${posture.latestLoss?.detail || ''}`)})`);
  if (signals.recoverySeen) story.push('further processing / recovery');
  if (signals.grantSeen) story.push('grant');
  if (signals.noOppositionSeen) story.push('no opposition');
  if (!story.length && signals.searchSeen) story.push('search publication');

  return {
    currentPosture: posture.currentSearch ? 'Search published' : (posture.currentLabel || 'Needs manual classification'),
    signals,
    story: story.join(' → '),
  };
}

function buildNormalizedCaseFromDocuments({
  caseNo = '',
  mainDoc = null,
  doclistDoc = null,
  eventDoc = null,
  legalDoc = null,
  familyDoc = null,
  citationsDoc = null,
  ueDoc = null,
  federatedDoc = null,
  pdfText = '',
  pdfContext = {},
  urls = {},
} = {}) {
  const mainRaw = mainDoc ? parseMainRawFromDocument(mainDoc, caseNo) : { appNo: caseNo };
  const main = enrichMain(mainRaw);

  const rawDoclist = doclistDoc
    ? parseDoclistFromDocument(doclistDoc, { fallbackUrl: urls.doclist || (caseNo ? `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en` : '') })
    : { docs: [] };
  const docs = classifyDoclistEntries(rawDoclist.docs);

  const eventHistory = eventDoc ? parseEventHistoryFromDocument(eventDoc, urls.event || '') : { events: [] };
  const legal = legalDoc ? parseLegalFromDocument(legalDoc, urls.legal || '') : { events: [], codedEvents: [], renewals: [] };
  const family = familyDoc ? parseFamilyFromDocument(familyDoc) : { publications: [] };
  const citations = citationsDoc ? parseCitationsFromDocument(citationsDoc) : { entries: [], phases: [] };
  const ue = ueDoc ? parseUeFromDocument(ueDoc) : { statusRaw: '', ueStatus: '', upcOptOut: '', memberStates: '', text: '' };
  const federated = federatedDoc ? parseFederatedFromDocument(federatedDoc, caseNo) : { appNo: caseNo, states: [], notableStates: [] };
  const pdfData = pdfText ? parsePdfDeadlineHints(pdfText, pdfContext) : { hints: [], diagnostics: {} };
  const posture = deriveProceduralPostureFromSources({ statusRaw: main.statusRaw, docs, eventHistory, legal });
  const deadlines = inferProceduralDeadlinesFromSources({ main, docs, eventHistory, legal, pdfData });

  return {
    main,
    rawDoclist,
    doclist: { docs },
    eventHistory,
    legal,
    family,
    citations,
    ue,
    federated,
    territorialPresentation: territorialPresentationModel(ue, null, federated),
    pdfData,
    posture,
    deadlines,
    currentPosture: deriveCurrentPosture({ main, docs, legal, eventHistory }),
    overviewActionable: buildActionableOverviewState({
      mainSourceStatus: 'ok',
      statusSummary: { simple: main.statusSimple, level: main.statusLevel },
      posture,
      deadlines,
      waitingOn: '',
      waitingDays: null,
      latestApplicant: docs.find((doc) => doc.actor === 'Applicant') || null,
    }),
  };
}

module.exports = {
  EPO_CODEX_DATA,
  normalize,
  normalizeCodexDescription,
  legalCodeRecord,
  codexDescriptionRecord,
  normaliseSignal,
  extractLegalEventBlocks,
  extractLegalEventBlocksFromHtml,
  lossReasonLabel,
  classifyDoclistEntries,
  enrichMain,
  deriveCurrentPosture,
  buildNormalizedCaseFromDocuments,
  buildActionableOverviewState,
};
