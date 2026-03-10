const assert = require('assert');
const { JSDOM } = require('jsdom');
const {
  loadFixtureDocument,
  loadFixtureText,
  loadUserscriptHooks,
} = require('./userscript_fixture_utils');

const hooks = loadUserscriptHooks();

const caseNo = 'EP24837586';
const docs = {
  main: loadFixtureDocument(['cases', caseNo, 'main.html'], `https://register.epo.org/application?number=${caseNo}&tab=main&lng=en`),
  doclist: loadFixtureDocument(['cases', caseNo, 'doclist.html'], `https://register.epo.org/application?number=${caseNo}&tab=doclist&lng=en`),
  legal: loadFixtureDocument(['cases', caseNo, 'legal.html'], `https://register.epo.org/application?number=${caseNo}&tab=legal&lng=en`),
  event: loadFixtureDocument(['cases', caseNo, 'event.html'], `https://register.epo.org/application?number=${caseNo}&tab=event&lng=en`),
  family: loadFixtureDocument(['cases', caseNo, 'family.html'], `https://register.epo.org/application?number=${caseNo}&tab=family&lng=en`),
  ueMain: loadFixtureDocument(['cases', caseNo, 'ueMain.html'], `https://register.epo.org/application?number=${caseNo}&tab=ueMain&lng=en`),
};

const main = hooks.parseMain(docs.main, caseNo);
assert.strictEqual(main.appNo, caseNo, 'Main parser should preserve case number');
assert.strictEqual(main.title, 'FACADE', 'Main parser should extract live English title from real Register capture');
assert(main.applicant.includes('Mauer Limited'), 'Main parser should normalize applicant block from real Register capture');
assert(main.representative.includes('J A Kemp LLP'), 'Main parser should extract representative from real Register capture');
assert.strictEqual(main.filingDate, '19.12.2024', 'Main parser should extract filing date from real Register capture');
assert(main.divisionalChildren.includes('EP25203726') && main.divisionalChildren.includes('EP25203732'), 'Main parser should extract live divisional children');
assert.strictEqual(main.applicationType, 'E/PCT regional phase', 'Main parser should classify the live case as Euro-PCT regional phase');
assert(main.internationalAppNo === 'WO2024EP87573', 'Main parser should extract the live PCT application number from the real capture');
assert(main.publications.some((p) => p.no === 'EP4623169' && p.kind === 'A1'), 'Main parser should extract real publication number + kind from multi-row publication tables');

const doclist = hooks.parseDoclist(docs.doclist);
assert(doclist.docs.length >= 10, 'Doclist parser should extract a non-trivial document list from the live capture');
assert(doclist.docs.some((d) => /Copy of the international search report/i.test(d.title) && d.bundle === 'Search package' && d.actor === 'EPO'), 'Doclist parser should classify EPO search-report material in the live Euro-PCT capture');
assert(doclist.docs.some((d) => /Amended claims|Amendments received before examination/i.test(d.title) && d.actor === 'Applicant'), 'Doclist parser should classify applicant amendment filings in the live capture');

const legal = hooks.parseLegal(docs.legal, caseNo);
assert(legal.events.some((e) => /Examination fee paid|Despatch of communication/i.test(`${e.title} ${e.detail}`)), 'Legal parser should extract dated legal-status events from the live capture');

const eventHistory = hooks.parseEventHistory(docs.event, caseNo);
assert(eventHistory.events.length >= 3, 'Event-history parser should extract multiple dated rows from the live capture');
assert(eventHistory.events.some((e) => /request for examination/i.test(e.title)), 'Event-history parser should preserve live event titles');

const family = hooks.parseFamily(docs.family);
assert(family.publications.some((p) => p.no === 'EP4623169' && p.kind === 'A1'), 'Family parser should extract publication entries from real family-table HTML');

const ue = hooks.parseUe(docs.ueMain);
assert((ue.ueStatus || ue.statusRaw || '').length > 0, 'UE parser should parse the live ueMain capture without crashing');

