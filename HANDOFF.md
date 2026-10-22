# Handoff — read this first

**Project:** Mind Desk, a local AI note organizer for the owner (Debashish Ghadei). Plan, decisions and reasons: `DECISIONS.md`.
**Current version:** 1.2.0 (22 Oct 2026): second build, the **claude.ai artifact** (`mind-desk-artifact.html`, D41–D46), published at https://claude.ai/artifact/TBqZt4vWQCZvCSBDFCfP93 (private to the owner; capabilities sample, db, user, downloads). The PC version (`mind-desk.html`) behaves as in 1.1.0. Delivered as `mind-desk-1.2.0.zip` (PC) + `mind-desk-1.2.0-TEST-REPORT.md` + `mind-desk-1.2.0-tests.zip`.
**1.1.0** (22 Oct 2026): Chat + Memory (D37–D40) on top of 1.0.4.
**First real run (22 Oct 2026, 4 notes, Fast):** "did a good job, saved hours"; some typos missed and text partly reworded (owner: fine); Careful "seemed stuck" (likely long thinking without visible progress → D32); notes appeared in several folders (AI tags + linked tasks → D33). Test note: 12.9 s first (model load), 2.3 s after. Owner on 1.1.0: chat works; Careful too slow on his laptop (model spills out of VRAM; advised context 4096 / Fast / 4b model).
**Next:** owner tries the artifact (restore his PC backup there, organize with Fast, check on the phone) and sends a "Report for Claude" for problems. Later: Mind Desk Cloud (Hostinger) in a separate repo; 1.1.1 ideas in the project note.

**Reviews:** ChatGPT review of 1.0.0: 17 testable points (R1–R15, R17, R18) all confirmed by tests failing on 1.0.0 and fixed in 1.0.1; R16 (`OLLAMA_ORIGINS=*`) is a trade-off, see D20. Review tests: `tests/review-tests.js`.
ChatGPT review of 1.0.1: 17 testable points (S1–S17) all confirmed by tests failing on 1.0.1 and fixed in 1.0.2; S18 (real-model trial) still open. Tests: `tests/review2-tests.js`.

## Owner context
- Writes notes fast in ~10 Notepad tabs and some Google Keep notes: heavy typos, mixed topics in one tab, private shortcodes (IGS, hs, FT, HL2, DG, BR, ER…), no dates.
- Most notes are reflections ("mind & life lessons"), plus job notes (Madhu Infotech, CEO, salary), client work, own websites/content/tool ideas, personal goals, and simple to-dos (no deadlines/priorities).
- Windows PC, RTX 4060 8 GB, 32 GB RAM. Ollama installed; `qwen3.5:9b` pulled 22 Oct 2026 (Bionic's models are separate). Also uses AnythingLLM and Bionic (close them while using Mind Desk: they hold RAM). Fan/RAM went high on a terminal test; check `ollama ps` shows 100% GPU.
- Cross-checks work with ChatGPT. Review points are verified with a test before fixing.

## Code map
- `src/core.js` pure logic (blocks, prompts, JSON parsing, guardrails, diff, Markdown). Exposed as `window.MDCore`.
- `src/app.js` interface, AI calls, run loop, storage, folder sync. Debug handle `window.MD`.
- `src/style.css`, `src/index.html`; `node bin/build.js` → `mind-desk.html` and `mind-desk-artifact.html` (both committed). `--zip` → `dist/` (PC only).
- Artifact build: `TARGET`/`ART` in app.js; `src/platform-artifact.js` (`window.MDArtifact`: init of the claude.ai capabilities, database store, mode db/local); `src/artifact.css`. Claude calls: `claudeChat` (inside `aiJSON`), batches: `batched()`, `askBatch`, `organizeClaude`. Questions to the person: `ask()` (native dialogs on the PC, in-page in the artifact). Publish: Artifact tool, same URL, capabilities `{sample:{}, db:{}, user:{}, downloads:true}`.
- Data: one IndexedDB record `state` (with a `rev` number checked on every save) (notes, items, tasks, categories, words, rules, prompts, settings, survey) + `folder` (directory handle) + `recovery` (unsaved copy from a window that lost control). State also has `runLog` (not in backups), `memory`, `chats` and `schema` 3.
- Item status: `pending` (split, waiting for AI) → `review` → `approved`. Note status `new` → `split`.

## Tests
`PW=<playwright path> node tests/run-tests.js [mind-desk.html]` — 24 browser tests from a `file://` URL with `tests/fake-ollama.js`. `REAL_OLLAMA=…` adds a real-Ollama connection check. `node tests/review-tests.js [html]` — 18 tests for review 1; `node tests/review2-tests.js [html]` — 17 tests for review 2 (`ONLY=S3` runs one); `node tests/v103-tests.js [html]` — 11 tests for Fast/Careful and thinking; `node tests/v104-tests.js [html]` — 10 tests for 1.0.4; `node tests/v110-tests.js [html]` — 12 tests for Chat + Memory; `node tests/artifact-tests.js [artifact html]` — 18 tests for the artifact (page wrapped like claude.ai, `tests/artifact-stub.js` replaces `window.claude`). The stand-in AI streams NDJSON when asked (`LONGTHINK` in a note = endless thinking). Results in `tests/last-*.json`.

## Not tested yet
- The artifact on the real claude.ai (Claude's real answers to the batched prompts, the consent prompt, the real database and downloads, the phone app). Tested only with the stand-in.
- A real model's quality on the owner's notes (no model download possible in the build sandbox). First real run will need prompt tuning.
- `Open Mind Desk.bat` on Windows (Edge `--app` with a `file:///` path).
- Folder saving with a real folder (tested with an in-memory stand-in; the API itself is present in Chromium for file pages).

## Next ideas (not built)
- "Recurring themes" view (gather notes that repeat the same idea).
- Send Content ideas to Content Pipeline.
- Google Keep import.
