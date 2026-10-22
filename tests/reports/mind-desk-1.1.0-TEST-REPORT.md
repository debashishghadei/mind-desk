# Mind Desk 1.1.0 — Test report

Date: 22 Oct 2026 · Tested file: `mind-desk.html` extracted from `mind-desk-1.1.0.zip` (sha256 379f61151956d1401d8d6ab9642c174dc34f6ef684bae256506485307e1c426a) · Chromium 141.0.7390.37 (Playwright 1.56), `file://` page · AI replaced by `tests/fake-ollama.js` (now also answers chat messages: suggests actions, memory, a made-up id to check filtering) · one check uses a real Ollama 0.40.7 (no model).

## Results

| Suite | Result |
|---|---|
| Main suite | 24/24 |
| Review 1 suite | 18/18 |
| Review 2 suite | 17/17 |
| 1.0.3 suite (Fast/Careful) | 11/11 |
| 1.0.4 suite | 10/10 |
| 1.1.0 suite (Chat + Memory) | 12/12 |

## New in 1.1.0 (tests/v110-tests.js)

| # | Test | Result |
|---|---|---|
| C1 | Chat page: send with Enter, answer appears, chats are kept after reopening | pass |
| C2 | the AI gets Memory, words and only the notes that match (not everything) | pass |
| C3 | suggested changes need Apply; Cancel changes nothing; made-up ids are left out | pass |
| C4 | tasks: mark done and add a task from the chat | pass |
| C5 | "remember …" becomes a Memory card; saved memory is used when organizing | pass |
| C6 | "organize again" from the chat redoes only that note, with the instruction | pass |
| C7 | "show me note 4" shows its items inline; links open the item or note | pass |
| C8 | changing a category in Review offers to teach Mind Desk | pass |
| C9 | Memory page: add, edit, delete; old "My rules" move into Memory once | pass |
| C10 | chats and memory are in backups; damaged chats are refused; ids cannot inject HTML | pass |
| C11 | Careful in chat: thinking folded under the answer; Stop works mid-answer | pass |
| C12 | copy & paste mode: chat prompt to copy, pasted answer is used | pass |

## Intended changes to earlier tests

- Main suite: answers to "what does this note mean?" questions and rules are now checked in Memory instead of "My rules" (merged in 1.1.0).
- 1.0.4 suite U3: data version is now 3 (was 2).

## Not tested

- How well the real `qwen3.5:9b` follows the chat format and picks the right ids and categories (no model download in the build sandbox). The app drops anything invalid, so the worst case is an answer without useful suggestions.
- `Open Mind Desk.bat` on Windows; folder saving with a real folder picker; Firefox.
