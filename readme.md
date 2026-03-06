# EP Register Pro (Tampermonkey)

Production userscript for the European Patent Register sidebar.

## What this build includes

- Shared per-application cache across all supported sub-pages (`main`, `doclist`, `event`, `family`, `legal`, `ueMain`).
- Background prefetch with freshness checks, retry, timeout, and incremental cache updates.
- Cross-tab/window synchronization via `localStorage` storage events.
- Sidebar tabs: Overview, Timeline, Options, Logs.
- Timeline de-duplication + grouped document bundles with clear group containers.
- Overview cards for prosecution summary, deadlines, renewals, UPC/UE state, publications, and searchable document index.
- Logs panel with timestamped diagnostics per application (prefetch lifecycle, per-source fetch/parse/cache writes, failures).

## Usage

Install `script.user.js` in Tampermonkey and open an EP Register `/application` page.

## Notes

- The script degrades gracefully when some sources are unavailable or blocked.
- UE/UPC and renewal interpretation are heuristic and include explanatory text to avoid false certainty.
