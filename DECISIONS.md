# Decisions

Numbered so both AIs (Claude and ChatGPT) and the owner can refer to them. Newest last.

- **D1 (21 Oct 2026) Single HTML file, no install.** Opens from the PC in Edge/Chrome. No Python, no server, no Windows installer. `Open Mind Desk.bat` opens it as an Edge app window.
- **D2 Ollama is the main AI; notes stay on the PC.** The notes are very private (personal life, job, salary). Copy & paste with ChatGPT/Claude and an OpenAI-style API (AnythingLLM, LM Studio) are options in Settings.
- **D3 `OLLAMA_ORIGINS=*` is required.** Tested with real Ollama 0.40.7: a page opened from a file sends `Origin: null`; default Ollama answers 403. `OLLAMA_ORIGINS=null` makes Ollama crash at start ("bad origin"). Only `*` works. The README and the app explain the one-time setting and its trade-off.
- **D4 Three AI steps (split → questions → organize), each small.** Small local models do better with one clear job per request. Organize runs one note per request; copy & paste mode bundles all notes per step.
- **D5 Rules first, AI second for splitting.** `makeBlocks` joins obvious pieces (heading + list, `//`/`sol:` follow-ups) and `-----` always separates. The AI can only join blocks, never cut inside one, so it cannot lose or reorder text. The user can split with `---` while editing.
- **D6 Typo fix must keep the person's voice.** Prompt forbids rewriting; My words + ALL-CAPS codes are protected. Checks after each answer: text shorter than 80%, more than 35% of words changed, or a protected word changed → one retry with a stricter instruction, then a warning in Review.
- **D7 Nothing counts until approved.** AI results wait in Review; tasks and categories show only approved items. Originals are always kept.
- **D8 Questions teach the AI.** Word answers → My words (meaning used in prompts, word protected). Intent answers → My rules. Both editable.
- **D9 One main category + tags.** A note can also show in other categories; to-do subcategories have an "area" so job/business/client tasks also show in their area.
- **D10 Storage:** IndexedDB in the browser (localStorage fallback), optional folder copy via the File System Access API, JSON backup/restore, Markdown export.
- **D11 Defaults from the owner's plan:** categories To-do (Chores, Shopping & buying, Job tasks, Business tasks, Client tasks), Mind & life lessons, Job: Madhu Infotech, Clients & side work, My business (Websites & brand, Content ideas, Tool ideas), Personal goals, Unsorted. Default word: Madhutech = Madhu Infotech (job, not own website). Default model `qwen3:8b` (RTX 4060 8 GB).
- **D12 Privacy of the repo:** no real notes in the repository; tests use invented notes in a similar style.
- **D13 (21 Oct 2026, review of 1.0.0) One working window.** Web Locks (`mind-desk-window`) give one window the right to work; others show "Use Mind Desk here" (steal). Saving also checks a revision number in the same storage transaction and stops if newer data exists (backstop without locks).
- **D14 Never write after a failed load.** A failed IndexedDB open or read shows an error screen; `save()` is disabled. localStorage is used only when IndexedDB does not exist at all.
- **D15 Backups are fully checked before restore** (`backupProblem`); restore keeps this PC's AI connection settings; backups never include the API key.
- **D16 Splitting is line based.** Each line may become a block; list lines, `//`/`sol:` follow-ups and lines under a heading stay attached; blocks written without an empty line are marked "(same paragraph)" for the AI. Dividers force a new item even if the AI joins.
- **D17 Meaning checks.** Character edit distance (> 30% and > 4 characters) replaces the word ratio; numbers/dates, negation words, URLs and e-mails must survive. Task "done" needs a sign in the note; unsupported or negated tasks are flagged.
- **D18 Context size grows with the note** (estimate chars/3.2 + answer + 768, rounded up, max 32,768). Larger items must be split by the user.
- **D19 Busy rule.** While the AI runs, actions that delete or replace data are blocked; late answers for deleted items are dropped.
- **D20 OLLAMA_ORIGINS=* stays for now** (review point R16 is a fair trade-off point). Alternative for later, owner's choice: a launcher that serves Mind Desk from `http://127.0.0.1:<port>`, which Ollama allows by default, so `*` is no longer needed (data would move to that address once).
- **D21 (21 Oct 2026, review of 1.0.1) One write at a time**; a change during a write is written right after. Folder bookkeeping saves never schedule another folder copy.
- **D22 Recovery copy.** A window that loses control with unsaved work stores it under a separate key (`recovery`), never over the main data; the window in charge shows it (on start and when the window gets focus) to download, use or delete.
- **D23 Folder writes are abandoned when control is lost** (checked before writing and before `close()`, which is when a file is replaced).
- **D24 Ids are simple** (`[A-Za-z0-9_-]{1,64}`, checked on restore) and always escaped in HTML / `CSS.escape` in selectors.
- **D25 Split originals by word alignment** with typo tolerance (up to ~2,000 words per side); beyond that an approximate cut at the same share of words, flagged `splitguess`.
- **D26 Meaning checks v2:** comparison line by line (fast, no false alarm on long notes); numbers in order (words like 2day/b2b are not numbers; 14th, 10k, 1L, 50% are); "not"-words per line with the first letter of the next word; done/support judged per clause (split at line, `;`, `,`, `..`); a task needs ≥ 75% of its words in the note (typos and short forms count).
- **D27 Lock failure is not fatal:** if Web Locks fail, Mind Desk runs with the revision check only and shows "one-window check off".
