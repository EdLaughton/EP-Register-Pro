const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync('script.user.js', 'utf8');

const metaVersion = (src.match(/@version\s+([^\n]+)/) || [])[1]?.trim();
const constVersion = (src.match(/const VERSION = '([^']+)'/) || [])[1];
assert(metaVersion, 'metadata version missing');
assert(constVersion, 'VERSION constant missing');
assert.strictEqual(metaVersion, constVersion, 'Metadata version must match runtime VERSION');

for (const tab of ['main', 'doclist', 'event', 'family', 'legal', 'ueMain']) {
  assert(src.includes(`key: '${tab}'`), `Missing source ${tab}`);
}

for (const option of ['preloadAllTabs', 'showPublications', 'showEventHistory', 'showLegalStatusRows', 'showRenewals', 'showUpcUe']) {
  assert(src.includes(option), `Missing option ${option}`);
}

for (const diagnosticsHook of ['epoRP-log-console', 'epoRP-clear-logs', 'epoRP-optvals', 'renderOptionSnapshot']) {
  assert(src.includes(diagnosticsHook), `Missing diagnostics hook ${diagnosticsHook}`);
}

for (const pdfHook of ['@grant        unsafeWindow', 'PDF_JS_CANDIDATES', 'OCR_TESSERACT_CANDIDATES', 'getPdfJsGlobal', 'registerPdfJsGlobal', 'ensureTesseract', 'extractTextFromPdfViaOcr', 'loadExternalScriptTag', 'evaluateExternalScriptCode', 'isPdfBinaryData', 'binaryToUtf8', 'hasMeaningfulCommunicationText', 'focusCommunicationContextText', 'deriveDocumentPageUrlFromPdfUrl', 'extractPdfLikeUrlFromHtml', 'inferDeadlineCategoryFromContext', 'defaultResponseMonthsForCategory', 'extractRegisteredLetterProofLine', 'normalizePdfDocumentUrl', 'Communication response period', 'PDF communication date differs from doclist date (using PDF date for deadline derivation)', 'Derived from fragmented target phrase', 'Derived from reversed fragmented target phrase', 'PDF OCR fallback used', 'PDF parse diagnostics', 'PDF proof line (below "Registered Letter")']) {
  assert(src.includes(pdfHook), `Missing PDF diagnostics hook ${pdfHook}`);
}

for (const diagnosticsHook of ['sourceDiagnostics', 'autoPrefetchDoneByCase', 'lastRegisterTabByCase', 'SESSION_KEY', 'loadSessionJson', 'patchCaseSession', 'timelineAttorneyImportance', 'slice(-MAX_LOGS_PER_APP).reverse()', 'Case tab/page changed; auto prefetch skipped for this page session', 'Same-case tab switch detected: prefetch gate active', 'Same-case page reload detected: prefetch gate active', 'Prefetch gate bypassed: stale/missing sources detected', 'staleSources', 'UPC registry check skipped: no EP publication numbers available', 'Intention to grant (R71(3) EPC)', 'Loss-of-rights posture detected.', 'const isOpen = hasSavedOpenState ? openGroups.has(groupKey) : true;', 'tr.epoRP-docgrp td:first-child{box-shadow:inset 3px 0 0 #3b82f6}', 'tr.epoRP-docgrp-item.epoRP-docgrp-open td:first-child{box-shadow:inset 3px 0 0 #93c5fd}']) {
  assert(src.includes(diagnosticsHook), `Missing diagnostics coverage hook ${diagnosticsHook}`);
}

assert(!src.includes('persistLiveTimelineGroups('), 'Timeline open-state persistence should be removed (timeline groups collapse by default)');

assert(!src.includes('IPC/CPC'), 'IPC/CPC block should be removed from sidebar UI');

console.log('userscript smoke checks passed');
