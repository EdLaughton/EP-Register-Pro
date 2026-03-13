const DATE_RE = /\b(\d{2}\.\d{2}\.\d{4})\b/;
const DOCLIST_TABLE_HINT_SETS = Object.freeze([
  ['date', 'document'],
  ['document type'],
]);

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function text(node) {
  return node ? normalize(node.innerText || node.textContent || '') : '';
}

function parseDateString(value = '') {
  const match = String(value || '').match(DATE_RE);
  if (!match) return null;
  const [dd, mm, yyyy] = match[1].split('.').map(Number);
  const date = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareDateDesc(a, b) {
  return (parseDateString(b?.dateStr)?.getTime() || 0) - (parseDateString(a?.dateStr)?.getTime() || 0);
}

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
  const stats = Array.from({ length: width }, () => ({ dateHits: 0, linkHits: 0, textHits: 0, numericHits: 0, alphaHits: 0 }));
  for (const row of bodyRows.slice(0, 24)) {
    [...row.querySelectorAll('td')].forEach((cell, idx) => {
      const value = text(cell);
      if (!value) return;
      if (DATE_RE.test(value)) stats[idx].dateHits += 1;
      if (cell.querySelector('a')) stats[idx].linkHits += 1;
      if (value.length >= 12) stats[idx].textHits += 1;
      if (/^\d{1,3}$/.test(value)) stats[idx].numericHits += 1;
      if (/\p{L}/u.test(value)) stats[idx].alphaHits += 1;
    });
  }

  if (map.date == null) {
    map.date = stats
      .map((stat, idx) => ({ idx, score: stat.dateHits * 5 + stat.linkHits }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  if (map.document == null) {
    map.document = stats
      .map((stat, idx) => ({ idx, score: stat.linkHits * 6 + stat.textHits * 2 - (idx === map.date ? 100 : 0) }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  if (map.pages == null) {
    map.pages = stats
      .map((stat, idx) => ({ idx, score: stat.numericHits * 5 - (idx === map.date || idx === map.document ? 100 : 0) }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  if (map.procedure == null) {
    map.procedure = stats
      .map((stat, idx) => ({ idx, score: stat.alphaHits * 3 + stat.textHits - stat.linkHits - stat.numericHits * 2 - (idx === map.date || idx === map.document || idx === map.pages ? 100 : 0) }))
      .sort((a, b) => b.score - a.score)[0]?.idx;
  }
  return map;
}

function doclistEntryFromRow(row, map = {}, { fallbackUrl = '', rowOrder = 0 } = {}) {
  const cells = [...row.querySelectorAll('td')];
  if (!cells.length || !row.querySelector("input[type='checkbox']")) return null;
  const rowText = cells.map(text).filter(Boolean).join(' ') || text(row);
  const dateMatch = rowText.match(DATE_RE);
  if (!dateMatch) return null;
  const dateStr = dateMatch[1];
  const getCell = (idx) => (idx != null && idx < cells.length ? text(cells[idx]) : '');

  let title = getCell(map.document);
  if (!title) {
    title = [...row.querySelectorAll('a')]
      .map(text)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || '';
  }
  if (!title) return null;

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
  const table = doclistTable(doc);
  if (!table) return { docs: [] };
  const map = tableColumnMap(table);
  const docs = [];
  let rowOrder = 0;
  for (const row of table.querySelectorAll('tr')) {
    const entry = doclistEntryFromRow(row, map, { fallbackUrl, rowOrder });
    if (!entry) continue;
    rowOrder += 1;
    docs.push(typeof transformEntry === 'function' ? transformEntry(entry, { row, map }) : entry);
  }
  return { docs: docs.sort(compareDateDesc) };
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
