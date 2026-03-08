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
hasText("const dependencyStamp = derivedDependencyStamp(caseNo, 'upcRegistry');", 'UPC refresh should compute dependency stamp from upstream state');
hasText("isFresh(cached, options().refreshHours, { allowEmpty: true, dependencyStamp })", 'UPC/PDF derived refresh should reuse fresh empty/ok cache only when dependency stamp matches');
hasText("status: 'empty'", 'Derived-source refreshers should cache explicit empty states when appropriate');
hasText('dependencyStamp,', 'Derived-source cache entries should persist dependency stamps');
hasText("await refreshUpcRegistry(caseNo, controller.signal, force);", 'Prefetch pipeline should pass force flag through to UPC refresh');

// Overview-model memoization
has(/function\s+overviewCacheKey\s*\(/, 'Overview cache key helper missing');
hasText("runtime.overviewCache = { key: cacheKey, model };", 'Overview model should be memoized');
hasText("if (runtime.overviewCache.key === cacheKey && runtime.overviewCache.model)", 'Overview model should reuse cached derived state when inputs are unchanged');

// Publication hydration should merge fallback evidence instead of only replacing on total miss
hasText('const publicationFallback = inferPublicationsFromDocs(docs);', 'Publication fallback should always be available as supplemental evidence');

console.log('userscript lifecycle checks passed');
