## 2026-03-11 progress snapshot

### What is now on shared/extracted helpers
- Main page parsing → `lib/epo_v2_main_parser.js`
- Doclist parsing → `lib/epo_v2_doclist_parser.js`
- Event/legal parsing → `lib/epo_v2_procedural_parser.js`
- Family/citations parsing → `lib/epo_v2_reference_parsers.js`
- UE/federated parsing → `lib/epo_v2_territorial_parser.js`
- PDF deadline parsing → `lib/epo_v2_pdf_parser.js`
- UPC opt-out parsing → `lib/epo_v2_upc_parser.js`
- Doc/status/packet/posture/deadline/timeline/overview semantics → shared `lib/` helpers
- `lib/epo_v2_normalized.js` now composes the extracted helpers instead of carrying older standalone logic
- Runtime/lib parity covers the extracted parser/helper surface across real fixtures

### What is still meaningfully open
- Remaining runtime-only orchestration glue, especially timeline/render composition and some territorial presentation/UI composition
- Live browser validation after the recent extraction wave (reload extension/userscript, spot-check control cases in the attached browser)
- Read and understand `/Users/el326/Downloads/epo_bundle.zip`, then reassess whether rewrite/new script still makes sense
- Final closeout pass on this backlog: verify each remaining item is actually satisfied, then delete this file only once the work is truly done

### Current recommendation
- Treat the codebase as being in the “shared parser/helper extraction mostly done; runtime orchestration cleanup + live validation still open” phase.

# Sidebar Improvement Backlog

_Discovered during live portfolio sweeps on 2026-03-10 (`The Toro Company`, `Oxford Nanopore`) and grounded in newly captured real fixtures._

This file is intentionally opinionated. Not every item below is a bug, but each one would make the sidebar more legible, less lossy, or more trustworthy when prosecution gets messy.

## New real-world controls added alongside this backlog

- `EP22809254` — Euro-PCT non-entry withdrawal + partial/final international-search packet mix
- `EP22812869` — second Euro-PCT non-entry withdrawal control
- `EP24163939` — divisional R71 / grant-intended control
- `EP23182542` — granted divisional with withdrawal/further-processing conflict history
- `EP25193159` — divisional search-stage control with extended-ESR annex
- `EP23758527` / `EP23758526` / `EP23758524` / `EP23721286` — Oxford Nanopore Euro-PCT deemed-withdrawn → further-processing recovery family
- `EP22153706` — divisional deemed-withdrawn with explicit non-payment / non-reply reason coding
- `EP22209859` — clean divisional no-opposition / post-grant control
- `EP20816706` — clean Euro-PCT no-opposition / post-grant control

## Priority 1 — posture accuracy and precedence

### 1) Add a stronger procedural-posture precedence model

**Why:** Some files contain optimistic grant-era documents, a later adverse event, and then a recovery step. The sidebar needs a principled way to decide which posture is controlling _now_.

**Best example:** `EP23182542`
- has `Communication about intention to grant a European patent`
- then `Application deemed to be withdrawn ( translations of claims/payment missing)`
- then `Decision to allow further processing`
- then `Decision to grant a European patent`
- then grant/certificate follow-up

**Desired behavior:**
- identify the **latest controlling procedural state**, not just the most important-sounding document title
- surface recovery steps like **further processing allowed** as explicit posture transitions, not background noise
- keep older grant-intention documents visible, but never let them outrank a later contrary event

### 2) Make the grant-state ladder more explicit

Right now the sidebar would benefit from a clearer distinction between:
- `Grant of patent is intended` / `R71(3)` stage
- `grant formalities completed by applicant`
- `decision to grant issued`
- `patent granted`
- `no opposition filed within time limit`
- `post-grant lapse / validation / national follow-on`

**Best examples:**
- `EP24163939` — clean `Grant of patent is intended` control with dense R71 packet
- `EP23182542` — grant decision + eventual grant after a withdrawal/further-processing detour
- Toro granted controls such as `EP22209859`, `EP20816706` — good clean no-opposition / post-grant baselines from the review sweep

**Concrete UI ideas:**
- a dedicated stage badge or subtitle just for grant posture
- separate wording for:
  - `Grant intended (R71)`
  - `Grant decision issued`
  - `Patent granted`
  - `No opposition filed`

### 3) Keep withdrawn/deemed-withdrawn reasons crisp and first-class

**Why:** “Withdrawn” is too coarse. The reason matters procedurally and strategically.

**Real cases from the sweeps:**
- `EP22809254` — `Application deemed to be withdrawn (non-entry into European phase)`
- Toro `EP22812869` — same non-entry pattern in a separate family
- Toro `EP22153706` — `Application deemed to be withdrawn (non-payment of examination fee/designation fee/non-reply to Written Opinion)`
- Oxford `EP23758527`, `EP23758526`, `EP23758524`, `EP23721286` — `Application deemed to be withdrawn (non-reply to Written Opinion)`
- `EP23182542` — `Application deemed to be withdrawn ( translations of claims/payment missing)` after R71

**Desired behavior:**
- distinguish at least:
  - voluntary withdrawal
  - deemed withdrawn
  - non-entry into EP phase
  - non-reply to written opinion / communication
  - non-payment / missing translations / grant-formality failure
  - loss of rights / Rule 112(1)
- show the **reason** near the posture, not buried in raw doc titles
- avoid flattening terminal and recoverable postures into the same bucket

## Priority 2 — family/divisional clarity

### 4) Surface family role explicitly: child / parent / has-children / sibling-heavy cluster

Portfolio-heavy families get hard to read fast. The sidebar should make it obvious whether the current case is:
- a divisional child
- a parent with one or more divisionals
- one of several near-sibling cases in the same family

