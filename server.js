import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Google AI Studio (Gemini). Get a key at aistudio.google.com/apikey
const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const client = KEY ? true : null;

export const AGENTS = {
  Contrarian: 'a monopoly-obsessed strategist. Demands a 10x secret, a defensible moat, and a path to a monopoly. Hates competition and incrementalism.',
  Purist: 'a user-pull purist. Cares only about real users, retention, and whether the founder has talked to customers. Hates hypotheticals.',
  Scaler: 'a bold, thesis-driven big-bet investor. Asks about market size, technical risk, and whether this changes the world. Pushes for ambition.',
  Operator: 'a pragmatic operator. Asks about unit economics, go-to-market, hiring, and what happens in the next 90 days.',
  Hacker: 'a technical founder who builds things. Hates hand-waving, asks what is technically hard, why now, and what the founder can ship this weekend.',
  Bootstrapper: 'a frugal, revenue-first founder who built a profitable company without VC. Distrusts fundraising, asks how soon the first dollar arrives and why this needs outside money at all.',
  Impact: 'an impact investor focused on societal problems. Asks who is helped and who might be harmed, whether the problem is real at scale, and how impact is measured.',
  Distributor: 'a growth and distribution expert. Believes distribution beats product. Asks how the first 1,000 customers are found, what the acquisition cost is, and whether there is a built-in loop.',
};
// UI metadata for the archetype picker.
export const META = {
  Contrarian: { title: 'The Monopolist Strategist', kind: 'Investor', blurb: 'Wants a 10x secret and a moat. Hates competition.' },
  Purist: { title: 'The User-Pull Purist', kind: 'Investor', blurb: 'Only cares about real users and retention.' },
  Scaler: { title: 'The Big-Bet Thesis Investor', kind: 'Investor', blurb: 'Pushes for ambition, market size and world-changing scale.' },
  Operator: { title: 'The Pragmatic Operator', kind: 'Investor', blurb: 'Unit economics, go-to-market, and the next 90 days.' },
  Impact: { title: 'The Impact Investor', kind: 'Investor', blurb: 'Who is helped, who is harmed, and how is it measured?' },
  Hacker: { title: 'The Technical Founder', kind: 'Founder', blurb: 'Hates hand-waving. What is technically hard? Why now?' },
  Bootstrapper: { title: 'The Bootstrapper', kind: 'Founder', blurb: 'Revenue first. Why does this even need outside money?' },
  Distributor: { title: 'The Growth Founder', kind: 'Founder', blurb: 'Distribution beats product. Where do customer #1 to #1000 come from?' },
};
const DEFAULT_PANEL = ['Contrarian', 'Purist', 'Scaler', 'Operator'];
const TOPICS = ['moat', 'users', 'market', 'economics', 'team', 'vision', 'technology', 'distribution', 'impact'];
const MIN_PANEL = 3, MAX_PANEL = 5;
function panelOf(agents) {
  const list = [...new Set(Array.isArray(agents) && agents.length ? agents : DEFAULT_PANEL)].filter(n => AGENTS[n]);
  if (list.length < MIN_PANEL || list.length > MAX_PANEL) throw new Error(`pick ${MIN_PANEL} to ${MAX_PANEL} archetypes`);
  return list;
}

// Bruin-produced cross-session memory (analytics.founder_weak_spots).
function memory() {
  try {
    const out = execFileSync('bruin', ['query', '--connection', 'duckdb-default', '--query',
      'SELECT topic, avg_score, worst_quote FROM analytics.founder_weak_spots ORDER BY avg_score LIMIT 3', '--output', 'json'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 8000 });
    const j = JSON.parse(out);
    return (j.rows || []).map(([topic, avg, quote]) => ({ topic, avg, quote }));
  } catch { return []; }
}

