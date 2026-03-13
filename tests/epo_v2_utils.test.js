const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalize,
  normalizeLower,
  dedupe,
  parseDateString,
  formatDate,
  compareDateDesc,
  isValidDate,
} = require('../lib/epo_v2_utils');

const libDir = path.join(__dirname, '..', 'lib');
const libFiles = fs.readdirSync(libDir).filter((name) => name.endsWith('.js'));

function filesDefining(pattern) {
  return libFiles.filter((name) => pattern.test(fs.readFileSync(path.join(libDir, name), 'utf8')));
}

assert.deepStrictEqual(
  filesDefining(/function\s+normalize\s*\(/),
  ['epo_v2_utils.js'],
  'Shared whitespace normalization should live in the utility module only within lib/',
);
assert.deepStrictEqual(
  filesDefining(/function\s+dedupe\s*\(/),
  ['epo_v2_utils.js'],
  'Generic dedupe helper should live in the utility module only within lib/',
);
assert.deepStrictEqual(
  filesDefining(/function\s+parseDateString\s*\(/),
  ['epo_v2_utils.js'],
  'Date parsing helper should live in the utility module only within lib/',
);
assert.deepStrictEqual(
  filesDefining(/function\s+formatDate\s*\(/),
  ['epo_v2_utils.js'],
  'Date formatting helper should live in the utility module only within lib/',
);

assert.strictEqual(normalize('  A\u00a0\n\tB   C  '), 'A B C', 'normalize should collapse mixed whitespace into single spaces');
assert.strictEqual(normalizeLower('  A\u00a0\n\tB   C  '), 'a b c', 'normalizeLower should explicitly provide the lowercase variant');
assert.deepStrictEqual(dedupe(['a', 'b', 'a', 'c']), ['a', 'b', 'c'], 'dedupe should preserve first occurrence order');

const parsed = parseDateString('Communication dated 07.03.2026');
assert(parsed instanceof Date && !Number.isNaN(parsed.getTime()), 'parseDateString should recover a valid Date from dd.mm.yyyy text');
assert.strictEqual(formatDate(parsed), '07.03.2026', 'formatDate should round-trip parsed EPC-style dates');
assert.strictEqual(isValidDate(parsed), true, 'isValidDate should accept parsed dates');
assert.strictEqual(isValidDate(new Date('bad')), false, 'isValidDate should reject invalid dates');
assert.deepStrictEqual(
  [{ dateStr: '06.03.2026' }, { dateStr: '07.03.2026' }, { dateStr: '05.03.2026' }].sort(compareDateDesc).map((item) => item.dateStr),
  ['07.03.2026', '06.03.2026', '05.03.2026'],
  'compareDateDesc should order later dd.mm.yyyy dates first',
);

console.log('epo_v2_utils.test.js passed');