const placeholderMainDoc = new JSDOM('<!doctype html><html><body><div>No files were found for your search terms.</div></body></html>', {
  url: 'https://register.epo.org/application?number=EP19205846&tab=main&lng=en',
}).window.document;
const placeholderDoclistDoc = new JSDOM('<!doctype html><html><body><div>No files were found for your search terms.</div></body></html>', {
  url: 'https://register.epo.org/application?number=EP19205846&tab=doclist&lng=en',
}).window.document;
assert.strictEqual(hooks.classifyParsedSourceState('main', placeholderMainDoc, { appNo: 'EP19205846' }).status, 'notFound', 'Main-tab placeholder pages should classify as notFound when no usable case data is present');
assert.strictEqual(hooks.classifyParsedSourceState('doclist', placeholderDoclistDoc, { docs: [] }).status, 'empty', 'Auxiliary placeholder pages should classify as empty instead of healthy ok loads');
assert.strictEqual(hooks.classifyParsedSourceState('main', docs.main, main).status, 'ok', 'Real main Register captures should remain classified as ok');

const repeatedGrantDoclistDoc = loadFixtureDocument(['cases', 'EP19205846', 'doclist.html'], 'https://register.epo.org/application?number=EP19205846&tab=doclist&lng=en');
const repeatedGrantDoclist = hooks.parseDoclist(repeatedGrantDoclistDoc);
const repeatedGrantPreview = hooks.doclistGroupingPreview(repeatedGrantDoclistDoc);
assert(repeatedGrantPreview.some((g) => g.label === 'Response to intention to grant' && g.dateStr === '08.09.2023' && g.size === 5), 'Doclist grouping should keep the full 08.09.2023 grant-response packet together, including the electronic receipt');
assert(repeatedGrantPreview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '10.05.2023' && g.size === 6), 'Doclist grouping should keep each R71 communication packet anchored to its own date');
assert(repeatedGrantPreview.some((g) => g.label === 'Response to intention to grant' && g.dateStr === '21.04.2023' && g.size === 5), 'Doclist grouping should keep the full 21.04.2023 disapproval/resumption packet together, including the electronic receipt');

const repeatedGrantTimelinePreview = hooks.timelineDocGroupingPreview(repeatedGrantDoclist.docs);
assert(repeatedGrantTimelinePreview.some((g) => g.title === 'Response to intention to grant' && g.dateStr === '08.09.2023' && g.size === 5), 'Timeline doc grouping should mirror the receipt-inclusive grant-response packet labels from the shared doc model');

const repeatedGrantControlPreview = hooks.doclistGroupingPreview(loadFixtureDocument(['cases', 'EP24189818', 'doclist.html'], 'https://register.epo.org/application?number=EP24189818&tab=doclist&lng=en'));
assert(repeatedGrantControlPreview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '18.11.2025' && g.size === 6), 'Repeated-grant control should expose the latest 18.11.2025 grant packet as its own grouped cycle');
assert(repeatedGrantControlPreview.some((g) => g.label === 'Response to intention to grant' && g.dateStr === '15.10.2025' && g.size === 2), 'Repeated-grant control should keep same-day R71 response rows and receipt together');
assert(repeatedGrantControlPreview.some((g) => g.label === 'Intention to grant (R71(3) EPC)' && g.dateStr === '07.10.2025' && g.size === 3), 'Repeated-grant control should keep the earlier 07.10.2025 grant packet separate from later grant-response rows');

const euroPctPreview = hooks.doclistGroupingPreview(loadFixtureDocument(['cases', 'EP24837586', 'doclist.html'], 'https://register.epo.org/application?number=EP24837586&tab=doclist&lng=en'));
assert(euroPctPreview.some((g) => g.label === 'Response to search' && g.dateStr === '09.09.2025' && g.size === 5), 'Doclist grouping should keep same-day search-response packets together, including the receipt');
assert(euroPctPreview.some((g) => g.label === 'Filing package' && g.dateStr === '26.06.2025' && g.size === 4), 'Doclist grouping should treat the Euro-PCT entry-day bundle as one filing package instead of splitting the ISR copy away');
assert(euroPctPreview.some((g) => g.label === 'International search / IPRP' && g.dateStr === '05.06.2025' && g.size === 5), 'Doclist grouping should relabel the full IPRP/ISA packet with a PCT-aware label instead of the generic search-package wording');
assert(euroPctPreview.some((g) => g.label === 'Partial international search' && g.dateStr === '15.04.2025' && g.size === 2), 'Doclist grouping should relabel partial-ISR packets with a PCT-aware label instead of the generic search-package wording');
assert(euroPctPreview.some((g) => g.label === 'Filing package' && g.dateStr === '19.12.2024' && g.size === 8), 'Doclist grouping should consolidate the Euro-PCT filing-day packet into one filing package');

