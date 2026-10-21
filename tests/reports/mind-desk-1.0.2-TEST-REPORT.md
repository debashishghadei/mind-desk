# Mind Desk 1.0.2 — Test report

Date: 21 Oct 2026 · Tested file: `mind-desk.html` extracted from `mind-desk-1.0.2.zip` (sha256 6b88abfc39064dff86e8ebf62aac4cd56dc35c3ed4d5054c6337406b9ac56f77) · Chromium 141.0.7390.37 (Playwright 1.56), page opened from a `file://` URL · AI replaced by `tests/fake-ollama.js`; one check uses a real Ollama 0.40.7 (no model).

**Results on 1.0.2: main suite 24/24 · review 1 suite 18/18 · review 2 suite 17/17. The review 2 suite on 1.0.1: 0/17 (every point confirmed).**

## ChatGPT review of 1.0.1 — point by point

Each point got a test first, run on 1.0.1 (must fail if the point is right), then on 1.0.2.

| Point | Test | 1.0.1 | 1.0.2 | Verdict |
|---|---|---|---|---|
| S1 | two quick saves in one window do not block it or lose the second change | fail | pass | Right |
| S2 | a note not yet saved when another window takes over can be recovered | fail | pass | Right |
| S3 | folder saving stops when nothing changes | fail | pass | Right (3 extra folder writes in 4.5 s while idle on 1.0.1) |
| S4 | a window that lost control cannot finish an older folder backup over a newer one | fail | pass | Right |
| S5 | after "Use Mind Desk here" the saved folder connection is picked up | fail | pass | Right |
| S6 | backups with a damaged question list, prompts, words or settings are rejected | fail | pass | Right |
| S7 | ids in a backup cannot inject HTML | fail | pass | Right, and worse than stated: the injected code actually ran in 1.0.1 |
| S8 | splitting finds the matching original words (and never calls the cleaned text "original") | fail | pass | Right |
| S9 | other buttons do not throw away text you are editing | fail | pass | Right |
| S10 | long notes: unchanged text gives no warning; one fixed typo shows as one change | fail | pass | Right |
| S11 | swapped numbers, added "not" and moved "not" are caught; normal fixes of "dont"/"nto" are not | fail | pass | Right |
| S12 | "done" is judged per task, and "not done" is not done | fail | pass | Right |
| S13 | task check: invented tasks sharing a word are flagged; a real task next to "not Amit" is not | fail | pass | Right |
| S14 | no warning for a curly apostrophe, upper case, or '2day' → 'today' | fail | pass | Right |
| S15 | "Use my original" clears the number and "not" warnings too | fail | pass | Right |
| S16 | a failed questions step stays visible on the note after a reload, and can be repeated | fail | pass | Right |
| S17 | if the window-lock feature fails, Mind Desk still starts (protected by the save check) | fail | pass | Right |
| S18 | Real-model acceptance trial | — | — | Right as a suggestion; needs the owner's PC and notes (see below). |

Test fixes made while checking (not app changes): two assertions compared browser elements to null (Node ran out of memory printing them on failure); S3 now waits for saves started before the folder was connected; S16 waits for the save before closing the window.

Intended changes to earlier tests: the original suite's made-up task "do it" is now flagged as not matching its note.

## Main suite and review 1 suite

All 24 main tests and all 18 review-1 tests pass on 1.0.2 (lists in `tests/run-tests.js` and `tests/review-tests.js`).

## Not tested

- Real model (qwen3:8b) on real notes: categories, warning frequency, speed on an RTX 4060. Suggested trial: run 2–3 real Notepad tabs, then count wrong categories, unnecessary warnings, missed meaning changes and seconds per note.
- `Open Mind Desk.bat` on Windows; folder saving with a real folder picker; Firefox.

## Run the tests

```
npm i playwright && npx playwright install chromium
PW=playwright node tests/run-tests.js path/to/mind-desk.html
PW=playwright node tests/review-tests.js path/to/mind-desk.html
PW=playwright node tests/review2-tests.js path/to/mind-desk.html
```
