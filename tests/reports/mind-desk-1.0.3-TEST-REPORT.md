# Mind Desk 1.0.3 — Test report

Date: 22 Oct 2026 · Tested file: `mind-desk.html` extracted from `mind-desk-1.0.3.zip` (sha256 0ae7dbef54a9b3740d426501cd20398456d373d3502cf703de40fae88fa4294d) · Chromium 141.0.7390.37 (Playwright 1.56), page opened from a `file://` URL · AI replaced by `tests/fake-ollama.js` (now also returns thinking, rejects the thinking switch for one model, and can write <think> tags); one check uses a real Ollama 0.40.7 (no model).

## Results

| Suite | Result |
|---|---|
| Main suite | 24/24 |
| Review 1 suite | 18/18 |
| Review 2 suite | 17/17 |
| 1.0.3 suite (Fast/Careful) | 11/11 |

## New in 1.0.3 (tests/v103-tests.js)

| # | Test | Result |
|---|---|---|
| T1 | new install: model qwen3.5:9b, Fast mode, Fast/Careful choice next to Organize all | pass |
| T2 | Fast: no thinking, fixed JSON format; nothing to show | pass |
| T3 | Careful: the AI thinks in every step; thinking is saved and folded away | pass |
| T4 | Careful steps can be switched off one by one in Settings | pass |
| T5 | "Ask AI again" offers Fast and Careful for one item | pass |
| T6 | a model that cannot think still works in Careful mode | pass |
| T7 | thinking written inside <think> tags is moved out of the answer | pass |
| T8 | 1.0.2 setting "think" on becomes Careful; off stays Fast | pass |
| T9 | thinking survives backup and restore; damaged thinking is refused | pass |
| T10 | Careful mode gives the AI more room for long notes | pass |
| T11 | the quick test note in Settings shows the mode and folded thinking | pass |

One test was corrected while writing it: T10 first used a short note, where the standard 8,192-token context already leaves room for thinking, so the size correctly did not change; it now uses a long note.

## Not tested

- Real thinking output, speed and quality of `qwen3.5:9b` on the owner's laptop (model downloads are blocked in the build sandbox). Whether Ollama returns the thinking separately for this model is expected from Ollama's API but not verified here; if it does not, the thinking box simply stays empty or `<think>` tags are moved out.
- `Open Mind Desk.bat` on Windows; folder saving with a real folder picker; Firefox.
