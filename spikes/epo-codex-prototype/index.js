const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { loadFixtureDocument, loadFixtureText, loadUserscriptHooks } = require('../../tests/userscript_fixture_utils');

const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  const header = rows.shift() || [];
  return rows.filter((r) => r.some((v) => String(v || '').length)).map((r) => Object.fromEntries(header.map((key, index) => [key, r[index] || ''])));
}

function loadCsvRows(filePath) {
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

function loadCodexData(baseDir = path.join(__dirname, 'data')) {
  const mappingRows = loadCsvRows(path.join(baseDir, 'epo_register_codex_mapping_v2.csv'));
  const mainEventRows = loadCsvRows(path.join(baseDir, 'epo_register_main_event_codes.csv'));
  const proceduralStepRows = loadCsvRows(path.join(baseDir, 'epo_register_procedural_steps_core.csv'));

  const byNamespaceAndCode = new Map();
  const byCode = new Map();

  const addRows = (rows, namespaceKey, codeKey) => {
    for (const row of rows) {
      const namespace = normalize(row[namespaceKey] || '').toLowerCase();
      const code = normalize(row[codeKey] || '').toUpperCase();
      if (!namespace || !code) continue;
      const record = { ...row, code_namespace: namespace, source_code: code, procedural_step_code: code };
      byNamespaceAndCode.set(`${namespace}:${code}`, record);
      if (!byCode.has(code) || rows === mappingRows) byCode.set(code, record);
    }
  };

  addRows(mainEventRows, 'code_namespace', 'source_code');
  addRows(proceduralStepRows, 'code_namespace', 'procedural_step_code');
  addRows(mappingRows, 'code_namespace', 'source_code');

  return {
    mappingRows,
    mainEventRows,
    proceduralStepRows,
    byNamespaceAndCode,
    byCode,
  };
}

function text(cell) {
  return normalize(cell && cell.textContent);
}

function extractLegalEventBlocks(legalHtml, url = 'https://register.epo.org/application?number=EP00000000&lng=en&tab=legal') {
  const doc = new JSDOM(legalHtml, { url }).window.document;
  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    if (current.dateStr || current.description || current.freeFormatText || current.effectiveDate) {
      blocks.push(current);
    }
    current = null;
  };

  for (const row of doc.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th,td')].map(text).filter(Boolean);
    if (!cells.length) continue;
    const label = cells[0];
    const value = normalize(cells.slice(1).join(' | '));

    if (/^Event date:?$/i.test(label) && DATE_RE.test(value)) {
      pushCurrent();
      current = { dateStr: value.match(DATE_RE)?.[1] || '', description: '', freeFormatText: '', effectiveDate: '' };
      continue;
    }

    if (!current) continue;
    if (/^Event description:?$/i.test(label)) {
      current.description = value;
      continue;
    }
    if (/^Free Format Text:?$/i.test(label)) {
      current.freeFormatText = value;
      continue;
    }
    if (/^Effective DATE:?$/i.test(label)) {
      current.effectiveDate = value;
    }
  }

  pushCurrent();
  return blocks;
}

function mapLegalBlocksToCodex(blocks, codex) {
  return blocks.map((block) => {
    const originalCode = normalize(block.freeFormatText.match(/ORIGINAL CODE:\s*([A-Z0-9]+)/i)?.[1] || '').toUpperCase();
    const codexRecord = originalCode ? (codex.byCode.get(originalCode) || null) : null;
    return {
      ...block,
      originalCode,
      codexRecord,
    };
  });
}

function lossReasonLabel(textValue = '') {
  const low = normalize(textValue).toLowerCase();
  if (!low) return '';
  if (/non-entry into european phase/.test(low)) return 'non-entry';
  if (/translations of claims\/payment missing/.test(low)) return 'grant formalities';
  if (/non-payment of examination fee\/designation fee\/non-reply to written opinion/.test(low)) return 'fees / no WO reply';
  if (/non-reply to written opinion/.test(low)) return 'no WO reply';
  if (/filing fee \/ search fee not paid/.test(low)) return 'filing/search fee non-payment';
  return 'generic loss of rights';
}

