/* Mind Desk core: pure functions (no DOM). Exposed as window.MDCore for tests. */
const MDCore = (() => {
  'use strict';

  const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* ---------- default data ---------- */
  function defaultCategories() {
    return [
      { id: 'todo', name: 'To-do', parent: null, desc: 'Things to do', system: true },
      { id: 'todo-chores', name: 'Chores', parent: 'todo', desc: 'house work, clothes, cleaning, daily life jobs', area: null },
      { id: 'todo-shopping', name: 'Shopping & buying', parent: 'todo', desc: 'things to buy, pay for or order', area: null },
      { id: 'todo-job', name: 'Job tasks', parent: 'todo', desc: 'tasks for my job', area: 'job' },
      { id: 'todo-business', name: 'Business tasks', parent: 'todo', desc: 'tasks for my own websites, content and tools', area: 'business' },
      { id: 'todo-clients', name: 'Client tasks', parent: 'todo', desc: 'tasks for clients and side work', area: 'clients' },
      { id: 'mind', name: 'Mind & life lessons', parent: null, desc: 'insights, lessons, experiments and theories about my mind, emotions, fear, worry, manifestation, letting things happen' },
      { id: 'job', name: 'Job: Madhu Infotech', parent: null, desc: 'my job at Madhu Infotech (also written Madhutech): CEO/owner, meetings, salary, work plans, its content' },
      { id: 'clients', name: 'Clients & side work', parent: null, desc: 'freelance clients and side jobs' },
      { id: 'business', name: 'My business', parent: null, desc: 'my own business' },
      { id: 'biz-sites', name: 'Websites & brand', parent: 'business', desc: 'my own websites and social media, plans for them' },
      { id: 'biz-content', name: 'Content ideas', parent: 'business', desc: 'article, theory and content ideas' },
      { id: 'biz-tools', name: 'Tool ideas', parent: 'business', desc: 'ideas for software tools to build' },
      { id: 'personal', name: 'Personal goals', parent: null, desc: 'health, gym, diet, smoking, dating, skills like English and communication, habits, fun' },
      { id: 'unsorted', name: 'Unsorted', parent: null, desc: 'anything that fits nowhere else', system: true },
    ];
  }

  const DEFAULT_PROMPTS = {
    split:
`You help organize one person's quick personal notes. The note below was cut into numbered blocks.
Some neighbouring blocks belong together: a heading and its list, a thought and its follow-up lines (starting with "//", "sol:", "ex:"), the parts of one plan or one speech.
Blocks marked "(same paragraph)" were written directly under the block before, without an empty line. They are often, but not always, about the same thing.
Decide where each NEW separate item starts.
Rules:
- One item = one thought, one plan, one topic or one list.
- Keep a heading (a block ending with ":") together with the blocks that belong to it.
- Do not join unrelated thoughts just because they are close to each other.
- Block 1 always starts an item.
Answer only with JSON: {"starts": [numbers of the blocks that start a new item, in order]}`,
    survey:
`You are preparing to organize a person's private notes. The person writes fast, with typos and personal shortcodes that only they understand.
Find at most {{max}} things you truly cannot understand:
1. kind "word": shortcodes, abbreviations or names whose meaning is unclear. Give your best guess.
2. kind "intent": a note where you cannot tell which category it belongs to. Quote a short exact part of it (max 12 words) and ask one short question. Give your best guess.
Do NOT ask about normal typos, normal English words, well-known terms (CEO, SEO, AI, B2B) or words that are already explained below.
Categories: {{categories}}
Already explained words: {{words}}
Answer only with JSON: {"questions":[{"kind":"word","term":"","guess":""},{"kind":"intent","quote":"","question":"","guess":""}]}`,
    organize:
`You organize one note that a person wrote quickly for themselves.
Return:
1. "text": {{editRule}} Keep these words exactly as written: {{protected}}
2. "title": a short title in plain English, at most 8 words.
3. "category": the id of the ONE best category.
4. "tasks": only real actions the person intends to do (chores, buying, work tasks). Write each as a short clear task. "done" is true if it is marked done. "category" is the best to-do id. Reflections, lessons, wishes and goals are NOT tasks. Never make a task from something the person says NOT to do. "done" is true ONLY if the note clearly says it is done. Empty list if there are none.
Categories (id: name - meaning):
{{categories}}
To-do ids for tasks:
{{todoCategories}}
What the person's words mean:
{{words}}
The person's rules:
{{rules}}
Answer only with JSON: {"title":"","category":"","tasks":[{"text":"","done":false,"category":""}],"text":""}`,
    fix:
`You fix the typing of a short text a person just wrote in their notes app.
{{editRule}}
Keep these words exactly as written: {{protected}}
What the person's words mean:
{{words}}
About the person and how they write:
{{rules}}
Answer only with JSON: {"text":""}`,
    chat:
`You are the assistant inside Mind Desk, a private notes app on the person's own PC. You help the person with their own notes: you answer questions about them and suggest changes.
You never change anything yourself. You suggest actions, and the person clicks Apply.
Talk simply and briefly, like a helpful friend, in plain English. If you are not sure what the person means, ask one short question instead of guessing.
What you remember about the person (Memory):
{{memory}}
What the person's words mean:
{{words}}
Categories (id: name - meaning):
{{categories}}
To-do lists (id: name):
{{todoCategories}}
Notes, items and tasks Mind Desk found for this message (only these exist for you; use their ids):
{{context}}
Actions you can suggest (use only ids from the lists above):
{"type":"move_item","item":"ITEM ID","category":"CATEGORY ID"}
{"type":"rename_item","item":"ITEM ID","title":"NEW TITLE"}
{"type":"mark_task","task":"TASK ID","done":true}
{"type":"add_task","text":"TASK","category":"TO-DO ID"}
{"type":"organize_again","note":"NOTE ID","instruction":"what to do differently"}
{"type":"show_note","note":"NOTE ID"}
"remember": things the person told you that should be used from now on: what their words or notes mean, where kinds of notes belong, how they write and talk. Only when they clearly say something lasting. Write each as one short sentence about the person.
In "reply" you can point to items with [[item:ID]] and to notes with [[note:ID]].
Answer only with JSON: {"reply":"","actions":[],"remember":[]}`,
  };
  /** how much the AI may change the person's text (Settings → writing) */
  const EDIT_RULES = {
    typos: 'the SAME text with ONLY spelling mistakes and typos fixed (examples: "thoguth" -> "thought", "mov eon" -> "move on", "teh" -> "the"). Keep the person\'s own words, short style, slang, "haha", grammar style, line breaks, list markers and "//" lines. Do NOT rewrite, polish, summarize, translate, add or remove anything.',
    clean: 'the SAME text with typos fixed and sentences made a little clearer and easier to read later. Keep the meaning, every point, every name, number and date, every "not"/"don\'t", the person\'s own voice, "haha", line breaks, list markers and "//" lines. Do NOT summarize, add new ideas, remove points, or change what the person decided.',
  };

  const SCHEMAS = {
    split: { type: 'object', properties: { starts: { type: 'array', items: { type: 'integer' } } }, required: ['starts'] },
    survey: {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['word', 'intent'] }, term: { type: 'string' }, quote: { type: 'string' }, question: { type: 'string' }, guess: { type: 'string' } }, required: ['kind'] } } },
      required: ['questions'],
    },
    fix: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    chat: {
      type: 'object',
      properties: {
        reply: { type: 'string' },
        actions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['move_item', 'rename_item', 'mark_task', 'add_task', 'organize_again', 'show_note'] }, item: { type: 'string' }, category: { type: 'string' }, title: { type: 'string' }, task: { type: 'string' }, done: { type: 'boolean' }, text: { type: 'string' }, note: { type: 'string' }, instruction: { type: 'string' } }, required: ['type'] } },
        remember: { type: 'array', items: { type: 'string' } },
      },
      required: ['reply', 'actions', 'remember'],
    },
    organize: {
      type: 'object',
      properties: {
        title: { type: 'string' }, category: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
        tasks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' }, category: { type: 'string' } }, required: ['text', 'done', 'category'] } },
        text: { type: 'string' },
      },
      required: ['title', 'category', 'tasks', 'text'],
    },
  };

  /* ---------- categories ---------- */
  function children(cats, id) { return cats.filter((c) => c.parent === id); }
  function subtreeIds(cats, id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of cats) if (c.parent === out[i] && !out.includes(c.id)) out.push(c.id);
    return out;
  }
  function isTodoCat(cats, id) { return subtreeIds(cats, 'todo').includes(id); }
  function catPath(cats, id) {
    const c = cats.find((x) => x.id === id); if (!c) return 'Unsorted';
    const p = c.parent ? cats.find((x) => x.id === c.parent) : null;
    return p ? p.name + ' › ' + c.name : c.name;
  }
  /** categories an item can be placed in: leaves outside the to-do tree, plus "todo" itself */
  function assignableCats(cats) {
    return cats.filter((c) => (c.id === 'todo') || (!isTodoCat(cats, c.id) && children(cats, c.id).length === 0));
  }
  function todoSubs(cats) { return children(cats, 'todo'); }

  /* ---------- splitting into blocks ---------- */
  const DIVIDER = /^\s*([-_=*~•]\s*){3,}$/;
  const LISTLIKE = /^\s*([-*•]|\d+[.)])\s+/;
  const FOLLOWUP = /^\s*(\/\/|(sol|solution|ex|eg|e\.g\.|er|result|reason|update|note)\s*[:.-])/i;

  /**
   * Cut a note into blocks. Every line can start a new block; simple rules keep obvious pieces together
   * (a heading with its list, "- " list lines and "//" or "sol:" follow-ups with the line above).
   * A divider line (-----) always separates (block.hard). The AI may later join blocks, never cut them.
   * Returns strings, or {text, hard, same} objects when detailed is true (same = no empty line before).
   */
  function makeBlocks(text, detailed) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = []; let hard = true; let blank = true;
    for (const raw of lines) {
      const ln = raw.replace(/\s+$/, '');
      if (DIVIDER.test(ln)) { hard = true; blank = true; continue; }
      if (ln.trim() === '') { blank = true; continue; }
      const prev = blocks[blocks.length - 1];
      if (prev && !hard) {
        const pl = prev.text.split('\n'); const prevFirst = pl[0].trim(); const prevLast = pl[pl.length - 1].trim();
        const join = blank
          ? FOLLOWUP.test(ln) || /:$/.test(prevLast) || (LISTLIKE.test(ln) && /:$/.test(prevFirst))
          : FOLLOWUP.test(ln) || LISTLIKE.test(ln) || /:$/.test(prevLast);
        if (join) { prev.text += (blank ? '\n\n' : '\n') + ln; blank = false; continue; }
      }
      blocks.push({ text: ln, hard: !!prev && hard, same: !!prev && !hard && !blank });
      hard = false; blank = false;
    }
    if (blocks[0]) blocks[0].hard = true;
    return detailed ? blocks : blocks.map((b) => b.text);
  }

  /** turn AI "starts" into groups of block indexes (0-based). Always valid. */
  function groupsFromStarts(n, starts, forced) {
    let s = Array.isArray(starts) ? starts.map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= n) : [];
    s = [...new Set([1, ...s, ...(forced || [])])].sort((a, b) => a - b);
    const groups = [];
    for (let i = 0; i < s.length; i++) {
      const from = s[i] - 1, to = (i + 1 < s.length ? s[i + 1] - 1 : n) - 1;
      const g = []; for (let k = from; k <= to; k++) g.push(k); groups.push(g);
    }
    return groups;
  }

  /** windows of blocks for the AI (keeps prompts small for local models) */
  function blockWindows(blocks, maxBlocks = 40, maxChars = 6000) {
    const wins = []; let cur = []; let chars = 0;
    blocks.forEach((b, i) => {
      const len = btext(b).length;
      if (cur.length && (cur.length >= maxBlocks || chars + len > maxChars)) { wins.push(cur); cur = []; chars = 0; }
      cur.push(i); chars += len;
    });
    if (cur.length) wins.push(cur);
    return wins;
  }

  /* ---------- JSON from AI ---------- */
  function parseJSON(raw) {
    if (raw && typeof raw === 'object') return raw;
    let s = String(raw || '').trim();
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* try to cut */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* fallthrough */ } }
    throw new Error('The AI answer was not valid JSON.');
  }

  /* ---------- prompts ---------- */
  function fill(tpl, vars) { return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)); }
  function catLines(cats) {
    return assignableCats(cats).map((c) => `${c.id}: ${catPath(cats, c.id)}${c.desc ? ' - ' + c.desc : ''}`).join('\n');
  }
  function todoLines(cats) { return todoSubs(cats).map((c) => `${c.id}: ${c.name}${c.desc ? ' - ' + c.desc : ''}`).join('\n') || 'todo: To-do'; }
  function wordLines(words) { return words.length ? words.map((w) => `${w.term} = ${w.meaning || '(keep as is)'}`).join('\n') : '(none yet)'; }
  function ruleLines(rules) { return rules.length ? rules.map((r) => '- ' + r).join('\n') : '(none yet)'; }

  /** words that must survive typo fixing: My words + ALL-CAPS codes found in the text */
  function protectedTerms(text, words) {
    const set = new Set();
    for (const w of words) if (w.term && new RegExp('(^|[^\\w])' + reEsc(w.term) + '(?![\\w])').test(text)) set.add(w.term);
    for (const m of String(text).matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)) if (!new RegExp('^' + NEG_SRC + '$', 'i').test(m[0])) set.add(m[0]); // "CANT", "NOT" are words, not codes
    for (const m of String(text).matchAll(/(?:https?:\/\/|www\.)[^\s<>"]+|[\w.+-]+@[\w-]+\.[\w.-]+/g)) set.add(m[0].replace(/[.,;:!?)]+$/, ''));
    return [...set];
  }

  const btext = (b) => (typeof b === 'string' ? b : b.text);
  const bmark = (b, k) => (k > 0 && b && b.same ? ' (same paragraph)' : '');
  function buildSplitPrompt(tpl, blocks, idxs) {
    const user = 'Blocks:\n' + idxs.map((bi, k) => `[${k + 1}]${bmark(blocks[bi], k)}\n${btext(blocks[bi])}`).join('\n\n');
    return { system: tpl, user };
  }
  function buildSurveyPrompt(tpl, text, ctx) {
    return { system: fill(tpl, { max: String(ctx.max || 8), categories: assignableCats(ctx.cats).map((c) => catPath(ctx.cats, c.id)).join('; '), words: wordLines(ctx.words) }), user: 'Notes:\n<<<\n' + text + '\n>>>' };
  }
  const editRule = (ctx) => EDIT_RULES[ctx.editStyle] || EDIT_RULES.typos;
  function buildFixPrompt(tpl, text, ctx) {
    const prot = protectedTerms(text, ctx.words);
    return { system: fill(tpl, { editRule: 'Return ' + editRule(ctx).replace(/^the SAME/, 'the same'), protected: prot.length ? prot.join(', ') : '(none)', words: wordLines(ctx.words), rules: ruleLines(ctx.rules || []) }), user: 'Text:\n<<<\n' + text + '\n>>>' };
  }
  function buildOrganizePrompt(tpl, text, ctx) {
    const prot = protectedTerms(text, ctx.words);
    return {
      system: fill(tpl, { editRule: editRule(ctx), protected: prot.length ? prot.join(', ') : '(none)', categories: catLines(ctx.cats), todoCategories: todoLines(ctx.cats), words: wordLines(ctx.words), rules: ruleLines(ctx.rules) }),
      user: 'Note:\n<<<\n' + text + '\n>>>',
    };
  }

  /* bulk versions for copy/paste mode (ChatGPT / Claude) */
  function bulkSplitPrompt(tpl, notes) {
    let user = 'There are several notes. Do the job for EACH note separately.\nAnswer only with JSON: {"notes":[{"id":"note id","starts":[...]}]}\n\n';
    for (const n of notes) user += `=== NOTE ${n.id} ===\n` + (n.note && n.note.instruction ? `(Extra instruction from the person for this note: ${n.note.instruction})\n` : '') + n.blocks.map((b, k) => `[${k + 1}]${bmark(b, k)}\n${btext(b)}`).join('\n\n') + '\n\n';
    return tpl + '\n\n' + user;
  }
  function bulkOrganizePrompt(tpl, items, ctx) {
    const all = items.map((i) => i.text).join('\n');
    const p = buildOrganizePrompt(tpl, all, ctx);
    let user = 'There are several notes. Do the job for EACH note separately and keep its id.\nAnswer only with JSON: {"results":[{"id":"note id","title":"","category":"","tasks":[],"text":""}]}\n\n';
    for (const it of items) user += `=== NOTE ${it.id} ===\n${it.instruction ? `(Extra instruction from the person for this note: ${it.instruction})\n` : ''}<<<\n${it.text}\n>>>\n\n`;
    return p.system + '\n\n' + user;
  }
  function bulkSurveyPrompt(tpl, text, ctx) { const p = buildSurveyPrompt(tpl, text, ctx); return p.system + '\n\n' + p.user; }

  /* ---------- checking AI results ---------- */
  function words(s) { return String(s).split(/\s+/).filter(Boolean); }

  /** LCS on token arrays after trimming the common start and end (so one small change in a long text is cheap) */
  function lcsOps(A, B, limit) {
    let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
    const a = A.slice(s, A.length - e), b = B.slice(s, B.length - e);
    const ops = A.slice(0, s).map((x) => ['eq', x]);
    const n = a.length, m = b.length;
    if (n * m > limit) { a.forEach((x) => ops.push(['del', x])); b.forEach((x) => ops.push(['ins', x])); } else {
      const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) { if (a[i] === b[j]) { ops.push(['eq', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['del', a[i++]]); else ops.push(['ins', b[j++]]); }
      while (i < n) ops.push(['del', a[i++]]); while (j < m) ops.push(['ins', b[j++]]);
    }
    A.slice(A.length - e).forEach((x) => ops.push(['eq', x]));
    return ops;
  }
  /** word-level diff for display: lines first, then words inside changed lines. returns [{t:'eq'|'del'|'ins', s}] */
  function diff(a, b) {
    a = String(a); b = String(b);
    if (a === b) return a ? [{ t: 'eq', s: a }] : [];
    const out = []; const push = (t, s) => { if (!s) return; const l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t, s }); };
    const L = (x) => x.match(/[^\n]*\n|[^\n]+$/g) || [];
    const lines = lcsOps(L(a), L(b), 4e6);
    let dels = [], inss = [];
    const flush = () => {
      if (dels.length || inss.length) {
        for (const [t, s] of lcsOps(dels.join('').split(/(\s+)/).filter((x) => x !== ''), inss.join('').split(/(\s+)/).filter((x) => x !== ''), 4e6)) push(t, s);
      }
      dels = []; inss = [];
    };
    for (const [t, s] of lines) { if (t === 'eq') { flush(); push('eq', s); } else if (t === 'del') dels.push(s); else inss.push(s); }
    flush();
    return out;
  }
  function changeRatio(a, b) {
    const wa = words(a), wb = words(b); if (!wa.length) return 0;
    const ops = lcsOps(wa, wb, 1e7);
    return 1 - ops.filter((o) => o[0] === 'eq').length / Math.max(wa.length, wb.length);
  }
  function countTerm(text, term) {
    const re = new RegExp('(^|[^\\w])' + reEsc(term) + '(?![\\w])', 'g');
    return (String(text).match(re) || []).length;
  }
  /** character edit distance (Levenshtein) after trimming the common start/end; null when still too long */
  function editDistance(a, b) {
    a = String(a); b = String(b);
    let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    a = a.slice(s, a.length - e); b = b.slice(s, b.length - e);
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    if (a.length * b.length > 1.6e7) return null;
    let prev = new Uint32Array(b.length + 1), cur = new Uint32Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i; const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }
  /** characters changed between two texts, measured line by line (fast for long notes). {dist, len} */
  function charChange(a, b) {
    a = String(a); b = String(b);
    if (a === b) return { dist: 0, len: a.length };
    const ops = lcsOps(a.split('\n'), b.split('\n'), 4e6);
    let dist = 0, dels = [], inss = [];
    const flush = () => {
      const n = Math.max(dels.length, inss.length);
      for (let k = 0; k < n; k++) {
        const x = dels[k] || '', y = inss[k] || '';
        const d = editDistance(x, y);
        dist += d === null ? Math.round(changeRatio(x, y) * Math.max(x.length, y.length)) : d;
      }
      dels = []; inss = [];
    };
    for (const [t, s] of ops) { if (t === 'eq') flush(); else if (t === 'del') dels.push(s); else inss.push(s); }
    flush();
    return { dist, len: Math.max(a.length, b.length, 1) };
  }

  /* --- meaning checks --- */
  const quotes = (t) => String(t).replace(/[’‘`´]/g, "'");
  const NEG_SRC = "\\b(not|nto|no|never|nothing|none|don'?t|dnt|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|cannot|couldn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|shouldn'?t|mustn'?t|haven'?t|hasn'?t|nahi|nahin|mat)\\b";
  const NEG = new RegExp(NEG_SRC, 'gi');
  const hasNeg = (t) => new RegExp(NEG_SRC, 'i').test(quotes(t));
  /** where the "not"-words are: per line, each with the first letter of the word after it */
  function negSigns(text) {
    return quotes(text).split('\n').map((ln) => {
      const out = []; const re = new RegExp(NEG_SRC + "\\W*([A-Za-z0-9]?)", 'gi'); let m;
      while ((m = re.exec(ln))) out.push((m[2] || '').toLowerCase());
      return out.sort().join(',');
    });
  }
  function negationChanged(a, b) {
    const x = negSigns(a), y = negSigns(b);
    if (x.length === y.length) return x.some((v, k) => v !== y[k]);
    return x.filter(Boolean).join('|').split(/[|,]/).sort().join() !== y.filter(Boolean).join('|').split(/[|,]/).sort().join();
  }
  // numbers in order; "2day", "b2b" or "4u" are words, not numbers; 14th, 10k, 1L, 50% are numbers
  const numbersOf = (t) => (String(t).match(/(?<![A-Za-z0-9])\d+(?:[.,:/]\d+)*(?:st|nd|rd|th|k|K|L|cr|%)?(?![A-Za-z0-9])/g) || []).join('|');
  const DONE = /(\b(done|did|finished|completed?|already|sent|paid|bought|called|ho gaya|hogaya)\b|\(done|✓|✔|\[x\])/i;
  const NOT_DONE = /\b(not|nto|nahi)\s+(yet\s+)?(done|finished|completed?|sent|paid)\b|\bpending\b|\b(not\s+yet|yet\s+to)\b/i;
  const STOP = new Set(['the', 'and', 'or', 'for', 'with', 'about', 'from', 'that', 'this', 'into', 'your', 'my', 'his', 'her', 'it', 'its', 'some', 'more', 'also', 'then', 'to', 'of', 'on', 'in', 'at', 'a', 'an', 'is', 'be', 'by', 'please', 'need', 'needs', 'will', 'should', 'must', 'can']);
  const wordsLower = (t) => (quotes(t).toLowerCase().match(/[a-z0-9]+/g) || []);
  const contentWords = (t) => wordsLower(t).filter((w) => w.length >= 2 && !STOP.has(w));
  const clauses = (t) => quotes(t).split(/[\n;,]|\.{2,}|\.\s+|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  /** same word, a typo of it, a longer form ("call"/"called") or a short form ("ppt" for "powerpoint") */
  function wordMatch(w, n) {
    if (w === n) return true;
    if (w.length >= 4 && n.length >= 4 && w.slice(0, 4) === n.slice(0, 4)) return true;
    const d = editDistance(w, n); if (d !== null && d <= (Math.max(w.length, n.length) >= 6 ? 2 : 1) && Math.min(w.length, n.length) >= 3) return true;
    const isAbbr = (s, l) => s.length >= 2 && s.length < l.length && s[0] === l[0] && [...s].every(((i) => (c) => (i = l.indexOf(c, i) + 1) > 0)(0));
    return isAbbr(n, w) || isAbbr(w, n);
  }
  /** clauses of the note that talk about this task (share at least one of its words) */
  function taskClauses(task, note) {
    const tw = contentWords(task);
    return clauses(note).filter((c) => contentWords(c).some((n) => tw.some((w) => wordMatch(w, n))));
  }
  /** does the note support this task? Most of its words are in the note, and the note does not say "not" about it */
  function taskSupport(task, original, fixed) {
    const tw = contentWords(task); if (!tw.length) return true;
    const nw = contentWords(original + ' ' + fixed);
    const found = tw.filter((w) => nw.some((n) => wordMatch(w, n))).length;
    if (found / tw.length < 0.75) return false;
    const cl = taskClauses(task, original);
    return !cl.length || !cl.every(hasNeg);
  }
  /** a task counts as done only if the part of the note it comes from says so */
  function taskDone(task, original) {
    return taskClauses(task, original).some((c) => DONE.test(c) && !NOT_DONE.test(c));
  }

  /** clean an organize answer and decide which warnings to show */
  function checkOrganize(res, original, ctx) {
    const cats = ctx.cats;
    const allowed = assignableCats(cats).map((c) => c.id);
    const flags = [];
    const r = res && typeof res === 'object' ? res : {};
    let text = typeof r.text === 'string' ? r.text.replace(/^\s*<<<\s*\n?|\n?\s*>>>\s*$/g, '').trim() : '';
    if (!text) { text = original; flags.push('notext'); }
    let category = String(r.category || '').trim();
    if (!allowed.includes(category)) {
      const byName = cats.find((c) => allowed.includes(c.id) && (c.name.toLowerCase() === category.toLowerCase() || catPath(cats, c.id).toLowerCase() === category.toLowerCase()));
      category = byName ? byName.id : 'unsorted';
      if (!byName) flags.push('unsorted');
    }
    const tags = ctx.noTags ? [] : [...new Set((Array.isArray(r.tags) ? r.tags : []).map(String).filter((t) => cats.some((c) => c.id === t) && !isTodoCat(cats, t) && t !== category && t !== 'unsorted'))];
    const subs = todoSubs(cats).map((c) => c.id);
    const area = (id) => { const c = todoSubs(cats).find((s) => s.area && subtreeIds(cats, s.area).includes(id)); return c ? c.id : null; };
    let taskWarn = false;
    const tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter((t) => t && String(t.text || '').trim()).map((t) => {
      const ttext = String(t.text).trim().slice(0, 300);
      if (!taskSupport(ttext, original, text)) taskWarn = true;
      return {
        text: ttext,
        // "done" needs a sign in the part of the note this task comes from; otherwise the task stays open
        done: (t.done === true || t.done === 'true') && taskDone(ttext, original),
        cat: subs.includes(t.category) ? t.category : (area(category) || subs[0] || 'todo'),
      };
    });
    if (taskWarn) flags.push('taskcheck');
    let title = String(r.title || '').trim().replace(/^["']|["']$/g, '').slice(0, 90);
    if (!title) title = words(text).slice(0, 7).join(' ');
    // guardrails: the typo fix must not change meaning
    const wo = words(original).length, wt = words(text).length;
    const norm = (t) => quotes(t).toLowerCase().replace(/[ \t]+/g, ' ').trim();
    const a = norm(original), b = norm(text);
    const clean = ctx.editStyle === 'clean'; // clean-up mode may reword, but must not drop content or change facts
    if (clean ? (wo >= 6 && wt < wo * 0.6) || b.length < a.length * 0.5 : (wo >= 6 && wt < wo * 0.8) || b.length < a.length * 0.7) flags.push('shortened');
    const ch = charChange(a, b);
    if (!clean && ch.dist > 4 && ch.dist / ch.len > 0.3) flags.push('bigchange');
    if (numbersOf(quotes(original)) !== numbersOf(quotes(text))) flags.push('numbers');
    if (negationChanged(original, text)) flags.push('negation');
    const lost = protectedTerms(original, ctx.words).filter((t) => countTerm(text, t) < countTerm(original, t));
    if (lost.length) flags.push('lostword');
    return { title, category, tags, tasks, text, flags, lost };
  }

  /** survey questions: clean, remove known words, dedupe, cap */
  function checkSurvey(list, ctx) {
    const known = new Set(ctx.words.map((w) => w.term.toLowerCase()));
    const seen = new Set(); const out = [];
    for (const q of Array.isArray(list) ? list : []) {
      if (!q || typeof q !== 'object') continue;
      if (q.kind === 'word') {
        const term = String(q.term || '').trim(); if (!term || term.length > 40) continue;
        const k = 'w:' + term.toLowerCase(); if (known.has(term.toLowerCase()) || seen.has(k)) continue;
        seen.add(k); out.push({ id: uid('q'), kind: 'word', term, guess: String(q.guess || '').trim() });
      } else if (q.kind === 'intent') {
        const quote = String(q.quote || '').trim().slice(0, 160); const question = String(q.question || '').trim();
        if (!quote || !question) continue;
        const k = 'i:' + quote.toLowerCase(); if (seen.has(k)) continue;
        seen.add(k); out.push({ id: uid('q'), kind: 'intent', quote, question, guess: String(q.guess || '').trim() });
      }
    }
    return out.slice(0, ctx.max || 8);
  }

  /* ---------- export ---------- */
  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled'; }

  /** Markdown for one category (approved items + open tasks) */
  /** approved items shown in a category: main category or "also show in" tag, including subcategories */
  function itemsIn(state, catId) {
    const ids = subtreeIds(state.categories, catId);
    return state.items.filter((i) => i.status === 'approved' && (ids.includes(i.cat) || (i.tags || []).some((t) => ids.includes(t))));
  }
  /** tasks whose to-do list is linked to this category ("also show in") */
  function linkedTasks(state, catId) {
    const subs = todoSubs(state.categories).filter((s) => s.area === catId).map((s) => s.id);
    return visibleTasks(state).filter((t) => subs.includes(t.cat));
  }
  function categoryMarkdown(state, catId) {
    const cats = state.categories; const ids = subtreeIds(cats, catId);
    const items = itemsIn(state, catId).sort((a, b) => a.createdAt - b.createdAt);
    const isTodo = catId === 'todo' || isTodoCat(cats, catId);
    let md = `# ${catPath(cats, catId)}\n\n`;
    // one place rule (1.0.4): tasks are listed only in To-do
    if (isTodo) {
      const tasks = visibleTasks(state).filter((t) => ids.includes(t.cat));
      for (const sub of [catId, ...ids.slice(1)]) {
        const list = tasks.filter((t) => t.cat === sub); if (!list.length) continue;
        if (sub !== catId) md += `## ${catPath(cats, sub)}\n\n`;
        for (const t of list) md += `- [${t.done ? 'x' : ' '}] ${t.text}\n`;
        md += '\n';
      }
    }
    for (const it of items) {
      md += `## ${it.title}\n\n*${fmtDate(it.createdAt)}${it.tags.length ? ' · also: ' + it.tags.map((t) => catPath(cats, t)).join(', ') : ''}*\n\n${it.text}\n\n`;
    }
    return md;
  }
  function visibleTasks(state) {
    const ok = new Set(state.items.filter((i) => i.status === 'approved').map((i) => i.id));
    return state.tasks.filter((t) => !t.itemId || ok.has(t.itemId));
  }
  function allMarkdown(state) {
    const tops = state.categories.filter((c) => !c.parent);
    return `# Mind Desk export (${fmtDate(Date.now())})\n\n` + tops.map((c) => categoryMarkdown(state, c.id).replace(/^(#+) /gm, '#$1 ')).join('\n');
  }

  /** full check of a backup before it may replace anything. Returns '' when fine, else the first problem in plain words. */
  function backupProblem(o) {
    if (!o || typeof o !== 'object' || o.app !== 'mind-desk') return 'This is not a Mind Desk backup file.';
    for (const k of ['notes', 'items', 'tasks', 'categories']) if (!Array.isArray(o[k])) return `The backup has no ${k} list.`;
    const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    const str = (x) => typeof x === 'string';
    const uniq = (list, what) => { const s = new Set(); for (const x of list) { if (s.has(x.id)) return `Two ${what} have the same id (${x.id}).`; s.add(x.id); } return ''; };
    for (const [i, n] of o.notes.entries()) if (!isObj(n) || !str(n.id) || !str(n.text) || !str(n.name) || typeof n.addedAt !== 'number') return `Note number ${i + 1} is damaged.`;
    for (const [i, c] of o.categories.entries()) if (!isObj(c) || !str(c.id) || !str(c.name) || !(c.parent === null || c.parent === undefined || str(c.parent))) return `Category number ${i + 1} is damaged.`;
    for (const [i, it] of o.items.entries()) if (!isObj(it) || !str(it.id) || !str(it.noteId) || !str(it.original) || !str(it.text) || !str(it.cat) || !Array.isArray(it.tags) || !['pending', 'review', 'approved'].includes(it.status)) return `Item number ${i + 1} is damaged.`;
    for (const [i, t] of o.tasks.entries()) if (!isObj(t) || !str(t.id) || !str(t.text) || !str(t.cat) || typeof t.done !== 'boolean' || !(t.itemId === null || t.itemId === undefined || str(t.itemId))) return `Task number ${i + 1} is damaged.`;
    const dup = uniq(o.notes, 'notes') || uniq(o.items, 'items') || uniq(o.tasks, 'tasks') || uniq(o.categories, 'categories');
    if (dup) return dup;
    // ids end up inside the page, so they may only use simple characters
    const ID = /^[A-Za-z0-9_-]{1,64}$/;
    for (const [list, what] of [[o.notes, 'note'], [o.items, 'item'], [o.tasks, 'task'], [o.categories, 'category']]) {
      const bad = list.find((x) => !ID.test(x.id)); if (bad) return `A ${what} has an id with characters that are not allowed.`;
    }
    const strs = (a) => Array.isArray(a) && a.every(str);
    for (const it of o.items) {
      if (!strs(it.tags) || (it.flags !== undefined && !strs(it.flags)) || (it.lost !== undefined && !strs(it.lost))) return 'An item has damaged tags or warnings.';
      if ((it.title !== undefined && !str(it.title)) || (it.order !== undefined && typeof it.order !== 'number') || (it.createdAt !== undefined && typeof it.createdAt !== 'number')) return 'An item has a damaged title, order or date.';
    }
    for (const c of o.categories) if ((c.desc !== undefined && c.desc !== null && !str(c.desc)) || (c.area !== undefined && c.area !== null && !str(c.area))) return `Category “${c.name}” is damaged.`;
    for (const sys of ['todo', 'unsorted']) { const c = o.categories.find((x) => x.id === sys); if (c && c.parent) return `The built-in category “${c.name}” cannot be inside another category.`; }
    for (const c of o.categories) if (c.area && !o.categories.some((x) => x.id === c.area && !x.parent)) return `Category “${c.name}” links its tasks to a missing category.`;
    if (o.survey !== undefined && o.survey !== null) {
      if (!isObj(o.survey) || !Array.isArray(o.survey.questions)) return 'The open questions in the backup are damaged.';
      for (const q of o.survey.questions) {
        if (!isObj(q) || !str(q.id) || !ID.test(q.id) || !['word', 'intent'].includes(q.kind)) return 'An open question in the backup is damaged.';
        if (q.kind === 'word' ? !str(q.term) : !(str(q.quote) && str(q.question))) return 'An open question in the backup is damaged.';
        if (q.guess !== undefined && !str(q.guess)) return 'An open question in the backup is damaged.';
      }
      if (o.survey.draft !== undefined && (!isObj(o.survey.draft) || !Object.values(o.survey.draft).every(str))) return 'The draft answers in the backup are damaged.';
    }
    if (o.prompts !== undefined && (!isObj(o.prompts) || !Object.values(o.prompts).every((v) => v === null || str(v)))) return 'The AI instructions in the backup are damaged.';
    if (o.settings !== undefined) {
      if (!isObj(o.settings)) return 'The settings in the backup are damaged.';
      for (const [k, v] of Object.entries(o.settings)) if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) return `The setting “${k}” in the backup is damaged.`;
    }
    for (const t of o.tasks) if (t.createdAt !== undefined && typeof t.createdAt !== 'number') return 'A task has a damaged date.';
    const optStr = (v) => v === undefined || v === null || str(v);
    if (o.items.some((it) => !optStr(it.thinking) || !(it.mode === undefined || ['fast', 'careful'].includes(it.mode)))) return 'An item has damaged AI thinking.';
    if (o.notes.some((n) => !optStr(n.splitThinking))) return 'A note has damaged AI thinking.';
    if (o.notes.some((n) => !optStr(n.instruction))) return 'A note has a damaged instruction.';
    if (o.survey && !optStr(o.survey.thinking)) return 'The open questions in the backup are damaged.';
    const catIds = new Set(o.categories.map((c) => c.id)); const noteIds = new Set(o.notes.map((n) => n.id)); const itemIds = new Set(o.items.map((i) => i.id));
    for (const c of o.categories) {
      if (c.parent && !catIds.has(c.parent)) return `Category “${c.name}” points to a missing parent.`;
      if (c.parent && o.categories.find((p) => p.id === c.parent).parent) return `Category “${c.name}” is nested too deep (or in a loop).`;
    }
    for (const it of o.items) {
      if (!noteIds.has(it.noteId)) return `An item points to a note that is not in the backup.`;
      if (!catIds.has(it.cat) || it.tags.some((t) => !catIds.has(t))) return `An item points to a category that is not in the backup.`;
    }
    for (const t of o.tasks) {
      if (t.itemId && !itemIds.has(t.itemId)) return 'A task points to an item that is not in the backup.';
      if (!catIds.has(t.cat)) return 'A task points to a to-do list that is not in the backup.';
    }
    if (o.words !== undefined && (!Array.isArray(o.words) || o.words.some((w) => !isObj(w) || !str(w.term) || !(w.meaning === undefined || str(w.meaning)) || !(w.id === undefined || (str(w.id) && ID.test(w.id)))))) return 'The word list is damaged.';
    if (o.rules !== undefined && (!Array.isArray(o.rules) || o.rules.some((r) => !str(r)))) return 'The rule list is damaged.';
    if (o.memory !== undefined && (!Array.isArray(o.memory) || o.memory.some((m) => !isObj(m) || !str(m.id) || !ID.test(m.id) || !str(m.text) || !(m.at === undefined || typeof m.at === 'number')))) return 'The memory list is damaged.';
    if (o.chats !== undefined) {
      if (!Array.isArray(o.chats)) return 'The chats in the backup are damaged.';
      const seenChat = new Set();
      for (const c of o.chats) {
        if (!isObj(c) || !str(c.id) || !ID.test(c.id) || seenChat.has(c.id) || !str(c.title) || !Array.isArray(c.messages)) return 'A chat in the backup is damaged.';
        seenChat.add(c.id);
        for (const m of c.messages) {
          if (!isObj(m) || !str(m.id) || !ID.test(m.id) || !['user', 'assistant'].includes(m.role) || !str(m.text) || !optStr(m.thinking)) return 'A chat message in the backup is damaged.';
          if (m.actions !== undefined && (!Array.isArray(m.actions) || m.actions.some((a) => !isObj(a) || !str(a.id) || !ID.test(a.id) || !str(a.type) || !['pending', 'applied', 'cancelled', 'failed', 'shown'].includes(a.status)))) return 'A chat action in the backup is damaged.';
          if (m.remember !== undefined && (!Array.isArray(m.remember) || m.remember.some((r) => !isObj(r) || !str(r.id) || !ID.test(r.id) || !str(r.text) || !['pending', 'saved', 'cancelled'].includes(r.status)))) return 'A chat memory card in the backup is damaged.';
        }
      }
    }
    return '';
  }
  function validBackup(o) { return !backupProblem(o); }

  /* ---------- chat ---------- */
  const CHAT_STOP = new Set('a an the and or but so if to of on in at for with from by about is are was were be been am i me my mine you your we our it its this that these those what which who how why when where can could should would will do does did done have has had not no yes please show tell give find list all any some my notes note items item there here them they than then just also more most very really haha ok okay now today'.split(' '));
  const chatWords = (t) => [...new Set((String(t).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 2 && !CHAT_STOP.has(w)))];
  const wordHit = (w, text) => { const tw = text.toLowerCase().match(/[a-z0-9]+/g) || []; return tw.some((x) => x === w || (w.length >= 4 && x.length >= 4 && x.slice(0, 4) === w.slice(0, 4))); };
  const TODO_WORDS = /\b(to-?dos?|tasks?|chores?|shopping|buy|pending|open|done|finish(ed)?|tick)\b/i;
  /**
   * What Mind Desk shows the AI for one chat message: a short overview, the notes the person named,
   * the best matching items and (when asked about to-dos) the tasks. Kept small for local models.
   * Returns {text, ids:{notes, items, tasks}}
   */
  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  /** does the message name this note? Numbers ("1") count as "note 1", "tab 1", "#1", "in 1", "1st note", "first note", "note one"… */
  function noteNamed(name, lower) {
    const nm = String(name || '').toLowerCase().trim(); if (!nm) return false;
    if (/^\d+$/.test(nm)) {
      const k = +nm; const ord = ORDINAL[k - 1]; const word = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][k - 1];
      const num = '(?:' + nm + (ord ? '|' + ord : '') + (word ? '|' + word : '') + (k === 1 ? '|1st' : k === 2 ? '|2nd' : k === 3 ? '|3rd' : '|' + nm + 'th') + ')';
      return new RegExp('\\b(?:notes?|tabs?|no\\.?|number|#)\\s*#?\\s*' + num + '\\b|#' + nm + '\\b|"' + nm + '"|“' + nm + '”|\\b(?:in|of|from)\\s+' + nm + '\\b(?![.,:]\\d)|\\b' + num + '\\s+(?:note|tab)\\b').test(lower);
    }
    return lower.includes(nm) || (nm.length > 3 && lower.includes('"' + nm));
  }
  const utf8Len = (t) => { let n = 0; for (const ch of String(t)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
  /**
   * "Read all my notes" (artifact, Claude): every note's own text, newest first, organized or not, then items and tasks.
   * Limited to about maxBytes (Claude can take ~256 KiB per request); what does not fit is named as left out.
   */
  function buildAllNotesContext(state, opts) {
    const cats = state.categories; const ids = { notes: new Set(), items: new Set(), tasks: new Set() };
    const maxBytes = (opts && opts.maxBytes) || 150000; const perNote = (opts && opts.perNote) || 40000;
    const L = ['All your notes, newest first (organized or not). Each NOTE shows the person\'s own original text.'];
    let used = 0; const left = [];
    const notes = [...state.notes].sort((a, b) => b.addedAt - a.addedAt);
    for (const n of notes) {
      const its = state.items.filter((i) => i.noteId === n.id && i.status !== 'pending').sort((a, b) => a.order - b.order);
      const status = n.status === 'new' ? 'not organized yet' : its.length ? its.length + ' item(s)' : 'being organized';
      let body = n.text; let cut = '';
      if (body.length > perNote) { cut = `\n[… cut: only the first ${perNote.toLocaleString('en')} of ${body.length.toLocaleString('en')} characters are shown]`; body = body.slice(0, perNote); }
      const block = `\nNOTE [${n.id}] "${n.name}" · added ${fmtDate(n.addedAt)} · ${status}\n<<<\n${body}\n>>>${cut}`;
      const b = utf8Len(block);
      if (used + b > maxBytes) { left.push(n); continue; }
      used += b; L.push(block); ids.notes.add(n.id);
      if (its.length) {
        L.push('Items made from it:');
        for (const it of its) {
          ids.items.add(it.id);
          const tx = it.text === it.original ? '(same text as in the note)' : (it.text.length > 600 ? it.text.slice(0, 600) + ' …' : it.text);
          const line = `ITEM [${it.id}] "${it.title}" · ${catPath(cats, it.cat)} · ${it.status === 'review' ? 'waiting for review' : 'approved'}\n${tx}`;
          used += utf8Len(line); L.push(line);
        }
      }
    }
    if (left.length) L.push('', `NOT INCLUDED (too much text for one message): ${left.length} older note(s): ${left.slice(0, 40).map((n) => `"${n.name}"`).join(', ')}${left.length > 40 ? ' …' : ''}. If the person asks about these, say you could not read them this time and suggest naming the note in the message.`);
    const tasks = visibleTasks(state).slice(0, 300);
    if (tasks.length) L.push('', 'Tasks:');
    for (const t of tasks) { ids.tasks.add(t.id); L.push(`TASK [${t.id}] [${t.done ? 'x' : ' '}] ${t.text} · ${catPath(cats, t.cat)}`); }
    L.push('', 'Items per category: ' + assignableCats(cats).map((c) => `${catPath(cats, c.id)} ${state.items.filter((i) => i.status !== 'pending' && i.cat === c.id).length}`).join(', '));
    return { text: L.join('\n'), ids, left: left.length };
  }
  function buildChatContext(state, message, recent) {
    const cats = state.categories; const q = String(message) + ' ' + (recent || '');
    const words = chatWords(q); const lower = q.toLowerCase();
    const ids = { notes: new Set(), items: new Set(), tasks: new Set() };
    const L = [];
    const visibleItems = state.items.filter((i) => i.status !== 'pending');
    // notes named in the message ("note 4", "Notepad tab 3", "4")
    const named = state.notes.filter((n) => noteNamed(n.name, lower));
    L.push('Overview:');
    L.push('Notes: ' + state.notes.slice(-30).map((n) => `[${n.id}] "${n.name}" (${n.status === 'new' ? 'not organized' : state.items.filter((i) => i.noteId === n.id).length + ' items'})`).join('; '));
    state.notes.slice(-30).forEach((n) => ids.notes.add(n.id));
    L.push('Items per category: ' + assignableCats(cats).map((c) => `${catPath(cats, c.id)} ${visibleItems.filter((i) => i.cat === c.id).length}`).join(', '));
    const itemLine = (it) => {
      ids.items.add(it.id); const n = state.notes.find((x) => x.id === it.noteId);
      const tx = it.text.length > 700 ? it.text.slice(0, 700) + ' …' : it.text;
      return `ITEM [${it.id}] "${it.title}" · ${catPath(cats, it.cat)} · ${it.status === 'review' ? 'waiting for review' : 'approved'} · from note "${n ? n.name : '?'}" [${it.noteId}]\n${tx}`;
    };
    let budget = 9000;
    for (const n of named.slice(0, 2)) {
      ids.notes.add(n.id);
      const its = visibleItems.filter((i) => i.noteId === n.id).sort((a, b) => a.order - b.order);
      L.push('', `NOTE [${n.id}] "${n.name}" — ${its.length ? its.length + ' items:' : 'not organized yet. Original text:\n' + n.text.slice(0, 4000) + (n.text.length > 4000 ? `\n[… cut: the note has ${n.text.length.toLocaleString('en')} characters]` : '')}`);
      for (const it of its) { const t = itemLine(it); if (budget - t.length < 0) break; budget -= t.length; L.push(t); }
    }
    // best matching other items
    const scored = visibleItems.filter((it) => !ids.items.has(it.id)).map((it) => {
      const cp = catPath(cats, it.cat);
      let sc = 0; for (const w of words) { if (wordHit(w, it.title)) sc += 3; if (wordHit(w, cp)) sc += 2; if (wordHit(w, it.text)) sc += 1; }
      return { it, sc };
    }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || b.it.updatedAt - a.it.updatedAt).slice(0, 8);
    if (scored.length) L.push('', 'Items that match the message:');
    for (const { it } of scored) { const t = itemLine(it); if (budget - t.length < 0) break; budget -= t.length; L.push(t); }
    // tasks
    const tasks = visibleTasks(state);
    let tl = [];
    if (TODO_WORDS.test(q)) {
      const catHit = assignableCats(cats).concat(todoSubs(cats)).filter((c) => words.some((w) => wordHit(w, c.name)));
      tl = tasks.filter((t) => !catHit.length || catHit.some((c) => t.cat === c.id || subtreeIds(cats, c.id).includes(t.cat) || todoSubs(cats).some((s) => s.id === t.cat && s.area === c.id)));
      if (!tl.length) tl = tasks;
    } else tl = tasks.filter((t) => words.some((w) => wordHit(w, t.text)));
    tl = tl.slice(0, 40);
    if (tl.length) L.push('', 'Tasks:');
    for (const t of tl) { ids.tasks.add(t.id); L.push(`TASK [${t.id}] [${t.done ? 'x' : ' '}] ${t.text} · ${catPath(cats, t.cat)}`); }
    return { text: L.join('\n'), ids };
  }
  function buildChatPrompt(tpl, state, chat, message, ctx) {
    const hist = (chat.messages || []).slice(-10);
    const recent = hist.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ');
    const c = ctx.allNotes ? buildAllNotesContext(state, ctx.allNotes) : buildChatContext(state, message, recent);
    const mem = (ctx.memory || []).map((m) => '- ' + m).join('\n') || '(nothing yet)';
    const system = fill(tpl, { memory: mem, words: wordLines(ctx.words), categories: catLines(ctx.cats), todoCategories: todoLines(ctx.cats), context: c.text });
    let user = '';
    if (hist.length) user += 'Earlier in this chat:\n' + hist.map((m) => (m.role === 'user' ? 'Person: ' : 'You: ') + String(m.text).slice(0, 1200)).join('\n') + '\n\n';
    user += 'Person: ' + message;
    return { system, user, ids: c.ids };
  }
  /* ---------- round trip with the Claude artifact (cloud build): send everything, organize there, merge back ---------- */
  const RT_LISTS = ['notes', 'items', 'tasks', 'chats', 'memory', 'words', 'categories'];
  function hash(o) { const str = JSON.stringify(o); let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + str.length.toString(36); }
  /** fingerprints of everything at the moment of sending, to know later what changed on which side */
  function roundTripBase(state) {
    const base = {};
    for (const k of RT_LISTS) { base[k] = {}; for (const x of state[k] || []) if (x && x.id != null) base[k][x.id] = hash(x); }
    base.prompts = {}; for (const k of Object.keys(state.prompts || {})) base.prompts[k] = hash(state.prompts[k]);
    base.survey = hash(state.survey || null);
    return base;
  }
  const stamp = (x) => Math.max(+x.updatedAt || 0, +x.at || 0, +x.doneAt || 0, +x.addedAt || 0, +x.createdAt || 0);
  /**
   * Three-way merge: local = this app now, incoming = the file from the artifact, base = fingerprints at sending (null: not sent from here).
   * Changed on one side only → that side wins. Changed on both → the newer one (incoming when unknown). New on either side → kept.
   * Deleted on one side and unchanged on the other → deleted. Settings stay local.
   */
  function mergeRoundTrip(local, incoming, base) {
    const out = JSON.parse(JSON.stringify(local)); const sum = { added: {}, updated: {}, removed: {}, keptHere: {}, conflicts: 0 };
    const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
    for (const k of RT_LISTS) {
      const L = new Map((local[k] || []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
      const I = new Map((incoming[k] || []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
      const B = (base && base[k]) || {};
      const res = [];
      for (const [id, x] of I) {
        const l = L.get(id); const inBase = id in B;
        if (l) {
          const lc = !inBase || hash(l) !== B[id]; const ic = !inBase || hash(x) !== B[id];
          if (!ic) res.push(l);
          else if (!lc) { res.push(x); if (hash(l) !== hash(x)) inc(sum.updated, k); }
          else if (hash(l) === hash(x)) res.push(l);
          else { sum.conflicts++; const pick = stamp(l) > stamp(x) ? l : x; res.push(pick); if (pick === x) inc(sum.updated, k); }
        } else if (inBase) { // deleted here after sending
          if (hash(x) !== B[id]) sum.conflicts++; // changed there, deleted here: stays deleted
        } else { res.push(x); inc(sum.added, k); } // new from the artifact
      }
      for (const [id, l] of L) {
        if (I.has(id)) continue;
        if (id in B) { if (hash(l) !== B[id]) { res.push(l); sum.conflicts++; } else inc(sum.removed, k); } // removed there
        else { res.push(l); inc(sum.keptHere, k); } // new here since sending
      }
      out[k] = res.map((x) => JSON.parse(JSON.stringify(x)));
    }
    out.prompts = Object.assign({}, local.prompts || {});
    for (const k of Object.keys(Object.assign({}, local.prompts, incoming.prompts))) {
      const l = (local.prompts || {})[k] ?? null; const x = (incoming.prompts || {})[k] ?? null; const b = base && base.prompts ? base.prompts[k] : undefined;
      if (hash(x) !== b && (b === undefined ? true : hash(l) === b)) out.prompts[k] = x;
    }
    if (base && hash(local.survey || null) === base.survey) out.survey = incoming.survey || null;
    // keep the pieces consistent
    const noteIds = new Set(out.notes.map((n) => n.id));
    out.items = out.items.filter((i) => noteIds.has(i.noteId));
    const itemIds = new Set(out.items.map((i) => i.id));
    out.tasks = out.tasks.filter((t) => !t.itemId || itemIds.has(t.itemId));
    const catIds = new Set(out.categories.map((c) => c.id));
    for (const sys of defaultCategories().filter((c) => c.system)) if (!catIds.has(sys.id)) { out.categories.push(sys); catIds.add(sys.id); }
    out.categories.forEach((c) => { if (c.parent && !catIds.has(c.parent)) c.parent = null; if (c.area && !catIds.has(c.area)) c.area = null; });
    out.items.forEach((i) => { if (!catIds.has(i.cat)) i.cat = 'unsorted'; i.tags = (i.tags || []).filter((t) => catIds.has(t)); });
    out.tasks.forEach((t) => { if (!catIds.has(t.cat)) t.cat = 'todo'; });
    out.schema = Math.max(+local.schema || 1, +incoming.schema || 1);
    return { state: out, summary: sum };
  }
  /** keep only actions that point to things that exist; returns {actions, dropped} */
  /** the "reply" text from a JSON answer that is still being written (for the live chat bubble) */
  function partialReply(raw) {
    const m = String(raw || '').match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (!m) return '';
    let body = m[1].replace(/\\(u[0-9a-fA-F]{0,3})?$/, ''); // drop a cut-off escape at the end
    try { return JSON.parse('"' + body + '"'); } catch (e) { return body.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
  }
  function checkChatActions(list, state, ids) {
    const out = []; let dropped = 0; const cats = state.categories;
    const assign = assignableCats(cats).map((c) => c.id); const subs = todoSubs(cats).map((c) => c.id);
    const item = (id) => state.items.find((i) => i.id === id && i.status !== 'pending');
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || typeof a !== 'object') { dropped++; continue; }
      const t = a.type; let ok = false; const x = { type: t };
      if (t === 'move_item') { ok = !!item(a.item) && assign.includes(a.category) && item(a.item).cat !== a.category; Object.assign(x, { item: a.item, category: a.category }); }
      else if (t === 'rename_item') { ok = !!item(a.item) && typeof a.title === 'string' && !!a.title.trim(); Object.assign(x, { item: a.item, title: String(a.title || '').trim().slice(0, 90) }); }
      else if (t === 'mark_task') { ok = state.tasks.some((k) => k.id === a.task); Object.assign(x, { task: a.task, done: a.done !== false && a.done !== 'false' }); }
      else if (t === 'add_task') { ok = typeof a.text === 'string' && !!a.text.trim(); Object.assign(x, { text: String(a.text || '').trim().slice(0, 300), category: subs.includes(a.category) ? a.category : (subs[0] || 'todo') }); }
      else if (t === 'organize_again') { ok = state.notes.some((n) => n.id === a.note); Object.assign(x, { note: a.note, instruction: String(a.instruction || '').trim().slice(0, 500) }); }
      else if (t === 'show_note') { ok = state.notes.some((n) => n.id === a.note); x.note = a.note; }
      if (ok && !out.some((o) => JSON.stringify(o) === JSON.stringify(x))) out.push(x); else dropped++;
    }
    return { actions: out.slice(0, 8), dropped };
  }
  function checkRemember(list, memory) {
    const have = new Set((memory || []).map((m) => String(m.text || m).toLowerCase().trim()));
    return [...new Set((Array.isArray(list) ? list : []).map((r) => String(r || '').trim()).filter((r) => r.length >= 3 && r.length <= 300 && !have.has(r.toLowerCase())))].slice(0, 5);
  }

  /* ---------- report for Claude ---------- */
  const NOT_NAMES = new Set(('I Im Ive Id Ill The A An And But Or So If Then When While This That These Those It Its My Me We Our You Your He She They His Her Their Ok Okay Yes No Not Ex Sol Note Notes Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec English Hindi Odia India Indian Google Keep Notepad Windows Chrome Edge Ollama ChatGPT Claude AI PowerPoint Excel Word WordPress Twitter Linkedin LinkedIn Insta Instagram Youtube YouTube Facebook WhatsApp Mind Desk Haha Also Just Maybe May Like Make Think Today Tomorrow Now Later Done End Result').split(' '));
  /** words that look like names of people (capitalised inside a sentence); the owner can edit the list before hiding */
  function nameCandidates(text, words) {
    const known = new Set((words || []).map((w) => String(w.term).toLowerCase()));
    const out = new Map();
    for (const m of String(text).matchAll(/(?<=[a-z,;:]\s+|\b(?:to|with|from|by|ask|call|tell|meet|pay)\s+)([A-Z][a-z]{2,})\b/g)) {
      const w = m[1]; if (NOT_NAMES.has(w) || known.has(w.toLowerCase())) continue;
      out.set(w, (out.get(w) || 0) + 1);
    }
    return [...out.keys()];
  }
  function hideNames(text, names) {
    let t = String(text);
    names.forEach((n, k) => { if (n) t = t.replace(new RegExp('\\b' + reEsc(n) + '\\b', 'gi'), 'Person ' + (k + 1)); });
    return t;
  }
  /**
   * Plain-text report of what Mind Desk shows, for pasting into a chat with Claude.
   * opts: {noteIds|null, thinking, settings, prompts, runLog, hide:[names], version, defaults:{prompts}}
   */
  function buildReport(state, opts) {
    const o = Object.assign({ thinking: true, settings: true, prompts: true, runLog: true, hide: [] }, opts || {});
    const cats = state.categories; const s = state.settings || {};
    const notes = state.notes.filter((n) => !o.noteIds || o.noteIds.includes(n.id)).sort((a, b) => a.addedAt - b.addedAt);
    const L = [];
    const dt = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
    L.push(`MIND DESK REPORT · version ${o.version || '?'} · ${dt(Date.now())} UTC`);
    L.push(`AI: ${s.provider === 'ollama' ? 'Ollama, model ' + s.model : s.provider === 'openai' ? 'OpenAI-style API, model ' + s.oaModel : 'copy & paste'} · default mode ${s.mode || 'fast'} · writing: ${s.editStyle === 'clean' ? 'clean up wording' : 'fix typos only'}`);
    L.push(`Notes in this report: ${notes.length} of ${state.notes.length}`);
    if (o.settings) {
      L.push('', '## Categories');
      for (const c of assignableCats(cats)) L.push(`- ${c.id}: ${catPath(cats, c.id)}${c.desc ? ' — ' + c.desc : ''}`);
      L.push('', '## My words'); (state.words || []).forEach((w) => L.push(`- ${w.term} = ${w.meaning || '(keep as is)'}`));
      L.push('', '## Memory'); (state.memory || []).forEach((m) => L.push('- ' + m.text)); if (!(state.memory || []).length) L.push('(none)');
      if ((state.rules || []).filter(Boolean).length) { L.push('', '## My rules'); state.rules.filter(Boolean).forEach((r) => L.push('- ' + r)); }
    }
    if (o.prompts) {
      const edited = Object.entries(state.prompts || {}).filter(([, v]) => v);
      L.push('', '## AI instructions'); if (!edited.length) L.push('All default (not edited).');
      for (const [k, v] of edited) L.push(`### ${k} (edited)`, v);
    }
    for (const n of notes) {
      const its = state.items.filter((i) => i.noteId === n.id).sort((a, b) => a.order - b.order);
      L.push('', `=== NOTE "${n.name}" · added ${dt(n.addedAt)} · ${n.text.length} chars · ${n.status === 'new' ? 'not organized yet' : its.length + ' item(s)'}${n.splitMs ? ' · split took ' + (n.splitMs / 1000).toFixed(1) + ' s' : ''} ===`);
      L.push('--- ORIGINAL NOTE ---', n.text);
      if (o.thinking && n.splitThinking) L.push('--- AI THINKING WHILE SPLITTING ---', n.splitThinking);
      its.forEach((it, k) => {
        const tasks = (state.tasks || []).filter((t) => t.itemId === it.id);
        L.push('', `--- ITEM ${k + 1}/${its.length} · ${it.status} · ${catPath(cats, it.cat)}${it.tags && it.tags.length ? ' (also: ' + it.tags.map((t) => catPath(cats, t)).join(', ') + ')' : ''} · ${it.mode || 'fast'}${it.ms ? ' · ' + (it.ms / 1000).toFixed(1) + ' s' : ''}${it.flags && it.flags.length ? ' · warnings: ' + it.flags.join(', ') : ''}${it.surveyFailed ? ' · questions step failed' : ''} ---`);
        L.push('Title: ' + (it.title || ''));
        L.push('Original part:', it.original);
        if (it.text !== it.original) L.push('Cleaned:', it.text); else L.push('Cleaned: (same as original)');
        if (tasks.length) { L.push('Tasks:'); tasks.forEach((t) => L.push(`- [${t.done ? 'x' : ' '}] ${t.text} (${catPath(cats, t.cat)})`)); }
        if (it.error) L.push('AI error: ' + it.error);
        if (o.thinking && it.thinking) L.push('AI thinking:', it.thinking);
      });
    }
    if (o.runLog && Array.isArray(state.runLog) && state.runLog.length) {
      L.push('', '## Last AI requests (newest last)');
      for (const r of state.runLog.slice(-60)) L.push(`- ${dt(r.at)} ${r.step}${r.note ? ' "' + r.note + '"' : ''} · ${r.mode} · ${(r.ms / 1000).toFixed(1)} s · ${r.ok ? 'ok' : 'FAILED: ' + r.err}${r.cut ? ' · thinking stopped (too long)' : ''}${r.thinkChars ? ' · thinking ' + r.thinkChars + ' chars' : ''}`);
    }
    return hideNames(L.join('\n'), o.hide || []);
  }

  /**
   * After "---" splits the edited text, find the matching pieces of the original (typo) text.
   * Words are lined up allowing typos ("wnat" ~ "want", "mov eon" ~ "move on"). For very long texts the cut is
   * placed at the same share of words. The result is always cut from the original text; .approx marks a guess.
   */
  function splitOriginal(original, parts) {
    const toks = (t) => { const out = []; const re = /\S+/g; let m; while ((m = re.exec(t))) out.push({ w: m[0].toLowerCase(), at: m.index }); return out; };
    const A = toks(original);
    const B = []; const cutsB = []; // word index in B where part k (k>0) starts
    parts.forEach((p, k) => { if (k) cutsB.push(B.length); for (const t of toks(p)) B.push(t); });
    const n = A.length, m = B.length;
    let approx = false; let cutsA;
    const sim = (x, y) => {
      if (x === y) return 2;
      const d = editDistance(x, y); const L = Math.max(x.length, y.length);
      if (d !== null && d <= Math.max(1, Math.floor(L / 2))) return 1;
      if (x.length >= 2 && y.length >= 2 && (y.startsWith(x) || x.startsWith(y))) return 1; // "mov" / "move"
      return -1;
    };
    if (n && m && n * m <= 4e6) {
      // global alignment, keep for each B word the A word it lines up with (or the next one)
      const W = m + 1; const score = new Int32Array((n + 1) * W); const move = new Uint8Array((n + 1) * W);
      for (let i = 1; i <= n; i++) { score[i * W] = -i; move[i * W] = 1; }
      for (let j = 1; j <= m; j++) { score[j] = -j; move[j] = 2; }
      for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
        const d = score[(i - 1) * W + j - 1] + sim(A[i - 1].w, B[j - 1].w), u = score[(i - 1) * W + j] - 1, l = score[i * W + j - 1] - 1;
        if (d >= u && d >= l) { score[i * W + j] = d; move[i * W + j] = 0; } else if (u >= l) { score[i * W + j] = u; move[i * W + j] = 1; } else { score[i * W + j] = l; move[i * W + j] = 2; }
      }
      const mapB = new Int32Array(m + 1).fill(-1); mapB[m] = n; let i = n, j = m;
      while (i > 0 || j > 0) {
        const mv = i > 0 && j > 0 ? move[i * W + j] : i > 0 ? 1 : 2;
        if (mv === 0) { mapB[j - 1] = i - 1; i--; j--; } else if (mv === 1) i--; else { mapB[j - 1] = -1; j--; }
      }
      for (let k = m - 1; k >= 0; k--) if (mapB[k] < 0) mapB[k] = mapB[k + 1]; // an extra word maps to the next aligned one
      cutsA = cutsB.map((cb) => mapB[cb]);
    } else { approx = true; cutsA = cutsB.map((cb) => Math.round((cb / Math.max(m, 1)) * n)); }
    // character positions in the original; prefer starting a part at the beginning of a line
    const pos = cutsA.map((ia) => {
      if (ia >= n) return original.length;
      let p = A[ia].at; const ls = original.lastIndexOf('\n', p - 1) + 1;
      if (/^\s*$/.test(original.slice(ls, p))) p = ls;
      return p;
    });
    const bounds = [0, ...pos, original.length];
    for (let k = 1; k < bounds.length; k++) if (bounds[k] < bounds[k - 1]) bounds[k] = bounds[k - 1];
    let out = parts.map((_, k) => original.slice(bounds[k], bounds[k + 1]).trim());
    if (out.some((x) => !x)) { // never relabel cleaned text as original: fall back to an even share of the original
      approx = true; const per = original.length / parts.length;
      out = parts.map((_, k) => original.slice(Math.round(per * k), k === parts.length - 1 ? original.length : Math.round(per * (k + 1))).trim());
    }
    out.approx = approx;
    return out;
  }

  return {
    uid, defaultCategories, DEFAULT_PROMPTS, SCHEMAS, children, subtreeIds, isTodoCat, catPath, assignableCats, todoSubs,
    makeBlocks, groupsFromStarts, blockWindows, parseJSON, fill, protectedTerms, buildSplitPrompt, buildSurveyPrompt,
    partialReply, buildOrganizePrompt, bulkSplitPrompt, bulkOrganizePrompt, bulkSurveyPrompt, diff, changeRatio, countTerm, checkOrganize,
    checkSurvey, fmtDate, safeName, categoryMarkdown, allMarkdown, visibleTasks, validBackup, backupProblem, itemsIn, linkedTasks,
    editDistance, splitOriginal, taskSupport, taskDone, charChange, wordMatch, EDIT_RULES, buildFixPrompt, buildReport, nameCandidates, hideNames,
    buildChatContext, buildAllNotesContext, noteNamed, buildChatPrompt, roundTripBase, mergeRoundTrip, checkChatActions, checkRemember,
  };
})();
if (typeof window !== 'undefined') window.MDCore = MDCore;
if (typeof module !== 'undefined') module.exports = MDCore;
