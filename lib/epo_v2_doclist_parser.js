const { DATE_RE, normalize, text, parseDateString, compareDateDesc } = require('./epo_v2_utils');
const DOCLIST_TABLE_HINT_SETS = Object.freeze([
  ['date', 'document'],
  ['document type'],
]);

function structuralTableScore(table) {
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return 0;
  let datedCells = 0;
  let linkCells = 0;
  let rowsWithDates = 0;
  let rowsWithLinks = 0;
  for (const row of rows.slice(0, 18)) {
    const cells = [...row.querySelectorAll('th,td')];
    if (!cells.length) continue;
    let rowHasDate = false;
    let rowHasLink = false;
    for (const cell of cells) {
      const cellText = text(cell);
      if (DATE_RE.test(cellText)) {
        datedCells += 1;
        rowHasDate = true;
      }
      if (cell.querySelector('a')) {
        linkCells += 1;
        rowHasLink = true;
      }
    }
    if (rowHasDate) rowsWithDates += 1;
    if (rowHasLink) rowsWithLinks += 1;
  }
  return (rowsWithDates * 3) + (rowsWithLinks * 3) + datedCells + linkCells;
}

function bestTable(doc, hints = []) {
  let best = null;
  let score = 0;
  for (const table of doc.querySelectorAll('table')) {
    const headerText = text(table.querySelector('thead') || table).toLowerCase();
    let current = structuralTableScore(table);
    for (const hint of hints) if (headerText.includes(String(hint || '').toLowerCase())) current += 5;
    if (current > score) {
      score = current;
      best = table;
    }
  }
  return score > 0 ? best : null;
}

function doclistTable(doc) {
  for (const hints of DOCLIST_TABLE_HINT_SETS) {
    const table = bestTable(doc, hints);
    if (table) return table;
  }
  return null;
}

function tableColumnMap(table) {
  const map = {};
  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  const headers = [...(headerRow?.querySelectorAll('th,td') || [])].map(text);
  headers.forEach((header, idx) => {
    const low = header.toLowerCase();
    if (/^date$/.test(low)) map.date = idx;
    if (low.includes('document type') || low === 'document') map.document = idx;
    if (low.includes('procedure')) map.procedure = idx;
    if (low.includes('number') && low.includes('page')) map.pages = idx;
  });

  const bodyRows = [...table.querySelectorAll('tbody tr, tr')].filter((row) => row.querySelector('td'));
  const width = Math.max(0, ...bodyRows.map((row) => row.querySelectorAll('td').length));
  const stats = Array.from({ length: width }, () => ({ dateHits: 0, linkHits: 0, textHits: 0, numberHits: 0 }));
  for (const row of bodyRows.slice(0, 24)) {
    [...row.querySelectorAll('td')].forEach((cell, idx) => {
      const value = text(cell);
      if (!value) return;
      if (DATE_RE.test(value)) stats[idx].dateHits += 1;
      if (cell.querySelector('a')) stats[idx].linkHits += 1;
      if (value.length >= 12) stats[idx].textHits += 1;
      if (/^\d{1,4}$/.test(value)) stats[idx].numberHits += 1;
    });
  }

  if (map.date == null) {
    map.date = stats
      .map((stat, idx) => ({ idx, score: stat.dateHits * 4 + stat.linkHits }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  if (map.document == null) {
    map.document = stats
      .map((stat, idx) => ({ idx, score: stat.linkHits * 5 + stat.textHits * 2 - (idx === map.date ? 100 : 0) }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  if (map.procedure == null) {
    map.procedure = stats
      .map((stat, idx) => ({ idx, score: stat.textHits - (idx === map.date || idx === map.document ? 100 : 0) }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  if (map.pages == null) {
    map.pages = stats
      .map((stat, idx) => ({ idx, score: stat.numberHits * 4 + stat.textHits - (idx === map.date || idx === map.document || idx === map.procedure ? 100 : 0) }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  return map;
}

function createParseStats(source = 'doclist') {
  return {
    source,
    tableFound: false,
    rowsSeen: 0,
    rowsAccepted: 0,
    rowsDropped: 0,
    rowsDroppedByReason: {},
  };
}

function noteParseDrop(parseStats, reason = 'unknown') {
  if (!parseStats) return;
  parseStats.rowsDropped += 1;
  parseStats.rowsDroppedByReason[reason] = (parseStats.rowsDroppedByReason[reason] || 0) + 1;
}

function doclistEntryFromRow(row, map = {}, { fallbackUrl = '', rowOrder = 0, parseStats = null } = {}) {
  const cells = [...row.querySelectorAll('td')];
  if (!cells.length) {
    noteParseDrop(parseStats, 'missing-cells');
    return null;
  }
  if (!row.querySelector("input[type='checkbox']")) {
    noteParseDrop(parseStats, 'missing-checkbox');
    return null;
  }
  const rowText = cells.map(text).filter(Boolean).join(' ') || text(row);
  const dateMatch = rowText.match(DATE_RE);
  if (!dateMatch) {
    noteParseDrop(parseStats, 'missing-date');
    return null;
  }
  const dateStr = dateMatch[1];
  const getCell = (idx) => (idx != null && idx < cells.length ? text(cells[idx]) : '');

  let title = getCell(map.document);
  if (!title) {
    title = [...row.querySelectorAll('a')]
      .map(text)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || '';
  }
  if (!title) {
    noteParseDrop(parseStats, 'missing-title');
    return null;
  }

  const url = [...row.querySelectorAll('a[href]')].map((a) => a.href).find(Boolean) || fallbackUrl;
  const procedure = getCell(map.procedure);
  const pages = getCell(map.pages);

  return {
    dateStr,
    title,
    procedure,
    pages,
    rowOrder,
    url,
    source: 'All documents',
  };
}

function parseDoclistFromDocument(doc, { fallbackUrl = '', transformEntry = null } = {}) {
  const parseStats = createParseStats('doclist');
  const table = doclistTable(doc);
  if (!table) return { docs: [], parseStats };
  parseStats.tableFound = true;
  const map = tableColumnMap(table);
  const docs = [];
  let rowOrder = 0;
  for (const row of table.querySelectorAll('tr')) {
    if (!row.querySelector('td')) continue;
    parseStats.rowsSeen += 1;
    const entry = doclistEntryFromRow(row, map, { fallbackUrl, rowOrder, parseStats });
    if (!entry) continue;
    rowOrder += 1;
    parseStats.rowsAccepted += 1;
    docs.push(typeof transformEntry === 'function' ? transformEntry(entry, { row, map }) : entry);
  }
  return { docs: docs.sort(compareDateDesc), parseStats };
}

module.exports = {
  DATE_RE,
  DOCLIST_TABLE_HINT_SETS,
  normalize,
  text,
  parseDateString,
  compareDateDesc,
  bestTable,
  doclistTable,
  tableColumnMap,
  doclistEntryFromRow,
  parseDoclistFromDocument,
};
