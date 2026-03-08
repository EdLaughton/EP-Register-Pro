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

Run the smoke test:

```bash
node tests/userscript_smoke.test.js
```

---

## 📝 Changelog (recent)

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
