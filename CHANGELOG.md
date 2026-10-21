# Changelog

All notable changes to Mind Desk. Versions follow semantic versioning.

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
