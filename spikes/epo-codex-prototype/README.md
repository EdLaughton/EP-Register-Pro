# EPO codex prototype

Small spike to test whether a cleaner **code-first parser core** is viable for a future EP Register sidebar rewrite.

## Why this exists

The current userscript works, but much of its procedural understanding still comes from:
- English status strings
- document-title regexes
- page-specific heuristics

The codex bundle (`epo_bundle.zip`) suggests a better long-term architecture:
- normalize Register events into stable internal keys
- use official/main-event codes when the Register leaks them into HTML
- fall back to text/title heuristics only when codes are absent

## What this prototype does

- loads the codex CSV mappings vendored into `data/`
- parses raw `legal.html` fixture pages for `ORIGINAL CODE: ...`
- maps visible codes to codex internal keys and phases
- combines those mapped events with lightweight current-parser signals
- derives a coarse current posture and a short procedural story

## What it already proves

This is not hypothetical: some current live/Register HTML already exposes codex-useful identifiers such as:
- `EPIDOSNIGR1` → Rule 71(3) / intention to grant
- `0009013` → publication of search report
- `0009210` → expected grant
- `0009261` → no opposition filed within time limit

So a future v2 parser does **not** need to wait for hidden XML endpoints before becoming more structured.

## Current limitations

- it only consumes the subset of codex signals visible in current HTML fixtures
- many procedural-step codes from the bundle (e.g. `RFPR`, `ADWI`, `PMAP`, `OREX`) are not yet surfaced directly in the Register pages we currently store
- the posture model is intentionally small and demonstrative, not a production replacement yet

## Recommended next step

If this spike keeps paying off, the next serious move should be:
1. build a dedicated normalized parser core
2. feed it code-first signals where available
3. keep text/title heuristics as fallback adapters
4. let the sidebar UI consume the normalized model rather than scraping-specific ad hoc flags
