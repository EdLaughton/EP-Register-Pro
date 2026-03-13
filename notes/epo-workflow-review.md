# EP-Register-Pro: Comprehensive Code & EPO-Procedure Review

## 1. Executive summary

**Bluntly:** this is a sophisticated but high-risk legal-tech codebase that is still too brittle in key places for procedural-grade trust.

**Strengths:**

- Broad feature set spanning 8 base sources (`main`/`doclist`/`event`/`family`/`legal`/`federated`/`citations`/`ueMain`) plus 2 derived sources (`upcRegistry`/`pdfDeadlines`), with cache lifecycle work and extensive fixture-driven tests.
- Good intent around derived-source freshness, dependency stamps, and confidence metadata for deadlines.
- Recent extraction of shared lib modules with parity testing is a clear improvement over a fully monolithic single-file approach.
- Deadline computation correctly reflects the post-November 2023 abolition of the Rule 126(2) 10-day notification fiction: dispatch-date-anchored deadlines use the dispatch date directly as the deemed notification date, consistent with amended Rules 126(2), 127(2), and 131(2) EPC (OJ EPO 2023, A29).

**Main risks:**

- **Language/markup brittleness** across core parsers: strong English-label dependency means non-English Register views cause silent total data loss.
- **Inference confidence vs UI certainty mismatch**: "Current posture," "Waiting on," and some deadline/renewal statements read more authoritative than the underlying evidence supports.
- **State/lifecycle edge-case bug** in the prefetch completion path when all sources are already fresh (stale abort controller left dangling).
- **Structural duplication crisis**: ~4,000 lines of domain logic exist in both `script.user.js` and `lib/`, with parity tests acting as a synchronization safety net rather than eliminating duplication. The `normalize()` function in the userscript is semantically different from all lib versions (preserves newlines vs collapses all whitespace), and `parseDateString` has a UTC vs local-time divergence.
- **Coverage holes** for the highest-risk procedural families: opposition, limitation, appeal (synthetic-only), plus missing tabs for key parent/child controls and no direct-EP baseline fixture.

---

## 2. Mental model of the codebase

```
script.user.js (10,200 lines) — Tampermonkey userscript
├── Constants, config, EPO codex data (~2,300 lines)
├── Cache/state management, localStorage lifecycle
├── Route detection, options, session, scroll persistence
├── Inline re-implementations of all lib parsers (~3,500 lines)
│   ├── main/doclist/event/legal/family/citations/UE/federated parsers
│   ├── document classification, doc/packet signals
│   ├── UPC parser, PDF parser + OCR pipeline
│   └── status/posture/timeline/overview signals
├── Deadline inference engine (~1,600 lines)
├── Renewal model, territorial presentation
├── Overview + timeline model builders
├── Rendering functions (sidebar, doclist grouping)
├── Lifecycle/routing (history patching, observers, polling fallback)

lib/ (~6,500 lines) — extracted shared modules
├── epo_v2_doclist_parser.js     — HTML table → doc entries
├── epo_v2_main_parser.js        — Main page → structured biblio
├── epo_v2_reference_parsers.js  — Publications, family, citations
├── epo_v2_procedural_parser.js  — Legal/event → codex-mapped blocks
├── epo_v2_document_classification.js — Doc → bundle/actor/level
├── epo_v2_doc_signals.js        — Document-level signal mapping
├── epo_v2_packet_signals.js     — Packet-level precedence logic
├── epo_v2_status_signals.js     — Status text → summary/stage
├── epo_v2_posture_signals.js    — Procedural posture derivation
├── epo_v2_deadline_signals.js   — Full deadline inference engine
├── epo_v2_timeline_signals.js   — Timeline presentation helpers
├── epo_v2_overview_signals.js   — Actionable overview state
├── epo_v2_territorial_parser.js — UE + federated register parsers
├── epo_v2_territorial_signals.js— Territorial presentation model
├── epo_v2_upc_parser.js         — UPC opt-out HTML parser
├── epo_v2_pdf_parser.js         — PDF text → deadline hints
├── epo_v2_normalized.js         — Integration pipeline
├── epo_v2_codex_data.js         — Event/step code mappings

tests/ (25 test files, 17 fixture cases, 2 UPC fixtures, 2 PDF fixtures)
```

