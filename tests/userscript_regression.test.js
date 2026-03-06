const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync('script.user.js', 'utf8');

function has(re, message) {
  assert(re.test(src), message);
}

function notHas(re, message) {
  assert(!re.test(src), message);
}

// UPC registry integration
has(/@grant\s+GM_xmlhttpRequest/, 'Missing GM_xmlhttpRequest grant for UPC registry checks');
has(/@connect\s+unifiedpatentcourt\.org/, 'Missing @connect unifiedpatentcourt.org');
has(/function\s+refreshUpcRegistry\s*\(/, 'Missing UPC registry refresh function');
has(/parseUpcOptOutResult/, 'Missing UPC opt-out parser');

// Timeline grouped items UX (collapsible + arrow)
has(/<details class="epoRP-grp">/, 'Timeline groups should render as collapsed <details> by default');
has(/class="epoRP-garrow"/, 'Timeline group arrow indicator missing');
has(/\.epoRP-grp\[open\]\s+\.epoRP-garrow\{transform:rotate\(90deg\)/, 'Timeline arrow rotation style missing');

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
has(/function\s+enhanceDoclistGrouping\s*\(/, 'All-documents grouping enhancer missing');
has(/epoRP-docgrp/, 'All-documents grouping row class missing');

console.log('userscript regression checks passed');
