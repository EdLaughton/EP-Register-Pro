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

function bestTable(doc, hints = []) {
  let best = null;
  let score = 0;
  for (const table of doc.querySelectorAll('table')) {
    const headerText = text(table.querySelector('thead') || table).toLowerCase();
    let current = 0;
    for (const hint of hints) if (headerText.includes(String(hint || '').toLowerCase())) current += 1;
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
  [...(headerRow?.querySelectorAll('th,td') || [])].map(text).forEach((header, idx) => {
    const low = header.toLowerCase();
    if (/^date$/.test(low)) map.date = idx;
    if (low.includes('document type') || low === 'document') map.document = idx;
    if (low.includes('procedure')) map.procedure = idx;
    if (low.includes('number') && low.includes('page')) map.pages = idx;
  });
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