// --- Persona voices (Gemini TTS prebuilt voice per archetype). style is '' on purpose: the model reads any cue aloud. ---
const VOICES = {
  Contrarian: { voice: 'Algenib', style: '' },
  Purist: { voice: 'Sulafat', style: '' },
  Scaler: { voice: 'Fenrir', style: '' },
  Operator: { voice: 'Schedar', style: '' },
  Hacker: { voice: 'Puck', style: '' },
  Bootstrapper: { voice: 'Alnilam', style: '' },
  Impact: { voice: 'Vindemiatrix', style: '' },
  Distributor: { voice: 'Laomedeia', style: '' },
};
const ttsCache = new Map();
// Gemini TTS sometimes appends a stray burst of noise after the last word. Drop a short isolated burst that follows
// enough speech to have covered the whole line, trim the very end, and fade out so there is no pop.
function cleanPcm(pcm, rate, text) {
  const n = pcm.length >> 1; if (n < rate * 0.3) return pcm;
  const x = new Int16Array(n); for (let i = 0; i < n; i++) x[i] = pcm.readInt16LE(i * 2);
  const fr = Math.round(rate * 0.02), frames = Math.floor(n / fr), rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { let a = 0; for (let i = f * fr; i < (f + 1) * fr; i++) a += x[i] * x[i]; rms[f] = Math.sqrt(a / fr); }
  const thr = Math.max(...rms) * 0.06;
  let end = frames - 1; while (end > 0 && rms[end] < thr) end--;
  let bs = end, gap = 0; for (let i = end; i >= 0; i--) { if (rms[i] >= thr) { bs = i; gap = 0; } else if (++gap >= 6) break; } // 6 frames = 120ms of silence ends a burst
  let keep = end + 1;
  if (bs > 0 && end - bs + 1 <= 25) { // final burst <= 500ms, preceded by a pause
    let e2 = bs - 1; while (e2 > 0 && rms[e2] < thr) e2--;
    const spokenSec = (e2 + 1) * 0.02, words = text.trim().split(/\s+/).length;
    if (spokenSec >= (words / 3.5) * 0.9) keep = e2 + 1; // earlier audio already covers the text: the burst is extra
  }
  const len = Math.min(n, (keep + 2) * fr), fade = Math.min(len, Math.round(rate * 0.08));
  for (let i = len - fade; i < len; i++) x[i] = Math.round(x[i] * (len - i) / fade);
  const out = Buffer.alloc(len * 2); for (let i = 0; i < len; i++) out.writeInt16LE(x[i], i * 2); return out;
}
function pcmToWav(pcm, rate = 24000) { // Gemini returns raw 16-bit mono PCM
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function tts(agent, text) {
  const key = `${agent}|${text}`; if (ttsCache.has(key)) return { ok: true, wav: ttsCache.get(key) };
  if (!KEY || !TTS_MODELS.length) return { ok: false, error: 'no tts model available' };
  const v = VOICES[agent];
  const payload = { contents: [{ parts: [{ text: v.style ? `Say ${v.style}: ${text}` : text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.voice } } } } };
  let lastErr = '';
  for (const model of TTS_MODELS.slice(0, 2)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || r.status);
      const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData); if (!part) throw new Error('no audio in response');
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
      const wav = pcmToWav(cleanPcm(Buffer.from(part.inlineData.data, 'base64'), rate, text), rate); ttsCache.set(key, wav); return { ok: true, wav };
    } catch (e) { lastErr = `${model}: ${String(e.message || e).slice(0, 140)}`; console.error('tts failed -', lastErr); }
  }
  return { ok: false, error: lastErr };
}

// --- Saved boardroom sessions: one JSON file per session in data/sessions/ ---
const SDIR = 'data/sessions';
fs.mkdirSync(SDIR, { recursive: true });
const sid = (id) => { if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('bad session id'); return `${SDIR}/${id}.json`; };
const readSession = (id) => { try { return JSON.parse(fs.readFileSync(sid(id), 'utf8')); } catch { return null; } };
const summary = (x) => ({ id: x.id, title: x.title, created: x.created, updated: x.updated, turn: x.turn, finished: !!x.verdictHtml, funded: x.funded, score: x.score });

const log = (e) => fs.appendFileSync('data/events.jsonl', JSON.stringify(e) + '\n');
const refreshBruin = () => { try { execFileSync('bruin', ['run', 'my-pipeline'], { timeout: 20000 }); } catch {} };