**Data flow:**

1. Route detection → case number + tab slug extraction
2. Live DOM parse OR background fetch of 6+ tabs → raw HTML
3. Per-tab parsers → structured data
4. Document classification → bundle/actor assignment
5. Codex mapping → internal keys + phase/classification
6. Procedural posture derivation (from docs + events + legal + status)
7. Deadline inference engine (from all sources + PDF hints)
8. Derived fetches: UPC registry lookup, PDF deadline scanning
9. Overview/timeline model builders → rendered sidebar + doclist grouping

**State/cache:**

- Per-case `localStorage` cache with `parserVersion`, `fetchedAt`, `status` semantics
- Freshness checks gate on status (`ok`/`empty`/`notfound`), parser version, age, and dependency stamps
- Session state (scroll positions, doclist group open/collapsed, active view) in `sessionStorage`

**Test architecture:**

- Runtime hook extraction from userscript + lib function parity checks (`epo_v2_runtime_parity.test.js`)
- Parser and signal unit tests over saved HTML fixtures
- Live case matrix integration tests against 17 real cases
- Lifecycle tests are largely structural/string assertions (no real async/nav race behavior)

---

## 3. Highest-risk findings

### F1: Core parsers depend entirely on English labels — CRITICAL

- **Category**: Parser brittleness / internationalization risk
- **Location**: `lib/epo_v2_main_parser.js` (`parseMainRawFromDocument`), `lib/epo_v2_procedural_parser.js` (`parseDatedRowsFromDocument`, `extractLegalEventBlocksFromDocument`), `lib/epo_v2_territorial_parser.js` (`parseUeFromDocument`, `parseFederatedFromDocument`), `lib/epo_v2_doclist_parser.js` (`tableColumnMap`)
- **What is wrong**: Core extraction logic is heavily tied to English labels and phrasing. Label regexes assume English headers: "Application number", "Status", "Priority", "Most recent event", "Event date", "Event description", "Member States covered by Unitary…", etc. Time-limit month words are English-only (one...twelve). The `@match` pattern captures all `register.epo.org/*` URLs regardless of language. The `sourceUrl` function uses `currentLang()` which returns whatever language the user's page is in.
- **Evidence**: All `sectionRowsByHeader`, `fieldByLabel`, and `sectionTextsByHeader` calls use English-only regexes. No language dictionary or fallback exists.
- **Why it matters**: If a user opens the Register in German or French, or if `currentLang()` returns `de`, all background fetches will be in that language and all parsing will silently fail, producing empty results. Downstream posture/deadline/renewal/UPC cards become partial or misleading without any user-facing confidence downgrade.
- **Practitioner impact**: Attorneys in Germany/France/Austria/Switzerland may see an empty or misleading sidebar with no warning. Stale English-cached data would mask the problem until cache expires.
- **Recommended fix**: (a) Hard-code `lng=en` in `sourceUrl` for all background fetches regardless of the user's current page language. (b) Longer-term: introduce language-aware label dictionaries keyed by `lng`, normalize semantic table structures, and add parse-failure telemetry that surfaces "source parsed with low confidence / label mismatch."
- **Scope**: Cross-cutting.

### F2: Inference confidence vs UI certainty mismatch — HIGH

- **Category**: Legal/procedural UX certainty
- **Location**: `script.user.js` (`resolvedOverviewStatus` line ~3698, `renderOverviewActionableCard` line ~9336, `renderOverviewDetailedDeadlines` line ~9259)
- **What is wrong**: Posture inference can override raw status summary for headline status. Actionable UI uses decisive wording ("Current posture", "Waiting on EPO") even when the model is heuristic. The data model carries `confidence` and `method` fields per deadline, but the sidebar rendering does not prominently surface these. A "high" confidence PDF-derived deadline looks identical to a "low" confidence heuristic.
- **Evidence**: Status selection in `resolvedOverviewStatus` prefers `posture.currentLabel` over `statusSummary.simple`; "Waiting on" text is definitive; only detailed clocks contain explicit heuristic disclaimers.
- **Why it matters**: Legal users can over-trust inferred "who acts next" determinations in ambiguous/procedurally noisy files (e.g., loss-of-rights + further processing + repeated R71 cycles). An attorney cannot visually gauge how much to trust a displayed deadline.
- **Practitioner impact**: Mistaken tactical assumptions about next procedural responsibility. Misplaced confidence in computed deadlines.
- **Recommended fix**: (a) Add explicit provenance badges at the headline/actionable level (e.g., "Derived from doc/event/legal; not an official Register state"). (b) Gate decisive wording behind confidence thresholds ("Likely waiting on…" vs "Waiting on"). (c) Show confidence badges (`high`/`medium`/`low`/`review`) on each deadline row. (d) Visually separate authoritative exact due dates from computed dates.
- **Scope**: Cross-cutting (model + UI semantics).

