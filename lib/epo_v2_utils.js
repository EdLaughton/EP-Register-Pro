const DATE_RE = /\b(\d{2}\.\d{2}\.\d{4})\b/;

function normalize(value = '') {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLower(value = '') {
  return normalize(value).toLowerCase();
}

function text(node) {
  return node ? normalize(node.innerText || node.textContent || '') : '';
}

function dedupe(items = [], keyFn = (item) => item) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseDateString(value = '') {
  const match = String(value || '').match(DATE_RE);
  if (!match) return null;
  const [dd, mm, yyyy] = match[1].split('.').map(Number);
  const date = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
}

function compareDateDesc(a, b) {
  return (parseDateString(b?.dateStr)?.getTime() || 0) - (parseDateString(a?.dateStr)?.getTime() || 0);
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

module.exports = {
  DATE_RE,
  normalize,
  normalizeLower,
  text,
  dedupe,
  parseDateString,
  formatDate,
  compareDateDesc,
  isValidDate,
};
