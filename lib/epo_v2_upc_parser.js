const { normalize } = require('./epo_v2_doclist_parser');

function normalizeUpcResultText(html = '') {
  return normalize(String(html || '').replace(/<[^>]+>/g, ' ')).toLowerCase();
}

function parseUpcOptOutResult(html, patentNumber) {
  const text = normalizeUpcResultText(html);
  if (!text) return null;

  if (/no results found/.test(text)) {
    return { patentNumber, optedOut: false, status: 'No opt-out found', source: 'UPC registry' };
  }

  const patentRef = String(patentNumber || '').toLowerCase();
  const hasPatentRef = patentRef && text.includes(patentRef);
  if (!hasPatentRef) return null;

  const hasOptOutToken = /\bopt(?:ed)?[\s-]*out\b/.test(text);
  const positiveSignal =
    /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+(?:register(?:ed)?|enter(?:ed)?|effective)\b/.test(text)
    || /\b(?:register(?:ed)?|enter(?:ed)?|effective)(?:\s+\w+){0,8}\s+opt(?:ed)?[\s-]*out\b/.test(text)
    || /\bcase\s+type\s+opt(?:ed)?[\s-]*out\s+application\b/.test(text)
    || /\bopt(?:ed)?[\s-]*out\s+application\b/.test(text);
  const withdrawnSignal = /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+(?:withdrawn|removed|revoked)\b/.test(text);
  const negativeSignal =
    /\bnot\s+opt(?:ed)?[\s-]*out\b/.test(text)
    || /\bno\s+opt(?:ed)?[\s-]*out\b/.test(text)
    || /\bopt(?:ed)?[\s-]*out(?:\s+\w+){0,8}\s+not\s+(?:been\s+)?(?:register(?:ed)?|enter(?:ed)?|effective)\b/.test(text);

  if (withdrawnSignal) {
    return { patentNumber, optedOut: false, status: 'Opt-out withdrawn', source: 'UPC registry' };
  }

  if (hasOptOutToken && positiveSignal && !negativeSignal) {
    return { patentNumber, optedOut: true, status: 'Opted out', source: 'UPC registry' };
  }

  return null;
}

module.exports = {
  normalizeUpcResultText,
  parseUpcOptOutResult,
};
