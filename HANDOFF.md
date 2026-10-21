# Handoff — read this first

**Project:** Mind Desk, a local AI note organizer for the owner (Debashish Ghadei). Plan, decisions and reasons: `DECISIONS.md`.
**Current version:** 1.0.1 (21 Oct 2026). Delivered as `mind-desk-1.0.1.zip` + `mind-desk-1.0.1-TEST-REPORT.md` + `mind-desk-1.0.1-tests.zip`.

**Reviews:** ChatGPT review of 1.0.0: 17 testable points (R1–R15, R17, R18) all confirmed by tests failing on 1.0.0 and fixed in 1.0.1; R16 (`OLLAMA_ORIGINS=*`) is a trade-off, see D20. Review tests: `tests/review-tests.js`.

## Owner context
- Writes notes fast in ~10 Notepad tabs and some Google Keep notes: heavy typos, mixed topics in one tab, private shortcodes (IGS, hs, FT, HL2, DG, BR, ER…), no dates.
- Most notes are reflections ("mind & life lessons"), plus job notes (Madhu Infotech, CEO, salary), client work, own websites/content/tool ideas, personal goals, and simple to-dos (no deadlines/priorities).
- Windows PC, RTX 4060 8 GB, 32 GB RAM. Has Ollama installed but no model pulled yet (as of 21 Oct 2026); also uses AnythingLLM and Bionic.
- Cross-checks work with ChatGPT. Review points are verified with a test before fixing.

## Code map
- `src/core.js` pure logic (blocks, prompts, JSON parsing, guardrails, diff, Markdown). Exposed as `window.MDCore`.
- `src/app.js` interface, AI calls, run loop, storage, folder sync. Debug handle `window.MD`.
- `src/style.css`, `src/index.html`; `node bin/build.js` → `mind-desk.html` (committed). `--zip` → `dist/`.
- Data: one IndexedDB record `state` (with a `rev` number checked on every save) (notes, items, tasks, categories, words, rules, prompts, settings, survey) + `folder` (directory handle).
- Item status: `pending` (split, waiting for AI) → `review` → `approved`. Note status `new` → `split`.

## Tests
`PW=<playwright path> node tests/run-tests.js [mind-desk.html]` — 24 browser tests from a `file://` URL with `tests/fake-ollama.js`. `REAL_OLLAMA=…` adds a real-Ollama connection check. `node tests/review-tests.js [html]` — 18 tests for the review points. Results in `tests/last-*.json`.

## Not tested yet
- A real model's quality on the owner's notes (no model download possible in the build sandbox). First real run will need prompt tuning.
- `Open Mind Desk.bat` on Windows (Edge `--app` with a `file:///` path).
- Folder saving with a real folder (tested with an in-memory stand-in; the API itself is present in Chromium for file pages).

## Next ideas (not built)
- "Recurring themes" view (gather notes that repeat the same idea).
- Send Content ideas to Content Pipeline.
- Google Keep import.
