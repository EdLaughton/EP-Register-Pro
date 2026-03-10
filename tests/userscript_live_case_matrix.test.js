const assert = require('assert');
const {
  loadFixtureDocument,
  loadFixtureText,
  loadUserscriptHooks,
} = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

function caseDoc(caseNo, tab) {
  return loadFixtureDocument(['cases', caseNo, `${tab}.html`], `https://register.epo.org/application?number=${caseNo}&tab=${tab}&lng=en`);
}

// EP19205846 — withdrawn/deemed-withdrawn + renewals + repeated R71 cycles
{
  const caseNo = 'EP19205846';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclist = hooks.parseDoclist(caseDoc(caseNo, 'doclist'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});

  assert(/deemed to be withdrawn/i.test(main.statusRaw || ''), 'Withdrawn control should preserve deemed-withdrawn status text');
  assert.strictEqual(main.applicationType, 'EP direct first filing', 'Withdrawn control should remain a direct EP filing');
  assert(legal.renewals.some((r) => r.year === 5), 'Withdrawn control should capture renewal-fee history through year 5');
  assert(eventHistory.events.some((e) => /Communication of intention to grant/i.test(e.title)), 'Withdrawn control should include R71/grant-intention events in event history');
  assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Withdrawn control should derive R71 deadline family from live doclist/event data');
  assert(family.publications.some((p) => p.no === 'EP3816364' && p.kind === 'A1'), 'Withdrawn control should retain the publication used for UPC negative lookup');
}

// EP24189818 — divisional + renewal-heavy + repeated grant-cycle communication
{
  const caseNo = 'EP24189818';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclist = hooks.parseDoclist(caseDoc(caseNo, 'doclist'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});

  assert.strictEqual(main.applicationType, 'Divisional', 'Grant-intention control should remain classified as divisional');
  assert.strictEqual(main.parentCase, 'EP19871250', 'Grant-intention control should expose parent application link');
  assert(legal.renewals.some((r) => r.year === 7), 'Grant-intention control should capture later renewal years');
  assert(eventHistory.events.filter((e) => /Communication of intention to grant/i.test(e.title)).length >= 2, 'Grant-intention control should preserve repeated intention-to-grant cycles');
  assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Grant-intention control should derive R71 deadline family from live communication docs');
  assert(family.publications.some((p) => p.no === 'EP4438108' && p.kind === 'A3'), 'Grant-intention control should retain its A3 family publication');
  assert(family.publications.some((p) => p.no === 'EP3863511' && p.kind === 'B1'), 'Grant-intention control should retain earlier parent-family grant publication');
}

// EP25203732 — active divisional child / parent link / search-publication path
{
  const caseNo = 'EP25203732';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclist = hooks.parseDoclist(caseDoc(caseNo, 'doclist'));
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));

  assert.strictEqual(main.title, 'FACADE', 'Divisional child control should retain live English title');
  assert.strictEqual(main.applicationType, 'Divisional', 'Divisional child control should classify as divisional');
  assert.strictEqual(main.parentCase, 'EP24837586', 'Divisional child control should expose parent application number');
  assert(doclist.docs.some((d) => /European search opinion/i.test(d.title)), 'Divisional child control should include search-opinion docs');
  assert(doclist.docs.some((d) => /Reminder period for payment of examination fee/i.test(d.title)), 'Divisional child control should include early reminder/deadline document');
  assert(eventHistory.events.some((e) => /Publication of search report/i.test(e.title)), 'Divisional child control should preserve search-report publication event');
  assert(family.publications.some((p) => p.no === 'EP4644110' && p.kind === 'A3'), 'Divisional child control should retain its own A3 family publication');
  assert(family.publications.some((p) => p.no === 'EP4623169' && p.kind === 'A1'), 'Divisional child control should retain parent-family publication reference');
}