### F3: parseDateString uses Date.UTC in one file, local time everywhere else — HIGH

- **Category**: Engineering / correctness
- **Location**: `lib/epo_v2_posture_signals.js:11` uses `new Date(Date.UTC(...))` vs `lib/epo_v2_deadline_signals.js:11`, `lib/epo_v2_doclist_parser.js:19`, `script.user.js:2429` which use `new Date(yyyy, mm-1, dd)` (local time)
- **What is wrong**: Posture date comparisons operate at UTC midnight; deadline date comparisons at local midnight. In UTC-negative timezones (Americas), a date at UTC midnight is the *previous day* in local time.
- **Why it matters**: Comparison of dates between posture results and deadline results can give off-by-one-day mismatches. This could cause a deadline to be marked as resolved or a posture to be incorrectly sequenced.
- **Practitioner impact**: Edge case, but in a legal tool, off-by-one on dates is intolerable.
- **Recommended fix**: Standardize all `parseDateString` implementations to use UTC consistently. Centralize into one shared implementation.
- **Scope**: All files using `parseDateString` (4 implementations across 4 files).

### F4: `normalize()` semantic divergence between userscript and lib — HIGH

- **Category**: Architecture / hidden divergence
- **Location**: `script.user.js:2387` vs all 6+ lib `normalize` definitions
- **What is wrong**: The userscript version preserves newlines (reduces 3+ to 2, strips `\r`, collapses only horizontal whitespace with `/[ \t]+/g`), while all lib versions collapse *all* whitespace including newlines with `/\s+/g`. Additionally, `epo_v2_doc_signals.js` appends `.toLowerCase()` to its variant (making it semantically different from every other `normalize`, yet identically named).
- **Why it matters**: Multi-line text (status strings, priority fields, title fields) is normalized differently at runtime vs in tests. The parity test may not catch this because most test inputs are single-line strings.
- **Practitioner impact**: Fields like `statusRaw` where multi-line Register status text could produce different parsing behavior in the tested lib vs the actually-running userscript.
- **Recommended fix**: Centralize into one module. Name the lowercase variant explicitly. Decide on one whitespace strategy.

### F5: State/lifecycle bug in prefetch early-return path — HIGH

- **Category**: State/lifecycle bug
- **Location**: `script.user.js` (`prefetchCase`, lines ~6981-6987)
- **What is wrong**: When `plan.needed.length === 0`, the function exits early after setting `runtime.fetching=false` and `fetchLabel='Idle'`, but does not clear `abortController` / `fetchCaseNo` in that branch. Cleanup only happens in `completePrefetch`, which is skipped by the early return.
- **Evidence**: Early return path at lines 6981-6987; controller nulling only in `completePrefetch`.
- **Why it matters**: Stale controller ownership creates subtle lifecycle coupling — subsequent prefetch cycles may reference a controller from a previous case, or cancellation of a "stale" controller may interfere with a live fetch.
- **Practitioner impact**: Intermittent "why didn't this refresh as expected?" behavior under repeated tab transitions/re-entry.
- **Recommended fix**: Ensure every exit path funnels through a single `finalizePrefetch(controller, caseNo)` cleanup.
- **Scope**: Local (with runtime implications).

### F6: Silent row/data loss in parsers — HIGH

