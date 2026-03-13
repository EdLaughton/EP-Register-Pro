#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'userscript.source.js');
const outputPath = path.join(repoRoot, 'script.user.js');

const MODULE_IDS = {
  codex: 'lib/epo_codex_data',
  utils: 'lib/epo_v2_utils',
  docSignals: 'lib/epo_v2_doc_signals',
  packet: 'lib/epo_v2_packet_signals',
  status: 'lib/epo_v2_status_signals',
  doclist: 'lib/epo_v2_doclist_parser',
  docClass: 'lib/epo_v2_document_classification',
  refs: 'lib/epo_v2_reference_parsers',
  terr: 'lib/epo_v2_territorial_parser',
  terrSignals: 'lib/epo_v2_territorial_signals',
  main: 'lib/epo_v2_main_parser',
  procedural: 'lib/epo_v2_procedural_parser',
  posture: 'lib/epo_v2_posture_signals',
  deadlines: 'lib/epo_v2_deadline_signals',
  pdf: 'lib/epo_v2_pdf_parser',
  timeline: 'lib/epo_v2_timeline_signals',
  overview: 'lib/epo_v2_overview_signals',
  upc: 'lib/epo_v2_upc_parser',
};

const bundleModules = [
  MODULE_IDS.codex,
  MODULE_IDS.utils,
  MODULE_IDS.docSignals,
  MODULE_IDS.packet,
  MODULE_IDS.status,
  MODULE_IDS.doclist,
  MODULE_IDS.docClass,
  MODULE_IDS.refs,
  MODULE_IDS.terr,
  MODULE_IDS.terrSignals,
  MODULE_IDS.main,
  MODULE_IDS.procedural,
  MODULE_IDS.posture,
  MODULE_IDS.deadlines,
  MODULE_IDS.pdf,
  MODULE_IDS.timeline,
  MODULE_IDS.overview,
  MODULE_IDS.upc,
];

const STRIP_FUNCTIONS = new Set([
  'parseApplicationType',
  'classifyDocument',
  'refineDocumentClassification',
  'bodyText',
  'fieldByLabel',
  'rowLabelValuePairs',
  'bestTable',
  'doclistTable',
  'tableColumnMap',
  'doclistEntryFromRow',
  'parseMain',
  'parseFamily',
  'parseLegal',
  'parseEventHistory',
  'parseDoclist',
  'parseFederated',
  'parseCitations',
  'parseUe',
  'normalizeCodexDescription',
  'normalizeStructuredLabel',
  'normalizeStructuredDate',
  'parseStructuredTimeLimit',
  'legalCodeRecord',
  'codexDescriptionRecord',
  'normalizeCodexSignal',
  'parseDatedRowsFromDocument',
  'extractLegalEventBlocks',
  'summarizeStatus',
  'inferStatusStage',
  'normalizedDocSignal',
  'packetSignalBundle',
  'standalonePacketBundle',
  'normalizedPacketSignal',
  'postureLossLabel',
  'postureRecoveryLabel',
  'postureRecord',
  'postureRecordByCodex',
  'postureRecordDate',
  'proceduralPostureModel',
  'addCalendarMonthsDetailed',
  'normalizeDateString',
  'parsePdfDeadlineHints',
  'parseUpcOptOutResult',
  'timelineAttorneyImportance',
  'docPacketExplanation',
  'timelineSubtitleText',
  'shouldAppendSingleRunLabel',
  'compactOverviewTitle',
  'resolvedOverviewStatus',
  'deadlinePresentationBuckets',
  'selectNextDeadline',
  'activeDeadlineNoteText',
  'recoveryActionModel',
  'buildDeadlineRecords',
  'inferProceduralDeadlines',
  'parseApplicationField',
  'parseMainPublications',
  'extractEpNumbersByHeader',
  'parsePriority',
  'parseRecentEvents',
  'cleanTitle',
  'pickApplicantLine',
  'extractTitle',
  'normalizePublicationNumber',
  'splitPublicationNumber',
  'parsePublications',
]);

const STRIP_CONSTS = new Set([
  'EPO_CODEX_DATA',
  'NORMALIZED_DOC_SIGNAL_RULES',
  'PACKET_SIGNAL_PRECEDENCE',
  'STANDALONE_PACKET_BUNDLES',
  'STATUS_STAGE_RULES',
  'STATUS_SUMMARY_RULES',
  'POSTURE_LOSS_LABEL_RULES',
  'POSTURE_RECOVERY_LABEL_RULES',
  'TIMELINE_LEVEL_RULES',
  'PACKET_EXPLANATION_MAP',
  'COMPACT_TITLE_EXACT_MAP',
  'COMPACT_TITLE_REPLACEMENTS',
]);

