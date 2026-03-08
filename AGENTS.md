# AGENTS.md — EP Register Pro

You are maintaining a single-file Tampermonkey userscript (`script.user.js`) that augments the European Patent Register.

## What this script must do

Supported Register page types / sources:
- `tab=main` → bibliographic data, status, priorities, publications, recent events
- `tab=doclist` → all documents, grouping, PDF deadline inference inputs
- `tab=event` → event history rows
- `tab=family` → family/publication hydration
- `tab=legal` → legal-status rows + renewal evidence
- `tab=ueMain` → unitary effect / UPC context
- never mount on document-viewer routes (`documentId` URLs)

Primary UI surfaces:
- sidebar views: **Overview**, **Timeline**, **Options**
- native `doclist` page grouping enhancer
- per-case operation console in Options

## Non-regression feature checklist

Do not ship a change unless these remain coherent:
- timeline
- overview
- deadlines
- publications
- family
- legal events
- renewal logic
- unitary effect handling
- opt-out handling
- cross-page cache hydration
- debug logging

Specific EPO expectations:
- timeline merges main/doclist/event/legal/publication evidence
- grouped timeline bundles collapse by default
- overview keeps type/stage, latest actions, waiting-on logic, next deadline, detailed clocks
- PDF-derived deadlines must be reconciled against later applicant/EPO activity
- publication parsing may use main, family, and doclist fallback evidence together
- renewal model must distinguish pre-grant EP, post-grant national phase, and UP central-fee posture
- UPC opt-out lookup must use **EP publication numbers only**, never application numbers
- doclist grouping must preserve stable expand/collapse + select-all behaviour

## Architecture rules

### 1) Audit broadly before editing
Do not patch one symptom in one function and stop.
Whenever you touch parsing, caching, routing, UI, or deadline logic, inspect surrounding modules and the full runtime path:
- route detection
- live DOM parse path
- background fetch path
- cache write/read path
- derived model render path
- tests

### 2) Cache/state ownership
Case cache lives in `localStorage` and is shared across Register subpages.
Source ownership:
- base sources: `main`, `doclist`, `event`, `family`, `legal`, `ueMain`
- derived sources: `upcRegistry`, `pdfDeadlines`

Rules:
- cache entries must carry `parserVersion`, `fetchedAt`, `status`
- **error entries are not fresh**; failed fetches must be retryable
- derived-source freshness must depend on upstream source state, not just age
- if a derived source has no usable input, write an explicit `empty` state when appropriate
- cross-page cache hydration must work regardless of which case tab the user opens first

### 3) UI lifecycle / idempotency
The sidebar and doclist grouping must be idempotent.
Rules:
- never duplicate sidebar mounts
- never duplicate doclist group headers
- route changes must clear stale case-scoped runtime state
- leaving a case page must remove UI and prevent delayed timers from parsing the wrong page
- tab switches / page re-entry must restore UI without stale state bleed
- injected controls must tolerate rerendering

### 4) Observers, listeners, navigation
Tampermonkey/browser hazards are real here.
Rules:
- prefer centralised route handling over scattered ad hoc init calls
- if you add listeners/observers, make them deduplicated and lifecycle-safe
- do not create repeated listeners on rerender
- do not rely on one brittle poll loop when route hooks are possible
- keep any polling as slow fallback only
- visibility/focus handlers must not trigger full background reload spam

### 5) Async/background fetching
Rules:
- dedupe in-flight prefetch for the same case
- cancel stale prefetch when navigating to a different case
- avoid unnecessary network work for fresh sources
- derived fetches (UPC/PDF) must not rerun pointlessly when inputs are unchanged
- failure paths must degrade gracefully and log enough to diagnose live-page issues

### 6) Parsing/rendering discipline
Rules:
- prefer source-derived structured data over incidental DOM order
- selectors must be resilient to minor Register markup changes
- grouping/sorting must reflect model data, not whatever row order happened to be seen first
- if fallback inference exists, integrate it coherently; do not leave partial hydration gaps
- do not preserve dead branches or redundant heuristics just because they already exist

### 7) Logging/debugging
The operation console is part of the product.
Rules:
- log meaningful state transitions, skips, dependency decisions, and failures
- avoid spammy duplicate logs
- when adding complex heuristics, include enough evidence metadata to debug production pages
- prefer structured metadata over vague strings

## Validation before completion
At minimum run:
- `node --check script.user.js`
- `npm test`
- any additional test added for the change

Fixture expectation:
- when touching parsers, page extraction, or PDF deadline logic, prefer representative saved fixtures under `tests/fixtures/` over adding only string-assertion tests

Also explicitly reason-check:
- initial load on each supported page type
- same-case tab switches
- leaving a case page and returning
- no duplicate sidebar
- no duplicate doclist grouping headers/listeners
- cache persistence and invalidation
- derived-source dedupe (UPC/PDF)
- graceful behaviour when fetches fail or sources are missing

## Forbidden behaviour
- narrow symptom patches that ignore root cause
- touching one parser without checking cache/render consequences
- adding more listeners/intervals to hide lifecycle bugs
- treating error cache entries as fresh
- using application numbers for UPC registry lookups
- shipping without validating repeated navigation / re-entry