const euroPctTimelinePreview = hooks.timelineDocGroupingPreview(doclist.docs);
assert(euroPctTimelinePreview.some((g) => g.title === 'International search / IPRP' && g.dateStr === '05.06.2025' && g.size === 5), 'Timeline doc grouping should reuse the shared PCT-aware label for the full IPRP/ISA packet');
assert(euroPctTimelinePreview.some((g) => g.title === 'Partial international search' && g.dateStr === '15.04.2025' && g.size === 2), 'Timeline doc grouping should reuse the shared PCT-aware label for partial-ISR packets');

const divisionalSearchPreview = hooks.doclistGroupingPreview(loadFixtureDocument(['cases', 'EP25203732', 'doclist.html'], 'https://register.epo.org/application?number=EP25203732&tab=doclist&lng=en'));
assert(divisionalSearchPreview.some((g) => g.label === 'European search package' && g.dateStr === '25.11.2025' && g.size === 3), 'Doclist grouping should relabel standard ESR/EPO search packets with a European-specific label');

const withdrawnSearchPreview = hooks.doclistGroupingPreview(loadFixtureDocument(['cases', 'EP19205846', 'doclist.html'], 'https://register.epo.org/application?number=EP19205846&tab=doclist&lng=en'));
assert(withdrawnSearchPreview.some((g) => g.label === 'European search package' && g.dateStr === '04.05.2020' && g.size === 2), 'Doclist grouping should relabel even slim European-search packets with a European-specific label');

const syntheticSupplementarySearchDoc = new JSDOM(`<!doctype html><html><body><table><thead><tr><th><input type="checkbox"></th><th>Date</th><th>Document type</th><th>Procedure</th><th>Number of pages</th></tr></thead><tbody>
<tr><td><input type="checkbox"></td><td>04.03.2022</td><td><a>Communication regarding the transmission of the European search report</a></td><td>Search / examination</td><td>1</td></tr>
<tr><td><input type="checkbox"></td><td>04.03.2022</td><td><a>European search opinion</a></td><td>Search / examination</td><td>9</td></tr>
<tr><td><input type="checkbox"></td><td>04.03.2022</td><td><a>Information on Search Strategy</a></td><td>Search / examination</td><td>1</td></tr>
<tr><td><input type="checkbox"></td><td>04.03.2022</td><td><a>Supplementary European search report</a></td><td>Search / examination</td><td>2</td></tr>
</tbody></table></body></html>`, {
  url: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en',
}).window.document;
const syntheticSupplementarySearchPreview = hooks.doclistGroupingPreview(syntheticSupplementarySearchDoc);
assert(syntheticSupplementarySearchPreview.some((g) => g.label === 'Supplementary European search package' && g.dateStr === '04.03.2022' && g.size === 4), 'Doclist grouping should distinguish supplementary European search packets from standard ESR packets');
const syntheticSupplementaryTimelinePreview = hooks.timelineDocGroupingPreview(hooks.parseDoclist(syntheticSupplementarySearchDoc).docs);
assert(syntheticSupplementaryTimelinePreview.some((g) => g.title === 'Supplementary European search package' && g.dateStr === '04.03.2022' && g.size === 4), 'Timeline doc grouping should reuse the supplementary-European search label from the shared packet labeler');

assert.strictEqual(hooks.panelScrollRestoreOverride('EP24837586', 'options', 1092.5, 'EP24837586', 'options'), 1093, 'Sidebar rerenders within the same case/view should preserve the current scroll position instead of falling back to stale stored state');
assert.strictEqual(hooks.panelScrollRestoreOverride('EP24837586', 'options', 1092.5, 'EP24837586', 'overview'), null, 'Sidebar scroll override should not leak across view switches');
assert.strictEqual(hooks.panelScrollRestoreOverride('EP24837586', 'options', 1092.5, 'EP25203732', 'options'), null, 'Sidebar scroll override should not leak across case switches');

