const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync('script.user.js', 'utf8');

function has(re, message) {
  assert(re.test(src), message);
}

function hasText(text, message) {
  assert(src.includes(text), message);
}

function notHas(re, message) {
  assert(!re.test(src), message);
}

// UPC registry integration
has(/@grant\s+GM_xmlhttpRequest/, 'Missing GM_xmlhttpRequest grant for UPC registry checks');
has(/@connect\s+unifiedpatentcourt\.org/, 'Missing @connect unifiedpatentcourt.org');
has(/function\s+refreshUpcRegistry\s*\(/, 'Missing UPC registry refresh function');
has(/parseUpcOptOutResult/, 'Missing UPC opt-out parser');
hasText("upcRegistry.status || (upcRegistry.optedOut ? 'Opted out' : 'No opt-out found')", 'Overview should preserve explicit UPC registry status (e.g., Opt-out withdrawn)');
hasText('opt(?:ed)?[\\s-]*out(?:\\s+\\w+){0,8}\\s+(?:register', 'UPC positive matcher should allow words between opt-out and registered/entered/effective');

// Timeline grouped items UX (collapsible + arrow)
has(/<details class="epoRP-grp" data-group-key=/, 'Timeline groups should render as keyed <details> for persisted collapse state');
has(/class="epoRP-garrow"/, 'Timeline group arrow indicator missing');
has(/\.epoRP-grp\[open\]\s+\.epoRP-garrow\{transform:rotate\(90deg\)/, 'Timeline arrow rotation style missing');
has(/timelineItemHtml\(item, compact = false, inGroup = false\)/, 'Timeline item renderer should support in-group styling');
has(/\.epoRP-it\.in-group\{/, 'Grouped timeline items should have dedicated styling hook');
has(/\.epoRP-grph::marker\{content:''\}/, 'Timeline group summary should hide default marker to avoid native grey button artefacts');
has(/function\s+timelineGroupKey\s*\(/, 'Timeline group key helper missing');
has(/data-group-key="\$\{esc\(groupKey\)\}"/, 'Timeline groups should render stable key attributes for open-state persistence');
has(/function\s+wireTimeline\s*\(caseNo\)/, 'Timeline wire-up should persist group expansion state');
has(/function\s+persistLiveTimelineGroups\s*\(/, 'Timeline open-group persistence helper missing');
has(/function\s+persistLiveDoclistGroups\s*\(/, 'Doclist open-group persistence helper missing');
has(/function\s+inferProceduralDeadlines\s*\(/, 'Deadline model should be derived by dedicated procedural deadline inference');
has(/function\s+addCalendarMonthsDetailed\s*\(/, 'Calendar-month calculation helper (with rollover detection) missing');
has(/function\s+timelineCacheKey\s*\(/, 'Timeline model should expose a cache key for memoization');
has(/@grant\s+unsafeWindow/, 'Userscript metadata should grant unsafeWindow for sandbox/page pdf.js bridging');
has(/const\s+PDF_JS_CANDIDATES\s*=\s*\[/, 'PDF parser should define multi-CDN loader candidates');
has(/const\s+OCR_TESSERACT_CANDIDATES\s*=\s*\[/, 'PDF OCR parser should define tesseract loader candidates');
has(/function\s+getUnsafeWindow\s*\(/, 'PDF parser should expose unsafeWindow bridge helper');
has(/function\s+getPdfJsGlobal\s*\(/, 'PDF parser should resolve pdf.js globals across sandbox/page scopes');
has(/function\s+clearPdfJsGlobals\s*\(/, 'PDF parser should clear stale pdf.js globals before retries');
has(/function\s+registerPdfJsGlobal\s*\(/, 'PDF parser should normalize discovered pdf.js globals back into known scope');
has(/function\s+ensurePdfJs\s*\(/, 'PDF parser loader helper missing');
has(/function\s+ensureTesseract\s*\(/, 'PDF OCR parser loader helper missing');
has(/function\s+loadExternalScriptTag\s*\(/, 'PDF parser should support script-tag fallback loading');
has(/function\s+evaluateExternalScriptCode\s*\(/, 'PDF parser should support multi-strategy script evaluation fallback');
has(/function\s+refreshPdfDeadlines\s*\(/, 'PDF deadline refresh pipeline missing');
has(/async function extractPdfText\(url, signal, pdfjsInstance = null\)/, 'PDF extraction should accept preloaded pdf.js engine instance');
has(/async function extractTextFromPdfViaOcr\(binary, pdfjs, signal\)/, 'PDF extraction should include OCR fallback for image-only PDFs');
has(/function\s+isPdfBinaryData\s*\(/, 'PDF extraction should detect non-PDF payloads before parser invocation');
has(/function\s+binaryToUtf8\s*\(/, 'PDF extraction should decode binary payloads for HTML fallback parsing');
has(/function\s+hasMeaningfulCommunicationText\s*\(/, 'PDF extraction should score fallback HTML text quality before using it');
has(/function\s+focusCommunicationContextText\s*\(/, 'PDF extraction should focus fallback text around communication/deadline anchors');
has(/function\s+deriveDocumentPageUrlFromPdfUrl\s*\(/, 'PDF extraction should derive document-page URLs for empty-PDF fallback');
has(/function\s+extractPdfLikeUrlFromHtml\s*\(/, 'PDF extraction should probe HTML payloads for linked PDF/document URLs');
has(/function\s+pdfContentToStructuredText\s*\(/, 'PDF text extraction should include layout-aware line reconstruction helper');
has(/const\s+txt\s*=\s*pdfContentToStructuredText\(content\);/, 'PDF extraction should use structured line reconstruction per page');
has(/function\s+extractCommunicationDateFromPdf\s*\(/, 'PDF parser should extract communication date explicitly');
has(/function\s+extractResponseMonthsFromPdf\s*\(/, 'PDF parser should extract response-period month count from communication text');
has(/function\s+extractExplicitDeadlineDateFromPdf\s*\(/, 'PDF parser should support explicit deadline dates when present in the communication');
has(/function\s+inferDeadlineCategoryFromContext\s*\(/, 'PDF parser should infer category from document title/procedure metadata when text lacks legal markers');
has(/function\s+defaultResponseMonthsForCategory\s*\(/, 'PDF parser should provide conservative default response periods for key categories');
has(/function\s+extractRegisteredLetterProofLine\s*\(/, 'PDF parser should extract proof line below Registered Letter for logging');
hasText('registered\\s+letter\\b[:\\s\\-]*', 'Registered Letter parser should handle same-line payload patterns');
has(/function\s+normalizePdfDocumentUrl\s*\(/, 'PDF resolver should normalize javascript-based document links');
hasText('/^javascript:/i.test(raw)', 'PDF URL normalizer should detect javascript pseudo-links from doclist');
hasText('source.match(/\\/?application\\?documentId=', 'PDF URL normalizer should extract application?documentId links from javascript handlers');
hasText('/[?&]documentId=/i.test(normalized)', 'PDF resolver should allow direct EPO documentId endpoints without requiring .pdf suffix');
hasText('within\\s+(?:a\\s+)?(?:period|time\\s+limit)\\s+of\\s+([a-z]+|\\d{1,2})\\s+months?', 'PDF month parser should match "within a period of X months" wording');
has(/communicationDateStr\s*=\s*communication\.dateStr\s*\|\|\s*docDateStr/, 'PDF hint derivation should anchor to communication date with doclist fallback');
has(/addCalendarMonthsDetailed\(communicationDate,\s*responseMonths\)/, 'PDF month-based deadline should be computed from communication date + response period (explicit or fallback)');
hasText('PDF proof line (below "Registered Letter")', 'PDF parser logging should report line below Registered Letter to prove document was opened');
hasText('PDF parse diagnostics', 'PDF parser logging should emit communication-date/response-period diagnostics');
hasText('categoryEvidence', 'PDF parse diagnostics should expose whether category came from text or document metadata');
hasText('registeredLetterLine', 'PDF diagnostics should include captured Registered Letter line snippet');
hasText('registeredLetterProofLine', 'PDF diagnostics should include captured Registered Letter proof-line snippet');
hasText('Default ${fallbackMonths}-month period inferred for ${category}', 'PDF parser should support conservative default response-period fallback when explicit month phrases are missing');
hasText('Derived from fragmented phrase', 'PDF parser should detect fragmented month phrase patterns such as "of 4 months"');
hasText('(?:2|3|5|6|two|three|five|six)', 'PDF parser should include explicit fragmented target month detection for 2/3/5/6 month phrases');
hasText('Derived from fragmented target phrase', 'PDF parser should log targeted fragmented month phrase evidence when matched');
hasText('Derived from reversed fragmented target phrase', 'PDF parser should detect reversed fragmented month phrase ordering');
hasText('PDF binary unavailable; using HTML fallback text extraction', 'PDF parser should log explicit HTML fallback path when binary response is not a valid PDF');
hasText('pdfjs-via-linked-url-empty-text', 'PDF parser should expose explicit transport tag when linked PDF has no extractable text layer');
hasText('html-fallback-from-document-page-after-empty-linked-pdf-text', 'PDF parser should support fallback from document-page HTML after empty linked-PDF text extraction');
hasText('normalizedDocUrl', 'PDF URL failure logging should include normalized URL attempt for debugging');
hasText('PDF parser engine ready', 'PDF parser should log successful engine initialization before scanning documents');
hasText('PDF OCR fallback used', 'PDF parser should explicitly log when OCR extraction path is used for image-only PDFs');
hasText('PDF parser unavailable:', 'PDF parser should log explicit engine-loader failures');
hasText('PDF deadline parse aborted (parser engine unavailable)', 'PDF parser should stop clearly when engine is unavailable');
has(/extractPdfText\(resolvedUrl,\s*signal,\s*pdfjs\)/, 'PDF parse loop should reuse a preloaded pdf.js engine instance');
has(/parsePdfDeadlineHints\(text,\s*\{[\s\S]*docTitle:\s*doc\.title,[\s\S]*docProcedure:\s*doc\.procedure,[\s\S]*\}\)/, 'PDF hint parsing should receive document metadata context for category fallback');
has(/withProofLine:\s*scanned\.filter\(/, 'PDF summary logging should include proof-line hit count');
has(/withResponsePeriod:\s*scanned\.filter\(/, 'PDF summary logging should include response-period hit count');
has(/withOcr:\s*scanned\.filter\(/, 'PDF summary logging should include OCR-path usage count');
has(/function\s+sourceDiagnostics\s*\(/, 'Source diagnostics helper should summarize parsed feature payloads');
has(/addLog\(caseNo,\s*'ok',\s*`Parse success \$\{src\.key\}`,[\s\S]*sourceDiagnostics\(src\.key,\s*parsed\)/, 'Fetch parse success logs should include feature-level source diagnostics');
has(/addLog\(caseNo,\s*'info',\s*'Live parse success',[\s\S]*sourceDiagnostics\(sourceKey,\s*data\)/, 'Live parse logs should include feature-level source diagnostics');
hasText('const logs = (getCase(caseNo).logs || []).slice(-MAX_LOGS_PER_APP).reverse();', 'Operation console should render latest logs first');
hasText('autoPrefetchDoneByCase', 'Init should track per-case auto-prefetch completion in current page session');
hasText('lastRegisterTabByCase', 'Init should track previous register tab per case to detect same-case tab switches');
hasText('SESSION_KEY', 'Init gate should persist page-session state in sessionStorage');
hasText('getCaseSession(caseNo)', 'Init should load case session state before applying prefetch gate');
hasText('patchCaseSession(caseNo, { prefetchDoneAt: gateTs, lastRegisterTab: registerTab });', 'Init should persist prefetch gate state to session storage for reload-safe same-tab switching');
hasText('Initial case load: stale/missing sources detected; running auto prefetch', 'Init should log initial auto-prefetch decisions');
hasText('Case tab/page changed; auto prefetch skipped for this page session', 'Init should skip repeated auto-prefetch on case/page switches in this session');
hasText('Same-case tab switch detected: prefetch gate active', 'Init should log explicit same-case tab switch gate decisions');
hasText('Same-case page reload detected: prefetch gate active', 'Init should log explicit same-case reload gate decisions');
hasText('Initial case load: cache is fresh; no auto prefetch needed', 'Init should log fresh-cache reuse on first case load');
has(/const\s+tabChangedWithinCase\s*=\s*hasPreviousTab\s*&&\s*previousRegisterTab\s*!==\s*registerTab;/, 'Init should detect same-case tab changes for gate logging across reloads');
notHas(/addEventListener\('focus',[\s\S]*prefetchCase\(/, 'Focus handler should not auto-reload all sources after same-case tab/page changes');
has(/inferProceduralDeadlines\(main,\s*docs,\s*eventHistory,\s*legal,\s*pdfDeadlines\)/, 'Overview deadline model should include PDF-derived hints');

// Timeline controls (include/exclude + importance)
has(/checkbox\('epoRP-opt-events'/, 'Timeline event include toggle missing from options');
has(/checkbox\('epoRP-opt-legal'/, 'Timeline legal include toggle missing from options');
has(/id="epoRP-opt-event-level"/, 'Timeline event level selector missing from options');
has(/id="epoRP-opt-legal-level"/, 'Timeline legal level selector missing from options');

// Options diagnostics console + effective key/value snapshot
has(/function\s+renderLogConsole\s*\(caseNo\)/, 'Operation console renderer missing');
has(/function\s+formatLogClock\s*\(/, 'Operation console should include timestamp formatter helper');
has(/function\s+safeInlineJson\s*\(/, 'Operation console should include safe JSON serializer helper');
has(/function\s+optionValueText\s*\(/, 'Option snapshot should include value-normalization helper');
has(/function\s+renderOptions\s*\(caseNo\)/, 'Options renderer should accept caseNo to scope diagnostics to current case');
has(/id="epoRP-log-console"/, 'Operation console container missing from options view');
has(/id="epoRP-clear-logs"/, 'Clear operation console button missing from options view');
has(/function\s+renderOptionSnapshot\s*\(/, 'Option snapshot renderer missing');
has(/Object\.keys\(o\)\.sort\(/, 'Option snapshot should enumerate and sort all option keys');
has(/id="epoRP-optvals"/, 'Option key/value list container missing from options view');
has(/renderOptionSnapshot\(\)/, 'Options view should render option key/value snapshot output');
has(/renderLogConsole\(caseNo\)/, 'Options view should render operation console scoped to current case');
has(/b\.querySelector\('#epoRP-clear-logs'\)\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?c\.logs\s*=\s*\[\];[\s\S]*?renderPanel\(\);[\s\S]*?\}\);/, 'Clear operation console control should empty case logs and rerender options');
hasText('Current option values', 'Options view should show a section listing effective option values');

// Publications parsing + tab readability improvements
has(/function\s+normalizePublicationNumber\s*\(/, 'Publication-number normalization helper missing');
has(/function\s+splitPublicationNumber\s*\(/, 'Publication number/kind splitter helper missing');
has(/const\s+publicationField\s*=\s*fieldByLabel\(doc,\s*\[\/\^Publication\\b\/i\]\);/, 'Main parser should match Publication* label variants');
has(/const\s+reDateBeforeNumber\s*=\s*new RegExp/, 'Publication parser should support date-before-number layouts');
hasText('(?:EP|WO|US|JP|CN|KR|DE|FR|GB|CA|AU|BR|IN)', 'Publication parser should include broad publication-country prefixes');
has(/\.epoRP-tab\.on\{background:#bfdbfe;color:#0f172a;border-color:#93c5fd/, 'Selected tab styling should use dark text for readability');

// UI removals requested
notHas(/Document index/, 'Document index UI should be removed');
notHas(/data-view="logs"/, 'Logs tab should be removed');
notHas(/IPC\/CPC/, 'IPC/CPC should be removed from UI');

// Data-cleaning and case typing regressions
has(/dedupeMultiline/, 'dedupeMultiline helper missing');
has(/parentCase/, 'Divisional parent case tracking missing');
has(/cleanTitle/, 'Title cleanup helper missing');
notHas(/isDivisional:\s*!!parentCase\s*\|\|\s*priorities\.some\(\(p\)\s*=>\s*\/\^EP\/i\.test\(p\.no\)\)/, 'Divisional detection should not rely on EP priority numbers alone');
has(/function\s+extractEpNumbersByHeader\s*\(/, 'Header-based EP number extraction helper missing');
has(/extractEpNumbersByHeader\(doc,\s*\/\\bParent application/, 'Parent application extraction should use header-scoped helper');
has(/extractEpNumbersByHeader\(doc,\s*\/\\bDivisional application/, 'Divisional child extraction should use header-scoped helper');
hasText('[A-Z]{2}\\d[0-9A-Z\\/\\-]{4,}', 'Priority parser should require numeric body after country code (prevents LANGUAGE false matches)');
hasText('Filing language|Procedural language|Publication|Applicant|Representative|Status|Most recent event', 'Priority page-text fallback should stop at known next labels to avoid pulling publication rows');
hasText('priority document|annex', 'Annex filings should be classed with the filing package when applicant-filed');
hasText('Response to search', 'Search-response applicant bundle should exist for grouped amendments after search report');
has(/annex to \(\?:the \)\?communication\|communication annex\|annex\.\*examining division/, 'Annex-to-communication should be classed as EPO examination material');
has(/const\s+internationalField\s*=\s*dedupeMultiline\(fieldByLabel\(doc,\s*\[\/\^International application\\b\/i,\s*\/\^International publication\\b\/i,\s*\/\^PCT application\\b\/i\]\)\);/, 'E/PCT detection should use international-application scoped fields');
notHas(/const\s+isEuroPct\s*=\s*!!internationalAppNo\s*\|\|\s*\/\\bPCT\\b\/i/, 'E/PCT detection should not rely on broad page-wide PCT token matching');
has(/function\s+enhanceDoclistGrouping\s*\(/, 'All-documents grouping enhancer missing');
has(/epoRP-docgrp/, 'All-documents grouping row class missing');
has(/headerRow\.classList\.toggle\('open',\s*nextExpanded\)/, 'All-documents group header should mark expanded state for styling');
has(/epoRP-docgrp-open/, 'All-documents grouped rows should get expanded-state class for background differentiation');
has(/function\s+getDoclistOpenGroups\s*\(/, 'All-documents open-state persistence helper missing');
has(/epoRP-docgrp-check/, 'All-documents group header should include a select-all checkbox');
has(/dispatchEvent\(new Event\('change',\s*\{ bubbles: true \}\)\)/, 'Group select-all should emit row checkbox change events');
has(/epoRP-docgrp-item\.epoRP-docgrp-last\.epoRP-docgrp-open td\{border-bottom:2px solid #bfdbfe\}/, 'All-documents grouped rows should draw a bottom boundary line when expanded');
has(/appearance:none\s*!important;-webkit-appearance:none\s*!important/, 'All-documents group header control should suppress native button chrome');
has(/function\s+epRenewalDueDate\s*\(/, 'Renewal model should compute EP due dates from filing-anniversary month');
has(/feeForum\s*=\s*'EPO central \(Unitary Patent\)'/, 'Renewal model should distinguish UP central-fee forum');
has(/graceUntil\s*=\s*nextDue\s*\?\s*addMonths\(nextDue,\s*6\)\s*:\s*null;/, 'Renewal model should include 6-month grace-period calculation');
has(/const\s+graceText\s*=\s*m\.renewal\.graceUntil[\s\S]*?`Grace until \$\{esc\(formatDate\(m\.renewal\.graceUntil\)\)\}/, 'Renewals overview should fold grace-period text into the next-due row');
hasText('Latest paid event:', 'Renewals overview should surface latest renewal inside patent year status');
notHas(/<div class="epoRP-l">Latest renewal<\/div>/, 'Renewals overview should not render a separate Latest renewal row');
notHas(/<div class="epoRP-l">Grace period until<\/div>/, 'Renewals overview should not render a separate Grace period row');
has(/return 'Post-publication';/, 'Stage mapping should avoid using "Published" as a stage label');
has(/return 'Closed';/, 'Stage mapping should classify withdrawn/refused/revoked outcomes as Closed');
has(/const\s+detailedDeadlines\s*=\s*m\.deadlines\.filter\(/, 'Overview should compute detailed deadlines separately from the active next deadline summary');
hasText('Deadlines & clocks (detailed)', 'Overview should render a detailed deadlines section title after dedupe pass');
hasText('Type / stage', 'Overview should combine type and stage in a single summary row');
has(/<div class="epoRP-l">Latest actions<\/div>/, 'Actionable status should combine EPO and applicant activity into one row');
has(/<div class="epoRP-l">Waiting on<\/div>/, 'Actionable status should render waiting-party summary row');
has(/const\s+nextDeadlineMetaLines\s*=\s*\[\];/, 'Actionable status should build tidy next-deadline metadata lines');
hasText('Basis: ${nextDeadlineMethod}', 'Actionable status should render method evidence as a dedicated Basis line');
notHas(/nextDeadlineMeta\s*=\s*m\.nextDeadline/, 'Legacy one-line next-deadline metadata blob should be removed');
hasText('since applicant response', 'Waiting-on summary should include elapsed applicant-response time when applicable');
notHas(/<div class="epoRP-l">EPO last action<\/div>/, 'Actionable status should not render a separate EPO last action row after consolidation');
notHas(/<div class="epoRP-l">Applicant last filing<\/div>/, 'Actionable status should not render a separate applicant last filing row after consolidation');
notHas(/<div class="epoRP-l">Days since applicant response<\/div>/, 'Actionable status should not render a separate day-counter row after consolidation');
has(/const\s+liveTable\s*=\s*bestTable\(document,\s*\['date',\s*'document'\]\)\s*\|\|\s*bestTable\(document,\s*\['document type'\]\)/, 'Doclist filter should resolve current table on each input (avoid stale table reference)');
has(/function\s+doclistGroupingSignature\s*\(/, 'Doclist grouping should compute a structural signature for change detection');
has(/runtime\.doclistGroupSigByCase\[caseNo\]\s*===\s*signature/, 'Doclist grouping should skip full regroup when table signature is unchanged');
has(/if \(runtime\.activeView !== 'timeline'\) renderPanel\(\);/, 'Focus/visibility refresh should avoid unnecessary timeline rerendering');
has(/function\s+panelScrollKey\s*\(/, 'Panel scroll key helper missing');
has(/function\s+persistCurrentPanelScroll\s*\(/, 'Panel scroll persistence helper missing');
has(/restorePanelScroll\(caseNo,\s*activeView\)/, 'Panel scroll should be restored after rerender');
has(/nextDeadlineBadge/, 'Actionable status should show next-deadline day delta inline');
hasText('rolled over', 'Deadline metadata should include rollover indicator when applicable');
notHas(/<div class="epoRP-l">Most recent event<\/div>/, 'Actionable status should not render a separate Most recent event row');
has(/el\.addEventListener\('input',\s*commit\)/, 'Options toggles should react on input events for reliable checkbox commits');

console.log('userscript regression checks passed');