// EP19871250 — granted B1/C0 baseline + unitary effect + no-opposition happy path
{
  const caseNo = 'EP19871250';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const federated = hooks.parseFederated(caseDoc(caseNo, 'federated'), caseNo);
  const citations = hooks.parseCitations(caseDoc(caseNo, 'citations'));
  const ue = hooks.parseUe(caseDoc(caseNo, 'ueMain'));

  assert(/No opposition filed within time limit/i.test(main.statusRaw || ''), 'Granted baseline should preserve the post-grant no-opposition status');
  assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Granted baseline should remain classified as Euro-PCT regional phase');
  assert(main.divisionalChildren.includes('EP24189818'), 'Granted baseline should expose downstream divisional links');
  assert(eventHistory.events.some((e) => /No opposition filed within time limit/i.test(e.title)), 'Granted baseline should retain no-opposition event history');
  assert(eventHistory.events.some((e) => /Lapse of the patent in a contracting state/i.test(e.title)), 'Granted baseline should retain post-grant lapse signals from live event history');
  assert(family.publications.some((p) => p.no === 'EP4438108' && p.kind === 'A3'), 'Granted baseline should retain the divisional-child family publication');
  assert.strictEqual(federated.status, 'No opposition filed within time limit', 'Granted baseline should parse federated-register status');
  assert.strictEqual(federated.renewalFeesPaidUntil, 'Year 17', 'Granted baseline should parse federated-register renewal horizon');
  assert(federated.states.some((s) => s.state === 'UP'), 'Granted baseline should retain UP row from federated register');
  assert(citations.phases.some((p) => p.name === 'Search') && citations.phases.some((p) => p.name === 'International search'), 'Granted baseline should parse citations grouped by real phases');
  assert(citations.entries.some((e) => e.publicationNo === 'WO2017035502'), 'Granted baseline should parse real citation publication numbers');
  assert.strictEqual(ue.ueStatus, 'Unitary effect registered', 'Granted baseline should parse real unitary-effect registration status');
  assert(/AT, BE, BG, DE/.test(ue.memberStates || ''), 'Granted baseline should retain covered UP member states');
}

// EP22809254 — Euro-PCT non-entry withdrawal + partial/final international-search packet mix
{
  const caseNo = 'EP22809254';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});
  const preview = hooks.doclistGroupingPreview(doclistDoc);

  assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Euro-PCT non-entry control should remain classified as Euro-PCT regional phase');
  assert(/deemed to be withdrawn/i.test(main.statusRaw || ''), 'Euro-PCT non-entry control should preserve deemed-withdrawn wording in the main status');
  assert(preview.some((g) => g.label === 'International search / IPRP' && g.dateStr === '18.04.2023' && g.size === 4), 'Euro-PCT non-entry control should keep the full ISA/IPRP packet together under the PCT-aware search label');
  assert(preview.some((g) => g.label === 'Partial international search' && g.dateStr === '21.02.2023' && g.size === 2), 'Euro-PCT non-entry control should keep the partial-ISR packet together under the partial-search label');
  assert(eventHistory.events.some((e) => /Application deemed to be withdrawn/i.test(e.title)), 'Euro-PCT non-entry control should retain the deemed-withdrawn event-history entry');
  assert(deadlines.some((d) => d.label === 'Euro-PCT entry acts (31-month stop)'), 'Euro-PCT non-entry control should keep Euro-PCT entry-stop guidance in the deadline model');
  assert(family.publications.some((p) => p.no === 'WO2023081017' && p.kind === 'A1'), 'Euro-PCT non-entry control should retain the WO publication reference in the family/publication parse');
}

// EP24163939 — divisional R71 / grant-intended control with clean response packet
{
  const caseNo = 'EP24163939';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});
  const preview = hooks.doclistGroupingPreview(doclistDoc);

  assert.strictEqual(main.applicationType, 'Divisional', 'Grant-intended control should remain classified as divisional');
  assert.strictEqual(main.parentCase, 'EP3440098', 'Grant-intended control should expose its parent case number');
  assert(/Grant of patent is intended/i.test(main.statusRaw || ''), 'Grant-intended control should preserve the R71/grant-intended status text');
  assert(preview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '07.11.2025' && g.size === 6), 'Grant-intended control should keep the full R71 packet together under the intention-to-grant label');
  assert(preview.some((g) => g.label === 'Response to intention to grant' && g.dateStr === '09.03.2026' && g.size === 5), 'Grant-intended control should keep the post-R71 translations/receipt bundle together as the response-to-grant packet');
  assert(eventHistory.events.some((e) => /Communication of intention to grant/i.test(e.title)), 'Grant-intended control should retain the R71 communication event in event history');
  assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Grant-intended control should derive the R71 response deadline family from live docs/events');
  assert(legal.renewals.some((r) => r.year === 9), 'Grant-intended control should retain later renewal-year history');
  assert(family.publications.some((p) => p.no === 'EP4397970' && p.kind === 'A3'), 'Grant-intended control should retain its own A3 publication in the family/publication parse');
}

