# Mind Desk 1.0.0 — Test report

Date: 21 Oct 2026 · Tested file: `mind-desk.html` extracted from `mind-desk-1.0.0.zip` (sha256 of zip: c22c76eef1a96c5eb210bddfc982d629ae8026a0896545d3d48f940a17316db8)

**Result: 24/24 passed.**

## How it was tested

- Chromium 141.0.7390.37 (Playwright 1.56), page opened from a `file://` URL exactly like on the user's PC.
- AI replaced by `tests/fake-ollama.js`, which copies Ollama's API (`/api/tags`, `/api/chat`) and its browser-origin rules. A second instance behaves like a default Ollama (blocks file pages).
- One check uses a **real Ollama 0.40.7** program (no model, as model downloads are blocked in the build sandbox) started with `OLLAMA_ORIGINS=*`.
- Every test starts with empty storage unless it tests reopening.

## Results

| # | Test | Result | Time |
|---|---|---|---|
| 1 | core: blocks keep heading+list, "sol:" and "//" lines together; divider splits | pass | 0.2 s |
| 2 | core: bad AI split answers can never lose or reorder text | pass | 0.2 s |
| 3 | core: JSON is read from fenced / thinking answers | pass | 0.1 s |
| 4 | core: guardrails flag shortened text, changed protected words, unknown category; tasks get a valid to-do list | pass | 0.2 s |
| 5 | core: word diff marks only the fixed words | pass | 0.1 s |
| 6 | add: paste a note (date added automatically), duplicates refused, empty refused | pass | 0.5 s |
| 7 | add: several files at once; non-text files skipped | pass | 0.2 s |
| 8 | flow: Organize all → split → questions → answers saved → organize → review | pass | 0.6 s |
| 9 | review: tasks stay hidden until approved; approve → category + To-do; tick done | pass | 0.2 s |
| 10 | review: job tasks also show in the Job category; change category from the list | pass | 0.2 s |
| 11 | edit: "---" splits one item into two; "Join with previous" merges back; "Use my original" restores | pass | 0.3 s |
| 12 | persistence: everything is still there after closing and reopening the page | pass | 0.4 s |
| 13 | export / restore backup round trip; Markdown export has categories and tasks | pass | 0.5 s |
| 14 | folder saving writes Markdown per category, originals and a backup | pass | 0.0 s |
| 15 | safety: note text with HTML is shown as text, never run | pass | 0.3 s |
| 16 | AI trouble: a shortened answer is retried with stricter rules; broken JSON keeps the original with a warning | pass | 0.6 s |
| 17 | Stop: a run can be stopped, the rest waits, and "Organize all" continues later | pass | 6.8 s |
| 18 | connection: a default Ollama (blocking file pages) gives the OLLAMA_ORIGINS fix in plain words | pass | 0.5 s |
| 19 | connection: missing model is named, with the exact "ollama pull" command; installed models can be picked | pass | 0.5 s |
| 20 | real Ollama: Test connection from a file page works with OLLAMA_ORIGINS=* | pass | 0.3 s |
| 21 | copy & paste mode: three prompts for ChatGPT/Claude, pasted answers are used | pass | 0.8 s |
| 22 | categories: add, rename, delete (items move to Unsorted); words and rules editable | pass | 0.6 s |
| 23 | settings: theme, edited prompt is used and can be reset | pass | 0.7 s |
| 24 | inbox: "Organize again" and delete remove the note's items and tasks | pass | 0.6 s |

## Real Ollama finding (decision D3)

With Ollama 0.40.7: a request with `Origin: null` (what Edge/Chrome send from a file page) gets **403** with default settings; `OLLAMA_ORIGINS=null` makes Ollama stop at start ("bad origin"); `OLLAMA_ORIGINS=*` works (204 + `Access-Control-Allow-Origin: *`). Origins `http://localhost:*` and `file://*` are allowed by default but do not match a file page.

## Bugs found and fixed during testing

1. Paste window: a delayed focus could move typing from the note box into the name box. Focus is now set once, immediately.
2. Empty-state text: bold words broke onto separate lines (CSS).

## Not tested

- Answer quality of a real model (qwen3:8b) on real notes — first real run will need prompt tuning.
- `Open Mind Desk.bat` on Windows (Edge app mode with a file path).
- Folder saving with a real folder picker (tested with an in-memory folder; the API is available in Chromium for file pages).
- Firefox (no folder saving there; the rest should work).

## Run the tests yourself

```
npm i playwright && npx playwright install chromium
PW=playwright node tests/run-tests.js path/to/mind-desk.html
```
