# EP Register Pro — Validation Case Matrix

This matrix is used to validate sidebar correctness across different prosecution states and UPC outcomes.

## Core Cases

> **Matrix rule:** the primary case identifier must be the **EP application number** (not publication number).

| Application # | Purpose | Key Checks | Publication Ref (optional) |
|---|---|---|---|
| `EP25203732` | Active polishing target (title/status/deadline/divisional behavior) | English title selection, non-duplicated status, divisional type+parent link, applicant-vs-EPO waiting logic, renewal countdown | — |
| `EP19205846` | Withdrawn/deemed-withdrawn behavior | Status simplification, stage vs status separation, event/timeline cleanup, publication fallback behavior | — |
| `TODO_APP_NO_FOR_UPC_POSITIVE` | UPC opt-out positive control | UPC registry lookup should resolve as opted out | `EP4438108` |
| `TODO_APP_NO_FOR_UPC_NEGATIVE` | UPC opt-out negative control | UPC registry lookup should resolve as no opt-out found | `EP3816364` |

---

## Extended Candidate Discovery (from live case context)

Use these derivation paths to add additional EP cases for regression:

1. **Divisional/parent link traversal**
   - If sidebar shows parent case in Type row, validate both child and parent.

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
- [ ] Positive control (`TODO_APP_NO_FOR_UPC_POSITIVE`; publication ref `EP4438108`) resolves as opted out.
- [ ] Negative control (`TODO_APP_NO_FOR_UPC_NEGATIVE`; publication ref `EP3816364`) resolves as no opt-out found.

### All Documents page (`tab=doclist`)
- [ ] Bundle grouping headers are present and stable after focus/visibility changes.

---

## Regression Commands

```bash
node tests/userscript_smoke.test.js
node tests/userscript_regression.test.js
```

---

## Notes

- Deadlines are heuristic unless explicit legal/date anchors exist.
- Use **application numbers** as matrix case IDs; if a publication reference is needed, store it in the `Publication Ref` column.
- UPC registry checks depend on endpoint availability and parseable result markup.
- Case-specific anomalies should be recorded with screenshot + URL + timestamp.
