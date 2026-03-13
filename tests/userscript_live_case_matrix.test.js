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

function caseLegal(caseNo) {
  try {
    return hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { events: [], codedEvents: [], renewals: [] };
    throw error;
  }
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
  const legal = caseLegal(caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});

  assert.strictEqual(main.title, 'FACADE', 'Divisional child control should retain live English title');
  assert.strictEqual(main.applicationType, 'Divisional', 'Divisional child control should classify as divisional');
  assert.strictEqual(main.parentCase, 'EP24837586', 'Divisional child control should expose parent application number');
  assert(doclist.docs.some((d) => /European search opinion/i.test(d.title)), 'Divisional child control should include search-opinion docs');
  assert(doclist.docs.some((d) => /Reminder period for payment of examination fee/i.test(d.title)), 'Divisional child control should include early reminder/deadline document');
  assert(eventHistory.events.some((e) => /Publication of search report/i.test(e.title)), 'Divisional child control should preserve search-report publication event');
  assert(!deadlines.some((d) => d.label === 'Unitary effect request window'), 'Divisional child control should stay pre-grant and must not grow a unitary-effect window from publication/search-stage signals');
  assert(!deadlines.some((d) => d.label === 'Opposition period (third-party monitor)'), 'Divisional child control should stay pre-grant and must not grow an opposition window from publication/search-stage signals');
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
  assert.strictEqual(ue.memberStates, 'AT, BE, BG, DE, DK, EE, FI, FR, IT, LT, LU, LV, MT, NL, PT, RO, SE, SI', 'Granted baseline should retain a clean covered-member-state list from ueMain without the registration date or bulletin tag');
  assert.strictEqual(ue.highestRenewalPaidYear, 7, 'Granted baseline should retain the latest UP renewal-fee year from ueMain data');
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
  const posture = hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal);

  assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Euro-PCT non-entry control should remain classified as Euro-PCT regional phase');
  assert(/deemed to be withdrawn/i.test(main.statusRaw || ''), 'Euro-PCT non-entry control should preserve deemed-withdrawn wording in the main status');
  assert.strictEqual(posture.currentLabel, 'Deemed withdrawn (non-entry)', 'Euro-PCT non-entry control should resolve to the sharper normalized current posture');
  assert(eventHistory.events.some((e) => e.codexKey && /LOSS_OF_RIGHTS/i.test(e.codexKey)), 'Euro-PCT non-entry control should normalize its event-history loss-of-rights row into a codex key even without a visible legal ORIGINAL CODE');
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
  const posture = hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal);

  assert.strictEqual(main.applicationType, 'Divisional', 'Grant-intended control should remain classified as divisional');
  assert.strictEqual(main.parentCase, 'EP3440098', 'Grant-intended control should expose its parent case number');
  assert.strictEqual(posture.currentLabel, 'Grant intended (R71(3))', 'Grant-intended control should resolve to the normalized R71 posture');
  assert.strictEqual(main.statusSimple, 'Grant intended (R71(3))', 'Grant-intended control should condense the raw R71 status into the clearer grant-intended badge text');
  assert(/Grant of patent is intended/i.test(main.statusRaw || ''), 'Grant-intended control should preserve the R71/grant-intended status text');
  assert(preview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '07.11.2025' && g.size === 6), 'Grant-intended control should keep the full R71 packet together under the intention-to-grant label');
  assert(preview.some((g) => g.label === 'Response to intention to grant' && g.dateStr === '09.03.2026' && g.size === 5), 'Grant-intended control should keep the post-R71 translations/receipt bundle together as the response-to-grant packet');
  assert(eventHistory.events.some((e) => /Communication of intention to grant/i.test(e.title)), 'Grant-intended control should retain the R71 communication event in event history');
  assert(eventHistory.events.some((e) => e.codexKey === 'GRANT_R71_3_EVENT'), 'Grant-intended control should normalize event-history R71 rows through description fallback as well as legal codes');
  assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Grant-intended control should derive the R71 response deadline family from live docs/events');
  assert((legal.codedEvents || []).some((e) => e.originalCode === 'EPIDOSNIGR1' && e.codexKey === 'GRANT_R71_3_EVENT'), 'Grant-intended control should expose coded legal-event mappings for Rule 71 events');
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
  const posture = hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal);

  assert.strictEqual(main.applicationType, 'Divisional', 'Conflict-history control should remain classified as divisional');
  assert.strictEqual(posture.currentLabel, 'Granted', 'Conflict-history control should resolve to a granted current posture after recovery');
  assert.strictEqual(!!posture.recovered, true, 'Conflict-history control should preserve the loss-of-rights → recovery arc in the posture model');
  assert.strictEqual(main.parentCase, 'EP4070092', 'Conflict-history control should expose its parent case number');
  assert.strictEqual(Array.from(main.divisionalChildren || []).join(','), 'EP25215625', 'Conflict-history control should keep downstream divisional links to application numbers only, not publication numbers');
  assert.strictEqual(main.statusSimple, 'Granted', 'Conflict-history control should condense the final top-level status to Granted despite earlier loss-of-rights detours');
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
  assert.strictEqual(main.statusSimple, 'Published', 'Extended-ESR control should keep a simple published/search-stage badge');
  assert(/The application has been published/i.test(main.statusRaw || ''), 'Extended-ESR control should preserve its published/search-stage status');
  assert(doclist.docs.some((d) => /Document annexed to the Extended European Search Report/i.test(d.title)), 'Extended-ESR control should retain the extended-ESR annex document in the doclist parse');
  assert(preview.some((g) => g.label === 'Extended European search package' && g.dateStr === '19.02.2026' && g.size === 5 && g.titles.some((title) => /Extended European Search Report/i.test(title))), 'Extended-ESR control should keep the full search packet together under an extended-search label when an annex is present');
  assert(eventHistory.events.some((e) => /Publication of search report/i.test(e.title)), 'Extended-ESR control should retain the search-report publication event');
  assert(legal.renewals.some((r) => r.year === 5), 'Extended-ESR control should retain renewal-fee history already visible during early search-stage prosecution');
  assert(family.publications.some((p) => p.no === 'EP4168798' && p.kind === 'B1'), 'Extended-ESR control should retain the parent-family grant publication reference');
}