function deriveCodexPrototype(caseNo, codex, fixtureLoader = { loadFixtureDocument, loadFixtureText, loadUserscriptHooks }) {
  const hooks = fixtureLoader.loadUserscriptHooks();
  const mainDoc = fixtureLoader.loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&lng=en&tab=main`);
  const doclistDoc = fixtureLoader.loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&lng=en&tab=doclist`);
  const main = hooks.parseMain(mainDoc, caseNo);
  const doclist = hooks.parseDoclist(doclistDoc);
  const legalHtml = fixtureLoader.loadFixtureText('cases', caseNo, 'legal.html');
  const legalBlocks = extractLegalEventBlocks(legalHtml, `https://register.epo.org/application?number=${caseNo}&lng=en&tab=legal`);
  const codexEvents = mapLegalBlocksToCodex(legalBlocks, codex);

  const docTitles = (doclist.docs || []).map((doc) => normalize(doc.title || ''));
  const joinedDocs = docTitles.join('\n').toLowerCase();
  const joinedLegal = codexEvents.map((event) => `${event.description}\n${event.freeFormatText}`).join('\n').toLowerCase();
  const statusRaw = normalize(main.statusRaw || '');
  const statusLow = statusRaw.toLowerCase();

  const internalKeys = codexEvents.map((event) => event.codexRecord?.internal_key).filter(Boolean);
  const hasKey = (value) => internalKeys.includes(value);
  const recoverySeen = /further processing/.test(joinedDocs) || /further processing/.test(joinedLegal);
  const lossSeen = hasKey('LOSS_OF_RIGHTS_EVENT') || hasKey('APPLICATION_DEEMED_WITHDRAWN') || /deemed to be withdrawn/.test(`${statusLow}\n${joinedDocs}\n${joinedLegal}`);
  const noOppositionSeen = hasKey('NO_OPPOSITION_FILED') || /no opposition filed within time limit/.test(`${statusLow}\n${joinedLegal}`);
  const grantIntendedSeen = hasKey('GRANT_R71_3_EVENT') || /grant of patent is intended|rule\s*71\(3\)|intention to grant/.test(`${statusLow}\n${joinedLegal}`);
  const grantSeen = hasKey('EXPECTED_GRANT') || /patent has been granted|the patent has been granted/.test(`${statusLow}\n${joinedLegal}`);
  const searchSeen = hasKey('SEARCH_REPORT_PUBLICATION') || /publication of search report/.test(joinedLegal) || /extended european search report|european search report/.test(joinedDocs);

  const currentPosture = (() => {
    if (noOppositionSeen) return 'Granted (no opposition)';
    if (grantSeen) return 'Granted';
    if (grantIntendedSeen) return 'Grant intended (R71(3))';
    if (lossSeen) {
      const reason = lossReasonLabel(`${statusRaw}\n${joinedDocs}\n${joinedLegal}`);
      return reason === 'generic loss of rights' ? 'Deemed withdrawn' : `Deemed withdrawn (${reason})`;
    }
    if (searchSeen) return 'Search published';
    return 'Needs manual classification';
  })();

  const storyParts = [];
  if (grantIntendedSeen) storyParts.push('R71/intention-to-grant');
  if (lossSeen) storyParts.push(`loss-of-rights (${lossReasonLabel(`${statusRaw}\n${joinedDocs}\n${joinedLegal}`)})`);
  if (recoverySeen) storyParts.push('further processing / recovery');
  if (grantSeen) storyParts.push('grant');
  if (noOppositionSeen) storyParts.push('no opposition');
  if (!storyParts.length && searchSeen) storyParts.push('search publication');

  return {
    caseNo,
    title: main.title,
    applicationType: main.applicationType,
    parentCase: main.parentCase || '',
    statusRaw,
    currentPosture,
    codexEvents,
    mappedKeys: internalKeys,
    signals: {
      grantIntendedSeen,
      lossSeen,
      recoverySeen,
      grantSeen,
      noOppositionSeen,
      searchSeen,
    },
    story: storyParts.join(' → '),
  };
}

module.exports = {
  normalize,
  parseCsv,
  loadCodexData,
  extractLegalEventBlocks,
  mapLegalBlocksToCodex,
  lossReasonLabel,
  deriveCodexPrototype,
};
