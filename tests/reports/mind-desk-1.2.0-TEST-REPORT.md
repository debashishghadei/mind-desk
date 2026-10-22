# Mind Desk 1.2.0 — Test report

Date: 22 Oct 2026 · Chromium 141.0.7390.37 (Playwright 1.56).

- PC: `mind-desk.html` extracted from `mind-desk-1.2.0.zip` (sha256 c2d64b87622e6a269b7b1476e4a25db4823ed64cbd44a0c63cbdd8d6b438040e), opened from a `file://` URL, AI replaced by `tests/fake-ollama.js`.
- Artifact: `mind-desk-artifact.html` (sha256 10726386c97a415c62470bbb8724e341bd6309b004bb3c4d3e033e40729b0bf7, the file published to claude.ai), wrapped in the same page skeleton claude.ai adds; `window.claude` replaced by `tests/artifact-stub.js` (in-memory artifact database with the real path rules and the 256 KiB document limit, a stand-in Claude that answers from each prompt's JSON format line and streams in parts, downloads). The stub also replaces `confirm`/`prompt`/`alert` and records any call (there were none).

## Results

| Suite | Result |
|---|---|
| Main suite (PC) | 23/23 (the real-Ollama check runs only with `REAL_OLLAMA`) |
| Review 1 suite (PC) | 18/18 |
| Review 2 suite (PC) | 17/17 |
| 1.0.3 suite (PC, Fast/Careful) | 11/11 |
| 1.0.4 suite (PC) | 10/10 |
| 1.1.0 suite (PC, Chat + Memory) | 12/12 |
| **1.2.0 artifact suite** | **18/18** |

No earlier test was changed. The PC suites still answer the browser's own dialogs, which shows the PC version still uses them.

## New in 1.2.0 (tests/artifact-tests.js)

| # | Test | Result |
|---|---|---|
| A1 | the file is a page fragment with the title first; Settings show “AI: Claude”, no Ollama, folder or theme settings | pass |
| A2 | Organize all (Fast): one split, one questions and one organize request for two notes, all on the quick model, no cache; the IGS question is answered and saved; typos fixed; tasks found | pass |
| A3 | Careful uses the default model; Ask AI again ⚡/🧠 sends one request on the matching model | pass |
| A4 | records live only under `data/users/<id>`; every document < 256 KiB; a 120,000-character Odia/Hindi note is split into parts and comes back identical after a reload | pass |
| A5 | in-page questions: Cancel and Escape keep the note, Delete removes it and its database records; Rename asks for text in the page; no browser dialog is ever called | pass |
| A6 | another device saves a newer version: the page stops writing (0 writes after), then “Load the newest version” shows the other device's note | pass |
| A7 | “not allowed” and “usage limit” from Claude stop the run after one request with a plain message (no Ollama help); notes are kept; the next press finishes the job | pass |
| A8 | an unreadable batch answer is asked again once; after two failures the three notes are organized one by one (exactly 2 + 3 requests) | pass |
| A9 | Stop ends a hanging answer at once; when Claude keeps failing, items get the AI-error mark with the original text, in a bounded number of requests | pass |
| A10 | Download backup / Markdown / report go through the save prompt with the right file names; a PC backup (provider Ollama) restores and the AI stays Claude; the restored note is saved to the database | pass |
| A11 | chat: the reply text appears while Claude writes; the suggested move waits for Apply; Remember saves to Memory; chat requests are not cached | pass |
| A12 | Fix my typing in the editor asks Claude and shows the changes; leaving unsaved changes asks in the page | pass |
| A13 | an answer with a changed number gets one stricter request for that note alone; the warning stays when it is still wrong | pass |
| A14 | 400 px wide: no sideways scrolling on Inbox, Chat, Settings, Review, To-do; ☰ opens the menu over the page, choosing or tapping outside closes it | pass |
| A15 | dark mode follows the viewer; the page never changes claude.ai's `data-theme` | pass |
| A16 | without the database (signed out / preview): works, says “only in this browser”, keeps notes after a reload | pass |
| A17 | without Claude: Organize says Claude is not available here | pass |
| A18 | “Try a quick test note” in Settings answers through Claude | pass |

Also checked by eye (screenshots): desktop light and phone dark for Review, Settings and the in-page question.

## Not tested

- The real claude.ai: Claude's real answers to the batched prompts (quality, whether ~15 notes fit in one answer), the consent prompt, the real database, downloads and the Claude phone app. The page falls back to note-by-note requests when a batch answer cannot be used.
- The PC version on Windows (unchanged from 1.1.0 apart from the menu on narrow windows).
