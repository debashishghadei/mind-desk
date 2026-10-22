# Mind Desk

Drop in your messy notes. A local AI splits them into separate thoughts, fixes the typos (keeping your words and style), learns your shortcodes through a few questions, and sorts everything into To-do lists and categories. You review every change before it counts.

Everything runs on your PC: one file in Microsoft Edge or Google Chrome, talking to Ollama. No installation, no account, nothing sent to the internet (unless you choose the ChatGPT/Claude copy & paste mode).

## What is in the zip

| File | What it is |
|---|---|
| `mind-desk.html` | The whole app |
| `Open Mind Desk.bat` | Opens Mind Desk in its own window (Edge app mode) |
| `README.md`, `CHANGELOG.md` | This guide and the version history |

## Start

1. Unzip into a folder you keep, for example `D:\MindDesk`.
2. Double-click **Open Mind Desk.bat**. (Or double-click `mind-desk.html` to open it in a normal browser tab.)
3. Optional: right-click its icon on the taskbar → **Pin to taskbar**.

Always open it the same way in the same browser. Your notes are stored in that browser on this PC. Only one Mind Desk window works at a time; a second one offers **Use Mind Desk here**. If the other window had changes that were not saved yet, Mind Desk keeps a copy and shows it to you.

## Connect Ollama (one time, about 10 minutes)

0. If Ollama is not installed: download it from ollama.com/download, install it and open **Ollama** from the Start menu.
1. **Get a model.** Press the Windows key, type `cmd`, press Enter. Type `ollama pull qwen3.5:9b` and press Enter. Wait for `success`. (Browse other models at ollama.com/library; `ollama list` shows what you have.)
2. **Allow Mind Desk to talk to Ollama.** Mind Desk is a file on your PC, and Ollama blocks files by default.
   Windows key → type `environment` → open **Edit environment variables for your account** → under *User variables* click **New…** →
   name `OLLAMA_ORIGINS`, value `*` → **OK**, **OK**.
3. **Restart Ollama.** Right-click the llama icon near the clock → **Quit Ollama**, then open **Ollama** from the Start menu.
4. In Mind Desk open **Settings** → **Test connection**, then **Try a quick test note**.

With `OLLAMA_ORIGINS=*`, websites you visit could also use your local AI (send it prompts, see your model list). They cannot read Mind Desk's notes or your files. You can remove the setting when you are not using Mind Desk. Model names ending in `cloud` run on Ollama's servers, not your PC; Mind Desk warns about them.

## Daily use

1. **Inbox → Add files** (or drag `.txt` files into the window, or **Paste a note**). The date is added automatically.
2. Choose **⚡ Fast** (quick) or **🧠 Careful** (the AI thinks first: slower, better at understanding what you meant), then **✨ Organize all** — or **✨ Organize this note** on one note in the Inbox. The top bar shows the seconds; in Careful mode a small panel shows the AI thinking live. Afterwards, **Show AI's thinking** reveals how it decided.
3. **Questions for you.** The AI asks about words and notes it does not understand. Your answers go into **Memory & words** and are used every time from then on.
4. **Review.** Red = removed, green = added by the AI. Approve, edit, change the category, join with the previous item, or keep your original text. Put `---` on its own line while editing to split an item in two.
5. **To-do** and the **categories** show only approved items. Each note lives in one category; tasks live only in To-do. Tick tasks when done.
6. To change a note later: **Edit** it in its category. **✨ Fix my typing** lets the AI clean what you just typed (you see the changes first).

**💬 Chat:** ask about your notes ("what are my job to-dos?", "show me note 4"), tell it what to change ("move the gym plan to Personal goals"), or teach it ("remember: BR is my client"). Changes only happen when you click **Apply**; things to remember only when you click **Remember**. Your chats are saved.

**🧠 Memory & words:** everything Mind Desk knows about you and your shortcodes. It is used in every AI request, with any model. When you move an item to another category in Review, Mind Desk offers to remember that.

**Something looks wrong?** Click **📋 Report for Claude** on the note (or in Settings), check the text, and paste it into your chat with Claude. You can hide names first.

Settings → **How much may the AI change your text?**: "Fix typos only" (default) or "Clean up wording". **☰** at the top left hides the menu.

Your original notes are never changed. They stay in the Inbox.

## On claude.ai: the Mind Desk artifact

The same app also runs as a Claude artifact (`mind-desk-artifact.html`, published on claude.ai). There Claude does the work with your own Claude plan: no Ollama, no API key, works on your phone. Your notes are saved in the artifact's private storage on your Claude account, so the PC browser and the phone show the same notes. ⚡ Fast uses Claude's quick model, 🧠 Careful its main model. To move your notes from the PC: **Download backup** here, then **Restore from backup…** in the artifact.

## Without Ollama: ChatGPT or Claude

Settings → **Copy & paste**. Mind Desk shows a prompt, you paste it into ChatGPT or Claude and paste the answer back (three rounds: split, questions, organize). Your notes leave your PC in this mode.

## Backup

- Settings → **Download backup** (a `.json` file) and **Restore from backup…** A backup is fully checked before it replaces anything; it never contains an API key, and restoring keeps this PC's AI connection.
- Settings → **Choose a folder…** keeps a live copy as normal files: `Organized\*.md`, `Originals\*.txt`, `Mind Desk backup.json`. After restarting the browser, click **reconnect folder** at the bottom left once.
- Clearing the browser's "cookies and site data" can delete Mind Desk's data. Keep a backup.

## Update to a new version

Replace `mind-desk.html` (and the `.bat`) with the new files. Your data stays.

## For developers

- Source: `src/` (`core.js` logic, `app.js` interface, `style.css`, `index.html`; artifact only: `platform-artifact.js`, `artifact.css`). `node bin/build.js` builds both `mind-desk.html` (PC) and `mind-desk-artifact.html` (claude.ai artifact) (`--zip` also makes `dist/mind-desk-<version>.zip` with the PC version).
- Tests: `tests/run-tests.js` runs Chromium (Playwright) against `mind-desk.html` opened from a `file://` URL, with a stand-in Ollama (`tests/fake-ollama.js`). `REAL_OLLAMA=http://127.0.0.1:11434` adds a check against a real Ollama. `tests/review-tests.js` and `tests/review2-tests.js` cover the two review rounds; `tests/v103-tests.js` covers Fast/Careful; `tests/v104-tests.js` covers 1.0.4; `tests/v110-tests.js` covers Chat + Memory; `tests/artifact-tests.js` tests the artifact with a stand-in for claude.ai (`tests/artifact-stub.js`: database, Claude, downloads).
- Shared notes for the AIs working on this repo: `HANDOFF.md`, `DECISIONS.md`.