// Oxford Nanopore family — Euro-PCT deemed-withdrawn / further-processing cluster after non-reply to Written Opinion
{
  const familyCases = [
    { caseNo: 'EP23758527', title: 'DE NOVO PORES', epPublication: 'EP4569331', woPublication: 'WO2024033447' },
    { caseNo: 'EP23758526', title: 'NOVEL PORE MONOMERS AND PORES', epPublication: 'EP4569330', woPublication: 'WO2024033443' },
    { caseNo: 'EP23758524', title: 'NOVEL PORE MONOMERS AND PORES', epPublication: 'EP4569328', woPublication: 'WO2024033421' },
    { caseNo: 'EP23721286', title: 'NOVEL MODIFIED PROTEIN PORES AND ENZYMES', epPublication: 'EP4508203', woPublication: 'WO2023198911' },
  ];

  for (const fixture of familyCases) {
    const main = hooks.parseMain(caseDoc(fixture.caseNo, 'main'), fixture.caseNo);
    const doclistDoc = caseDoc(fixture.caseNo, 'doclist');
    const doclist = hooks.parseDoclist(doclistDoc);
    const eventHistory = hooks.parseEventHistory(caseDoc(fixture.caseNo, 'event'), fixture.caseNo);
    const legal = hooks.parseLegal(caseDoc(fixture.caseNo, 'legal'), fixture.caseNo);
    const family = hooks.parseFamily(caseDoc(fixture.caseNo, 'family'));
    const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});
    const preview = hooks.doclistGroupingPreview(doclistDoc);

    assert.strictEqual(main.title, fixture.title, `${fixture.caseNo} should retain its live English title`);
    assert.strictEqual(main.applicationType, 'E/PCT regional phase', `${fixture.caseNo} should remain classified as Euro-PCT regional phase`);
    assert(/Request for examination was made/i.test(main.statusRaw || ''), `${fixture.caseNo} should preserve the current revived/request-for-exam status after further processing`);
    assert(doclist.docs.some((d) => /Application deemed to be withdrawn \(non-reply to Written Opinion\)/i.test(d.title)), `${fixture.caseNo} should retain the deemed-withdrawn non-reply document in the doclist parse`);
    assert(preview.some((g) => g.dateStr === '06.10.2025' || g.dateStr === '06.06.2025'), `${fixture.caseNo} should keep the deemed-withdrawn event visible as its own packet`);
    assert(doclist.docs.some((d) => /Decision to allow further processing/i.test(d.title)), `${fixture.caseNo} should retain the further-processing decision in the doclist parse`);
    assert(eventHistory.events.some((e) => /Decision on request for further processing/i.test(e.title)), `${fixture.caseNo} should retain the further-processing event-history entry`);
    assert(eventHistory.events.some((e) => /Application deemed to be withdrawn/i.test(e.title)), `${fixture.caseNo} should retain the deemed-withdrawn event-history entry`);
    assert(deadlines.some((d) => d.label === 'Euro-PCT entry acts (31-month stop)'), `${fixture.caseNo} should keep Euro-PCT entry-stop guidance in the deadline model`);
    assert(!deadlines.some((d) => d.label === 'Appeal notice + fee'), `${fixture.caseNo} should not fabricate appeal clocks from further-processing decisions`);
    assert(legal.renewals.some((r) => r.year === 3), `${fixture.caseNo} should retain renewal-fee history through year 3`);
    assert(family.publications.some((p) => p.no === fixture.epPublication), `${fixture.caseNo} should retain its EP publication in the family/publication parse`);
    assert(family.publications.some((p) => p.no === fixture.woPublication), `${fixture.caseNo} should retain its WO publication in the family/publication parse`);
  }
}