const syntheticTransferDoc = new JSDOM(`<!doctype html><html><body><table><thead><tr><th><input type="checkbox"></th><th>Date</th><th>Document type</th><th>Procedure</th><th>Number of pages</th></tr></thead><tbody>
<tr><td><input type="checkbox"></td><td>06.12.2022</td><td><a>(Electronic) Receipt</a></td><td>Search / examination</td><td>1</td></tr>
<tr><td><input type="checkbox"></td><td>06.12.2022</td><td><a>Annexes in respect of a client data request</a></td><td>Search / examination</td><td>3</td></tr>
<tr><td><input type="checkbox"></td><td>06.12.2022</td><td><a>Letter accompanying subsequently filed items</a></td><td>Search / examination</td><td>1</td></tr>
<tr><td><input type="checkbox"></td><td>06.12.2022</td><td><a>Submission concerning a transfer of rights (applicant)</a></td><td>Search / examination</td><td>1</td></tr>
</tbody></table></body></html>`, {
  url: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en',
}).window.document;
const syntheticTransferPreview = hooks.doclistGroupingPreview(syntheticTransferDoc);
assert(syntheticTransferPreview.some((g) => g.label === 'Transfer / recordal filings' && g.dateStr === '06.12.2022' && g.size === 4), 'Doclist grouping should use a specific transfer/recordal packet label for same-day register-admin bundles');

const syntheticFilingDeficiencyDoc = new JSDOM(`<!doctype html><html><body><table><thead><tr><th><input type="checkbox"></th><th>Date</th><th>Document type</th><th>Procedure</th><th>Number of pages</th></tr></thead><tbody>
<tr><td><input type="checkbox"></td><td>19.08.2024</td><td><a>(Electronic) Receipt</a></td><td>Search / examination</td><td>1</td></tr>
<tr><td><input type="checkbox"></td><td>19.08.2024</td><td><a>Reply to the invitation to remedy deficiencies</a></td><td>Search / examination</td><td>1</td></tr>
</tbody></table></body></html>`, {
  url: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en',
}).window.document;
const syntheticFilingDeficiencyPreview = hooks.doclistGroupingPreview(syntheticFilingDeficiencyDoc);
assert(syntheticFilingDeficiencyPreview.some((g) => g.label === 'Filing-deficiency response' && g.dateStr === '19.08.2024' && g.size === 2), 'Doclist grouping should relabel applicant filing packets that answer an invitation to remedy deficiencies');
const syntheticFilingDeficiencyTimelinePreview = hooks.timelineDocGroupingPreview(hooks.parseDoclist(syntheticFilingDeficiencyDoc).docs);
assert(syntheticFilingDeficiencyTimelinePreview.some((g) => g.title === 'Filing-deficiency response' && g.dateStr === '19.08.2024' && g.size === 2), 'Timeline doc grouping should reuse the filing-deficiency response label from the shared packet labeler');

const syntheticArt94Doc = new JSDOM(`<!doctype html><html><body><table><thead><tr><th><input type="checkbox"></th><th>Date</th><th>Document type</th><th>Procedure</th><th>Number of pages</th></tr></thead><tbody>
<tr><td><input type="checkbox"></td><td>07.08.2023</td><td><a>Communication from the Examining Division pursuant to Article 94(3) EPC</a></td><td>Search / examination</td><td>5</td></tr>
<tr><td><input type="checkbox"></td><td>07.08.2023</td><td><a>Annex to the communication from the Examining Division pursuant to Article 94(3) EPC</a></td><td>Search / examination</td><td>2</td></tr>
<tr><td><input type="checkbox"></td><td>11.12.2023</td><td><a>Reply to a communication from the Examining Division</a></td><td>Search / examination</td><td>3</td></tr>
<tr><td><input type="checkbox"></td><td>11.12.2023</td><td><a>Claims</a></td><td>Search / examination</td><td>8</td></tr>
<tr><td><input type="checkbox"></td><td>11.12.2023</td><td><a>Amended description with annotations</a></td><td>Search / examination</td><td>12</td></tr>
</tbody></table></body></html>`, {
  url: 'https://register.epo.org/application?number=EP00000000&tab=doclist&lng=en',
}).window.document;
const syntheticArt94Preview = hooks.doclistGroupingPreview(syntheticArt94Doc);
assert(syntheticArt94Preview.some((g) => g.label === 'Examination communication' && g.dateStr === '07.08.2023' && g.size === 2), 'Doclist grouping should keep same-date Art. 94(3) communication rows together');
assert(syntheticArt94Preview.some((g) => g.label === 'Response to examination communication' && g.dateStr === '11.12.2023' && g.size === 3), 'Doclist grouping should promote same-date applicant claims/amendments into the Art. 94(3) response packet');

