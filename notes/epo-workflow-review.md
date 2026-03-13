# EP-Register-Pro: Comprehensive Code & EPO-Procedure Review
 
**Review revision**: 2 (post-followup commits `95f0e0f`…`c7af009`)
**Branch reviewed**: `nemo/post-merge-followups-3` at `c7af009`
 
## 1. Executive summary
 
**Assessment**: This codebase has made significant progress on its highest-risk findings since the initial review. Seven of the nine original findings have been fully or substantially addressed. The remaining gaps are primarily in test coverage (real opposition/limitation/appeal fixtures) and lifecycle test realism.
 
**What improved since v1 review:**
 
- **Build system introduced** (`build/build-userscript.js`): `script.user.js` is now a build artifact generated from `src/userscript.source.js` + bundled `lib/` modules. The ~4,000 lines of duplicated domain logic are eliminated at the source level. This was the single largest architectural risk. *(Addresses F7)*
- **Utility centralization** (`lib/epo_v2_utils.js`): `normalize`, `parseDateString`, `dedupe`, `formatDate`, `compareDateDesc`, `isValidDate` consolidated into one module. All 16 lib files import from it. The `parseDateString` UTC/local divergence is resolved (local-time chosen, consistent with `formatDate`). The `doc_signals.js` lowercase variant is now explicitly named `normalizeLower`. *(Addresses F3, F4)*
- **Background fetches hardcoded to English** (`sourceUrl` now sets `lng=en`): Non-English Register sessions no longer produce silent parse failures for background-fetched tabs. *(Partially addresses F1)*
- **Recovery request vs decision split** in posture signals: `latestRecoveryDecision` and `latestRecoveryRequest` are now distinct. `recovered=true` requires a decision, not just a request. `recoveryPending` flag added. *(Addresses F2 partially, addresses risky assumption #3)*
- **Prefetch early-return cleanup fixed**: The no-op path now properly clears `abortController` and `fetchCaseNo` with ownership guards. *(Addresses F5)*
- **Parser diagnostics implemented**: `createParseStats` / `noteParseDrop` pattern across doclist and procedural parsers with `rowsSeen`, `rowsAccepted`, `rowsDropped`, `rowsDroppedByReason`. Warning thresholds via `parserWarningMeta`. *(Addresses F6)*
- **Confidence/provenance UI badges**: `certaintyLabel()` gates "Current posture" → "Likely current posture" / "Estimated current posture" by confidence. Provenance badges ("Exact due date" / "Derived clock" / "Monitoring window") on deadline rows. Inline disclaimers under posture and waiting-on fields. *(Addresses F2)*
 
**Remaining risks:**
 
- **Parser English-label dependency persists** in the parsing logic itself. Background fetches are now English-hardcoded (good), but the live DOM parse of the user's current tab still depends on English labels. A user browsing in German will get correct background data but broken live-tab parsing.
- **Opposition/limitation/appeal deadline logic still synthetic-only**. Zero real fixture cases.
- **Lifecycle tests remain structural**, no real async/navigation race behavior.
- **Build system fragility**: hardcoded strip lists, no automated completeness check, committed build artifact requires manual rebuild.
- **Userscript `normalize` still diverges from lib `normalize`** (preserves newlines vs collapses). This is now intentional and scoped (UI rendering vs data parsing), but worth documenting.
 
---
 
## 2. Mental model of the codebase
 
```
src/userscript.source.js (10,516 lines) — source template
├── Constants, config, EPO codex data
├── Cache/state management, localStorage lifecycle
├── Route detection, options, session, scroll persistence
├── Inline function stubs (stripped by build, replaced with lib bridges)
├── Deadline inference engine
├── Renewal model, territorial presentation
├── Overview + timeline model builders
├── Rendering functions (sidebar, doclist grouping)
├── Lifecycle/routing (history patching, observers, polling fallback)
 
build/build-userscript.js — AST-guided build pipeline
├── Parses source with acorn, locates IIFE body
├── Strips ~119 functions + ~13 constants matching hardcoded name sets
├── Injects inline CommonJS module system wrapping all 18 lib/*.js files
├── Generates bridge declarations delegating to bundled modules
├── Writes script.user.js (~13,100 lines)
 
lib/ (~6,500 lines) — canonical domain logic (18 modules)
├── epo_v2_utils.js              — centralized normalize/parseDateString/dedupe/formatDate
├── epo_v2_doclist_parser.js     — HTML table → doc entries + parseStats
├── epo_v2_main_parser.js        — Main page → structured biblio
├── epo_v2_reference_parsers.js  — Publications, family, citations
├── epo_v2_procedural_parser.js  — Legal/event → codex-mapped blocks + parseStats
├── epo_v2_document_classification.js — Doc → bundle/actor/level
├── epo_v2_doc_signals.js        — Document-level signal mapping
├── epo_v2_packet_signals.js     — Packet-level precedence logic
├── epo_v2_status_signals.js     — Status text → summary/stage
├── epo_v2_posture_signals.js    — Procedural posture (with request/decision split)
├── epo_v2_deadline_signals.js   — Full deadline inference engine
├── epo_v2_timeline_signals.js   — Timeline presentation helpers
├── epo_v2_overview_signals.js   — Actionable overview state + certaintyLabel
├── epo_v2_territorial_parser.js — UE + federated register parsers
├── epo_v2_territorial_signals.js— Territorial presentation model
├── epo_v2_upc_parser.js         — UPC opt-out HTML parser
├── epo_v2_pdf_parser.js         — PDF text → deadline hints
├── epo_v2_normalized.js         — Integration pipeline
├── epo_v2_codex_data.js         — Event/step code mappings
 
script.user.js — BUILD ARTIFACT (committed for Tampermonkey direct install)
 
tests/ (26 test files, 17 fixture cases, 2 UPC fixtures, 2 PDF fixtures)
├── epo_v2_utils.test.js         — NEW: centralized utility tests + no-duplicate assertions
├── epo_v2_runtime_parity.test.js— now validates build bridge correctness
├── (24 other test files)
```
 
**Key architectural change**: `script.user.js` is no longer hand-maintained. Edit `lib/` for domain logic, `src/userscript.source.js` for UI/lifecycle, run `npm run build` to regenerate. `npm test` runs build first.
 
---
 
## 3. Finding status tracker
 
| ID | Finding | Original severity | Status | Notes |
|----|---------|------------------|--------|-------|
| F1 | English-label parser dependency | CRITICAL | **Partially fixed** | Background fetches now hardcoded to `lng=en`. Live DOM parse of current tab still English-dependent. |
| F2 | Inference confidence vs UI certainty | HIGH | **Fixed** | `certaintyLabel()` gates wording by confidence. Provenance badges on deadlines. Inline disclaimers. Recovery request/decision split. |
| F3 | parseDateString UTC/local divergence | HIGH | **Fixed** | Centralized in `epo_v2_utils.js`, local-time consistently. |
| F4 | normalize() semantic divergence | HIGH | **Fixed (lib-side)** | All lib files use centralized `normalize`; `normalizeLower` named explicitly. Userscript version intentionally different (preserves newlines for UI). |
| F5 | Prefetch early-return cleanup bug | HIGH | **Fixed** | Early-return path now clears `abortController`/`fetchCaseNo` with ownership guards. |
| F6 | Silent row/data loss in parsers | HIGH | **Fixed** | `parseStats` with drop counters + reasons across doclist and procedural parsers. Warning thresholds. |
| F7 | Code duplication (~4,000 lines) | MEDIUM-HIGH | **Fixed** | Build system bundles lib into userscript. Source of truth is now `lib/` + `src/userscript.source.js`. |
| F8 | Opposition/limitation/appeal untested | MEDIUM-HIGH | **Open** | Still synthetic-only. No real fixture cases captured. |
| F9 | Lifecycle tests lack real async | MEDIUM | **Open** | Still structural/string assertions with stubbed timers. |
 
---
 
## 4. New findings from post-review changes
 
### F10: Build system fragility — MEDIUM
 
- **Category**: Build / maintainability
- **Location**: `build/build-userscript.js` (STRIP_FUNCTIONS, STRIP_CONSTS sets)
- **What is wrong**: The strip-by-name mechanism uses hardcoded sets of 119 function names and 13 constant names. If a new function is added to both `lib/` and the source template but not added to the strip set, the built output will contain two copies — one inline and one bundled. Several bridge functions are not simple pass-throughs (e.g., `parseMain`, `inferProceduralDeadlines`, `proceduralPostureModel` adapt signatures), so lib API changes require manual bridge updates.
- **Why it matters**: Silently broken builds can ship a userscript where the inline (stale) version shadows the bundled (current) version.
- **Recommended fix**: Add a build-time assertion that no stripped function name still appears as a declaration in the output. Or: invert the approach and strip *everything* inside a marked region, rather than maintaining a name allowlist.
 
### F11: Committed build artifact without staleness check — MEDIUM
 
- **Category**: Build / workflow
- **Location**: `script.user.js` (checked into git)
- **What is wrong**: `script.user.js` is a build artifact committed to git (for Tampermonkey direct install). If a developer changes `lib/` but forgets `npm run build`, the committed file is stale. CI runs `npm run build` as part of `npm test`, but there is no assertion that the committed `script.user.js` matches the freshly built output.
- **Recommended fix**: Add a CI check: `npm run build && git diff --exit-code script.user.js` to fail if the committed artifact is stale.
 
### F12: Vestigial re-exports in epo_v2_doclist_parser.js — LOW
 
- **Category**: Code hygiene
- **Location**: `lib/epo_v2_doclist_parser.js` (module.exports)
- **What is wrong**: Still re-exports `normalize`, `text`, `parseDateString`, `compareDateDesc`, `DATE_RE` even though all consumers now import from `epo_v2_utils.js`. No consumer imports these from doclist_parser anymore.
- **Recommended fix**: Remove vestigial re-exports.
 
### F13: doclistEntryFromRow signature divergence — LOW
 
- **Category**: Build bridge correctness
- **Location**: `lib/epo_v2_doclist_parser.js:125` (destructured options) vs `src/userscript.source.js` (positional args)
- **What is wrong**: The lib version uses `{ fallbackUrl, rowOrder, parseStats }` destructured options; the userscript source still uses positional parameters. The build bridge correctly adapts the call, but the two signatures differ — future changes to parameter ordering in one could silently break the other.
- **Recommended fix**: Align signatures or add a bridge-level test that explicitly covers all parameter combinations.
 
### F14: Main parser fallback heuristic over-matching risk — LOW
 
- **Category**: Parser correctness
- **Location**: `lib/epo_v2_main_parser.js` (`fallbackPublicationField`, `fallbackRecentEventField`)
- **What is wrong**: These heuristics were tightened in `ddf6582` (two-tier publication regex, `status|former` exclusion, date-anchor + content-length check for events). Good improvements, but the two-tier publication fallback is somewhat hard to reason about and could still produce false matches on edge cases.
- **Impact**: Low — these are fallbacks only used when structured extraction fails.
 
---
 
## 5. EPO-procedure audit (updated)
 
### Assumptions that are correct
 
1–11 from v1 review remain correct. No regressions.
 
Additionally verified:
- **Recovery request vs decision distinction** is now properly modeled. `recovered=true` requires `FURTHER_PROCESSING_DECISION` or equivalent text. `recoveryPending` correctly flags cases where only a request exists.
- **`certaintyLabel` gating** correctly applies "Likely" prefix for medium confidence, "Estimated" for low. Posture confidence correctly degrades when `mainSourceStatus !== 'ok'` or `posture.partial` is set.
 
### Assumptions that are risky (updated)
 
Items #1 (waiting-on wording), #2 (posture-over-status), #4 (English decoding), #5 (R71(3) resolved-by), #6 (Art. 94(3) fallback), #7 (priority parse order), #8 (7-day safeguard) from v1 remain unchanged.
 
Item #3 (recovery conflation) is **resolved** — recovery now correctly distinguishes request from decision.
 
**New risky assumption**: The `waitingOn` derivation now also triggers on `posture.recoveryPending`, which is good, but the `recoveryPending` flag depends on codex key `FURTHER_PROCESSING_REQUEST` — if the Register uses a different code or wording for the request event, the pending state won't be detected.
 
---
 
## 6. Parser and data-source audit (updated)
 
### Improvements since v1
 
- **Parser diagnostics**: `parseStats` objects with `rowsSeen`, `rowsAccepted`, `rowsDropped`, `rowsDroppedByReason` on both doclist and procedural parsers. Attached via `Object.defineProperty` (non-enumerable, doesn't pollute serialization). `parserWarningMeta` function generates warnings when drop rates are anomalous.
- **Main parser fallback tightening**: Publication field requires kind code within 24 chars or falls back to secondary tier. Recent event field excludes `status|former` labels and requires date-anchored content of minimum length.
- **Recent event inline data**: Date lines that also contain title text (e.g., `30.01.2026\nLapse of patent...`) now correctly capture the trailing text as the title. `normalizeRecentEventEntry` strips metadata suffixes (`New state(s):`, publication dates) from titles into detail.
 
### Remaining fragility (unchanged)
 
- English-label dependency in live DOM parsing (background fetches are now safe)
- Checkbox selector for doclist rows
- Structured time-limit month words English-only
- UPC parser exact-string matching
 
---
 
## 7. Test coverage audit (updated)
 
### What improved
 
- **26 test files** (was 25), new `epo_v2_utils.test.js` with no-duplicate-definition assertions
- **Parser diagnostics tested**: parseStats output validated on doclist and procedural parsers
- **Posture recovery split tested**: New assertions for `recoveryPending`, `latestRecoveryDecision` vs `latestRecoveryRequest`
- **Parity tests now validate build bridge correctness**, not just manual synchronization
- **Regression tests tightened**: `hasText` → `has(regex)` for more specific function-signature matching, including `certaintyLabel`, `overviewPresentationHints`
 
### What is still not covered well enough
 
- **Real opposition/limitation/appeal**: Still synthetic-only. **P1 gap.**
- **Lifecycle races**: Still structural/stubbed. No real async/nav race tests.
- **Locale variation**: No German/French fixtures (though background fetches are now safe).
- **Direct EP baseline**: Still queued, not captured.
- **Build staleness**: No CI check that committed `script.user.js` matches fresh build output.
 
### Updated prioritized missing-case matrix
 
| Priority | Missing fixture | Risk |
|----------|----------------|------|
| P1 | Real opposition case (Rule 79, 82, oral proceedings, decision) | Highest-stakes deadlines untested |
| P1 | Real limitation case (Rule 95, LIRE communication) | Untested on real data |
| P1 | Real appeal case (notice, grounds, decision) | Untested on real data |
| P1 | Direct EP baseline with full tabs (EP23160622 queued) | No baseline for most common filing type |
| P2 | Parent/divisional tab completion (EP19871250 legal/doclist) | Key parent fixture incomplete |
| P2 | Non-UP grant baseline (EP17751711 missing) | No comparison case |
| P3 | Locale fixtures for `lng=de` and `lng=fr` | Live DOM parse failure untested |
| P3 | Heavy legal-history stress fixture (multi-cycle loss/recovery) | Edge case sequencing |
 
---
 
## 8. Refactor plan (updated)
 
### Completed
 
1. ~~Fix prefetch no-op cleanup path~~ — Done in `95f0e0f`
2. ~~Hard-code `lng=en` in `sourceUrl`~~ — Done in `95f0e0f`
3. ~~Centralize `normalize`, `dedupe`, `parseDateString`, `formatDate`~~ — Done in `866ce92`
4. ~~Add parser drop diagnostics~~ — Done in `ddf6582`
5. ~~Add confidence badge rendering~~ — Done in `95f0e0f`
6. ~~Distinguish "recovery requested" from "recovery decided"~~ — Done in `95f0e0f`
7. ~~Add provenance badges to actionable overview status~~ — Done in `95f0e0f`
8. ~~Collapse runtime/lib duplication via build step~~ — Done in `c7af009`
 
### Still open
 
9. **Harden UPC parser** to normalize EP numbers with optional separators/spaces.
10. **Introduce locale-aware label maps** and parser strategy by `lng` for live DOM parsing.
11. **Capture real opposition/limitation/appeal fixture cases** + assertions.
12. **Add lifecycle behavior tests** with real timers/navigation simulation.
13. **Capture direct-EP baseline** (EP23160622) + parent/divisional tab completion.
14. **Add CI build-staleness check** (`npm run build && git diff --exit-code script.user.js`).
15. **Add build-time strip-completeness assertion** (no stripped function name appears as declaration in output).
16. **Remove vestigial re-exports** from `epo_v2_doclist_parser.js`.
 
---
 
## 9. Concrete change list (remaining)
 
1. Harden UPC patent number matching against format variants (spaces, dashes, dots).
2. Introduce locale label map for live DOM parsing (at minimum en/de/fr).
3. Add CI check: `npm run build && git diff --exit-code script.user.js`.
4. Add build-time assertion: no stripped function still declared in output.
5. Capture real opposition/limitation/appeal fixtures + assertions.
6. Capture direct-EP baseline (EP23160622) + EP19871250 missing tabs.
7. Add lifecycle behavior tests with real async hooks.
8. Remove vestigial re-exports from `epo_v2_doclist_parser.js`.
9. Align `doclistEntryFromRow` signature between lib and source template.
 
---
 
## 10. Optional patch candidates (remaining, in priority order)
 
1. **PR: Real opposition/limitation/appeal fixture cases** — Closes the most dangerous testing gap. (`tests/fixtures/`)
 
2. **PR: CI build-staleness + strip-completeness checks** — Prevents silent build drift. (`build/`, CI config)
 
3. **PR: Harden UPC number matching** — Prevents false-negative opt-out detection. (`lib/epo_v2_upc_parser.js`)
 
4. **PR: Locale-aware live DOM parsing** — Prevents broken live-tab parse for non-English users. (`lib/epo_v2_main_parser.js`, `lib/epo_v2_procedural_parser.js`)
 
5. **PR: Lifecycle race test harness** — Validates prefetch/cancel/re-entry under realistic conditions. (`tests/`)
 
6. **PR: Direct-EP + parent/divisional fixture completion** — Fills remaining coverage matrix gaps. (`tests/fixtures/`)
 
7. **PR: Code cleanup (vestigial re-exports, signature alignment)** — Housekeeping. (`lib/epo_v2_doclist_parser.js`, `src/userscript.source.js`)
 
---
 
## 11. EPO legal framework notes
 
### Rule 126(2) / 127(2) / 131(2) EPC — post-November 2023 regime
 
As of 1 November 2023, the EPO abolished the "10-day rule" (the former notification fiction under Rule 126(2) EPC). Under the amended rules:
 
- Documents from the EPO are deemed notified on the **date printed on the document**, regardless of postal or electronic delivery method.
- Deadlines for response run from the document date directly. The former +10 day offset no longer applies to any communication dated 1 November 2023 or later.
- A **7-day safeguard** exists: if the EPO cannot prove delivery within 7 days of the document date, the response period is extended by the excess days. This is an exceptional circumstance that cannot be modeled from Register data alone.
 
The codebase's current deadline computation — anchoring to `dispatchDate` directly without adding 10 days — is **correct** under the current legal framework.
 
**Source**: OJ EPO 2023, A29 (CA/D 10/22); amended Rules 126(2), 127(2), 131(2) EPC, effective 1 November 2023.
 
---
 
## Checks performed
 
- `node --check script.user.js` — passed
- `node --check src/userscript.source.js` — passed
- `npm install` — clean (acorn added as devDependency)
- `npm test` (includes `npm run build`) — all 26 test files passed
- Manual code review of all 4 post-review commits (`95f0e0f`, `ddf6582`, `866ce92`, `c7af009`)
- Verification of finding resolution against updated source
- Verification of EPO procedural assumptions against current EPC Implementing Regulations
