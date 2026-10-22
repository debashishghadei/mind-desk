# Mind Desk 1.0.4 — Test report

Date: 22 Oct 2026 · Tested file: `mind-desk.html` extracted from `mind-desk-1.0.4.zip` (sha256 148d51a6cdb6d9616ff7a23608e11956d5f0b60108a6ee779361e2732837e70b) · Chromium 141.0.7390.37 (Playwright 1.56), `file://` page · AI replaced by `tests/fake-ollama.js`, which now streams answers like Ollama (NDJSON, thinking first) and can think endlessly (`LONGTHINK`) · one check uses a real Ollama 0.40.7 (no model).

## Results

| Suite | Result |
|---|---|
| Main suite | 24/24 |
| Review 1 suite | 18/18 |
| Review 2 suite | 17/17 |
| 1.0.3 suite (Fast/Careful) | 11/11 |
| 1.0.4 suite | 10/10 |

## New in 1.0.4 (tests/v104-tests.js)

| # | Test | Result |
|---|---|---|
| U1 | answers are streamed; while the AI works a seconds counter and its live thinking are shown | pass |
| U2 | thinking longer than the limit is stopped and answered in Fast mode, with a note on the item | pass |
| U3 | one place rule: AI tags ignored, old AI tags removed once, tasks only in To-do | pass |
| U4 | "Organize this note" organizes only that note | pass |
| U5 | the menu can be hidden and shown; the choice is remembered | pass |
| U6 | "Clean up wording" changes the prompt and allows rewording, but still guards facts | pass |
| U7 | "Fix my typing" in the editor: preview, then use it (whole text or only the selected part) | pass |
| U8 | Report for Claude: one note, with original, items, warnings, thinking, timings; names hidden | pass |
| U9 | Report from Settings: items waiting for review; API key never included; runLog not in backups | pass |
| U10 | report can be saved into the connected Mind Desk folder (Reports) | pass |

## Intended changes to earlier tests

- Main suite, "review: Job page …": job tasks are no longer listed on the Job page; it now checks the link "1 open task for this area is in To-do" (one place rule, owner's request).
- Review 1, R15: the Job Markdown file no longer repeats tasks; tagged notes are still included.

## Not tested

- Real streaming and thinking of `qwen3.5:9b` on the owner's laptop (no model download in the build sandbox). The stand-in follows Ollama's documented stream format.
- Whether Careful was really stuck or only slow in 1.0.3: the live panel in 1.0.4 will show it.
- `Open Mind Desk.bat` on Windows; folder saving with a real folder picker; Firefox.
