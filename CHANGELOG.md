# Changelog

All notable changes to Mind Desk. Versions follow semantic versioning.

## 1.0.4 — 2026-10-22

Changes from the owner's first real run.

- **Live progress:** answers from Ollama are streamed. While the AI works, the top bar shows seconds and what it is doing (waiting / thinking / writing), and in Careful mode a small panel shows its thinking as it is written (can be hidden). Careful no longer looks stuck.
- **Thinking time limit** (Settings, default 120 s): if the AI is still thinking after that, it is stopped and the item is answered in Fast mode, with a note on the item.
- **One place rule:** each note lives in one category. The AI no longer adds "also show in" tags; tags it added before 1.0.4 are removed once (your own later tags stay). Tasks are listed only in To-do; category pages show a link like "2 open tasks for this area are in To-do". Category Markdown files no longer repeat tasks.
- **✨ Organize this note** button for each new note in the Inbox. "Organize again" also only redoes that note.
- **☰ Hide/show the menu** (remembered).
- **How much may the AI change your text?** Settings: "Fix typos only" (default) or "Clean up wording". Clean-up may reword, but numbers, names, "not" and content are still checked.
- **✨ Fix my typing** in the editor: the AI fixes the text in the box (or only the selected part); you see the changes and choose "Use the fixed text" or "Keep mine".
- **📋 Report for Claude:** for one note (Inbox) or all notes / items waiting for review (Settings). Text with the original, how the AI split and cleaned it, categories, tasks, warnings, thinking and timings of the last AI requests. Preview before copying, optional name hiding (Person 1, Person 2 …), Copy, Download, or save into the Mind Desk folder (Reports). Never includes the API key.
- Each AI request's time is recorded (shown in reports); not included in backups.

## 1.0.3 — 2026-10-22

- **⚡ Fast / 🧠 Careful** choice next to ✨ Organize all. Fast: quick answers, no thinking. Careful: the AI thinks first (slower, better at understanding intent). Mind Desk remembers the last choice.
- The AI's thinking is saved and folded away: "Show AI's thinking" on each item, "Show how the AI decided to split this note" in the Inbox, and on the Questions page.
- "Ask AI again" offers ⚡ Fast or 🧠 Careful for one item.
- Settings → Fast or Careful: choose which steps think in Careful mode (split, questions, organize).
- Careful mode gives the AI more room (context) and double the time limit; a model that cannot think falls back to normal answers automatically; thinking inside `<think>` tags is moved out of the answer.
- Default model is now `qwen3.5:9b`. The old on/off "think" switch from 1.0.2 becomes Careful mode when it was on.

## 1.0.2 — 2026-10-21

Fixes from ChatGPT's review of 1.0.1 (points S1–S17, each confirmed by a test that fails on 1.0.1).

- Saves run one at a time, so a slow save no longer makes the window block itself (S1).
- A window that loses control while it has unsaved changes keeps a copy; the window in charge offers "Download that copy / Use that copy instead / Delete that copy", and the stopped window can download its copy (S2).
- Folder saving no longer repeats every 1.5 seconds when nothing changes (S3).
- A window that lost control throws away a folder write it had started instead of finishing it over newer files (S4).
- After "Use Mind Desk here", the saved folder connection is picked up (S5).
- Backup check also covers open questions, drafts, AI instructions, settings, words, item details, built-in categories and task links (S6); ids may only use simple characters, and every id shown in the page is escaped — a crafted backup could run code in 1.0.1 (S7).
- Splitting with `---` lines up the original words even with typos ("mov eon" ↔ "move on"); very long notes get an approximate cut taken from the original, marked with a warning — cleaned text is never called "original" (S8).
- Unsaved editor changes survive other buttons (warning filter, approving another card, search) (S9).
- Long notes: unchanged text gives no warning; the comparison works line by line and shows only the real changes (S10).
- Numbers are compared in order; "not"-words are compared per line with the word after them, so added, removed or moved "not" is caught; "dont"/"nto"/curly apostrophes and "2day" do not cause warnings (S11, S14).
- "Done" is judged per task from the part of the note it comes from; "not done" stays open (S12).
- Task check: most of a task's words must be in the note (short forms like "ppt" count); "not" elsewhere in the sentence no longer causes a false warning (S13).
- "Use my original" also clears number and "not" warnings (S15).
- A failed questions step stays marked on the note after reloading, with "Ask questions again" (S16).
- If the browser's window-lock feature fails, Mind Desk still starts (the save check protects the data) and shows "one-window check off" (S17).

