# Changelog

All notable changes to Mind Desk. Versions follow semantic versioning.

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
