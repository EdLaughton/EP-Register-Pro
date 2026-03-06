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

### 7.0.4
- Timeline grouped bundles are now collapsible/minimizable.
- Deduped repeated multiline status/designated-state text.
- Added fallback for “Most recent event” from legal events when main is missing.
- Added publication fallback inference from document rows when publication sources are empty.

### 7.0.3
- Removed IPC/CPC from sidebar output.
- Removed Logs/debug tab from visible sidebar UI.
- Improved title extraction by preferring explicit Title field.

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