- **Category**: Parser resilience / silent data loss
- **Location**: `lib/epo_v2_doclist_parser.js` (`doclistEntryFromRow:65`, `parseDoclistFromDocument`), `lib/epo_v2_procedural_parser.js` (`parseDatedRowsFromDocument`)
- **What is wrong**: Row ingestion requires specific structural cues (checkbox presence, date token, first-payload assumptions). Nonconforming rows are silently dropped with no diagnostic.
- **Evidence**: Doclist rows without checkbox/date/title are discarded; dated-row extraction strips by hardcoded token words and drops rows aggressively if first payload isn't expected.
- **Why it matters**: Missed rows can distort packet grouping, timeline chronology, and inferred deadlines.
- **Practitioner impact**: "Missing event/document" in timeline or wrong cycle interpretation.
- **Recommended fix**: Implement parser diagnostics per source (drop counters + reasons), preserve uncertain rows as low-confidence items rather than discarding.
- **Scope**: Cross-cutting.

### F7: Massive code duplication between script.user.js and lib/ — MEDIUM-HIGH

- **Category**: Architecture / maintainability / hidden coupling
- **Location**: ~3,500 lines of `script.user.js` (lines 3084-7000+) duplicate `lib/` modules
- **What is wrong**: There are effectively two implementations — the runtime monolith and the modular lib — with parity tests verifying synchronization. `normalize()` already has a known semantic divergence. `parseDateString` already has a UTC/local divergence. `inferProceduralDeadlines` has different calling conventions (positional params in userscript vs object destructuring in lib). Every domain change requires mirrored updates and parity maintenance.
- **Evidence**: `epo_v2_runtime_parity.test.js` imports lib modules and compares many runtime hook outputs. `normalize` is defined 8 times. `dedupe` is defined 7 times. `parseDateString` is defined 4 times with 2 different behaviors.
- **Why it matters**: Drift bugs remain likely under schedule pressure. The parity test checks I/O equivalence on specific inputs but cannot catch all behavioral divergence.
- **Practitioner impact**: Users run the userscript. Tests validate the lib. If they diverge, practitioners get untested behavior.
- **Recommended fix**: Adopt a build step (esbuild/rollup) that bundles `lib/` modules into `script.user.js`, eliminating duplication entirely. This makes the parity test unnecessary and ensures users always run tested code.
- **Scope**: Architectural.

### F8: Opposition/limitation/appeal logic untested on real data — MEDIUM-HIGH

- **Category**: Testing strategy gap
- **Location**: `lib/epo_v2_deadline_signals.js:1050-1250` (opposition deadlines), `tests/`
- **What is wrong**: All opposition deadline families (Rule 79(1), 79(3), 82(1-3), oral proceedings), all limitation deadline families (Rule 95(2-3)), and all appeal deadline families are tested only with synthetic data. Zero real fixture cases exist for these phases.
- **Why it matters**: These are the highest-stakes deadlines in patent prosecution. Missing an opposition reply deadline can cost the patent. This logic is effectively unvalidated against real EPO Register output.
- **Practitioner impact**: If the real Register's HTML structure for opposition/limitation/appeal proceedings differs from synthetic assumptions, the tool could produce incorrect or missing deadlines for the most consequential situations.
- **Recommended fix**: Capture 2-3 real opposition cases, 1 limitation case, and 1 appeal case as fixtures.

### F9: Lifecycle tests lack real async/navigation race behavior — MEDIUM

- **Category**: Testing strategy gap
- **Location**: `tests/userscript_lifecycle.test.js`, `tests/userscript_fixture_utils.js`
- **What is wrong**: Lifecycle tests are mostly structural text/regex checks. The harness stubs timers/intervals, meaning no real async or navigation-race behavior is tested. Race conditions between `pushState`/`popstate`/`visibilitychange`/`focus`/`pageshow` and pending prefetch operations are untested.
- **Evidence**: Lifecycle assertions use `src.includes()`/regex; test harness disables timers/intervals; no simulation of rapid tab-switching or navigation mid-fetch.
- **Why it matters**: Race/idempotence bugs pass CI but appear only in live browsing, precisely where procedural confidence is needed.
- **Recommended fix**: Add behavior-driven lifecycle tests with real timers/navigation simulation, covering at minimum: rapid same-case tab switching, leave-and-return to different case, prefetch cancellation mid-flight, visibility toggle during fetch.
- **Scope**: Cross-cutting.

---

## 4. EPO-procedure audit

### Assumptions that are correct