// EP22812869 — second Euro-PCT non-entry withdrawal control
{
  const caseNo = 'EP22812869';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});
  const preview = hooks.doclistGroupingPreview(doclistDoc);

  assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Second Euro-PCT non-entry control should remain classified as Euro-PCT regional phase');
  assert(/deemed to be withdrawn/i.test(main.statusRaw || ''), 'Second Euro-PCT non-entry control should preserve deemed-withdrawn wording in the main status');
  assert(preview.some((g) => g.label === 'International search / IPRP' && g.dateStr === '21.05.2024' && g.size === 1), 'Second Euro-PCT non-entry control should relabel singleton IPRP copies with the PCT-aware search label');
  assert(doclist.docs.some((d) => /Application deemed to be withdrawn \(non-entry into European phase\)/i.test(d.title)), 'Second Euro-PCT non-entry control should retain the non-entry loss document in the doclist parse');
  assert(eventHistory.events.some((e) => /Application deemed to be withdrawn/i.test(e.title)), 'Second Euro-PCT non-entry control should retain the deemed-withdrawn event-history entry');
  assert(deadlines.some((d) => d.label === 'Euro-PCT entry acts (31-month stop)'), 'Second Euro-PCT non-entry control should keep Euro-PCT entry-stop guidance in the deadline model');
  assert(family.publications.some((p) => p.no === 'WO2023081016' && p.kind === 'A1'), 'Second Euro-PCT non-entry control should retain the WO publication reference in the family/publication parse');
}

// EP22153706 — divisional deemed-withdrawn control with explicit non-payment / non-reply reason coding
{
  const caseNo = 'EP22153706';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const preview = hooks.doclistGroupingPreview(doclistDoc);

  assert.strictEqual(main.applicationType, 'Divisional', 'Reason-coded withdrawn control should remain classified as divisional');
  assert.strictEqual(main.parentCase, 'EP3800978', 'Reason-coded withdrawn control should expose its parent case number');
  assert.strictEqual(main.statusSimple, 'Deemed withdrawn', 'Reason-coded withdrawn control should use the sharper deemed-withdrawn badge instead of a generic withdrawn/closed label');
  assert(/deemed to be withdrawn/i.test(main.statusRaw || ''), 'Reason-coded withdrawn control should preserve deemed-withdrawn wording in the main status');
  assert(doclist.docs.some((d) => /non-payment of examination fee\/designation fee\/non-reply to Written Opinion/i.test(d.title)), 'Reason-coded withdrawn control should retain the explicit non-payment/non-reply loss document');
  assert(preview.some((g) => g.label === 'Fees / written-opinion failure' && g.dateStr === '05.01.2023' && g.size === 1), 'Reason-coded withdrawn control should promote the reason-coded deemed-withdrawn singleton out of the generic Examination label');
  assert(preview.some((g) => g.label === 'European search package' && g.dateStr === '20.04.2022' && g.size === 4), 'Reason-coded withdrawn control should keep the ESR packet together under the European-search label');
  assert(eventHistory.events.some((e) => /Application deemed to be withdrawn/i.test(e.title)), 'Reason-coded withdrawn control should retain the deemed-withdrawn event-history entry');
  assert(legal.renewals.some((r) => r.year === 4), 'Reason-coded withdrawn control should retain renewal-fee history through year 4');
  assert(family.publications.some((p) => p.no === 'EP3800978' && p.kind === 'B1'), 'Reason-coded withdrawn control should retain the parent-family grant publication');
  assert(family.publications.some((p) => p.no === 'EP4008170' && p.kind === 'A1'), 'Reason-coded withdrawn control should retain its own EP publication');
}