const syntheticArt94Doclist = hooks.parseDoclist(syntheticArt94Doc);
const syntheticArt94TimelinePreview = hooks.timelineDocGroupingPreview(syntheticArt94Doclist.docs, {
  scanned: [{
    title: 'Communication from the Examining Division pursuant to Article 94(3) EPC',
    dateStr: '07.08.2023',
    category: 'Art. 94(3) response period',
  }],
});
assert(syntheticArt94TimelinePreview.some((g) => g.title === 'Art. 94(3) communication' && g.dateStr === '07.08.2023' && g.size === 2), 'Timeline doc grouping should use PDF/OCR-derived Art. 94(3) labels when a scanned communication category is available');

assert.strictEqual(hooks.upcRegistryNoteText({ status: 'No registry match found', patentNumbers: ['EP3816364'] }), 'Registry checked for EP3816364.', 'UPC overview note should mention checked EP publication candidates instead of rendering undefined');
assert.strictEqual(hooks.upcRegistryNoteText(null, { ueStatus: 'The application is deemed to be withdrawn' }), 'Taken from UP/legal data where available.', 'UPC overview note should retain the UP/legal fallback when no UPC registry result is cached');
assert.strictEqual(hooks.upcUePresentationModel({ ueStatus: 'The application is deemed to be withdrawn' }, { status: 'No registry match found', patentNumbers: ['EP3816364'] }, { status: 'The application is deemed to be withdrawn' }).unitaryEffect, 'No unitary effect record', 'UPC/UE presentation should not parrot overall withdrawn status as if it were a unitary-effect record');
assert.strictEqual(hooks.upcUePresentationModel({ ueStatus: 'The application is deemed to be withdrawn' }, { status: 'No registry match found', patentNumbers: ['EP3816364'] }, { status: 'The application is deemed to be withdrawn' }).upcRegistryStatus, 'No registry match found', 'UPC/UE presentation should surface explicit UPC registry status separately from unitary-effect wording');
assert.strictEqual(hooks.pdfCategoryBundleLabel('Art. 94(3) response period', 'Examination communication'), 'Art. 94(3) communication', 'PDF-derived categories should be able to upgrade generic examination communication labels');
assert.strictEqual(hooks.timelineSubtitleText({ detail: 'published on 17.07.2024 [2024/29]\nEvent history', source: 'Event history', actor: 'EPO' }), 'published on 17.07.2024 [2024/29] · Event history · EPO', 'Timeline subtitle rendering should dedupe repeated source/detail labels even when the duplicate source tag arrives on a new line');
assert.strictEqual(hooks.timelineSubtitleText({ detail: 'Formalities / other', source: 'Documents', actor: 'Other' }), 'Formalities / other · Documents', 'Timeline subtitle rendering should omit the useless actor=Other tail for generic document items');
assert.deepStrictEqual(hooks.classifyDocument('Decision to allow further processing', 'Examination'), { bundle: 'Further processing', actor: 'EPO', level: 'warn' }, 'Document classification should use the normalized doc-signal path for further-processing decisions');
assert.deepStrictEqual(hooks.classifyDocument('Decision to grant a European patent', 'Examination'), { bundle: 'Grant decision', actor: 'EPO', level: 'ok' }, 'Document classification should use the normalized doc-signal path for grant decisions');
assert.deepStrictEqual(hooks.classifyDocument('Application deemed to be withdrawn (non-entry into European phase)', 'Examination'), { bundle: 'Euro-PCT non-entry failure', actor: 'EPO', level: 'bad' }, 'Document classification should use the normalized doc-signal path for Euro-PCT non-entry losses');
assert.strictEqual(hooks.genericDocLabel({ title: 'Application deemed to be withdrawn ( translations of claims/payment missing)', bundle: 'Examination' }), 'Grant-formalities failure', 'Generic document labels should distinguish grant-formality failures from broader loss-of-rights wording');
assert.strictEqual(hooks.genericDocLabel({ title: 'Application deemed to be withdrawn (non-entry into European phase)', bundle: 'Examination' }), 'Euro-PCT non-entry failure', 'Generic document labels should expose Euro-PCT non-entry failures directly');
assert.strictEqual(hooks.genericDocLabel({ title: 'Decision to allow further processing', bundle: 'Other' }), 'Further processing', 'Generic document labels should promote further-processing decisions out of the raw Other bucket');
assert.strictEqual(hooks.genericDocLabel({ title: 'Communication to designated inventor', bundle: 'Other' }), 'Inventor notification', 'Generic document labels should upgrade common filing-formality rows beyond the raw Other bucket');
assert.strictEqual(hooks.docPacketExplanation('Extended European search package'), 'European search packet including an extended-ESR annex.', 'Packet explanations should give the user a clearer explanation of extended search bundles');
assert.strictEqual(hooks.familyRoleSummary({ applicationType: 'Divisional', parentCase: 'EP3440098', divisionalChildren: ['EP25215625'] }).label, 'Divisional child with descendants', 'Family-role summaries should distinguish divisional children that already have their own descendants');
const conflictMain = hooks.parseMain(loadFixtureDocument(['cases', 'EP23182542', 'main.html'], 'https://register.epo.org/application?number=EP23182542&tab=main&lng=en'), 'EP23182542');
const conflictDoclist = hooks.parseDoclist(loadFixtureDocument(['cases', 'EP23182542', 'doclist.html'], 'https://register.epo.org/application?number=EP23182542&tab=doclist&lng=en'));
const conflictEvent = hooks.parseEventHistory(loadFixtureDocument(['cases', 'EP23182542', 'event.html'], 'https://register.epo.org/application?number=EP23182542&tab=event&lng=en'), 'EP23182542');
const conflictLegal = hooks.parseLegal(loadFixtureDocument(['cases', 'EP23182542', 'legal.html'], 'https://register.epo.org/application?number=EP23182542&tab=legal&lng=en'), 'EP23182542');
const conflictPosture = hooks.proceduralPostureModel(conflictMain, conflictDoclist.docs, conflictEvent, conflictLegal);
assert.strictEqual(conflictPosture.label, 'Granted', 'Procedural posture should keep the current granted state after further processing cures an earlier adverse event');
assert.strictEqual(conflictPosture.recoveredBeforeGrant, true, 'Procedural posture should detect that the case recovered from an adverse posture before grant');
assert(/Recovered from earlier grant-formalities failure via further processing before grant\./.test(conflictPosture.note), 'Procedural posture note should explain the recovery path in plain language for conflict-history cases');
const recoveryMain = hooks.parseMain(loadFixtureDocument(['cases', 'EP23758527', 'main.html'], 'https://register.epo.org/application?number=EP23758527&tab=main&lng=en'), 'EP23758527');
const recoveryDoclist = hooks.parseDoclist(loadFixtureDocument(['cases', 'EP23758527', 'doclist.html'], 'https://register.epo.org/application?number=EP23758527&tab=doclist&lng=en'));
const recoveryEvent = hooks.parseEventHistory(loadFixtureDocument(['cases', 'EP23758527', 'event.html'], 'https://register.epo.org/application?number=EP23758527&tab=event&lng=en'), 'EP23758527');
const recoveryLegal = hooks.parseLegal(loadFixtureDocument(['cases', 'EP23758527', 'legal.html'], 'https://register.epo.org/application?number=EP23758527&tab=legal&lng=en'), 'EP23758527');
const recoveryPosture = hooks.proceduralPostureModel(recoveryMain, recoveryDoclist.docs, recoveryEvent, recoveryLegal);
assert.strictEqual(recoveryPosture.recovered, true, 'Procedural posture should detect recovery from deemed-withdrawn non-reply cases after further processing');
assert(/Recovered from earlier no reply to the written opinion via further processing\./.test(recoveryPosture.note), 'Procedural posture note should explain the recovery path for revived written-opinion loss cases');
const grantTextClassification = hooks.classifyDocument('Text intended for grant (version for approval)', 'Search / examination');
assert.strictEqual(grantTextClassification.bundle, 'Grant package', 'Grant-text communication rows should remain in the grant-package bucket');
assert.strictEqual(grantTextClassification.level, 'warn', 'Grant-text communication rows should retain the expected grant-package severity');
assert.strictEqual(grantTextClassification.actor, 'EPO', 'Grant-text communication rows should remain EPO grant-package items instead of being misclassified as applicant responses');
assert.strictEqual(hooks.shouldAppendSingleRunLabel('Loss-of-rights communication', 'Examination'), false, 'Single-item timeline rows should not append broad run labels when a stronger upgraded label already exists');
assert.strictEqual(hooks.overviewPartialState({ sources: { main: { status: 'empty' }, doclist: { status: 'ok' }, event: { status: 'ok' }, family: { status: 'empty' }, legal: { status: 'empty' }, federated: { status: 'empty' }, citations: { status: 'empty' }, ueMain: { status: 'empty' } } }).note, 'Main Register data is temporarily unavailable. Showing partial data from doclist, event history. Still empty: family, legal status, federated, citations, UE/UPC.', 'Overview should explain partial-data states in plain language when the main Register source is empty');
assert.strictEqual(hooks.normalizeOptions({}).showPublications, false, 'Timeline publications should default to off');
assert.strictEqual(hooks.normalizeOptions({}).showEventHistory, false, 'Timeline event-history rows should default to off');
assert.strictEqual(hooks.normalizeOptions({}).showLegalStatusRows, false, 'Timeline legal-status rows should default to off');
assert.strictEqual(hooks.normalizeOptions({ doclistGroupsExpandedByDefault: 'off' }).doclistGroupsExpandedByDefault, false, 'Options normalization should accept falsey string forms for the new doclist default-open toggle');
assert.strictEqual(hooks.refineDocumentClassification('Communication concerning the reminder according to rule 39(1) EPC and the invitation pursuant to rule 45 EPC', 'Search / examination', { bundle: 'Response to search', actor: 'Applicant', level: 'warn' }).actor, 'EPO', 'Reminder/formalities rows should stay on the EPO side even if the broad classifier drifts toward Applicant');
assert.strictEqual(hooks.sourceStatusTooltip({ sources: { main: { status: 'ok' }, doclist: { status: 'empty' } } }).includes('main Register: ok'), true, 'Source-status tooltip should expose per-source state for hover details');