1. **Deadline start = date on the document (post-November 2023 regime).** Since 1 November 2023, amended Rules 126(2), 127(2), and 131(2) EPC abolish the former 10-day notification fiction. Documents are deemed notified on the date printed on the document. The codebase correctly uses `dispatchDate` directly as the anchor for time-limit computation. For communications with an explicit `timeLimitDate` from structured ST.36 fields, the code prefers that (also correct). This behavior aligns with the current EPC Implementing Regulations.

2. **Application type detection** (`parseApplicationType`): Logic for distinguishing Euro-PCT (via WO/PCT numbers or status text), divisional (via parent case), and direct EP filing is sound and tested on 17+ real cases.

3. **20-year term calculation from filing date** (`appendReferenceDeadlines`): Standard Art. 63(1) EPC. Used as reference only, not actionable.

4. **R71(3) = 4-month response period**: Correct per Rule 71(3) EPC. Non-extendable.

5. **Rule 70(2) = 6-month response period**: Correct per Rule 70(2) EPC.

6. **Rule 161/162 = 6-month response period for Euro-PCT**: Correct per Rule 161(1)/162 EPC.

7. **Opposition period = 9 months from mention of grant in the Bulletin**: Correct per Art. 99(1) EPC. The code's `findGrantMentionAnchor` looks for events with text matching "publication of the mention of grant" / "mention of grant" / "patent granted" in the Register's event/legal history. The EPO Register records these events with the Bulletin publication date (not the internal decision-to-grant date), so the anchor is correct.

8. **Unitary effect request window = 1 month from mention of grant**: Correct per R. 6(1) RUPP (Rules relating to Unitary Patent Protection). Same anchor as opposition, correctly sourced.

9. **UPC lookup correctly constrained to EP publication numbers** (not application numbers): Verified in candidate selection implementation and AGENTS.md prohibition.

10. **Derived-source freshness tied to dependency stamps** for UPC/PDF paths: Good anti-stale pattern.

11. **Deadline UI includes heuristic caveat in detailed clocks section**: Present, but only in that section — not at headline level (see F2).

### Assumptions that are risky

1. **"Waiting on" actor inference shown as operational status** despite ambiguity in mixed legal/event/doc evidence. Decisive wording in a heuristic context. **Risky**.

2. **Posture-over-status precedence** (`resolvedOverviewStatus`): Can amplify inferred state beyond the authoritative main-page status text. **Risky** in procedurally noisy files.

3. **"Recovered" = recovery date >= loss date** (`epo_v2_posture_signals.js:147`): A *request* for further processing is not the same as a *decision to allow* further processing. The code looks for both `FURTHER_PROCESSING_REQUEST` and `FURTHER_PROCESSING_DECISION`, but `latestRecovery` may match the request before the decision exists. **Risky**: may show "Recovered" when recovery is still pending.

4. **English phrase-based procedural decoding** for loss/recovery and time limits may mis-map nuanced outcomes or localized phrasing. **Risky**.

5. **R71(3) resolved-by detection**: Checks for fee payment or applicant response after anchor, but a Rule 71(6) disapproval also "resolves" the deadline. The previous R71(3) deadline may remain as "active" even after disapproval. **Risky**.

6. **Art. 94(3) fallback to review-only when no structured period**: Appropriately cautious in isolation, but **risky** because users may not realize this means the tool provides no useful deadline for the communication.

7. **Euro-PCT 31-month entry deadline uses first priority in parse order** (`lib/epo_v2_deadline_signals.js:988`): `ctx.priorityDate` comes from `main.priorities?.[0]`. Under PCT, the 31-month period runs from the *earliest* claimed priority. If parsing order differs from chronological order, the wrong date is used. **Risky**: depends on the Register always presenting priorities chronologically.

8. **No handling of the 7-day safeguard provision.** Under amended Rule 126(2)/127(2) EPC, if the EPO cannot prove delivery within 7 days of the document date, the response period is extended by the number of days exceeding 7. The codebase does not model this — which is reasonable because the tool cannot know actual delivery dates, but users should be aware that displayed deadlines assume timely delivery. **Low risk** but worth noting in UI.

### Where UI certainty should be downgraded

- **"Current posture"** and **"Waiting on"** should show explicit derived badge + confidence tier inline, not just in detailed clocks.
- **"Next deadline"** should visually separate authoritative exact due date (from `timeLimitDate`) vs computed date (from dispatch anchor + months). Different badge classes.
- Any posture relying on text matching (as opposed to codex keys) should note lower confidence.
- The "recovered" flag should distinguish between "recovery requested" and "recovery decided."
- **Renewal "Paid through Year X"** should always indicate source hierarchy (legal vs UE vs federated) in primary text, not only notes.