// EP22209859 — clean divisional no-opposition / post-grant control
{
  const caseNo = 'EP22209859';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});
  const preview = hooks.doclistGroupingPreview(doclistDoc);
  const posture = hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal);
  const buckets = hooks.deadlinePresentationBuckets(deadlines, posture.currentClosed);

  assert.strictEqual(main.applicationType, 'Divisional', 'Clean no-opposition divisional control should remain classified as divisional');
  assert.strictEqual(posture.currentLabel, 'Granted (no opposition)', 'Clean no-opposition divisional control should resolve to the normalized no-opposition posture');
  assert.strictEqual(posture.note, 'Current controlling posture is granted with the opposition period closed.', 'Clean no-opposition divisional control should prefer the post-grant closed note over stale historical R71 wording');
  assert.strictEqual(main.parentCase, 'EP3942381', 'Clean no-opposition divisional control should expose its parent case number');
  assert(/No opposition filed within time limit/i.test(main.statusRaw || ''), 'Clean no-opposition divisional control should preserve the post-grant no-opposition status');
  assert(preview.some((g) => g.label === 'Opposition' && g.dateStr === '10.03.2025' && g.size === 1), 'Clean no-opposition divisional control should surface the opposition-expiry communication as its own packet');
  assert(preview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '14.02.2024' && g.size === 6), 'Clean no-opposition divisional control should keep the R71 packet together');
  assert(eventHistory.events.some((e) => /No opposition filed within time limit/i.test(e.title)), 'Clean no-opposition divisional control should retain the no-opposition event-history entry');
  assert(eventHistory.events.some((e) => e.codexKey === 'NO_OPPOSITION_FILED'), 'Clean no-opposition divisional control should normalize event-history no-opposition rows through description fallback');
  assert((legal.codedEvents || []).some((e) => e.originalCode === '0009261' && e.codexKey === 'NO_OPPOSITION_FILED'), 'Clean no-opposition divisional control should expose coded legal-event mappings for the no-opposition status');
  assert(eventHistory.events.some((e) => /Lapse of the patent in a contracting state/i.test(e.title)), 'Clean no-opposition divisional control should retain post-grant lapse signals');
  assert(deadlines.some((d) => d.label === 'Opposition period (third-party monitor)'), 'Clean no-opposition divisional control should derive the opposition monitoring window');
  assert(deadlines.some((d) => d.label === 'Unitary effect request window'), 'Clean no-opposition divisional control should derive the post-grant unitary-effect window');
  assert.strictEqual(hooks.selectNextDeadline(deadlines, posture.currentClosed), null, 'Clean no-opposition divisional control should not keep stale post-grant appeal or UE clocks active once the opposition period is closed');
  assert.strictEqual(buckets.active.length, 0, 'Clean no-opposition divisional control should move post-grant appeal / UE clocks out of the active bucket after no-opposition closure');
  assert.strictEqual(buckets.monitoring.length, 0, 'Clean no-opposition divisional control should not keep the opposition monitor active once the no-opposition event has landed');
  assert(buckets.historical.some((d) => d.label === 'Opposition period (third-party monitor)' && d.resolved), 'Clean no-opposition divisional control should retain the opposition window only as resolved historical context after closure');
  assert(buckets.historical.some((d) => d.label === 'Appeal notice + fee' && d.resolved), 'Clean no-opposition divisional control should retain grant-decision appeal clocks only as resolved historical context after closure');
  assert(legal.renewals.some((r) => r.year === 5), 'Clean no-opposition divisional control should retain renewal-fee history through year 5');
  assert(family.publications.some((p) => p.no === 'EP3942381' && p.kind === 'B1'), 'Clean no-opposition divisional control should retain the parent-family grant publication');
  assert(family.publications.some((p) => p.no === 'EP4163756' && p.kind === 'B1'), 'Clean no-opposition divisional control should retain its own B1 publication');
}

