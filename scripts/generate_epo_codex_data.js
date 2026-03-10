const fs = require('fs');
const path = require('path');

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

function normalizeKey(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function loadRows(filePath) {
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

function buildData(baseDir) {
  const mappingRows = loadRows(path.join(baseDir, 'epo_register_codex_mapping_v2.csv'));
  const mainEventRows = loadRows(path.join(baseDir, 'epo_register_main_event_codes.csv'));
  const proceduralRows = loadRows(path.join(baseDir, 'epo_register_procedural_steps_core.csv'));

  const byCode = {};
  const byDescription = {};

  const addRecord = (code, description, record, priority) => {
    if (code) {
      if (!byCode[code] || priority >= byCode[code].__priority) byCode[code] = { ...record, __priority: priority };
    }
    const descriptionKey = normalizeKey(description);
    if (descriptionKey) {
      if (!byDescription[descriptionKey] || priority >= byDescription[descriptionKey].__priority) byDescription[descriptionKey] = { ...record, __priority: priority };
    }
  };

  for (const row of proceduralRows) {
    addRecord(
      String(row.procedural_step_code || '').toUpperCase(),
      row.step_description,
      {
        codeNamespace: row.code_namespace || 'procedural_step',
        sourceCode: String(row.procedural_step_code || '').toUpperCase(),
        sourceDescription: row.step_description || '',
        internalKey: '',
        procedureFamily: '',
        phase: row.phase || '',
        classification: '',
        preferredSurface: 'st36/all_documents',
        codexAction: row.parser_treatment || '',
        parserNote: row.notes || '',
      },
      1,
    );
  }

  for (const row of mainEventRows) {
    addRecord(
      String(row.source_code || '').toUpperCase(),
      row.source_description,
      {
        codeNamespace: row.code_namespace || 'register_main_event',
        sourceCode: String(row.source_code || '').toUpperCase(),
        sourceDescription: row.source_description || '',
        internalKey: row.internal_key || '',
        procedureFamily: row.procedure_family || '',
        phase: row.phase || '',
        classification: row.classification || '',
        preferredSurface: row.preferred_surface || '',
        codexAction: row.default_action || '',
        parserNote: row.notes || row.anchor_hint || '',
      },
      2,
    );
  }

  for (const row of mappingRows) {
    addRecord(
      String(row.source_code || '').toUpperCase(),
      row.source_description,
      {
        codeNamespace: row.code_namespace || '',
        sourceCode: String(row.source_code || '').toUpperCase(),
        sourceDescription: row.source_description || '',
        internalKey: row.internal_key || '',
        procedureFamily: row.procedure_family || '',
        phase: row.phase || '',
        classification: row.classification || '',
        preferredSurface: row.preferred_surface || '',
        codexAction: row.codex_action || '',
        parserNote: row.parser_note || '',
      },
      3,
    );
  }

  for (const map of [byCode, byDescription]) {
    for (const key of Object.keys(map)) delete map[key].__priority;
  }

  return { byCode, byDescription };
}

function asJsModule(data) {
  return `const EPO_CODEX_DATA = Object.freeze(${JSON.stringify(data, null, 2)});\n\nmodule.exports = { EPO_CODEX_DATA };\n`;
}

if (require.main === module) {
  const baseDir = process.argv[2] || path.join(__dirname, '..', 'spikes', 'epo-codex-prototype', 'data');
  const outPath = process.argv[3] || path.join(__dirname, '..', 'lib', 'epo_codex_data.js');
  const data = buildData(baseDir);
  fs.writeFileSync(outPath, asJsModule(data));
  console.log(`Wrote ${outPath}`);
}

module.exports = { parseCsv, normalizeKey, loadRows, buildData, asJsModule };