---

## 5. Parser and data-source audit

### Fragility

1. **English-label hard dependency** (F1 above): All parsers use English-only regex patterns. `sourceUrl` propagates `currentLang()`, so German/French users get non-English fetches that produce empty parse results. No fallback, no warning.

2. **Checkbox selector for doclist rows** (`epo_v2_doclist_parser.js:65`): `row.querySelector("input[type='checkbox']")` — relies on EPO Register having checkboxes in document rows. Register redesign without checkboxes → all document parsing fails.

3. **Table-header hint matching** (`bestTable`, `sectionRowsByHeader`): Relies on column headers containing exact text like "date," "document type," "procedure." Reasonably resilient to minor changes, but a redesign breaks all table parsing.

4. **Dated-row extraction shape** (`parseDatedRowsFromDocument`): Single expected shape — date token first, then payload. Nonstandard payload ordering or cells with embedded dates are dropped silently.

5. **Structured time-limit parser**: Months parsed from English words only (one...twelve). French/German equivalents ignored.

6. **UPC parser false-negative vector** (`parseUpcOptOutResult`): Result ignored if exact patent string is not present verbatim in flattened text. Format variants (spacing, separators, different formatting of EP publication numbers) can evade detection.

7. **Priority parsing regex cascade** (`parseMainRawFromDocument`): 4-level fallback from strict to loose matching. Good engineering, but the loosest fallback (`/^([A-Z]{2}[0-9A-Z/\-]{4,})\b/`) could match non-priority strings.

### Normalization quality

- Date normalization handles `DD.MM.YYYY` (EPO standard) correctly. Also handles compact `YYYYMMDD` and alternate separators. Good.
- Publication number normalization strips non-alphanumeric characters and handles kind-code splitting. Potential issue with 9-digit application numbers.
- Whitespace normalization (NBSP → space) applied consistently in lib, but the userscript version diverges (preserves newlines).

### Deduplication quality

Uses composite string keys (`dateStr|title|detail`). Reasonable but can fail on slightly different whitespace normalization across sources. Overall acceptable.

### Silent parse failures

Parsers return empty arrays/objects on failure rather than throwing. Good for resilience, but data loss is **silent**. The operation console logs fetch status but not parse success/failure details. If a parser returns 0 events from a page that has events, no warning is raised.

**Recommended fix**: Add diagnostic counts to parse results (e.g., `{ events: [...], parseStats: { rowsSeen: N, rowsParsed: M } }`) and surface warnings when `M << N`.

---

## 6. Test coverage audit

### What is covered reasonably well

- **Application type detection**: All three types (direct EP, Euro-PCT, divisional) on 17 real fixtures.
- **Status summarization**: Rule-table coverage for all major status texts.
- **Posture derivation**: 5+ recovery arcs, loss-of-rights variants, grant lifecycle.
- **Deadline inference**: 50+ scenarios covering search/examination/grant/opposition/limitation deadlines.
- **Document classification**: Search, grant, opposition, loss-of-rights, filing packages. 13+ packet families.
- **PDF deadline parsing**: Communication date extraction, response period extraction, explicit deadline extraction.
- **UPC opt-out**: Positive and negative controls.
- **Unitary effect**: 1 full lifecycle case (EP19871250).
- **Runtime parity**: 30+ function-level parity checks between userscript and lib.
- **Full suite runs clean** (all 25 test files pass).

### What is not covered well enough

- **Behavioral lifecycle races/idempotence**: Tests are largely static code-shape checks under stubbed timers.
- **Locale variation**: No German/French fixtures. No non-English month terms.
- **Real opposition/limitation/appeal**: Synthetic-only. Zero live fixture cases.
- **Federated register**: Only 1 case (EP19871250). No national-phase lapse/revival.
- **ueMain**: Only 2 cases. No negative control for granted-without-UP.
- **Citations**: Only 1 case.
- **Direct EP baseline**: Queued (EP23160622) but not yet captured.
- **Nested divisional chains**: Untested.
- **Publication fallback logic**: Code exists, never exercised on fixture.
- **Multiple sequential loss-of-rights events**: Untested chain.

