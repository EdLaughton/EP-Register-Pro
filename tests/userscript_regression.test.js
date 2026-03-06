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
has(/id="epoRP-tl-events"/, 'Timeline event include toggle missing');
has(/id="epoRP-tl-legal"/, 'Timeline legal include toggle missing');
has(/id="epoRP-tl-event-level"/, 'Timeline event level selector missing');
has(/id="epoRP-tl-legal-level"/, 'Timeline legal level selector missing');
has(/function\s+wireTimeline\s*\(/, 'wireTimeline handler missing');

// UI removals requested
notHas(/Document index/, 'Document index UI should be removed');
notHas(/data-view="logs"/, 'Logs tab should be removed');
notHas(/IPC\/CPC/, 'IPC/CPC should be removed from UI');

// Data-cleaning and case typing regressions
has(/dedupeMultiline/, 'dedupeMultiline helper missing');
has(/parentCase/, 'Divisional parent case tracking missing');
has(/cleanTitle/, 'Title cleanup helper missing');

console.log('userscript regression checks passed');
