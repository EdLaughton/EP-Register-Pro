# EP Register Pro — Validation Case Matrix

This matrix is used to validate sidebar correctness across different prosecution states and UPC outcomes.

Per-tab live capture status is tracked separately in `tests/live-fixture-tracker.md`.

## Core Cases

> **Matrix rule:** the primary case identifier must be the **EP application number** (not publication number).

| Application # | Purpose | Key Checks | Publication Ref (optional) |
|---|---|---|---|
| `EP24837586` | Parent / family / active Euro-PCT baseline | Main-page title/applicant/rep extraction, divisional children, event/legal/doclist/family hydration, parent-side family publication coverage | `EP4623169` |
| `EP25203732` | Active divisional child | English title selection, divisional type + parent link, search-publication path, family/publication crossover to parent case, reminder/search-opinion doc coverage | `EP4644110` |
| `EP19205846` | Withdrawn/deemed-withdrawn + renewal-history + UPC opt-out negative control | Status simplification, repeated R71 cycles, deemed-withdrawn outcome, renewal-fee extraction, publication fallback behavior, UPC lookup resolves as no opt-out found | `EP3816364` |
| `EP24189818` | Divisional child / branching procedural path / renewal-heavy / UPC opt-out positive control | Parent link to `EP19871250`, repeated grant-intention cycles, renewal-fee extraction through later years, family/publication linkage, UPC registry lookup resolves as opted out | `EP4438108` |
| `EP19871250` | Parent granted baseline + Euro-PCT + unitary effect | Parent half of the `EP19871250` ↔ `EP24189818` divisional pair; granted/no-opposition happy path, unitary effect extraction, federated-register national/UP summary, citations grouping, B1/C0 family/publication coverage, post-grant lapse signals | `EP3863511` |
| `EP22809254` | Euro-PCT non-entry withdrawal + partial/final international-search packet mix | Deemed-withdrawn non-entry posture, Euro-PCT deadline heuristics, real-world `Partial international search` + `International search / IPRP` packet labelling, WO-family publication carry-through | `WO2023081017` |
| `EP24163939` | Divisional R71 / grant-intended control | Parent-link parsing, intention-to-grant packet grouping, response-to-intention packet grouping, R71 deadline family, later renewal-year carry-through before grant | `EP4397970` |
| `EP23182542` | Granted divisional with withdrawal/further-processing conflict history | Tests precedence-sensitive posture: deemed-withdrawn after R71, later further processing, then grant; also preserves parent/child family publications and post-grant deadline windows | `EP4270008` |
| `EP25193159` | Divisional search-stage control with extended-ESR annex | Search-stage divisional with `Document annexed to the Extended European Search Report`; useful for packet-grouping nuance and parent-family publication carry-through | `EP4682536` |
| `EP23758527` | Euro-PCT deemed-withdrawn / further-processing recovery control | Non-reply-to-written-opinion loss, later further processing, and revived request-for-examination posture in one real case | `EP4569331` |
| `EP23758526` | Euro-PCT deemed-withdrawn / further-processing recovery sibling | Same Oxford Nanopore family pattern as `EP23758527`, but with duplicated further-processing decisions and slightly different doc packet shape | `EP4569330` |
| `EP23758524` | Euro-PCT deemed-withdrawn / further-processing recovery sibling | Third Oxford Nanopore sibling for the same non-reply/further-processing pattern; useful against overfitted one-off heuristics | `EP4569328` |
| `EP23721286` | Euro-PCT deemed-withdrawn / further-processing recovery variant | Similar non-reply/further-processing recovery pattern, but with an IPRP copy in the search packet | `EP4508203` |
| `EP22812869` | Second Euro-PCT non-entry withdrawal control | Sibling to `EP22809254`; useful for testing non-entry posture without the partial-ISR packet and with a slimmer IPRP copy set | `WO2023081016` |
| `EP22153706` | Divisional deemed-withdrawn with explicit reason coding | Good real case for non-payment / designation-fee / non-reply reason wording and parent-link carry-through | `EP4008170` |
| `EP22209859` | Clean divisional no-opposition / post-grant control | Strong direct comparison against messier grant/post-grant cases; includes R71, grant, no-opposition, and lapse signals | `EP4163756` |
| `EP20816706` | Clean Euro-PCT no-opposition / post-grant control | Euro-PCT baseline with R71, grant, no-opposition, lapse signals, and WO→EP publication carry-through | `EP4054309` |

