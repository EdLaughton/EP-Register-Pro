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

assert(src.includes("data-view=\"logs\""), 'Logs tab not found');
assert(src.includes('Background prefetch start'), 'Expected debug logging markers missing');

console.log('userscript smoke checks passed');
