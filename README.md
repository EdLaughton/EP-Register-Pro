# EPO Register Pro

A production-focused **Tampermonkey userscript** for the [European Patent Register](https://register.epo.org/) that adds a fast, data-rich right-hand sidebar for prosecution tracking.

> Designed for patent professionals who want quicker case understanding without endless tab-switching.

---

## ✨ Features

### Overview panel
- Key case metadata at a glance:
  - Title
  - Applicant
  - Representative
  - Application number
  - Filing date
  - Priority
  - Type / stage / status
  - Designated states
- Actionable snapshot:
  - EPO last action
  - Applicant last filing
  - Waiting-on-EPO day counter
  - Most recent event (with fallback)
- Derived timelines:
  - Heuristic deadline estimates (e.g. Rule 71(3), Art. 94(3), 20-year reference)
- Renewal and UPC/UE summaries
- Publication block (with fallback inference from document rows)
- Searchable document index

### Timeline panel
- Unified chronology from:
  - Main page data
  - All documents
  - Event history
  - Legal status
  - Publication sources
- De-duplication logic to reduce repeated entries
- **Collapsible grouped bundles** (e.g. filing/search/grant/applicant filings), with item counts in the group header
- Density modes: compact / standard / verbose

### Options panel
- Toggle major sections and behavior:
  - Body shift
  - Background preloading
  - Publication/event/legal timeline inclusion
  - Renewals + UPC/UE sections
  - Timeline density
- Persisted options with normalization for robust checkbox state across reloads

### Data/cache behavior
- Shared per-application cache across supported tabs:
  - `main`, `doclist`, `event`, `family`, `legal`, `ueMain`
- Background prefetch with retry/timeout and freshness windows
- Cross-tab synchronization via `localStorage` storage events
- Graceful degradation when some sources are unavailable

---

## 🚀 Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2. Open `script.user.js` from this repository.
3. Create/update your Tampermonkey script with its contents.
4. Visit an EPO Register case URL such as:
   - `https://register.epo.org/application?number=EP19205846&tab=main`

---

## 🧭 Usage

1. Open an EP Register application page.
2. Use the sidebar tabs:
   - **Overview**
   - **Timeline**
   - **Options**
3. Trigger a full refresh from **Options → Reload all background pages** if needed.

---

## 🧪 Testing

Install test dependencies once:

```bash
npm install
```

Run the checks:

```bash
node --check script.user.js
npm test
```

---

## 📝 Changelog (recent)

### 7.0.88
- Removed the synthetic/fake Register HTML fixtures and consolidated real Register captures under `tests/fixtures/cases/<application>/`.
- Added a persistent scrape tracker at `tests/live-fixture-tracker.md` so future runs can retry missing tabs/cases until the requested coverage set is complete.
- Added the requested `EP3863511 B1` granted baseline via Register application `EP19871250`:
  - captured real `main`, `event`, `family`, and `ueMain` HTML
  - recorded `legal` and `doclist` as still missing after this run (challenge/blocked)
- Expanded live case-matrix coverage to assert granted/no-opposition + unitary-effect behavior from the new real baseline case.

### 7.0.87
- Cleaned up the sidebar presentation without dropping useful data:
  - filing summary still shows the 20-year term reference, but no longer shows the extra years-remaining countdown noise
  - latest-action and renewal labels now compact verbose Register document titles into shorter human-readable summaries (for example, `Text intended for grant (version for approval)` → `Grant text for approval`)
  - retained the underlying data model and validation coverage while improving readability

### 7.0.86
- Expanded the live case matrix with additional browser-captured fixtures under `tests/fixtures/cases/`:
  - `EP19205846` for deemed-withdrawn + renewal-history + repeated R71 cycles
  - `EP24189818` for renewal-heavy grant-intention flow
  - `EP25203732` for active divisional-child / parent-link / search-publication behavior
- Added live UPC registry fixtures under `tests/fixtures/upc/` and a new matrix test covering positive/negative controls.
- Real live-control expansion surfaced and fixed a parser gap:
  - `parseUpcOptOutResult()` now recognizes live UPC positive-control pages that present `Case Type: Opt-out application` instead of only `opted out registered/effective` wording.
- `npm test` now includes `userscript_live_case_matrix.test.js` for broader feature-type coverage.

### 7.0.85
- Added **browser-captured real Register fixtures** under `tests/fixtures/register-real/` and wired them into test coverage.
- Real-capture pass surfaced and fixed a parser gap:
  - `parseFamily()` now understands live family-table publication rows (`Publication No. / Date / Type`) instead of relying only on loose text extraction.
- `npm test` now covers both representative synthetic fixtures and real captured Register fixtures.

### 7.0.84
- Added real fixture-based parser tests using a lightweight `jsdom` harness:
  - exercises `parseMain`, `parseDoclist`, `parseLegal`, `parseEventHistory`, `parseFamily`, `parseUe`, `parsePdfDeadlineHints`, and `inferProceduralDeadlines`
  - uses saved representative Register HTML fixtures plus PDF-text fixtures under `tests/fixtures/`
  - adds `npm test` as the canonical multi-test entry point

### 7.0.83
- Fifth-pass maintainability refactor:
  - split deadline derivation into focused helper stages (`buildDeadlineComputationContext`, PDF/core/PCT/post-grant/reference appenders) so `inferProceduralDeadlines()` is no longer one monolith
  - split PDF deadline refresh into candidate selection, per-document scanning, status derivation, and summary helpers
  - split doclist grouping into filter setup, row modelling, run building, and per-group DOM wiring helpers
  - kept behavior stable and extended lifecycle structural coverage for the new helper boundaries

### 7.0.82
- Fourth-pass maintainability refactor:
  - centralized case-source reads behind `caseSnapshot()` / `caseSourceData()` / `caseDocs()` helpers
  - centralized publication evidence assembly behind `casePublications()` / `mergePublications()` so overview, timeline, and UPC logic stop rebuilding publication sets differently
  - split the large overview renderer into focused card helpers (`header`, `actionable`, `renewals`, `UPC/UE`, `publications`) without changing the feature set
  - added regression coverage for the new shared helpers in `tests/userscript_lifecycle.test.js`

### 7.0.81
- Third-pass cross-page hydration cleanup:
  - UPC candidate-number selection now supplements main-page publication numbers with **case-local doclist-derived publication evidence**
  - preserves the publication-number-only rule while improving UPC lookup coverage when the case was first hydrated from non-main tabs or partial main data
  - still avoids family-wide publication fallback to reduce false positives

### 7.0.80
- Second-pass cache/state hardening:
  - centralized source-cache writes behind a single helper to keep status/parserVersion/dependencyStamp handling consistent
  - `sourceStamp()` now includes dependency stamps so derived-model memoization reflects upstream dependency changes cleanly
- Fixed derived-source status semantics:
  - UPC registry refresh now distinguishes **true empty/no-match** from **all candidate requests failed**
  - PDF deadline refresh now distinguishes **no hints after successful scans** from **all candidate scans failed**
  - avoids false-negative empty states during transport/parser failures
- Added lifecycle/derived-status coverage in `tests/userscript_lifecycle.test.js`.

### 7.0.79
- Refactored page lifecycle + navigation handling:
  - added debounced route observers around `pushState` / `replaceState` / `popstate` / `hashchange`
  - retained a slower interval fallback instead of relying on a 1s poll loop alone
  - clears case-scoped runtime state when leaving Register case pages, preventing stale delayed re-parses after navigation
- Fixed cache freshness semantics so recent **error** fetches are no longer treated as reusable/fresh sources.
  - broken source fetches now retry on later init/prefetch instead of remaining stuck until the refresh window expires.
- Deduplicated derived-source background work:
  - UPC registry checks now respect cache freshness + dependency stamps tied to current publication candidates
  - PDF-derived deadline scans now respect doclist dependency stamps and cache explicit empty states when no eligible communication docs exist
- Added overview-model memoization and publication fallback merging from doclist evidence even when main/family sources already contain partial publication data.

### 7.0.78
- Fixed doclist response grouping edge-cases around intention-to-grant:
  - applicant amendments/corrections in R71(3)/text-proposed-for-grant context now group with grant/intention-to-grant flow (not `Response to search`).
- Fixed PDF-derived deadline resolution state:
  - PDF hint cycles are now checked against subsequent applicant/EPO activity and can be auto-marked resolved when later response evidence exists.
  - avoids stale historical R71(3) cycles appearing as still-open in actionable/deadline views.
- Improved robustness in doclist parser fallback URL generation (no undefined case number in fallback URL path).
- Detailed clocks now hide already-resolved deadlines for a cleaner actionable view.

### 7.0.77
- Condensed filing metadata in Overview top summary:
  - combined `Filing date` and `20-year term from filing (reference)` into a single line for quicker scanning
  - format now reads as: `Filed <date> · 20-year term <expiry> · <remaining time>`

### 7.0.76
- Fixed auto-load regression where prefetch session-gate could suppress background loading even when sources were stale/missing (e.g. sidebar stuck at `1/6`).
- Gate now auto-bypasses when stale/missing sources are detected and runs a recovery prefetch.
- Added stale-source diagnostics in prefetch logs for easier troubleshooting.

### 7.0.75
- Added a clear blue guide line on the left side of doclist grouping rows:
  - group header rows: stronger blue left marker
  - grouped child rows: lighter blue continuation line
- Improves visual scanning of which documents belong to each collapsible group.

### 7.0.74
- Full-script audit cleanup pass:
  - removed an unused `caseNo` parameter from `parseDoclist` call flow
  - retained existing behavior while simplifying parser call signatures
- Includes previous timeline-collapse cleanup and redundancy removal.

### 7.0.73
- Removed redundant timeline open-state persistence code paths (toggle listeners + save hooks) now that timeline groups intentionally default collapsed on each render.
- Simplified timeline rendering flow while preserving keyed group markup and collapse/expand behavior per-view.

### 7.0.72
- Timeline grouping now defaults to **collapsed** on each render (no persisted expanded groups).
- Doclist grouping now defaults to **expanded** when no saved group-state exists for the case.
- Added timeline importance classification tuned for EP prosecution triage:
  - escalates loss-of-rights/refusal/revocation style events to high severity
  - highlights deadline/summons/R71(3)/Art.94(3)/opposition style events as warn-level items
  - keeps lower-signal procedural entries at lower emphasis

### 7.0.71
- Rebalanced communication-date extraction priority for OCR-derived letters:
  - prioritizes central communication/header table date patterns (`Application No. / Ref. / Date` and `Date of communication` fields)
  - keeps Registered Letter / EPO form stamp dates as lower-priority dispatch-proof context
- This reduces risk of using dispatch/stamp dates when the communication table date is available.

### 7.0.70
- Improved actionability heuristics for deemed-withdrawn / loss-of-rights postures:
  - classifies loss-of-rights style communications as EPO actions (avoids false applicant attribution)
  - adds a **Recovery options** advisory line in Actionable status with Rule 136(1) context when applicable
  - adjusts waiting-party logic in loss-of-rights situations to avoid incorrectly showing "waiting on EPO"
- Improved doclist grouping around grant communications:
  - group header label now shows **Intention to grant (R71(3) EPC)** (instead of generic Grant package)
  - bibliographic rows on the same date as intention-to-grant communications are folded into that group

### 7.0.69
- Sidebar mounting is now blocked on EPO document-viewer URLs (`/application?documentId=...`).
- Case-page detection now requires an EP application number in the `number` query param and excludes `documentId` routes.

### 7.0.68
- Expanded PDF/OCR candidate selection to cover broader communication-type documents (not only a narrow rule list).
- Communication date extraction now prioritizes PDF-derived date evidence from **Registered Letter** / EPO form stamp lines before doclist fallback.
- Added diagnostics for doclist-vs-PDF date divergence and explicitly prefers PDF communication date for deadline derivation when they differ.
- Added generic communication category fallback (`Communication response period`) when communication-period evidence exists without a specific rule label.

### 7.0.67
- Moved **20-year term from filing (reference)** into the top overview summary directly after **Filing date**.
- Removed duplicate display of that same 20-year reference term from the inline detailed clocks section.

### 7.0.66
- Combined previously separate overview blocks into a single **Actionable status** card:
  - actionable next-deadline summary + latest actions + waiting-party state
  - detailed/reference clocks now shown inline below as **Detailed clocks**
- Removed duplicate section split between `Deadlines & clocks (detailed)` and `Actionable status` for a more compact decision view.

### 7.0.65
- UPC opt-out query input now strictly uses **EP publication numbers only**.
  - Removed any application-number fallback for UPC `patent_number` lookups.
  - Added explicit skip diagnostic when no EP publication number is available for UPC lookup.

### 7.0.64
- Tidied **Overview → Actionable status** formatting for readability:
  - reformatted Next deadline supporting context into cleaner sub-lines (context + basis + status), instead of one long parenthesized sentence
  - normalized whitespace/newlines in parsed deadline evidence (e.g. OCR-derived `within a period of 4 months`)
  - removed redundant source-date duplication when already embedded in method text

### 7.0.63
- Added OCR fallback path for image-only prosecution PDFs:
  - loads `tesseract.js` (with sandbox-safe fallback loading) when pdf.js text extraction is empty
  - OCRs first pages of image-only PDFs and feeds extracted text into existing deadline parsing logic
  - supports linked PDF OCR fallback (`pdfjs-via-linked-url-ocr`) and logs OCR usage metadata
- Added OCR transport diagnostics and summary counters (`withOcr`) in PDF parse logs.

### 7.0.62
- Expanded fragmented month-phrase detection to explicitly catch additional response periods often seen in OCR/HTML fallbacks:
  - `2 months`, `3 months`, `5 months`, `6 months`
  - and reversed/fragmented variants (e.g. `months ... 2` style ordering).
- Keeps these targeted phrase detections lower-priority than explicit legal-wording matches.

### 7.0.61
- Improved robustness of **Registered Letter proof-line extraction**:
  - handles same-line payloads after `Registered Letter`
  - checks nearby `EPO Form ... (dd.mm.yyyy)` fallback patterns when line ordering is irregular
  - preserves/reattaches Registered Letter tail context when focused fallback text window would otherwise exclude it
- Improved fragmented month phrase detection (`of 4 months`) in fallback text extraction.
- Added registered-letter line/proof snippets into PDF diagnostics metadata for easier verification.

### 7.0.60
- Improved deadline inference when PDF/HTML fallback text lacks explicit legal markers:
  - Adds category fallback from document metadata (`doc title`/`procedure`) when communication text does not contain `Art. 94(3)`/rule tags.
  - Adds conservative default response-period fallback for key response categories when no explicit month phrase is present:
    - Art. 94(3): 4 months
    - R71(3): 4 months
    - Rule 161/162: 6 months
  - Logs `categoryEvidence` so diagnostics show whether category came from communication text or document metadata.

### 7.0.59
- Improved empty-PDF handling when linked document endpoints return PDF bytes with no extractable text layer:
  - Adds secondary fallback to parse communication context from document-page HTML when pdf.js text extraction returns empty.
  - Adds linked-document-page fallback path for `showPdfPage`/documentId URL chains.
  - Keeps transport diagnostics explicit (`pdfjs-empty-text`, linked/html fallback paths) for easier debugging.

### 7.0.58
- Improved non-PDF payload handling for document links that do not return raw PDF bytes:
  - Detects non-PDF responses before pdf.js parse and avoids opaque `Invalid PDF structure` failures where possible.
  - Tries to extract linked PDF/document URLs from HTML payloads and re-fetches those when available.
  - Falls back to HTML text extraction for deadline parsing when binary PDF is unavailable.
  - Adds transport/url diagnostics so logs clearly show whether parsing used `pdfjs`, linked PDF fetch, or HTML fallback.

### 7.0.57
- Improved pdf.js compatibility in Tampermonkey sandbox contexts:
  - Added `unsafeWindow` bridge support for detecting/registering `pdfjsLib` globals across sandbox/page scopes.
  - Added resilient global detection (`window`, `globalThis`, `unsafeWindow`, UMD key variants).
  - Added CommonJS/UMD-aware evaluation fallback to capture module-style exports when no window-global is emitted.
  - Kept multi-CDN and script-tag fallback behavior.

### 7.0.56
- Fixed same-case tab-switch gate detection across full Register page reloads.
  - Gate logs now correctly classify:
    - `Same-case tab switch detected: prefetch gate active`
    - `Same-case page reload detected: prefetch gate active`
- Reduced log churn by deduplicating near-identical back-to-back operation entries.
- Removed unused legacy helper code paths (`fetchBinaryCrossOrigin`, `extractDateCandidates`, `addDays`) to simplify maintenance while preserving feature behavior.

### 7.0.55
- Hardened PDF engine loading (pdf.js) with multi-path fallback:
  - multiple CDN candidates (`cdnjs`, `jsdelivr`, `unpkg`)
  - script-text fetch + multi-strategy evaluation fallback
  - script-tag fallback loading path
- Added explicit parser-engine diagnostics:
  - `PDF parser engine ready`
  - `PDF parser unavailable: ...`
  - `PDF deadline parse aborted (parser engine unavailable)`
- Reused a single loaded pdf.js instance per PDF parse cycle (instead of resolving engine per-document).

### 7.0.54
- Fixed same-case auto-prefetch gate persistence across full page reloads by storing gate state in `sessionStorage`.
  - Prevents repeated background full-source reloads when switching Register tabs (`tab=main`, `tab=doclist`, etc.) for the same case in the same browser tab session.
- Increased operation-console visibility to show the full retained per-case log window (latest-at-top) instead of clipping to 120 rows.

### 7.0.53
- Added explicit gate diagnostics for same-case Register tab switches:
  - Logs `Same-case tab switch detected: prefetch gate active` with `fromTab`/`toTab` metadata.
  - Helps verify that switching e.g. `tab=doclist` ↔ `tab=main` on the same application does **not** trigger a full background reload.

### 7.0.52
- Added broader feature diagnostics in operation logs:
  - source-level parse summaries for main/doclist/event/family/legal/ueMain
  - sidebar context logs (current Register tab + sidebar view)
  - richer prefetch plan/finish logs with per-source status summaries
- Operation console now renders **latest entries first**.
- Prevented repeated automatic full-source reloads on same-case tab/page changes within the same browser page session.
  - Auto prefetch now runs only on initial case load (or manual forced reload).
  - Focus events no longer trigger background full-source reload checks.
- Increased per-case log retention to reduce perceived console "clearing" from log rollover.

### 7.0.51
- Fixed PDF URL resolution for EPO doclist links that use `javascript:NewPDFWindow(...)` handlers.
  - Extracts and normalizes `application?documentId=...` links from javascript pseudo-URLs.
  - Allows direct `documentId` endpoints as resolvable PDF candidates (without requiring `.pdf` suffix in URL).
  - Adds `normalizedDocUrl` to failure logs for easier debugging when URL resolution still fails.

### 7.0.50
- Expanded PDF parse diagnostics in the sidebar operation console:
  - Logs whether communication date was detected and what evidence pattern matched.
  - Logs whether a response-period month value was detected.
  - Always logs the line immediately below **"Registered Letter"** (or reports not found) as proof the PDF text was opened/extracted.
  - Adds aggregate PDF parse summary counters (scanned docs, communication-date hits, response-period hits, registered-letter proof hits).
- Hardened PDF category matching for spacing/format variants (e.g. `Art. 94 (3)`).

### 7.0.49
- Improved PDF deadline parsing for prosecution communications:
  - Better extraction of the **communication date** from PDF header/table fields (e.g. `Date 14.11.2025`).
  - Better extraction of response periods phrased as **"within a period of X months"** / **"period of X months"**.
  - Deadlines are now derived from the extracted communication date + response period (with doclist date fallback).
  - Added stronger explicit-deadline detection (`final date`, `no later than`, `latest by`) when present.
  - Switched PDF text extraction to layout-aware line reconstruction for more reliable pattern matching.

### 7.0.48
- Improved publication extraction robustness (handles spaced/formatted publication numbers and date/number order variations).
- Broadened publication label matching on the main page (`Publication*` variants).
- Updated selected sidebar tab styling for better readability (dark text on selected tab).

### 7.0.47
- Broader **Overview** deduplication pass:
  - Combined **Type** + **Stage** into a single `Type / stage` row.
  - Consolidated actionable activity into a single **Latest actions** row (EPO + Applicant).
  - Replaced standalone `Days since applicant response` row with a compact **Waiting on** summary.
  - Reduced deadline repetition by excluding the active `Next deadline` from detailed deadline rows.

### 7.0.46
- Tidied the **Overview → Renewals** panel to reduce duplicate rows.
- Folded latest paid renewal event into **Patent year status** and removed the separate **Latest renewal** line.
- Merged grace-period timing into **Next fee year / due** for a more compact renewal summary.

### 7.0.45
- Added a **Current option values** block in **Options** listing all sidebar parameters and their effective values.

### 7.0.44
- Added an **Operation console** under the **Options** tab to show live sidebar activity (prefetch/fetch/parse/cache/manual actions) for the current application.
- Added a one-click **Clear operation console** action in Options.

### 7.0.9
- Restored visual document grouping headers on the native **All documents** page (`tab=doclist`).
- Added stable regrouping behavior on init/focus/visibility updates.

### 7.0.8
- Moved timeline inclusion/importance controls from Timeline tab into **Options** tab.
- Reordered overview to put **Deadlines & clocks** before **Actionable status**.
- Added actionable countdown logic (days since applicant response vs days to deadline) with color severity.
- Improved title language preference (English first where available).
- Expanded divisional detection heuristics and parent-link support.
- Renewals panel redesigned around patent-year progression + next fee countdown.

### 7.0.7
- Added UPC registry cross-check integration for opt-out status.
- Added Tampermonkey cross-origin permissions for `unifiedpatentcourt.org`.

### 7.0.6
- Added timeline group collapse UX improvements and better repeated-text cleanup.

### 7.0.5
- Removed IPC/CPC and logs/debug tab from sidebar UI.
- Improved sidebar data fallback/cleanup and consolidated to a single canonical `README.md`.

### 7.0.4
- Timeline grouped bundles became collapsible/minimizable.
- Added fallback for “Most recent event” when missing on main source.
- Added publication fallback inference from document rows.

### 7.0.3
- Improved title extraction preference for explicit `Title` values.

### 7.0.2
- Fixed options checkbox persistence across toggles/reloads.
- Normalized option value handling and timeline density validation.

---

## ⚠️ Notes

- Some fields are heuristic by nature (deadlines, renewal interpretation, UPC/UE inference).
- Register source availability/format can vary by case and by EPO page changes.
- If data looks stale, run a manual background reload from the Options panel.

---

## 📄 License

Repository owner’s license/terms apply.
