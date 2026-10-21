# Mind Desk 1.0.1 — Test report

Date: 21 Oct 2026 · Tested file: `mind-desk.html` extracted from `mind-desk-1.0.1.zip` (sha256 f819d05fb501531d7ec0a1500056d0a087a8478a9f36be1f4b587b0b297c36b2) · Chromium 141.0.7390.37 (Playwright 1.56), page opened from a `file://` URL · AI replaced by `tests/fake-ollama.js`; one check uses a real Ollama 0.40.7 (no model) with `OLLAMA_ORIGINS=*`.

**Results: main suite 24/24 passed · review suite 18/18 passed on 1.0.1 (and 0/18 on 1.0.0, i.e. every review test fails on the old version).**

## ChatGPT review of 1.0.0 — point by point

Each point got a test first. It was run on 1.0.0 (must fail if the point is right), then on 1.0.1.

| Point | Test | 1.0.0 | 1.0.1 | Verdict |
|---|---|---|---|---|
| R1 | two open windows cannot silently overwrite each other | fail | pass | Right |
| R1b | the second window can take over; the first one then stops and its data is not reused | fail | pass | Right (extra check) |
| R2 | a failed read at start never turns into an empty app that overwrites data | fail | pass | Right |
| R3 | a damaged backup is rejected before it replaces anything (incl. category loops) | fail | pass | Right |
| R4 | folder copy: notes or categories with the same name do not overwrite each other | fail | pass | Right |
| R5 | after stopping "Ask AI again", a second "Ask AI again" works | fail | pass | Right |
| R6 | copy & paste mode: Stop always ends the run; background is blocked while a window is open | fail | pass | Right |
| R7 | splitting with --- keeps the right original for each part | fail | pass | Right |
| R8 | deleting a note during a run leaves no orphan items or tasks | fail | pass | Right |
| R9 | a storage write that aborts is reported, not left hanging | fail | pass | Right |
| R10 | guardrails catch changed meaning (negation, numbers, short rewrites) but allow heavy typo fixes | fail | pass | Right |
| R11 | tasks: invented tasks are flagged; "done" needs a sign in the note | fail | pass | Right |
| R12 | splitter: lines of one paragraph can become separate items; ----- always separates | fail | pass | Right |
| R13 | questions step reads every note fully (long notes, many notes) | fail | pass | Right |
| R14 | a long note gets a big enough AI context (not cut off) | fail | pass | Right (context part; real-model quality still untested) |
| R15 | folder/Markdown files match the screen (tagged notes, linked tasks) | fail | pass | Right |
| R17 | privacy: backups do not contain the API key; restoring keeps this PC's AI address; remote/cloud AI is warned about | fail | pass | Right |
| R18 | unfinished edits and half-answered questions are not lost silently; setup explains installing Ollama | fail | pass | Right (draft + install-step parts; Windows launcher still untested) |
| R16 | OLLAMA_ORIGINS=* weakens a boundary | — | — | Fair trade-off point, not a bug. Verified on real Ollama 0.40.7: file pages send Origin "null"; default Ollama answers 403; the value "null" makes Ollama stop at start; only `*` works. Kept for now, wording made precise (sites could use the local AI, not read notes). Alternative recorded as D20 (serve Mind Desk from 127.0.0.1 so `*` is not needed) — owner's choice. |

## Main suite (1.0.1)

| # | Test | Result |
|---|---|---|
| 1 | core: blocks keep heading+list, "sol:" and "//" lines together; divider splits | pass |
| 2 | core: bad AI split answers can never lose or reorder text | pass |
| 3 | core: JSON is read from fenced / thinking answers | pass |
| 4 | core: guardrails flag shortened text, changed protected words, unknown category; tasks get a valid to-do list | pass |
| 5 | core: word diff marks only the fixed words | pass |
| 6 | add: paste a note (date added automatically), duplicates refused, empty refused | pass |
| 7 | add: several files at once; non-text files skipped | pass |
| 8 | flow: Organize all → split → questions → answers saved → organize → review | pass |
| 9 | review: tasks stay hidden until approved; approve → category + To-do; tick done | pass |
| 10 | review: job tasks also show in the Job category; change category from the list | pass |
| 11 | edit: "---" splits one item into two; "Join with previous" merges back; "Use my original" restores | pass |
| 12 | persistence: everything is still there after closing and reopening the page | pass |
| 13 | export / restore backup round trip; Markdown export has categories and tasks | pass |
| 14 | folder saving writes Markdown per category, originals and a backup | pass |
| 15 | safety: note text with HTML is shown as text, never run | pass |
| 16 | AI trouble: a shortened answer is retried with stricter rules; broken JSON keeps the original with a warning | pass |
| 17 | Stop: a run can be stopped, the rest waits, and "Organize all" continues later | pass |
| 18 | connection: a default Ollama (blocking file pages) gives the OLLAMA_ORIGINS fix in plain words | pass |
| 19 | connection: missing model is named, with the exact "ollama pull" command; installed models can be picked | pass |
| 20 | real Ollama: Test connection from a file page works with OLLAMA_ORIGINS=* | pass |
| 21 | copy & paste mode: three prompts for ChatGPT/Claude, pasted answers are used | pass |
| 22 | categories: add, rename, delete (items move to Unsorted); words and rules editable | pass |
| 23 | settings: theme, edited prompt is used and can be reset | pass |
| 24 | inbox: "Organize again" and delete remove the note's items and tasks | pass |

Five main-suite expectations were updated on purpose for 1.0.1: line-based splitting (6 blocks / 6 items instead of 4 for the sample note), "done" now needs a sign in the note, and original files now carry a short id in their name.

## Not tested

- Answer quality of a real model (qwen3:8b) on real notes: needs the owner's first real run (model downloads are blocked in the build sandbox).
- `Open Mind Desk.bat` on Windows (paths with spaces, Edge app mode).
- Folder saving with a real folder picker and permission prompts (tested with an in-memory folder).
- Edge's own extra protections for websites calling localhost (relevant to R16).
- Firefox.

## Run the tests

```
npm i playwright && npx playwright install chromium
PW=playwright node tests/run-tests.js path/to/mind-desk.html
PW=playwright node tests/review-tests.js path/to/mind-desk.html
```