## 1.0.1 — 2026-10-21

Fixes from ChatGPT's review of 1.0.0 (each point checked with a test that fails on 1.0.0 first; see the test report).

- Only one Mind Desk window works at a time; a second window shows "Use Mind Desk here" to take over. Saving also refuses to overwrite newer data from another window (R1).
- If saved data cannot be read or opened at start, Mind Desk stops with a message instead of starting empty, and never writes (R2).
- Restoring a backup checks everything first (damaged notes/items/tasks, duplicate ids, missing references, category loops); nothing is replaced on any problem. Category loops can no longer freeze the app (R3).
- Folder copy: original files get a short id in the name; category files with the same name (also upper/lower case) no longer overwrite each other (R4).
- Stop works for "Ask AI again" without blocking the next try (R5) and always ends copy & paste mode; the background is blocked while a window is open (R6).
- Splitting an item with `---` also splits its original text, so "Use my original" brings back only that part (R7).
- Deleting, restoring, joining or deleting categories is blocked while the AI runs; late AI answers for deleted items are dropped (R8).
- A storage write that aborts is reported (R9).
- New checks: a number or date changed, a "not/never/don't" word disappeared, a URL or e-mail changed, or a short note rewritten. Change is now measured in characters, so normal heavy typo fixing no longer warns (R10).
- Tasks: "done" only when the note says so (done, already, finished…); tasks that do not match the note (or come from a "don't…" line) are flagged (R11).
- Splitting: each line can become its own item (the AI joins lines that belong together); `-----` dividers always separate (R12).
- The questions step reads every note completely, in parts; failures are reported (R13).
- The AI context grows with long notes (up to 32,768 tokens); too-long items get a clear message (R14).
- Markdown/folder files now match the screen: tagged notes and linked tasks included (R15).
- Privacy: backups never contain the API key; restoring keeps this PC's AI connection; warnings for a non-local AI address, Ollama cloud models and copy & paste mode (R17).
- Half-typed answers to questions are kept; leaving the editor with unsaved changes asks first; setup explains installing Ollama (R18).

## 1.0.0 — 2026-10-21

First release.

- Single-file app (`mind-desk.html`) for Edge/Chrome, opened from the PC; launcher `Open Mind Desk.bat` (Edge app window).
- Inbox: add notes by drag & drop, file picker (many files at once) or paste; date added automatically; duplicates and non-text files refused; originals never changed.
- Organize all, in three steps:
  1. Split: simple rules cut each note into blocks (headings keep their lists, `//` and `sol:` lines stay with their thought, `-----` lines always separate), then the AI decides which blocks belong together.
  2. Questions: the AI asks about unknown shortcodes and unclear notes; answers are saved as **My words** and **My rules** and used in every later run.
  3. Organize: typo fix (own words and style kept, shortcodes protected), title, one category plus "also show in" tags, and tasks with a to-do list.
- Guardrails: shorter text, many changed words or a changed protected word are flagged and retried once with stricter rules; broken AI answers keep the original text with a warning; the run can be stopped and continued.
- Review screen: original vs cleaned with highlighted changes; approve / approve all / edit / change category / use original / join with previous / split with `---` / ask AI again / delete.
- To-do: Chores, Shopping & buying, Job tasks, Business tasks, Client tasks (job/business/client tasks also show in their area); tick, add, edit, delete; done tasks hidden by default.
- Categories with subcategories (default set from the plan), editable in Settings with descriptions that guide the AI.
- AI connection: Ollama (default `qwen3:8b`, JSON schema output, thinking off), copy & paste with ChatGPT/Claude, or any OpenAI-style local API (AnythingLLM, LM Studio). Test connection and a quick test note with plain-language fixes (including the `OLLAMA_ORIGINS` setting).
- Editable AI prompts with reset.
- Storage in the browser (IndexedDB), optional live copy to a folder (Markdown per category, original notes, backup), backup download/restore, Markdown export.
- Light/dark theme.
