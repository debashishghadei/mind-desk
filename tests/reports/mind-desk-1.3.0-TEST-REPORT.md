# Mind Desk 1.3.0 — Test report

Date: 22 Oct 2026 · Node.js 22.22.0 · Chromium 141.0.7390.37 (Playwright 1.56).

Tested files (the release files themselves, unzipped):
- PC: `mind-desk.html` from `mind-desk-1.3.0.zip` (sha256 4800cb0ff19b69791b20e7360f8a8d08d3d5ca0387db56e65757c903d80d1814), opened from `file://`, AI = `tests/fake-ollama.js`.
- Artifact: `mind-desk-artifact.html` (sha256 7ac3fa359422d9905ee80aee2ce572018f241a107794e5293b168b0c4b2703cc, published to claude.ai as version 4), wrapped like claude.ai wraps it, `window.claude` = `tests/artifact-stub.js`.
- Cloud: the folder from `mind-desk-cloud-1.3.0.zip` (sha256 73df0d4f48a515940aafa6316b43b6ec1486977c867bfda792fd38b178e9bf92), run with `CLOUD_DIR=`; Anthropic and OpenAI APIs = `tests/fake-cloud-ai.js` (streams like the real APIs, including a thinking block that must not be passed on). Also started once with `npm start` from the unzipped folder: `/health` answers, `/` sends to `/setup`, the setup code is written to `data/SETUP-CODE.txt`.

## Results

| Suite | Result |
|---|---|
| Main suite (PC) | 23/23 (the real-Ollama check runs only with `REAL_OLLAMA`) |
| Review 1 suite (PC) | 18/18 |
| Review 2 suite (PC) | 17/17 |
| 1.0.3 suite (PC) | 11/11 |
| 1.0.4 suite (PC) | 10/10 |
| 1.1.0 suite (PC) | 12/12 |
| Artifact suite | 24/24 |
| **Cloud suite (new)** | **11/11** |

No earlier test was changed. During the build, the review 1 test R17 ("backups never contain the API key") failed on a work-in-progress build: an edit had turned the line that removes the key into a comment. Fixed before release; this never reached `main`.

## Cloud tests (tests/cloud-tests.js)

| # | Test | Result |
|---|---|---|
| S1 | first run needs the setup code, a 12+ character password and a correct 6-digit code; the same code never works twice; recovery codes work once; password and recovery codes are not stored in plain text; setup works only once | pass |
| S2 | 5 wrong logins lock the address for 15 minutes (even with the right password), then it opens again; the API refuses calls without login, without the X-MD header or from another site; strict security policy (only the page's own scripts), nosniff; behind HTTPS the cookie is Secure + HttpOnly | pass |
| S3 | a save from an old revision is refused (409); non–Mind Desk data is refused; quick captures wait, a resend is not saved twice, they leave after the app confirms; a damaged data file stops the server instead of starting empty | pass |
| S4 | API key: “no key” message; the saved key never comes back (only the last 4 characters); secrets file readable only by the app; Claude answer streamed without the thinking; cost counted (Haiku price); Fast sends effort low, Careful the model's own; no temperature; at the monthly limit nothing is sent (402); a refused key, OpenAI streaming with usage, and “no credit” | pass |
| S5 | one backup per day; a safety copy on request; changing the password needs the current one and logs out the other devices but not this one | pass |
| B1 | setup in the browser (setup code → authenticator key → code → 8 recovery codes) opens the app; a pasted note is saved on the server; cloud Settings (API key, round trip, login, version), no folder saving; no errors, also none from the security policy | pass |
| B2 | with an API key: test note shows model and cost; 3 notes organized with 2 requests (split + one batch) on Haiku; items show the model; switching to ChatGPT shows “Careful · Sol”; at the limit the run stops with a clear message and sends nothing | pass |
| B3 | full round trip: Send to Claude → the real artifact build restores the file, organizes, adds a Memory entry, downloads its backup → meanwhile a phone idea arrives → Bring back shows a summary (3 new items, 1 Memory change, 1 idea kept), makes a server safety copy, merges, opens Review; settings here stay; the same file again adds no duplicates | pass |
| B4 | phone quick capture: online save; offline save waits on the phone and is sent when online, in order; no sideways scroll at 390 px; the app pulls both into the Inbox and the server forgets them; not logged in → login page | pass |
| B5 | another device saves: this page stops saving, “Load the newest version” shows the other device's note; no sideways scroll at 400 px | pass |
| B6 | Log out in Settings ends the session | pass |

## Not tested

- A real hosting (Hostinger) and HTTPS in front of the app; adding the capture page to a real phone's home screen; offline capture on a real phone.
- Real Anthropic / OpenAI APIs (no keys in the build sandbox): the request format follows the official documentation (model ids, `anthropic-version`, `output_config.effort`, streaming events); the first real request will confirm it. Prices from the official price pages on 22 Oct 2026.
- Windows: `npm start` on the owner's PC (tested on Linux).
