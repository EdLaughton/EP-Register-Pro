const assert = require('assert');
const {
  loadFixtureDocument,
  loadUserscriptHooks,
} = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();
const caseNo = 'EP24837586';

function realDoc(name) {
  return loadFixtureDocument(['register-real', `${name}.html`], `https://register.epo.org/application?number=${caseNo}&tab=${name}&lng=en`);
}

const main = hooks.parseMain(realDoc('main'), caseNo);
assert.strictEqual(main.appNo, caseNo, 'Real main capture should preserve requested application number');
assert.strictEqual(main.title, 'FACADE', 'Real main capture should extract live title');
assert(main.applicant.includes('Mauer Limited'), 'Real main capture should extract applicant text');
assert(main.representative.includes('J A Kemp LLP'), 'Real main capture should extract representative text');
assert.strictEqual(main.filingDate, '19.12.2024', 'Real main capture should extract live filing date');
assert.strictEqual(main.applicationType, 'Divisional', 'Real main capture should classify the live case as divisional');
assert(main.divisionalChildren.includes('EP25203726') && main.divisionalChildren.includes('EP25203732'), 'Real main capture should retain live divisional child links');

const doclist = hooks.parseDoclist(realDoc('doclist'));
assert(doclist.docs.length >= 10, 'Real doclist capture should produce a non-trivial document list');
assert(doclist.docs.some((d) => d.title.includes('Amendment by applicant') || d.title.includes('Amendments received before examination')), 'Real doclist capture should include applicant amendment material');
assert(doclist.docs.some((d) => d.actor === 'Applicant'), 'Real doclist capture should retain actor classification');

const legal = hooks.parseLegal(realDoc('legal'), caseNo);
assert(legal.events.length >= 3, 'Real legal capture should produce legal events');
assert(legal.events.some((e) => e.title === 'Examination procedure'), 'Real legal capture should include examination-procedure entry');
assert(legal.events.some((e) => /Examination fee paid/.test(`${e.title} ${e.detail}`)), 'Real legal capture should include examination-fee entry');

const eventHistory = hooks.parseEventHistory(realDoc('event'), caseNo);
assert(eventHistory.events.length >= 5, 'Real event-history capture should produce multiple event entries');
assert(eventHistory.events.some((e) => /Request for examination filed/i.test(e.title)), 'Real event-history capture should include request-for-examination event');

const family = hooks.parseFamily(realDoc('family'));
assert(family.publications.some((p) => p.no === 'EP4623169' && p.kind === 'A1'), 'Real family capture should extract the core EP publication');
assert(family.publications.some((p) => p.no === 'EP4644110' && p.kind === 'A3'), 'Real family capture should extract related family-member publications');

const ue = hooks.parseUe(realDoc('ueMain'));
assert((ue.statusRaw || ue.ueStatus || '').length > 0, 'Real ueMain capture should parse without crashing even when the page is not a positive unitary-effect example');

console.log('userscript real fixture checks passed');