// Model chain: primary first, then flash-class models this key can actually call (discovered at startup via ListModels).
let MODELS = [MODEL];
let TTS_MODELS = [];
async function discoverModels() {
  if (!KEY) return;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(10000) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || r.status);
    const ok = (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace('models/', ''))
      .filter(n => /^gemini-.*flash/.test(n) && !/(image|tts|live|audio|robotics|computer|embedding)/.test(n));
    ok.sort((x, y) => (/lite/.test(x) - /lite/.test(y)) || y.localeCompare(x)); // full flash before lite, newest name first
    TTS_MODELS = (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace('models/', ''))
      .filter(n => /tts/.test(n)).sort((x, y) => (/pro/.test(x) - /pro/.test(y)) || y.localeCompare(x)); // flash TTS first: faster and cheaper
    if (process.env.GEMINI_TTS_MODEL) TTS_MODELS = [process.env.GEMINI_TTS_MODEL, ...TTS_MODELS];
    console.log('tts models:', TTS_MODELS.join(', ') || '(none found: browser voices will be used)');
    const extra = process.env.GEMINI_FALLBACKS ? process.env.GEMINI_FALLBACKS.split(',') : ok;
    MODELS = [MODEL, ...extra].filter((m, i, a) => m && a.indexOf(m) === i).slice(0, 5);
    if (!ok.includes(MODEL)) console.warn(`warning: ${MODEL} not in your key's model list; available: ${ok.join(', ')}`);
    console.log('model chain:', MODELS.join(' -> '));
  } catch (e) { console.warn('could not list models:', String(e.message || e).slice(0, 120)); }
}
discoverModels();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Shared Gemini caller: walks the model chain with backoff. `parse` turns the raw text into a validated value or throws.
async function gemini(system, user, parse, maxOutputTokens = 2048) {
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens },
  };
  let lastErr = '';
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000),
        });
        const data = await r.json();
        if (!r.ok) { const e = new Error(data.error?.message || r.status); e.status = r.status; throw e; }
        const value = parse(data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '');
        if (model !== MODELS[0]) console.log(`served by fallback model ${model}`);
        return { ok: true, value };
      } catch (e) {
        lastErr = `${model}: ${String(e.message || e).slice(0, 140)}`; console.error('call failed -', lastErr);
        if ([400, 403, 404, 429].includes(e.status)) break; // wrong model, bad key, or out of quota: next model, no retry
        await sleep(800 * (attempt + 1)); // overloaded (503) or bad JSON: back off, retry once
      }
    }
  }
  return { ok: false, error: lastErr };
}
const memText = (mem) => mem.length ? `Memory from past sessions (press on these): ${mem.map(m => `${m.topic} (avg ${m.avg}/10, e.g. "${m.quote}")`).join('; ')}.` : '';
const roster = (list) => list.map(n => `- ${n}: ${AGENTS[n]}`).join('\n');
const cut = (t, open, close) => JSON.parse(t.slice(t.indexOf(open), t.lastIndexOf(close) + 1));

// One call per turn returns all four reactions to the founder.
async function panelTurn(list, transcript, founder, mem) {
  if (!client) return { ok: true, results: list.map(agent => { const score = 3 + Math.floor(Math.random() * 6);
    return { agent, reply: `(${agent}) Be more specific about that.`, topic: TOPICS[Math.floor(Math.random() * TOPICS.length)], stance: score > 5 ? 'warming' : 'skeptical', score, reason: 'offline mock' }; }) };
  const system = `You play a startup investor panel of ${list.length} distinct characters. Never claim to be a real person.
${roster(list)}
${memText(mem)}
Each character reacts to the founder's latest message in their own voice, and may reference what another panelist said. Reply ONLY with a JSON array of ${list.length} objects, one per character in this order: ${list.join(', ')}.
Each object: {"agent":"<name>","reply":"<=2 sentences, in character, challenge a specific claim","topic":"one of ${TOPICS.join('|')}","stance":"skeptical|neutral|warming|sold","score":<0-10 rating of the founder's latest answer>,"reason":"one sentence citing what the founder said"}`;
  const out = await gemini(system, `Transcript so far:\n${transcript}\n\nFounder's latest: "${founder}"`, (t) => {
    const arr = cut(t, '[', ']');
    const results = list.map(agent => arr.find(x => x.agent === agent)).filter(Boolean).map(x => ({ ...x, score: Number(x.score) }));
    if (results.length !== list.length) throw new Error('incomplete panel response');
    return results;
  });
  return out.ok ? { ok: true, results: out.value } : out;
}

