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

| Application | Publication / label | Purpose | main | legal | event | family | doclist | ueMain | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `EP24837586` | `EP4623169 A1` | active parent / family / Euro-PCT baseline | captured | captured | captured | captured | captured | captured | already in real case fixtures |
| `EP25203732` | `EP4644110 A2/A3` | active divisional child / parent link / search-publication path | captured | missing | captured | captured | captured | missing | legal/ueMain not yet saved; retry later |
| `EP24189818` | `EP4438108 A2/A3` | renewal-heavy grant-intention flow / UPC positive publication | captured | captured | captured | captured | captured | missing | ueMain not yet saved; UPC positive control captured separately |
| `EP19205846` | `EP3816364 A1` | deemed-withdrawn / renewal-history / UPC negative publication | captured | captured | captured | captured | captured | missing | ueMain not yet saved; UPC negative control captured separately |
| `EP19871250` | `EP3863511 B1 / C0` | granted baseline + Euro-PCT + unitary effect happy-path | captured | missing | captured | captured | missing | captured | this was requested explicitly from `3511B1`; legal/doclist hit challenge on this run |

## UPC coverage

| Publication | Purpose | Capture |
|---|---|---|
| `EP3816364` | UPC negative control | captured |
| `EP4438108` | UPC positive control | captured |

## Requested cases queue

| Requested label | Register application | Status | Notes |
|---|---|---|---|
| `3511B1 — good granted EP baseline, richer because Euro-PCT + later unitary effect` | `EP19871250` | partial | captured `main/event/family/ueMain`; still missing `legal` and `doclist` |
