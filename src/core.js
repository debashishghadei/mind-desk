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
1. "text": the SAME note with ONLY spelling mistakes and typos fixed (examples: "thoguth" -> "thought", "mov eon" -> "move on", "teh" -> "the"). Keep the person's own words, short style, slang, "haha", grammar style, line breaks, list markers and "//" lines. Do NOT rewrite, polish, summarize, translate, add or remove anything. Keep these words exactly as written: {{protected}}
2. "title": a short title in plain English, at most 8 words.
3. "category": the id of the ONE best category.
4. "tags": ids of other categories this note also clearly relates to (often empty).
5. "tasks": only real actions the person intends to do (chores, buying, work tasks). Write each as a short clear task. "done" is true if it is marked done. "category" is the best to-do id. Reflections, lessons, wishes and goals are NOT tasks. Never make a task from something the person says NOT to do. "done" is true ONLY if the note clearly says it is done. Empty list if there are none.
Categories (id: name - meaning):
{{categories}}
To-do ids for tasks:
{{todoCategories}}
What the person's words mean:
{{words}}
The person's rules:
{{rules}}
Answer only with JSON: {"title":"","category":"","tags":[],"tasks":[{"text":"","done":false,"category":""}],"text":""}`,
  };

  const SCHEMAS = {
    split: { type: 'object', properties: { starts: { type: 'array', items: { type: 'integer' } } }, required: ['starts'] },
    survey: {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['word', 'intent'] }, term: { type: 'string' }, quote: { type: 'string' }, question: { type: 'string' }, guess: { type: 'string' } }, required: ['kind'] } } },
      required: ['questions'],
    },
    organize: {
      type: 'object',
      properties: {
        title: { type: 'string' }, category: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
        tasks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' }, category: { type: 'string' } }, required: ['text', 'done', 'category'] } },
        text: { type: 'string' },
      },
      required: ['title', 'category', 'tags', 'tasks', 'text'],
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
    for (const m of String(text).matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)) set.add(m[0]);
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
  function buildOrganizePrompt(tpl, text, ctx) {
    const prot = protectedTerms(text, ctx.words);
    return {
      system: fill(tpl, { protected: prot.length ? prot.join(', ') : '(none)', categories: catLines(ctx.cats), todoCategories: todoLines(ctx.cats), words: wordLines(ctx.words), rules: ruleLines(ctx.rules) }),
      user: 'Note:\n<<<\n' + text + '\n>>>',
    };
  }

  /* bulk versions for copy/paste mode (ChatGPT / Claude) */
  function bulkSplitPrompt(tpl, notes) {
    let user = 'There are several notes. Do the job for EACH note separately.\nAnswer only with JSON: {"notes":[{"id":"note id","starts":[...]}]}\n\n';
    for (const n of notes) user += `=== NOTE ${n.id} ===\n` + n.blocks.map((b, k) => `[${k + 1}]${bmark(b, k)}\n${btext(b)}`).join('\n\n') + '\n\n';
    return tpl + '\n\n' + user;
  }
  function bulkOrganizePrompt(tpl, items, ctx) {
    const all = items.map((i) => i.text).join('\n');
    const p = buildOrganizePrompt(tpl, all, ctx);
    let user = 'There are several notes. Do the job for EACH note separately and keep its id.\nAnswer only with JSON: {"results":[{"id":"note id","title":"","category":"","tags":[],"tasks":[],"text":""}]}\n\n';
    for (const it of items) user += `=== NOTE ${it.id} ===\n<<<\n${it.text}\n>>>\n\n`;
    return p.system + '\n\n' + user;
  }
  function bulkSurveyPrompt(tpl, text, ctx) { const p = buildSurveyPrompt(tpl, text, ctx); return p.system + '\n\n' + p.user; }

  /* ---------- checking AI results ---------- */
  function words(s) { return String(s).split(/\s+/).filter(Boolean); }

  /** word-level diff (LCS). returns [{t:'eq'|'del'|'ins', s}] */
  function diff(a, b) {
    const A = String(a).split(/(\s+)/), B = String(b).split(/(\s+)/);
    const n = A.length, m = B.length;
    if (n * m > 4e6) return [{ t: 'del', s: a }, { t: 'ins', s: b }];
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (t, s) => { const l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t, s }); };
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('eq', A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; } else { push('ins', B[j]); j++; }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('ins', B[j++]);
    return out;
  }
  function changeRatio(a, b) {
    const wa = words(a), wb = words(b); if (!wa.length) return 0;
    const n = wa.length, m = wb.length;
    if (n * m > 4e6) return 1;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = wa[i] === wb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    return 1 - dp[0][0] / Math.max(n, m);
  }
  function countTerm(text, term) {
    const re = new RegExp('(^|[^\\w])' + reEsc(term) + '(?![\\w])', 'g');
    return (String(text).match(re) || []).length;
  }
  /** character edit distance (Levenshtein), two rows; null when too long to compute quickly */
  function editDistance(a, b) {
    a = String(a); b = String(b);
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
  const NEG = /\b(not|no|never|nothing|none|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|cannot|couldn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|shouldn'?t|mustn'?t|haven'?t|hasn'?t|nahi|nahin|mat)\b/gi;
  const DONE = /(\b(done|did|finished|completed?|already|sent|paid|bought|called)\b|\(done|✓|✔|\[x\])/i;
  const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'from', 'that', 'this', 'into', 'your', 'my', 'some', 'more', 'have', 'will', 'then', 'also', 'make', 'call', 'buy', 'get', 'do', 'to', 'of', 'on', 'in', 'a', 'an']);
  const numbersOf = (t) => (String(t).match(/\d+(?:[.,:/]\d+)*/g) || []).sort().join('|');
  const contentWords = (t) => (String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
  /** does the note support this task? (shares a word; the line it comes from is not negated) */
  function taskSupport(task, original, fixed) {
    const tw = contentWords(task).map((w) => w.slice(0, 4));
    if (!tw.length) return true;
    const lines = (original + '\n' + fixed).split('\n').filter((ln) => contentWords(ln).some((w) => tw.includes(w.slice(0, 4))));
    if (!lines.length) return false;
    return !lines.every((ln) => { NEG.lastIndex = 0; return NEG.test(ln); });
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
    const tags = [...new Set((Array.isArray(r.tags) ? r.tags : []).map(String).filter((t) => cats.some((c) => c.id === t) && !isTodoCat(cats, t) && t !== category && t !== 'unsorted'))];
    const subs = todoSubs(cats).map((c) => c.id);
    const area = (id) => { const c = todoSubs(cats).find((s) => s.area && subtreeIds(cats, s.area).includes(id)); return c ? c.id : null; };
    let taskWarn = false;
    const tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter((t) => t && String(t.text || '').trim()).map((t) => {
      const text = String(t.text).trim().slice(0, 300);
      if (!taskSupport(text, original, typeof r.text === 'string' ? r.text : '')) taskWarn = true;
      return {
        text,
        // "done" needs a sign in the note itself; otherwise the task stays open
        done: (t.done === true || t.done === 'true') && DONE.test(original),
        cat: subs.includes(t.category) ? t.category : (area(category) || subs[0] || 'todo'),
      };
    });
    if (taskWarn) flags.push('taskcheck');
    let title = String(r.title || '').trim().replace(/^["']|["']$/g, '').slice(0, 90);
    if (!title) title = words(text).slice(0, 7).join(' ');
    // guardrails: the typo fix must not change meaning
    const wo = words(original).length, wt = words(text).length;
    const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
    const a = norm(original), b = norm(text);
    if ((wo >= 6 && wt < wo * 0.8) || b.length < a.length * 0.7) flags.push('shortened');
    const dist = editDistance(a, b);
    if (dist === null ? changeRatio(original, text) > 0.35 : dist > 4 && dist / Math.max(a.length, b.length, 1) > 0.3) flags.push('bigchange');
    if (numbersOf(original) !== numbersOf(text)) flags.push('numbers');
    if ((text.match(NEG) || []).length < (original.match(NEG) || []).length) flags.push('negation');
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
    const linked = isTodo ? [] : linkedTasks(state, catId);
    if (linked.length) md += '## Tasks\n\n' + linked.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}\n`).join('') + '\n';
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
    if (o.words !== undefined && (!Array.isArray(o.words) || o.words.some((w) => !isObj(w) || !str(w.term)))) return 'The word list is damaged.';
    if (o.rules !== undefined && (!Array.isArray(o.rules) || o.rules.some((r) => !str(r)))) return 'The rule list is damaged.';
    return '';
  }
  function validBackup(o) { return !backupProblem(o); }

  /** after "---" splits edited text, find the matching pieces of the original (typo) text */
  function splitOriginal(original, parts) {
    const joined = parts.join('\n');
    const d = diff(original, joined);
    const mapPos = (pb) => {
      let a = 0, b = 0;
      for (const t of d) {
        const len = t.s.length;
        if (t.t === 'eq') { if (pb <= b + len) return a + (pb - b); a += len; b += len; } else if (t.t === 'del') a += len; else { if (pb <= b + len) return a; b += len; }
      }
      return a;
    };
    const snap = (pos) => {
      if (pos <= 0 || original[pos - 1] === '\n') return pos;
      const back = original.lastIndexOf('\n', pos), fwd = original.indexOf('\n', pos);
      const cands = [back + 1, fwd + 1].filter((x) => x > 0 && Math.abs(x - pos) <= 60);
      return cands.length ? cands.sort((x, y) => Math.abs(x - pos) - Math.abs(y - pos))[0] : pos;
    };
    const cuts = [0]; let off = 0;
    for (let k = 0; k < parts.length - 1; k++) { off += parts[k].length + 1; cuts.push(snap(mapPos(off))); }
    cuts.push(original.length);
    const out = parts.map((p, k) => original.slice(cuts[k], Math.max(cuts[k], cuts[k + 1])).trim());
    return out.some((x) => !x) ? parts.slice() : out;
  }

  return {
    uid, defaultCategories, DEFAULT_PROMPTS, SCHEMAS, children, subtreeIds, isTodoCat, catPath, assignableCats, todoSubs,
    makeBlocks, groupsFromStarts, blockWindows, parseJSON, fill, protectedTerms, buildSplitPrompt, buildSurveyPrompt,
    buildOrganizePrompt, bulkSplitPrompt, bulkOrganizePrompt, bulkSurveyPrompt, diff, changeRatio, countTerm, checkOrganize,
    checkSurvey, fmtDate, safeName, categoryMarkdown, allMarkdown, visibleTasks, validBackup, backupProblem, itemsIn, linkedTasks,
    editDistance, splitOriginal, taskSupport,
  };
})();
if (typeof window !== 'undefined') window.MDCore = MDCore;
if (typeof module !== 'undefined') module.exports = MDCore;