// "idea": one panelist pitches an idea / societal problem fitting their persona; the other three debate it.
async function ideaTurn(list, transcript, mem, proposer) {
  const others = list.filter(n => n !== proposer);
  if (!client) return { ok: true, proposer, idea: { title: 'Offline idea', pitch: `(${proposer}) An idea would go here.` },
    debate: others.map(agent => ({ agent, reply: `(${agent}) I disagree.`, topic: 'vision', stance: 'neutral', score: 5, reason: 'offline mock' })) };
  const system = `You play a startup investor panel. Never claim to be a real person.
${roster(list)}
${memText(mem)}
${proposer} must pitch ONE startup idea or societal problem worth solving that reflects their worldview (not generic). Then ${others.join(', ')} debate it IN THAT ORDER, each reacting to ${proposer} and to the panelist who spoke just before, disagreeing where their persona would. Don't repeat ideas already in the transcript.
Reply ONLY with JSON: {"title":"<=6 words","pitch":"2 sentences, spoken by ${proposer} in first person","debate":[{"agent":"<name>","reply":"<=2 sentences, in character","topic":"one of ${TOPICS.join('|')}","stance":"skeptical|neutral|warming|sold","score":<0-10 how fundable this idea is>,"reason":"one sentence on why, citing the pitch"}]}
The debate array must have exactly ${others.length} entries in order: ${others.join(', ')}.`;
  const out = await gemini(system, `Transcript so far:\n${transcript || '(empty)'}`, (t) => {
    const j = cut(t, '{', '}');
    const debate = others.map(agent => (j.debate || []).find(x => x.agent === agent)).filter(Boolean).map(x => ({ ...x, score: Number(x.score) }));
    if (!j.title || !j.pitch || debate.length !== others.length) throw new Error('incomplete idea response');
    return { proposer, idea: { title: j.title, pitch: j.pitch }, debate };
  }, 3072);
  return out.ok ? { ok: true, ...out.value } : out;
}

const body = (req) => new Promise(res => { let d = ''; req.on('data', c => d += c); req.on('end', () => res(JSON.parse(d || '{}'))); });
const send = (res, o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/start') return send(res, { agents: Object.keys(AGENTS), roster: Object.entries(META).map(([name, m]) => ({ name, ...m })), min: MIN_PANEL, max: MAX_PANEL, defaults: DEFAULT_PANEL, memory: memory() });
    if (req.url === '/api/turn') {
      const { session_id, turn, transcript, founder, agents } = await body(req);
      const list = panelOf(agents);
      const mem = memory();
      const out = await panelTurn(list, transcript, founder, mem);
      if (!out.ok) return send(res, { error: `The panel could not respond (${out.error}). Try again in a moment.` }, 503);
      const { results } = out; // only real model output reaches the Bruin event log
      for (const r of results) log({ session_id, ts: new Date().toISOString().replace('T', ' ').slice(0, 19), turn, agent: r.agent, topic: r.topic, stance: r.stance, score: r.score, founder_quote: founder, reason: r.reason });
      return send(res, { results });
    }
    if (req.url === '/api/tts') {
      const { agent, text } = await body(req);
      if (!VOICES[agent] || typeof text !== 'string' || !text || text.length > 600) return send(res, { error: 'bad tts request' }, 400);
      const out = await tts(agent, text);
      if (!out.ok) return send(res, { error: out.error }, 503);
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': out.wav.length }); return res.end(out.wav);
    }
    if (req.url === '/api/sessions') {
      const list = fs.readdirSync(SDIR).filter(f => f.endsWith('.json')).map(f => { try { return summary(JSON.parse(fs.readFileSync(`${SDIR}/${f}`, 'utf8'))); } catch { return null; } }).filter(Boolean);
      return send(res, { sessions: list.sort((a, b) => b.updated - a.updated) });
    }
    if (req.url === '/api/session/get') { const { id } = await body(req); const x = readSession(id); return x ? send(res, { session: x }) : send(res, { error: 'not found' }, 404); }
    if (req.url === '/api/session/save') { const { session } = await body(req); fs.writeFileSync(sid(session.id), JSON.stringify(session)); return send(res, { ok: true }); }
    if (req.url === '/api/session/delete') { const { id } = await body(req); try { fs.unlinkSync(sid(id)); } catch {} return send(res, { ok: true }); }
    if (req.url === '/api/idea') {
      const { transcript, last, agents } = await body(req);
      const list = panelOf(agents);
      const pool = list.filter(n => n !== last); // don't let the same panelist pitch twice in a row
      const out = await ideaTurn(list, transcript, memory(), pool[Math.floor(Math.random() * pool.length)]);
      if (!out.ok) return send(res, { error: `The panel could not come up with an idea (${out.error}). Try again in a moment.` }, 503);
      return send(res, out); // idea debate is the panel's, not the founder's: it is not written to the Bruin event log
    }
    if (req.url === '/api/finish') { refreshBruin(); return send(res, { memory: memory() }); }
    send(res, { error: 'not found' }, 404);
  } catch (e) { send(res, { error: String(e) }, 500); }
}).listen(process.env.PORT || 8787, () => console.log('api on :' + (process.env.PORT || 8787), client ? '(live)' : '(offline mock — set GEMINI_API_KEY)'));
