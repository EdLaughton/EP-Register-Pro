const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let cachedHooks = null;

function repoPath(...parts) {
  return path.join(__dirname, '..', ...parts);
}

function fixturePath(...parts) {
  return path.join(__dirname, 'fixtures', ...parts);
}

function loadFixtureText(...parts) {
  return fs.readFileSync(fixturePath(...parts), 'utf8');
}

function loadFixtureDocument(parts, url) {
  const html = loadFixtureText(...parts);
  return new JSDOM(html, { url }).window.document;
}

function loadUserscriptHooks() {
  if (cachedHooks) return cachedHooks;

  const source = fs.readFileSync(repoPath('script.user.js'), 'utf8');
  const hookNames = [
    'parseMain',
    'parseDoclist',
    'parseFamily',
    'parseLegal',
    'parseEventHistory',
    'parseFederated',
    'parseCitations',
    'parseUe',
    'parsePdfDeadlineHints',
    'parseUpcOptOutResult',
    'inferProceduralDeadlines',
    'classifyDocument',
    'classifyParsedSourceState',
    'bestTable',
    'doclistRowModels',
    'normalizeGrantPackageRowModels',
    'normalizeDoclistGroupKinds',
    'doclistRuns',
    'doclistRunLabel',
    'timelineDocItemsFromDocs',
    'upcRegistryNoteText',
    'selectNextDeadline',
    'activeDeadlineNoteText',
    'proceduralPostureModel',
    'docPacketExplanation',
    'familyRoleSummary',
    'upcUePresentationModel',
    'timelineSubtitleText',
    'pdfCategoryBundleLabel',
    'genericDocLabel',
    'normalizedDocSignal',
    'normalizedPacketSignal',
    'proceduralPostureModel',
    'shouldAppendSingleRunLabel',
    'overviewPartialState',
    'normalizeOptions',
    'refineDocumentClassification',
    'sourceStatusTooltip',
    'panelScrollRestoreOverride',
  ];

  const instrumented = source.replace(/\}\)\(\);\s*$/, `window.__EPRP_TEST_HOOKS = { ${hookNames.join(', ')} };})();`);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://register.epo.org/search?lng=en',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  window.console = console;
  window.fetch = async () => { throw new Error('network disabled in fixture tests'); };
  window.GM_addStyle = () => {};
  window.GM_xmlhttpRequest = undefined;
  window.unsafeWindow = window;
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.setTimeout = () => 0;
  window.clearTimeout = () => {};

  const context = dom.getInternalVMContext();
  vm.runInContext(instrumented, context);

  if (!window.__EPRP_TEST_HOOKS) {
    throw new Error('Failed to expose userscript test hooks');
  }

  const hooks = window.__EPRP_TEST_HOOKS;
  hooks.doclistGroupingPreview = (doc, pdfDeadlines = {}) => {
    const table = hooks.bestTable(doc, ['date', 'document']) || hooks.bestTable(doc, ['document type']);
    if (!table) return [];
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.querySelector("input[type='checkbox']"));
    return hooks.doclistRuns(hooks.normalizeDoclistGroupKinds(hooks.normalizeGrantPackageRowModels(hooks.doclistRowModels(rows)))).map((run) => ({
      bundle: run.bundle,
      label: hooks.doclistRunLabel(run, pdfDeadlines),
      dateStr: run.dateStr,
      size: run.rows.length,
      titles: run.models.map((model) => model.title),
    }));
  };
  hooks.timelineDocGroupingPreview = (docs = [], pdfDeadlines = {}) => hooks.timelineDocItemsFromDocs('', docs, pdfDeadlines)
    .filter((item) => item.type === 'group')
    .map((item) => ({
      dateStr: item.dateStr,
      title: item.title,
      size: (item.items || []).length,
      actor: item.actor,
    }));

  cachedHooks = hooks;
  return cachedHooks;
}

module.exports = {
  fixturePath,
  loadFixtureText,
  loadFixtureDocument,
  loadUserscriptHooks,
};