// EP23182542 — granted divisional with withdrawal/further-processing conflict history
{
  const caseNo = 'EP23182542';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclist = hooks.parseDoclist(caseDoc(caseNo, 'doclist'));
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});

  assert.strictEqual(main.applicationType, 'Divisional', 'Conflict-history control should remain classified as divisional');
  assert.strictEqual(main.parentCase, 'EP4070092', 'Conflict-history control should expose its parent case number');
  assert(/The patent has been granted/i.test(main.statusRaw || ''), 'Conflict-history control should preserve the granted top-level status after further processing');
  assert(doclist.docs.some((d) => /Decision to grant a European patent/i.test(d.title)), 'Conflict-history control should keep the grant-decision document in the doclist parse');
  assert(doclist.docs.some((d) => /Application deemed to be withdrawn \( translations of claims\/payment missing\)/i.test(d.title)), 'Conflict-history control should keep the post-R71 deemed-withdrawn document in the doclist parse');
  assert(doclist.docs.some((d) => /Decision to allow further processing/i.test(d.title)), 'Conflict-history control should keep the further-processing decision in the doclist parse');
  assert(eventHistory.events.some((e) => /Decision on request for further processing/i.test(e.title)), 'Conflict-history control should retain the further-processing event-history entry');
  assert(eventHistory.events.some((e) => /Application deemed to be withdrawn/i.test(e.title)), 'Conflict-history control should retain the deemed-withdrawn event-history entry');
  assert(legal.events.some((e) => /European patent granted/i.test(e.title)), 'Conflict-history control should preserve the eventual grant in legal-status data');
  assert(deadlines.some((d) => d.label === 'Opposition period (third-party monitor)'), 'Conflict-history control should derive the post-grant opposition monitoring window');
  assert(deadlines.some((d) => d.label === 'Unitary effect request window'), 'Conflict-history control should derive the post-grant unitary-effect window');
  assert(family.publications.some((p) => p.no === 'EP4070092' && p.kind === 'B1'), 'Conflict-history control should retain the parent-family grant publication');
  assert(family.publications.some((p) => p.no === 'EP4671766' && p.kind === 'A2'), 'Conflict-history control should retain the downstream divisional publication reference');
}

// EP25193159 — divisional search-stage control with extended-ESR annex
{
  const caseNo = 'EP25193159';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const preview = hooks.doclistGroupingPreview(doclistDoc);

  assert.strictEqual(main.applicationType, 'Divisional', 'Extended-ESR control should remain classified as divisional');
  assert.strictEqual(main.parentCase, 'EP4168798', 'Extended-ESR control should expose its parent case number');
  assert(/The application has been published/i.test(main.statusRaw || ''), 'Extended-ESR control should preserve its published/search-stage status');
  assert(doclist.docs.some((d) => /Document annexed to the Extended European Search Report/i.test(d.title)), 'Extended-ESR control should retain the extended-ESR annex document in the doclist parse');
  assert(preview.some((g) => g.dateStr === '19.02.2026' && g.size === 5 && g.titles.some((title) => /Extended European Search Report/i.test(title))), 'Extended-ESR control should keep the full search packet together even when an extended-search annex is present');
  assert(eventHistory.events.some((e) => /Publication of search report/i.test(e.title)), 'Extended-ESR control should retain the search-report publication event');
  assert(legal.renewals.some((r) => r.year === 5), 'Extended-ESR control should retain renewal-fee history already visible during early search-stage prosecution');
  assert(family.publications.some((p) => p.no === 'EP4168798' && p.kind === 'B1'), 'Extended-ESR control should retain the parent-family grant publication reference');
}

// Live UPC registry positive / negative controls
{
  const negative = hooks.parseUpcOptOutResult(loadFixtureText('upc', 'EP3816364.html'), 'EP3816364');
  assert(negative && negative.optedOut === false && /No opt-out found/i.test(negative.status), 'UPC negative control should resolve as no opt-out found');

  const positive = hooks.parseUpcOptOutResult(loadFixtureText('upc', 'EP4438108.html'), 'EP4438108');
  assert(positive && positive.optedOut === true && /Opted out/i.test(positive.status), 'UPC positive control should resolve as opted out from live UPC registry capture');
}

console.log('userscript live case-matrix checks passed');
