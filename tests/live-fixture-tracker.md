# Live Fixture Tracker

Keep this file current. When a user asks for more real Register/UPC coverage:
- retry every `missing` tab/capture below
- add newly captured HTML under `tests/fixtures/cases/<application>/` or `tests/fixtures/upc/`
- update this file in the same commit
- when every requested capture is complete, explicitly tell the user

## Coverage legend
- `captured` = real HTML saved in repo
- `missing` = wanted but not yet captured successfully
- `n/a` = not relevant for this case/source

## Current EP Register case coverage

| Application | Publication / label | Purpose | main | legal | event | family | doclist | federated | citations | ueMain | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `EP24837586` | `EP4623169 A1` | active parent / family / Euro-PCT baseline | captured | captured | captured | captured | captured | missing | missing | captured | already in real case fixtures; federated/citations still not captured |
| `EP25203732` | `EP4644110 A2/A3` | active divisional child / parent link / search-publication path | captured | missing | captured | captured | captured | missing | missing | missing | child half of the recommended parent/divisional branching pair; legal/federated/citations/ueMain still missing |
| `EP24189818` | `EP4438108 A2/A3` | divisional child + renewal-heavy grant-intention flow / UPC positive publication | captured | captured | captured | captured | captured | missing | missing | missing | explicitly paired with parent `EP19871250 / EP3863511`; federated/citations/ueMain still missing; UPC positive control captured separately |
| `EP19205846` | `EP3816364 A1` | deemed-withdrawn / renewal-history / UPC negative publication | captured | captured | captured | captured | captured | missing | missing | missing | federated/citations/ueMain not yet saved; UPC negative control captured separately |
| `EP19871250` | `EP3863511 B1 / C0` | granted baseline + Euro-PCT + unitary effect happy-path | captured | missing | captured | captured | missing | captured | captured | captured | parent half of the recommended branching parent/divisional pair; legal/doclist still missing after this run |
| `EP22809254` | `WO2023081017 A1` | Euro-PCT non-entry withdrawal + partial/final international-search packet mix | captured | captured | captured | captured | captured | missing | missing | missing | strong non-entry Euro-PCT withdrawal control; real-world `Partial international search` + `International search / IPRP` packet grouping |
| `EP24163939` | `EP4397970 A2/A3` | divisional R71 / grant-intended control | captured | captured | captured | captured | captured | missing | missing | missing | clean `Grant of patent is intended` control with dense R71 + response-to-grant packets |
| `EP23182542` | `EP4270008 A2/A3/B1` | granted divisional with withdrawal/further-processing conflict history | captured | captured | captured | captured | captured | missing | missing | missing | useful conflict case: deemed withdrawn after R71, then further processing, then grant |
| `EP25193159` | `EP4682536 A2/A3` | divisional search-stage control with extended-ESR annex | captured | captured | captured | captured | captured | missing | missing | missing | useful for search-packet nuance (`Document annexed to the Extended European Search Report`) and parent-family linkage |

## UPC coverage

| Publication | Purpose | Capture |
|---|---|---|
| `EP3816364` | UPC negative control | captured |
| `EP4438108` | UPC positive control | captured |

## Requested cases queue

| Requested label | Register application | Status | Notes |
|---|---|---|---|
| `P1 baseline happy path — EP17751711.7 / EP3496607B1` | `EP17751711` | missing | target clean Euro-PCT granted baseline without UP; useful control against `EP19871250` |
| `P1 direct EP seed — EP23160622.9 / EP4243380` | `EP23160622` | missing | treat as direct-EP parsing seed; not yet verified as first filing vs convention filing |
| `P1/P5 Mauer family spine — EP24837586 / EP4623169 + EP25203726 / EP4644109 + EP25203732 / EP4644110 + PCT/EP2024/087573 / WO2025132902` | `EP24837586` + siblings | partial | `EP24837586` and `EP25203732` are already captured; still missing sibling `EP25203726`; use this family for cross-family role labelling and EP+PCT parsing |
| `P1 backup Euro-PCT family — EP20831233.0 / EP3989815` | `EP20831233` | missing | backup non-Element-Science Euro-PCT fixture from different family |
| `P1 backup Euro-PCT family — EP20735516.5 / EP3987119` | `EP20735516` | missing | backup non-Element-Science Euro-PCT fixture from different family |
| `3511B1 — good granted EP baseline, richer because Euro-PCT + later unitary effect` | `EP19871250` | partial | captured `main/event/family/federated/citations/ueMain`; still missing `legal` and `doclist` |
| `P2 — branching procedural paths: parent/divisional pair (EP19871250 / EP3863511 parent + EP24189818 / EP4438108 divisional)` | `EP19871250` + `EP24189818` | partial | strong real branching pair; `EP24189818` is already broadly captured, but parent `EP19871250` still needs `legal` and `doclist`; child `EP24189818` still needs `ueMain` |
| `P3/P4 deadline-heavy + grant + UP — EP19871250.7 / EP3863511B1` | `EP19871250` | partial | already in live fixtures; strongest single public case for EP-phase entry → examination → grant-intention → grant fee → grant → UP transitions |
| `P3/P4 deadline-heavy + grant without UP — EP17751711.7 / EP3496607B1` | `EP17751711` | missing | wanted as non-UP control for grant / post-grant lapse handling |
| `P3/P4 repeated grant-intention churn — EP24189818.8 / EP4438108A3` | `EP24189818` | partial | broadly captured already; still missing `ueMain`; use as latest-controlling-deadline / repeated-R71 control |