// EP20816706 — clean Euro-PCT no-opposition / post-grant control
{
  const caseNo = 'EP20816706';
  const main = hooks.parseMain(caseDoc(caseNo, 'main'), caseNo);
  const doclistDoc = caseDoc(caseNo, 'doclist');
  const doclist = hooks.parseDoclist(doclistDoc);
  const eventHistory = hooks.parseEventHistory(caseDoc(caseNo, 'event'), caseNo);
  const family = hooks.parseFamily(caseDoc(caseNo, 'family'));
  const legal = hooks.parseLegal(caseDoc(caseNo, 'legal'), caseNo);
  const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, {});
  const preview = hooks.doclistGroupingPreview(doclistDoc);
  const posture = hooks.proceduralPostureModel(main, doclist.docs, eventHistory, legal);
  const buckets = hooks.deadlinePresentationBuckets(deadlines, posture.currentClosed);

  assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Clean Euro-PCT no-opposition control should remain classified as Euro-PCT regional phase');
  assert.strictEqual(posture.currentLabel, 'Granted (no opposition)', 'Clean Euro-PCT no-opposition control should resolve to the normalized no-opposition posture');
  assert.strictEqual(posture.note, 'Current controlling posture is granted with the opposition period closed.', 'Clean Euro-PCT no-opposition control should prefer the post-grant closed note over stale historical R71 wording');
  assert(/No opposition filed within time limit/i.test(main.statusRaw || ''), 'Clean Euro-PCT no-opposition control should preserve the post-grant no-opposition status');
  assert(preview.some((g) => g.label === 'Opposition' && g.dateStr === '06.02.2026' && g.size === 1), 'Clean Euro-PCT no-opposition control should surface the opposition-expiry communication as its own packet');
  assert(preview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '06.12.2024' && g.size === 6), 'Clean Euro-PCT no-opposition control should keep the R71 packet together');
  assert(eventHistory.events.some((e) => /No opposition filed within time limit/i.test(e.title)), 'Clean Euro-PCT no-opposition control should retain the no-opposition event-history entry');
  assert(eventHistory.events.some((e) => /Lapse of the patent in a contracting state/i.test(e.title)), 'Clean Euro-PCT no-opposition control should retain post-grant lapse signals');
  assert(deadlines.some((d) => d.label === 'Euro-PCT entry acts (31-month stop)'), 'Clean Euro-PCT no-opposition control should preserve its Euro-PCT entry-stop reference in the deadline model');
  assert.strictEqual(deadlines.find((d) => d.label === 'R71(3) response period')?.sourceDate, '06.12.2024', 'Clean Euro-PCT no-opposition control should anchor Rule 71(3) to the underlying communication date rather than the later announcement row');
  assert.strictEqual(deadlines.find((d) => d.label === 'Euro-PCT exam/designation deadline (later-of formula)')?.sourceDate, '04.11.2019 / 14.05.2021', 'Clean Euro-PCT no-opposition control should anchor the later-of formula to the actual ISR/WO issue packet instead of later loss-of-rights rows');
  assert(deadlines.some((d) => d.label === 'Opposition period (third-party monitor)'), 'Clean Euro-PCT no-opposition control should derive the opposition monitoring window');
  assert.strictEqual(hooks.selectNextDeadline(deadlines, posture.currentClosed), null, 'Clean Euro-PCT no-opposition control should not keep stale post-grant appeal or UE clocks active once the opposition period is closed');
  assert.strictEqual(buckets.active.length, 0, 'Clean Euro-PCT no-opposition control should move post-grant appeal / UE clocks out of the active bucket after no-opposition closure');
  assert.strictEqual(buckets.monitoring.length, 0, 'Clean Euro-PCT no-opposition control should not keep the opposition monitor active once the no-opposition event has landed');
  assert(buckets.historical.some((d) => d.label === 'Unitary effect request window' && d.resolved), 'Clean Euro-PCT no-opposition control should retain the unitary-effect request window only as resolved historical context after closure');
  assert(buckets.historical.some((d) => d.label === 'Appeal grounds' && d.resolved), 'Clean Euro-PCT no-opposition control should retain grant-decision appeal clocks only as resolved historical context after closure');
  assert(legal.renewals.some((r) => r.year === 5), 'Clean Euro-PCT no-opposition control should retain renewal-fee history through year 5');
  assert(family.publications.some((p) => p.no === 'WO2021091972' && p.kind === 'A1'), 'Clean Euro-PCT no-opposition control should retain the WO publication');
  assert(family.publications.some((p) => p.no === 'EP4054309' && p.kind === 'B1'), 'Clean Euro-PCT no-opposition control should retain its own B1 publication');
}

// Live UPC registry positive / negative controls
{
  const negative = hooks.parseUpcOptOutResult(loadFixtureText('upc', 'EP3816364.html'), 'EP3816364');
  assert(negative && negative.optedOut === false && /No opt-out found/i.test(negative.status), 'UPC negative control should resolve as no opt-out found');

  const positive = hooks.parseUpcOptOutResult(loadFixtureText('upc', 'EP4438108.html'), 'EP4438108');
  assert(positive && positive.optedOut === true && /Opted out/i.test(positive.status), 'UPC positive control should resolve as opted out from live UPC registry capture');
}

console.log('userscript live case-matrix checks passed');
