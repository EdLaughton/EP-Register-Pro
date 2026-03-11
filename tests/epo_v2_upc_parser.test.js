const assert = require('assert');
const { loadFixtureText } = require('./userscript_fixture_utils');
const { normalizeUpcResultText, parseUpcOptOutResult } = require('../lib/epo_v2_upc_parser');

assert.strictEqual(
  normalizeUpcResultText('<div>  EP3816364 <strong>Opted-out</strong> registered </div>'),
  'ep3816364 opted-out registered',
  'UPC parser should normalize registry HTML into plain lowercase text for matching',
);

assert.deepStrictEqual(
  parseUpcOptOutResult('<div>EP3816364 Opted-out application registered</div>', 'EP3816364'),
  { patentNumber: 'EP3816364', optedOut: true, status: 'Opted out', source: 'UPC registry' },
  'UPC parser should detect positive opt-out registration results when the patent number is present',
);

assert.deepStrictEqual(
  parseUpcOptOutResult('<div>EP3816364 opt-out application withdrawn</div>', 'EP3816364'),
  { patentNumber: 'EP3816364', optedOut: false, status: 'Opt-out withdrawn', source: 'UPC registry' },
  'UPC parser should distinguish withdrawn opt-outs from positive registrations',
);

assert.strictEqual(
  parseUpcOptOutResult('<div>Opted-out application registered</div>', 'EP3816364'),
  null,
  'UPC parser should require the target patent reference for positive matches',
);

assert.deepStrictEqual(
  parseUpcOptOutResult(loadFixtureText('upc', 'EP3816364.html'), 'EP3816364'),
  { patentNumber: 'EP3816364', optedOut: false, status: 'No opt-out found', source: 'UPC registry' },
  'UPC parser should preserve the real no-result UPC fixture behavior',
);

assert.deepStrictEqual(
  parseUpcOptOutResult(loadFixtureText('upc', 'EP4438108.html'), 'EP4438108'),
  { patentNumber: 'EP4438108', optedOut: true, status: 'Opted out', source: 'UPC registry' },
  'UPC parser should preserve the real positive opt-out UPC fixture behavior',
);
assert.strictEqual(
  parseUpcOptOutResult(loadFixtureText('upc', 'EP4438108.html')),
  null,
  'UPC parser should still require the target patent reference when reading a real positive opt-out fixture',
);

console.log('epo_v2_upc_parser.test.js passed');
