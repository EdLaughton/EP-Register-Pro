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

// Timeline controls (include/exclude + importance)
has(/checkbox\('epoRP-opt-events'/, 'Timeline event include toggle missing from options');
has(/checkbox\('epoRP-opt-legal'/, 'Timeline legal include toggle missing from options');
has(/id="epoRP-opt-event-level"/, 'Timeline event level selector missing from options');
has(/id="epoRP-opt-legal-level"/, 'Timeline legal level selector missing from options');

// UI removals requested
notHas(/Document index/, 'Document index UI should be removed');
notHas(/data-view="logs"/, 'Logs tab should be removed');
notHas(/IPC\/CPC/, 'IPC/CPC should be removed from UI');

// Data-cleaning and case typing regressions
has(/dedupeMultiline/, 'dedupeMultiline helper missing');
has(/parentCase/, 'Divisional parent case tracking missing');
has(/cleanTitle/, 'Title cleanup helper missing');
has(/function\s+extractEpNumbersByHeader\s*\(/, 'Header-based EP number extraction helper missing');
has(/extractEpNumbersByHeader\(doc,\s*\/\\bParent application/, 'Parent application extraction should use header-scoped helper');
has(/extractEpNumbersByHeader\(doc,\s*\/\\bDivisional application/, 'Divisional child extraction should use header-scoped helper');
hasText('[A-Z]{2}\\d[0-9A-Z\\/\\-]{4,}', 'Priority parser should require numeric body after country code (prevents LANGUAGE false matches)');
hasText('Filing language|Procedural language|Publication|Applicant|Representative|Status|Most recent event', 'Priority page-text fallback should stop at known next labels to avoid pulling publication rows');
hasText('priority document|annex', 'Annex filings should be classed with the filing package');
has(/const\s+internationalField\s*=\s*dedupeMultiline\(fieldByLabel\(doc,\s*\[\/\^International application\\b\/i,\s*\/\^International publication\\b\/i,\s*\/\^PCT application\\b\/i\]\)\);/, 'E/PCT detection should use international-application scoped fields');
notHas(/const\s+isEuroPct\s*=\s*!!internationalAppNo\s*\|\|\s*\/\\bPCT\\b\/i/, 'E/PCT detection should not rely on broad page-wide PCT token matching');
has(/function\s+enhanceDoclistGrouping\s*\(/, 'All-documents grouping enhancer missing');
has(/epoRP-docgrp/, 'All-documents grouping row class missing');
has(/headerRow\.classList\.toggle\('open',\s*nextExpanded\)/, 'All-documents group header should mark expanded state for styling');
has(/epoRP-docgrp-open/, 'All-documents grouped rows should get expanded-state class for background differentiation');
has(/appearance:none\s*!important;-webkit-appearance:none\s*!important/, 'All-documents group header control should suppress native button chrome');
has(/const\s+highestPaidNextYear\s*=\s*m\.renewal\.highestYear\s*\?\s*\(m\.renewal\.highestYear\s*\+\s*1\)\s*:\s*null;/, 'Renewal next-year should account for paid-ahead highest year');
has(/Math\.max\(3,\s*filingBasedNextYear\s*\|\|\s*0,\s*highestPaidNextYear\s*\|\|\s*0\)/, 'Renewal next-year should be max of filing-based and paid-ahead baseline');
has(/const\s+liveTable\s*=\s*bestTable\(document,\s*\['date',\s*'document'\]\)\s*\|\|\s*bestTable\(document,\s*\['document type'\]\)/, 'Doclist filter should resolve current table on each input (avoid stale table reference)');
has(/if \(runtime\.activeView !== 'timeline'\) renderPanel\(\);/, 'Focus/visibility refresh should avoid unnecessary timeline rerendering');

console.log('userscript regression checks passed');