### Prioritized missing-case matrix

| Priority | Missing fixture | Risk |
|----------|----------------|------|
| P1 | Direct EP baseline with full tabs (EP23160622 queued) | No baseline for most common filing type |
| P1 | Real opposition case (Rule 79, 82, oral proceedings, decision) | Highest-stakes deadlines untested |
| P1 | Real limitation case (Rule 95, LIRE communication) | Untested on real data |
| P1 | Real appeal case (notice, grounds, decision) | Untested on real data |
| P2 | Parent/divisional tab completion (EP19871250 legal/doclist) | Key parent fixture incomplete |
| P2 | Non-UP grant baseline (EP17751711 missing) for differential renewal/UPC | No comparison case |
| P2 | Locale fixtures for `lng=de` and `lng=fr` on main/doclist/legal/event | Complete parse failure untested |
| P3 | Heavy legal-history stress fixture (multi-cycle loss/recovery conflict) | Edge case sequencing |
| P3 | Nested divisional hierarchies (divisional of divisional) | Untested hierarchy |
| P3 | Supplementary search report (not extended) | Untested variant |

---

## 7. Refactor plan

### Quick wins (1-2 hours each)

1. **Fix prefetch no-op cleanup path**: ensure the early-return branch in `prefetchCase` clears `abortController` / `fetchCaseNo` via a single `finalizePrefetch` cleanup function.

2. **Hard-code `lng=en` in `sourceUrl`** to prevent non-English parsing failures. Add a guard in `prefetchSource` that logs a warning if cached data came from a non-English page.

3. **Centralize `normalize`, `dedupe`, `parseDateString`, `formatDate`** into a shared `lib/epo_v2_utils.js`. Fix the UTC/local inconsistency. Fix the normalize whitespace divergence. Name the lowercase variant in `epo_v2_doc_signals.js` explicitly.

4. **Add parser drop diagnostics**: counters per source (rowsSeen, rowsAccepted, rowsDroppedByReason), surfaced in operation console.

5. **Add confidence badge rendering** to deadline display in the sidebar. The data model already carries the field — just render it.

### Medium refactors (1-2 days each)

6. **Distinguish "recovery requested" from "recovery decided"** in posture signals. Only show "Recovered" when a decision event (not just a request) is found.

7. **Add provenance badges to actionable overview status**: "Derived" vs "Authoritative." Gate "Waiting on" behind confidence: "Likely waiting on…" for heuristic determinations.

8. **Introduce locale-aware label maps** and parser strategy by `lng` (at minimum EN/DE/FR for critical headers).

9. **Harden UPC parser** to normalize EP numbers with optional separators/spaces before string comparison.

10. **Capture 3+ real fixture cases**: active opposition, limitation, appeal. Add test assertions.

### Deeper redesigns (1+ weeks)

11. **Move to a single-source core domain library** bundled into userscript via build artifact. Eliminate all mirrored logic. Delete the parity test (no longer needed).

12. **Build typed source packets** with explicit authoritative vs inferred edges in the model schema. Every derived field carries provenance.

13. **Add scenario-driven simulation tests** for navigation/prefetch/cancel/re-entry with real timers (not stubbed).

14. **Centralize the deadline computation into a single rule-table** instead of ~10 `append*Deadlines` functions. Each deadline family as a declarative entry: `{ label, anchorFinder, months, resolvedBy, phase, ... }`.

---

## 8. Concrete change list

1. Fix prefetch no-op cleanup path: unify all exit paths through `finalizePrefetch(controller, caseNo)`.
2. Hard-code `lng=en` in `sourceUrl` for all background fetches.
3. Create `lib/epo_v2_utils.js` with centralized `normalize`, `dedupe`, `parseDateString` (UTC), `formatDate`, `compareDateDesc`, `isValidDate`. Update all lib imports. Fix `normalize` whitespace semantics.
4. In posture signals, distinguish `latestRecoveryRequest` from `latestRecoveryDecision`. Only set `recovered=true` on a decision event.
5. Add parser telemetry: `rowsSeen`, `rowsAccepted`, `rowsDroppedByReason` per parse function. Log warnings when accepted count is 0 but seen count > 5.
6. Add provenance + confidence fields to actionable overview status (not just detailed deadlines). Gate "Waiting on" by confidence.
7. Add visible confidence badges per deadline row in sidebar rendering.
8. Harden UPC patent number matching against format variants (spaces, dashes, dots).
9. Introduce locale label map for main/event/legal headers (at minimum en/de/fr).
10. Add fixture packs for non-English pages and wire into CI parser tests.
11. Add lifecycle behavior tests with real async hooks (history pushState/popstate/visibility/focus/pageshow).
12. Capture real opposition/limitation/appeal fixtures + assertions.
13. Capture direct-EP baseline (EP23160622) + parent/divisional tab completion for EP19871250.
14. Collapse runtime/lib duplication via build step.