**Best examples:**
- `EP24163939` — divisional, parent `EP3440098`
- `EP23182542` — divisional, parent `EP4070092`
- `EP25193159` — divisional, parent `EP4168798`
- Toro and Oxford both produced large clusters of closely related divisional-style filings with near-identical titles

**Desired behavior:**
- explicit labels like:
  - `Divisional child of EP…`
  - `Has divisional children`
  - `Sibling-heavy family`
- clickable/compact parent-child cluster summary in overview

### 5) Normalize parent/child identifiers to application numbers only

**Why:** Family-role data gets confusing if publication numbers leak into app-number lists.

**Best example:** `EP23182542`
- parsed parent: `EP4070092`
- parsed divisional children included both `EP25215625` **and** `EP4671766`
- `EP4671766` is a publication identifier, not an application number

**Desired behavior:**
- parent/child lists should contain **application numbers only**
- publication references can appear separately as publication metadata

## Priority 3 — doc packet naming / grouping nuance

### 6) Decide whether extended ESR should get its own label or richer subtitle

**Best example:** `EP25193159`
- search packet contains:
  - `Communication regarding the transmission of the European search report`
  - `Document annexed to the Extended European Search Report`
  - `European search opinion`
  - `European search report`
  - `Information on Search Strategy`

Today that still groups fine, but the wording could probably be better than a generic `European search package`.

**Two good options:**
- keep the current group, but add a subtitle/tooltip like `includes extended-ESR annex`
- or introduce a distinct label such as `Extended European search package`

### 7) Promote some important single-document packets out of `Other`

Several high-signal singletons currently land in `Other`, which hides useful structure.

**Best examples:** `EP23182542`
- `Decision to grant a European patent` → currently a one-item `Other`
- `Decision to allow further processing` → currently a one-item `Other`
- `Transmission of the certificate for a European patent pursuant to Rule 74 EPC` → currently a one-item `Other`

**Possible improvements:**
- `Grant decision`
- `Further processing`
- `Post-grant formalities`

This would make the doclist feel less like a generic pile and more like a procedural sequence.

### 8) Revisit whether loss-of-rights style docs deserve a more explicit packet name than `Examination`

**Best examples:**
- `EP22809254` — `Application deemed to be withdrawn (non-entry into European phase)` grouped under `Examination`
- `EP23182542` — `Application deemed to be withdrawn ( translations of claims/payment missing)` grouped under `Examination`

That grouping is not wrong, but it is not very informative.

**Possible replacements:**
- `Loss of rights / deemed withdrawn`
- `Grant formalities failure`
- `Euro-PCT non-entry failure`

Even a tooltip would help if a new top-level label feels too broad.

### 9) Be careful with naïve keyword collisions around “grant”

Some document titles include the word `grant` without meaning the case is actually in grant posture.

**Example from the Oxford sweep:**
- `Grant of extension of time limit (examination procedure)`

Any future grant-state heuristics should avoid accidentally treating these as true grant-state milestones.

## Priority 4 — actionable / deadline presentation

### 10) Make deadline output posture-aware after terminal or quasi-terminal events

Some deadline families are useful even after a negative event, but they should be presented carefully so they do not read like live obligations when the case is effectively over.

**Examples:**
- `EP22809254` — useful to preserve Euro-PCT entry logic as explanatory context, but the case is already deemed withdrawn for non-entry
- `EP23182542` — historic R71 and Art. 94 responses coexist with later grant and post-grant windows

**Desired behavior:**
- preserve deadline derivation for auditability
- but visually distinguish:
  - historical / superseded deadline logic
  - currently live deadlines
  - third-party monitoring windows (e.g. opposition)

### 11) Treat recovery windows as first-class actionable states

**Best example:** `EP23182542`
- further processing is not just another doc row; it is a major procedural pivot

**Desired behavior:**
- when a case is revived by further processing / re-establishment / similar relief, surface that explicitly in the sidebar narrative
- ideally link the negative posture and the recovery posture together

## Priority 5 — timeline / explanation quality

### 12) Make the timeline emphasize controlling transitions, not just source rows

The reviewed portfolios reinforce that these moments matter most:
- search report published
- request for examination
- examination begins / ED responsible
- R71 issued
- applicant responds to R71
- deemed withdrawn / loss of rights
- further processing / recovery allowed
- grant decision
- grant
- no opposition filed

**Desired behavior:**
- these transitions should visually stand out more than generic administrative noise
- grouped documents should support the transition, not obscure it

### 13) Add better explanatory text/tooltips for grouped packets

For users who do not live inside EPO procedure every day, compact packet labels still need explanation.

**Examples:**
- `International search / IPRP`
- `Partial international search`
- `Intention to grant (R71(3) EPC)`
- `Response to intention to grant`

**Desired behavior:**
- hover text or secondary text that says what the packet actually represents procedurally
- especially valuable for search-stage and R71-stage packets

## Next-tier fixture candidates (not yet captured here)

These still looked worthwhile during the same sweeps, but are **not** yet captured in this batch:

- `EP22812869` counterpart family members beyond the two captured non-entry controls, if we want a broader non-entry cluster later
- additional Toro granted/post-grant comparators beyond `EP22209859` and `EP20816706`, if we want a wider sample of no-opposition / lapse combinations
- more Oxford sibling filings around the newly captured cluster, if we later want to stress-test sibling/family-role summarisation even harder

## Short version

If only a handful of improvements happen next, they should probably be:

1. posture precedence / conflict resolution
2. sharper grant-state wording
3. sharper withdrawn/deemed-withdrawn reason wording
4. explicit family/divisional role surfacing
5. better labels/subtitles for extended-search and grant-formality singletons