const supersededDeadline = hooks.selectNextDeadline([
  { label: 'R71(3) response period', date: new Date('2024-02-10T00:00:00Z'), resolved: false, superseded: true },
], true, new Date('2026-01-01T00:00:00Z'));
assert.strictEqual(supersededDeadline, null, 'Closed/loss-of-rights cases should not keep superseded overdue periods as the active next deadline');
assert.strictEqual(hooks.activeDeadlineNoteText([
  { label: 'R71(3) response period', date: new Date('2024-02-10T00:00:00Z'), resolved: false, superseded: true },
], true), 'No active procedural deadline detected; later loss-of-rights events superseded earlier response periods.', 'Actionable status should explain why no active deadline is shown after terminal EPO events');

const pdfR71 = hooks.parsePdfDeadlineHints(loadFixtureText('pdf', 'r71_communication.txt'), {
  docDateStr: '10.01.2026',
  docTitle: 'Communication about intention to grant',
  docProcedure: 'Examining division',
});
assert.strictEqual(pdfR71.hints.length, 1, 'PDF parser should emit one R71(3) deadline hint for the sample communication');
assert.strictEqual(pdfR71.hints[0].label, 'R71(3) response period', 'PDF parser should classify Rule 71(3) communication correctly');
assert.strictEqual(pdfR71.hints[0].dateStr, '10.05.2026', 'PDF parser should derive the R71(3) deadline from communication date + 4 months');
assert.strictEqual(pdfR71.diagnostics.communicationDate, '10.01.2026', 'PDF parser should extract the communication date from the fixture letter header');