---

## 9. Optional patch candidates (top 10 PRs in recommended order)

1. **PR: Prefetch cleanup correctness fix** — High ROI, low blast radius. Fixes dangling abort controller on the no-op path. (`script.user.js:prefetchCase`)

2. **PR: Force English language in all background fetches** — Prevents silent total data loss for non-English users. One-line fix in `sourceUrl`. (`script.user.js`)

3. **PR: Unify parseDateString, normalize, dedupe into shared utility module** — Eliminates 20+ duplicate function definitions and the UTC/local divergence. (`lib/epo_v2_utils.js` new)

4. **PR: Surface deadline confidence and provenance in UI** — Lets practitioners distinguish reliable from heuristic deadlines, gate "Waiting on" wording by confidence. (`script.user.js` rendering functions)

5. **PR: Distinguish recovery request from recovery decision in posture** — Prevents false "Recovered" display during pending further-processing requests. (`lib/epo_v2_posture_signals.js`)

6. **PR: Add parser drop diagnostics + UPC number normalization** — Catches silent parser failures and UPC false negatives. (`lib/epo_v2_doclist_parser.js`, `lib/epo_v2_upc_parser.js`)

7. **PR: Capture real opposition/limitation/appeal + direct-EP fixture cases** — Closes the most dangerous testing gap. (`tests/fixtures/`)

8. **PR: Introduce locale label maps for core parsers (en/de/fr)** — Prevents silent parse failure for European users. (`lib/epo_v2_main_parser.js`, `lib/epo_v2_procedural_parser.js`)

9. **PR: Lifecycle race test harness with non-stubbed timers** — Validates prefetch/cancel/re-entry behavior under realistic conditions. (`tests/`)

10. **PR: Introduce build step to eliminate userscript/lib duplication** — The single most impactful architectural improvement. Deletes ~4,000 lines and the parity test. (build config + `script.user.js` restructure)

---

## 10. EPO legal framework notes

### Rule 126(2) / 127(2) / 131(2) EPC — post-November 2023 regime

As of 1 November 2023, the EPO abolished the "10-day rule" (the former notification fiction under Rule 126(2) EPC). Under the amended rules:

- Documents from the EPO are deemed notified on the **date printed on the document**, regardless of postal or electronic delivery method.
- Deadlines for response run from the document date directly. The former +10 day offset no longer applies to any communication dated 1 November 2023 or later.
- A **7-day safeguard** exists: if the EPO cannot prove delivery within 7 days of the document date, the response period is extended by the excess days. This is an exceptional circumstance that cannot be modeled from Register data alone.

The codebase's current deadline computation — anchoring to `dispatchDate` directly without adding 10 days — is **correct** under the current legal framework. The `structuredAnchorDate` → `addMonthsDeadline` pipeline correctly computes N months from the document date, and the `structuredExactDueDate` path correctly prefers explicit `timeLimitDate` values from structured ST.36 fields when available.

**Source**: OJ EPO 2023, A29 (CA/D 10/22); amended Rules 126(2), 127(2), 131(2) EPC, effective 1 November 2023.

### Transitional note

For historical communications dated before 1 November 2023, the old 10-day rule would technically apply. However, any such deadlines would have expired well before the current date and are not actionable. The codebase does not need to handle this transitional case for practical purposes.

---

## Checks performed

- `node --check script.user.js` — passed
- `npm test` — all 25 test files passed
- Manual code review of deadline computation, parser logic, lifecycle management, and test coverage
- Verification of EPO procedural assumptions against current EPC Implementing Regulations (post-November 2023 amendments)