## Queued high-value additions

| Application # | Purpose | Why it matters | Publication Ref (optional) |
|---|---|---|---|
| `EP17751711` | Granted Euro-PCT baseline without UP | clean grant path + post-grant lapse signals; best control against `EP19871250` | `EP3496607` |
| `EP23160622` | Direct EP parsing seed | cleaner non-PCT HTML/input shape for parser coverage | `EP4243380` |
| `EP20831233` | Backup non-Element-Science Euro-PCT fixture | different family / bulletin source for Euro-PCT parsing backup | `EP3989815` |
| `EP20735516` | Backup non-Element-Science Euro-PCT fixture | different family / bulletin source for Euro-PCT parsing backup | `EP3987119` |
| `EP25203726` | Mauer sibling divisional | completes the captured Mauer family spine for sibling-role / family parsing checks | `EP4644109` |

---

## Extended Candidate Discovery (from live case context)

Use these derivation paths to add additional EP cases for regression:

1. **Divisional/parent link traversal**
   - If sidebar shows parent case in Type row, validate both child and parent.
   - Current high-value real pair: `EP19871250 / EP3863511` (parent) ↔ `EP24189818 / EP4438108` (divisional child).

2. **Priority chain traversal**
   - Extract EP/WO numbers from Priority section and test related EP numbers where available.

3. **Patent family traversal**
   - Pull EP publications from family/publication blocks and test those with Register pages.

4. **Timeline/legal document traversal**
   - For cases with distinct legal events, validate event title extraction against timeline rows.

---

## Field-Level Acceptance Checklist

For each case, verify these fields:

### Overview
- [ ] **Title** uses English where available and strips language labels/bracket clutter.
- [ ] **Type** correctly identifies divisional where applicable.
- [ ] **Type** shows parent EP link when detected.
- [ ] **Status badge** shows concise status meaning (no repeated multiline payload).
- [ ] **Stage** remains independent from status text.
- [ ] **Designated states** absent (removed by design).

### Actionable / Deadlines
- [ ] Deadlines panel appears above actionable status.
- [ ] Next deadline surfaced in actionable block.
- [ ] If waiting on EPO: show days since applicant response.
- [ ] If waiting on applicant: show days to deadline.
- [ ] Proximity coloring behaves as expected (ok/warn/bad).

### Timeline
- [ ] Group headers collapsed by default.
- [ ] Group arrow visible and clear; rotates on expand.
- [ ] Group item count visible in header.
- [ ] Event/legal items have meaningful titles (no repeated “Event date:” labels).

### Options
- [ ] Timeline include/exclude and importance controls exist in Options tab.
- [ ] Option changes persist after reload/navigation.

### Publications
- [ ] If direct publication parse empty, fallback inference from doc rows activates.
- [ ] Publication list non-empty where source evidence exists.

### UPC / UE
- [ ] Opt-out status is registry-backed when lookup succeeds.
- [ ] Positive control (`EP24189818`; publication ref `EP4438108`) resolves as opted out.
- [ ] Negative control (`EP19205846`; publication ref `EP3816364`) resolves as no opt-out found.

### All Documents page (`tab=doclist`)
- [ ] Bundle grouping headers are present and stable after focus/visibility changes.

---

## Regression Commands

```bash
node --check script.user.js
npm test
```

---

## Notes

- Deadlines are heuristic unless explicit legal/date anchors exist.
- Use **application numbers** as matrix case IDs; if a publication reference is needed, store it in the `Publication Ref` column.
- UPC registry checks depend on endpoint availability and parseable result markup.
- Case-specific anomalies should be recorded with screenshot + URL + timestamp.
