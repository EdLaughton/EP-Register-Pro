const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync('script.user.js', 'utf8');

function has(re, message) {
  assert(re.test(src), message);
}

function hasText(text, message) {
  assert(src.includes(text), message);
}

// Freshness / cache reuse semantics
has(/function\s+isFresh\(src,\s*refreshHours,\s*config\s*=\s*\{\}\)/, 'Freshness helper should support config for reusable statuses / dependency stamps');
hasText("const reusableStatuses = allowEmpty ? new Set(['ok', 'empty']) : new Set(['ok']);", 'Error sources must not be treated as fresh');
hasText("if (config.dependencyStamp != null && String(src?.dependencyStamp || '') !== String(config.dependencyStamp || '')) return false;", 'Freshness helper should invalidate derived cache when upstream dependency stamp changes');

// Lifecycle / route safety
has(/function\s+clearDerivedCaches\s*\(/, 'Derived-view cache reset helper missing');
has(/function\s+resetRouteRuntime\s*\(/, 'Route reset helper missing');
hasText('resetRouteRuntime();', 'Leaving a case page should reset case-scoped runtime state');
hasText("runtime.appNo = '';", 'Non-case render/reset path should clear active case number');
has(/function\s+scheduleInit\s*\(force = false\)/, 'Debounced init scheduler missing');
has(/function\s+installRouteObservers\s*\(/, 'Route observer installer missing');
hasText("for (const method of ['pushState', 'replaceState'])", 'Route observers should hook history state changes');
hasText('setInterval(handleLocationChange, 1500);', 'Route observers should keep only a slower fallback poll');
hasText("addEventListener('pageshow', () => {", 'Pageshow should reschedule init for bfcache / re-entry');
hasText('scheduleInit(false);', 'Route/pageshow handling should use debounced init scheduling');

// Derived-source dedupe
has(/function\s+storeCaseSource\s*\(/, 'Centralized source-write helper missing');
hasText("const dependencyStamp = derivedDependencyStamp(caseNo, 'upcRegistry');", 'UPC refresh should compute dependency stamp from upstream state');
has(/function\s+casePublications\s*\(/, 'Publication evidence should be centralized behind a casePublications helper');
hasText('Prefer explicit main-page publications, then supplement from case-local doclist evidence.', 'UPC candidate selection should document the main+doclist publication priority');
hasText("for (const p of casePublications(c, { docs, includeFamily: false }))", 'UPC candidate selection should reuse centralized case-local publication evidence without widening to family publications');
hasText("isFresh(cached, options().refreshHours, { allowEmpty: true, dependencyStamp })", 'UPC/PDF derived refresh should reuse fresh empty/ok cache only when dependency stamp matches');
hasText("status: 'empty'", 'Derived-source refreshers should cache explicit empty states when appropriate');
hasText('dependencyStamp,', 'Derived-source cache entries should persist dependency stamps');
hasText("await refreshUpcRegistry(caseNo, controller.signal, force);", 'Prefetch pipeline should pass force flag through to UPC refresh');
hasText('let hadResponse = false;', 'UPC refresh should distinguish real empty results from complete request failure');
hasText("status: 'error'", 'Derived-source refreshers should persist error states when all candidate requests fail');
hasText('let failedCandidates = 0;', 'PDF refresh should track per-candidate failures instead of collapsing all-zero-hint outcomes into empty');
has(/function\s+derivePdfDeadlineStatus\s*\(/, 'PDF refresh should derive status from successful-vs-failed candidate scans through a dedicated helper');

// Overview-model memoization
hasText("{ key: 'federated', slug: 'federated', title: 'EP Federated register' }", 'Federated register should be a first-class cached source');
hasText("{ key: 'citations', slug: 'citations', title: 'EP Citations' }", 'Citations should be a first-class cached source');
has(/function\s+parseFederated\s*\(/, 'Federated-register parser missing');
has(/function\s+parseCitations\s*\(/, 'Citations parser missing');
has(/function\s+sectionRowsByHeader\s*\(/, 'Header-rowspan section extraction should be centralized for real Register table parsing');
has(/function\s+parseMainPublications\s*\(/, 'Main-page publication parsing should handle multi-row Register publication tables');
has(/function\s+caseSnapshot\s*\(/, 'Case-source reads should be centralized behind a caseSnapshot helper');
has(/function\s+overviewCacheKey\s*\(/, 'Overview cache key helper missing');
hasText("runtime.overviewCache = { key: cacheKey, model };", 'Overview model should be memoized');
hasText("if (runtime.overviewCache.key === cacheKey && runtime.overviewCache.model)", 'Overview model should reuse cached derived state when inputs are unchanged');
has(/function\s+compactOverviewTitle\s*\(/, 'Overview renderer should centralize noisy document-title cleanup behind a compaction helper');
has(/function\s+renderOverviewHeaderCard\s*\(/, 'Overview renderer should be split into maintainable sub-renderers');
has(/function\s+renderOverviewActionableCard\s*\(/, 'Actionable-status overview card should be isolated from the top-level renderer');
has(/function\s+renderOverviewFederatedCard\s*\(/, 'Federated-register summary should have a dedicated overview renderer');
has(/function\s+renderOverviewCitationsCard\s*\(/, 'Compact citations section should have a dedicated overview renderer');
hasText("termReferenceDate ? `20-year term ${termReferenceDate}` : ''", 'Overview header should show 20-year term date without extra years-remaining noise');
hasText("showCitations: true,", 'Citations panel should be controllable via options');

// Publication hydration should merge fallback evidence instead of only replacing on total miss
hasText('const publicationFallback = includeDocFallback ? inferPublicationsFromDocs(docs) : [];', 'Publication fallback should always be available as centralized supplemental evidence');

// Fifth-pass structural refactors
has(/function\s+buildDeadlineComputationContext\s*\(/, 'Deadline derivation should be organized around a shared computation context');
has(/function\s+appendCoreCommunicationDeadlines\s*\(/, 'Core deadline families should be factored out of inferProceduralDeadlines');
has(/function\s+pdfDeadlineCandidates\s*\(/, 'PDF deadline candidate selection should be isolated from the main refresh flow');
has(/function\s+scanPdfDeadlineCandidate\s*\(/, 'Per-document PDF scanning should be isolated from refresh orchestration');
has(/function\s+ensureDoclistFilterWrap\s*\(/, 'Doclist filter UI setup should be isolated from group rebuild logic');
has(/function\s+attachDoclistGroupRun\s*\(/, 'Doclist group DOM wiring should be isolated from group discovery');

console.log('userscript lifecycle checks passed');