const pdfArt94Fallback = hooks.parsePdfDeadlineHints(loadFixtureText('pdf', 'art94_generic.txt'), {
  docDateStr: '01.09.2025',
  docTitle: 'Communication from the Examining Division pursuant to Article 94(3) EPC',
  docProcedure: 'Examining division',
});
assert.strictEqual(pdfArt94Fallback.hints.length, 1, 'PDF parser should produce a fallback Art. 94(3) deadline hint from metadata + communication date');
assert.strictEqual(pdfArt94Fallback.hints[0].label, 'Art. 94(3) response period', 'PDF parser should use metadata fallback to infer Art. 94(3) category');
assert.strictEqual(pdfArt94Fallback.hints[0].dateStr, '01.01.2026', 'PDF parser should apply the default 4-month Art. 94(3) period when months are not explicit');
assert(/Default 4-month period inferred/.test(pdfArt94Fallback.diagnostics.responseEvidence), 'PDF parser should record default-period fallback evidence for metadata-derived categories');

const deadlines = hooks.inferProceduralDeadlines(main, doclist.docs, eventHistory, legal, pdfR71);
assert(deadlines.some((d) => d.label === 'R71(3) response period'), 'Deadline model should derive the R71(3) cycle from live grant-communication material');
assert(deadlines.some((d) => d.label === '20-year term from filing (reference)' && d.reference === true), 'Deadline model should include filing-term reference from real Register data');

console.log('userscript parser fixture checks passed');