function findIifeBody(program) {
  for (const stmt of program.body || []) {
    const expr = stmt && stmt.type === 'ExpressionStatement' ? stmt.expression : null;
    if (!expr || expr.type !== 'CallExpression') continue;
    const callee = expr.callee;
    if (!callee) continue;
    if ((callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression') && callee.body?.type === 'BlockStatement') {
      return callee.body;
    }
  }
  throw new Error('Could not locate userscript IIFE body');
}

function statementName(statement) {
  if (!statement) return '';
  if (statement.type === 'FunctionDeclaration') return statement.id?.name || '';
  if (statement.type === 'VariableDeclaration' && statement.declarations?.length === 1) {
    const decl = statement.declarations[0];
    return decl?.id?.type === 'Identifier' ? decl.id.name : '';
  }
  return '';
}

function shouldStrip(statement) {
  const name = statementName(statement);
  if (!name) return false;
  if (statement.type === 'FunctionDeclaration') return STRIP_FUNCTIONS.has(name);
  if (statement.type === 'VariableDeclaration') return STRIP_CONSTS.has(name);
  return false;
}

function moduleSource(moduleId) {
  const filePath = path.join(repoRoot, `${moduleId}.js`);
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.replace(/^#!.*\n/, '');
}

function buildBundlePrelude() {
  const factories = bundleModules.map((moduleId) => {
    const src = moduleSource(moduleId);
    return `      ${JSON.stringify(moduleId)}: function(module, exports, require) {\n${src.split('\n').map((line) => `        ${line}`).join('\n')}\n      }`;
  }).join(',\n');

  return [
    '  const __EPRP_MODULES = (() => {',
    '    const __factories = {',
    factories,
    '    };',
    '    const __cache = Object.create(null);',
    '    function __resolve(fromId, request) {',
    "      if (!request.startsWith('.')) return request.replace(/\\.js$/, '');",
    '      const fromDir = fromId ? pathPosixDirname(fromId) : \'\';',
    '      const joined = pathPosixNormalize(`${fromDir}/${request}`);',
    "      return joined.replace(/\\.js$/, '');",
    '    }',
    '    function pathPosixDirname(value) {',
    "      const normalized = String(value || '').replace(/\\/+/g, '/');",
    "      const idx = normalized.lastIndexOf('/');",
    "      return idx >= 0 ? normalized.slice(0, idx) : '';",
    '    }',
    '    function pathPosixNormalize(value) {',
    "      const input = String(value || '').replace(/\\/+/g, '/');",
    "      const out = [];",
    "      for (const part of input.split('/')) {",
    "        if (!part || part === '.') continue;",
    "        if (part === '..') { out.pop(); continue; }",
    '        out.push(part);',
    '      }',
    "      return out.join('/');",
    '    }',
    '    function __require(request, fromId = \"\") {',
    '      const target = __resolve(fromId, request);',
    '      if (__cache[target]) return __cache[target].exports;',
    '      const factory = __factories[target];',
    '      if (!factory) throw new Error(`Unknown bundled module: ${request} from ${fromId}`);',
    '      const module = { exports: {} };',
    '      __cache[target] = module;',
    '      factory(module, module.exports, (child) => __require(child, target));',
    '      return module.exports;',
    '    }',
    '    return {',
    `      codex: __require(${JSON.stringify(MODULE_IDS.codex)}),`,
    `      utils: __require(${JSON.stringify(MODULE_IDS.utils)}),`,
    `      docSignals: __require(${JSON.stringify(MODULE_IDS.docSignals)}),`,
    `      packet: __require(${JSON.stringify(MODULE_IDS.packet)}),`,
    `      status: __require(${JSON.stringify(MODULE_IDS.status)}),`,
    `      doclist: __require(${JSON.stringify(MODULE_IDS.doclist)}),`,
    `      docClass: __require(${JSON.stringify(MODULE_IDS.docClass)}),`,
    `      refs: __require(${JSON.stringify(MODULE_IDS.refs)}),`,
    `      terr: __require(${JSON.stringify(MODULE_IDS.terr)}),`,
    `      terrSignals: __require(${JSON.stringify(MODULE_IDS.terrSignals)}),`,
    `      main: __require(${JSON.stringify(MODULE_IDS.main)}),`,
    `      procedural: __require(${JSON.stringify(MODULE_IDS.procedural)}),`,
    `      posture: __require(${JSON.stringify(MODULE_IDS.posture)}),`,
    `      deadlines: __require(${JSON.stringify(MODULE_IDS.deadlines)}),`,
    `      pdf: __require(${JSON.stringify(MODULE_IDS.pdf)}),`,
    `      timeline: __require(${JSON.stringify(MODULE_IDS.timeline)}),`,
    `      overview: __require(${JSON.stringify(MODULE_IDS.overview)}),`,
    `      upc: __require(${JSON.stringify(MODULE_IDS.upc)}),`,
    '    };',
    '  })();',
  ].join('\n');
}

function buildBridge() {
  return [
    buildBundlePrelude(),
    '',
    '  const EPO_CODEX_DATA = __EPRP_MODULES.codex.EPO_CODEX_DATA;',
    '  const NORMALIZED_DOC_SIGNAL_RULES = __EPRP_MODULES.docSignals.NORMALIZED_DOC_SIGNAL_RULES;',
    '  const PACKET_SIGNAL_PRECEDENCE = __EPRP_MODULES.packet.PACKET_SIGNAL_PRECEDENCE;',
    '  const STANDALONE_PACKET_BUNDLES = __EPRP_MODULES.packet.STANDALONE_PACKET_BUNDLES;',
    '  const STATUS_STAGE_RULES = __EPRP_MODULES.status.STATUS_STAGE_RULES;',
    '  const STATUS_SUMMARY_RULES = __EPRP_MODULES.status.STATUS_SUMMARY_RULES;',
    '  const POSTURE_LOSS_LABEL_RULES = __EPRP_MODULES.posture.POSTURE_LOSS_LABEL_RULES;',
    '  const POSTURE_RECOVERY_LABEL_RULES = __EPRP_MODULES.posture.POSTURE_RECOVERY_LABEL_RULES;',
    '  const TIMELINE_LEVEL_RULES = __EPRP_MODULES.timeline.TIMELINE_LEVEL_RULES;',
    '  const PACKET_EXPLANATION_MAP = __EPRP_MODULES.timeline.PACKET_EXPLANATION_MAP;',
    '  const COMPACT_TITLE_EXACT_MAP = __EPRP_MODULES.timeline.COMPACT_TITLE_EXACT_MAP;',
    '  const COMPACT_TITLE_REPLACEMENTS = __EPRP_MODULES.timeline.COMPACT_TITLE_REPLACEMENTS;',
    '',
    '  function parseApplicationType(...args) { return __EPRP_MODULES.docClass.parseApplicationType(...args); }',
    '  function classifyDocument(...args) { return __EPRP_MODULES.docClass.classifyDocument(...args); }',
    '  function refineDocumentClassification(...args) { return __EPRP_MODULES.docClass.refineDocumentClassification(...args); }',
    '  function bodyText(...args) { return __EPRP_MODULES.terr.bodyText(...args); }',
    '  function fieldByLabel(...args) { return __EPRP_MODULES.terr.fieldByLabel(...args); }',
    '  function rowLabelValuePairs(...args) { return __EPRP_MODULES.terr.rowLabelValuePairs(...args); }',
    '  function bestTable(...args) { return __EPRP_MODULES.doclist.bestTable(...args); }',
    '  function doclistTable(...args) { return __EPRP_MODULES.doclist.doclistTable(...args); }',
    '  function tableColumnMap(...args) { return __EPRP_MODULES.doclist.tableColumnMap(...args); }',
    '  function doclistEntryFromRow(...args) { return __EPRP_MODULES.doclist.doclistEntryFromRow(...args); }',
    '  function parseApplicationField(...args) { return __EPRP_MODULES.main.parseApplicationField(...args); }',
    '  function parseMainPublications(...args) { return __EPRP_MODULES.main.parseMainPublications(...args); }',
    '  function extractEpNumbersByHeader(...args) { return __EPRP_MODULES.main.extractEpNumbersByHeader(...args); }',
    '  function parsePriority(...args) { return __EPRP_MODULES.main.parsePriority(...args); }',
    '  function parseRecentEvents(...args) { return __EPRP_MODULES.main.parseRecentEvents(...args); }',
    '  function cleanTitle(...args) { return __EPRP_MODULES.main.cleanTitle(...args); }',
    '  function pickApplicantLine(...args) { return __EPRP_MODULES.main.pickApplicantLine(...args); }',
    '  function extractTitle(...args) { return __EPRP_MODULES.main.extractTitle(...args); }',
    '  function normalizePublicationNumber(...args) { return __EPRP_MODULES.refs.normalizePublicationNumber(...args); }',
    '  function splitPublicationNumber(...args) { return __EPRP_MODULES.refs.splitPublicationNumber(...args); }',
    '  function parsePublications(...args) { return __EPRP_MODULES.refs.parsePublications(...args); }',
    '  function normalizeCodexDescription(...args) { return __EPRP_MODULES.procedural.normalizeCodexDescription(...args); }',
    '  function normalizeStructuredLabel(...args) { return __EPRP_MODULES.procedural.normalizeStructuredLabel(...args); }',
    '  function normalizeStructuredDate(...args) { return __EPRP_MODULES.procedural.normalizeStructuredDate(...args); }',
    '  function parseStructuredTimeLimit(...args) { return __EPRP_MODULES.procedural.parseStructuredTimeLimit(...args); }',
    '  function legalCodeRecord(...args) { return __EPRP_MODULES.procedural.legalCodeRecord(...args); }',
    '  function codexDescriptionRecord(...args) { return __EPRP_MODULES.procedural.codexDescriptionRecord(...args); }',
    '  function normalizeCodexSignal(...args) { return __EPRP_MODULES.procedural.normalizeCodexSignal(...args); }',
    '  function parseDatedRowsFromDocument(...args) { return __EPRP_MODULES.procedural.parseDatedRowsFromDocument(...args); }',
    '  function extractLegalEventBlocks(doc, url = "") { return __EPRP_MODULES.procedural.extractLegalEventBlocksFromDocument(doc, url); }',
    '  function summarizeStatus(...args) { return __EPRP_MODULES.status.summarizeStatusText(...args); }',
    '  function inferStatusStage(...args) { return __EPRP_MODULES.status.inferStatusStageFromText(...args); }',
    '  function normalizedDocSignal(title = "", procedure = "") { return __EPRP_MODULES.docSignals.classifyDocSignal({ title, procedure }); }',
    '  function packetSignalBundle(...args) { return __EPRP_MODULES.packet.packetSignalBundle(...args); }',
    '  function standalonePacketBundle(...args) { return __EPRP_MODULES.packet.standalonePacketBundle(...args); }',
    '  function normalizedPacketSignal(...args) { return __EPRP_MODULES.packet.classifyPacketSignal(...args); }',
    '  function postureLossLabel(...args) { return __EPRP_MODULES.posture.postureLossLabel(...args); }',
    '  function postureRecoveryLabel(...args) { return __EPRP_MODULES.posture.postureRecoveryLabel(...args); }',
    '  function postureRecord(...args) { return __EPRP_MODULES.posture.postureRecord(...args); }',
    '  function postureRecordByCodex(...args) { return __EPRP_MODULES.posture.postureRecordByCodex(...args); }',
    '  function postureRecordDate(...args) { return __EPRP_MODULES.posture.postureRecordDate(...args); }',
    '  function proceduralPostureModel(main, docs, eventHistory = {}, legal = {}) { return __EPRP_MODULES.posture.deriveProceduralPostureFromSources({ statusRaw: main?.statusRaw || "", docs, eventHistory, legal }); }',
    '  function addCalendarMonthsDetailed(...args) { return __EPRP_MODULES.deadlines.addCalendarMonthsDetailed(...args); }',
    '  function buildDeadlineRecords(docs, eventHistory = {}, legal = {}) { return __EPRP_MODULES.posture.buildProceduralRecords(docs, eventHistory, legal); }',
    '  function inferProceduralDeadlines(main, docs, eventHistory = {}, legal = {}, pdfData = {}) { return __EPRP_MODULES.deadlines.inferProceduralDeadlinesFromSources({ main, docs, eventHistory, legal, pdfData }); }',
    '  function normalizeDateString(...args) { return __EPRP_MODULES.pdf.normalizeDateString(...args); }',
    '  function parsePdfDeadlineHints(...args) { return __EPRP_MODULES.pdf.parsePdfDeadlineHints(...args); }',
    '  function parseUpcOptOutResult(...args) { return __EPRP_MODULES.upc.parseUpcOptOutResult(...args); }',
    '  function timelineAttorneyImportance(...args) { return __EPRP_MODULES.timeline.classifyTimelineImportance(...args); }',
    '  function docPacketExplanation(...args) { return __EPRP_MODULES.timeline.docPacketExplanation(...args); }',
    '  function timelineSubtitleText(...args) { return __EPRP_MODULES.timeline.timelineSubtitle(...args); }',
    '  function shouldAppendSingleRunLabel(...args) { return __EPRP_MODULES.timeline.shouldAppendSingleRunLabel(...args); }',
    '  function compactOverviewTitle(...args) { return __EPRP_MODULES.timeline.compactOverviewTitle(...args); }',
    '  function resolvedOverviewStatus(...args) { return __EPRP_MODULES.overview.resolvedOverviewStatus(...args); }',
    '  function deadlinePresentationBuckets(...args) { return __EPRP_MODULES.overview.deadlinePresentationBuckets(...args); }',
    '  function selectNextDeadline(...args) { return __EPRP_MODULES.overview.selectNextDeadline(...args); }',
    '  function activeDeadlineNoteText(...args) { return __EPRP_MODULES.overview.activeDeadlineNoteText(...args); }',
    '  function recoveryActionModel(...args) { return __EPRP_MODULES.overview.recoveryActionModel(...args); }',
    '',
    '  function parseMain(doc, caseNo = "") {',
    '    const main = __EPRP_MODULES.main.parseMainRawFromDocument(doc, caseNo);',
    '    const statusSummary = __EPRP_MODULES.status.summarizeStatusText(main.statusRaw || "");',
    '    return {',
    '      ...main,',
    '      statusSimple: statusSummary.simple,',
    '      statusLevel: statusSummary.level,',
    '      statusStage: __EPRP_MODULES.status.inferStatusStageFromText(main.statusRaw || ""),',
    '      applicationType: __EPRP_MODULES.docClass.parseApplicationType(main),',
    '    };',
    '  }',
    '',
    '  function parseDoclist(doc) {',
    '    const fallbackCaseNo = runtime.fetchCaseNo || runtime.appNo || detectAppNo();',
    '    const fallbackUrl = sourceUrl(fallbackCaseNo, "doclist");',
    '    const parsed = __EPRP_MODULES.doclist.parseDoclistFromDocument(doc, { fallbackUrl });',
    '    const docs = (Array.isArray(parsed.docs) ? parsed.docs : []).map((entry) => ({',
    '      ...entry,',
    '      ...__EPRP_MODULES.docClass.refineDocumentClassification(entry.title, entry.procedure, __EPRP_MODULES.docClass.classifyDocument(entry.title, entry.procedure)),',
    '    })).sort(__EPRP_MODULES.utils.compareDateDesc);',
    '    return { docs, parseStats: parsed.parseStats || null };',
    '  }',
    '',
    '  function parseFamily(doc) { return __EPRP_MODULES.refs.parseFamilyFromDocument(doc); }',
    '  function parseLegal(doc, caseNo) { return __EPRP_MODULES.procedural.parseLegalFromDocument(doc, sourceUrl(caseNo, "legal")); }',
    '  function parseEventHistory(doc, caseNo) { return __EPRP_MODULES.procedural.parseEventHistoryFromDocument(doc, sourceUrl(caseNo, "event")); }',
    '  function parseFederated(doc, caseNo = "") { return __EPRP_MODULES.terr.parseFederatedFromDocument(doc, caseNo); }',
    '  function parseCitations(doc) { return __EPRP_MODULES.refs.parseCitationsFromDocument(doc); }',
    '  function parseUe(doc) { return __EPRP_MODULES.terr.parseUeFromDocument(doc); }',
    '',
  ].join('\n');
}

function buildUserscript(source) {
  const program = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const body = findIifeBody(program);
  const stripped = body.body.filter(shouldStrip).map((statement) => ({ start: statement.start, end: statement.end })).sort((a, b) => a.start - b.start);
  if (!stripped.length) throw new Error('No strip targets found in source');

  const bridge = `${buildBridge()}\n\n`;
  let out = '';
  let cursor = 0;
  let inserted = false;
  for (const range of stripped) {
    out += source.slice(cursor, range.start);
    if (!inserted) {
      out += bridge;
      inserted = true;
    }
    cursor = range.end;
  }
  out += source.slice(cursor);
  return out;
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const built = buildUserscript(source);
  fs.writeFileSync(outputPath, built);
  process.stdout.write(`Built ${path.relative(repoRoot, outputPath)} from ${path.relative(repoRoot, sourcePath)}\n`);
}

main();
