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
};
const TOPICS = ['moat', 'users', 'market', 'economics', 'team', 'vision'];

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

const log = (e) => fs.appendFileSync('data/events.jsonl', JSON.stringify(e) + '\n');
const refreshBruin = () => { try { execFileSync('bruin', ['run', 'my-pipeline'], { timeout: 20000 }); } catch {} };

// Model chain: primary first, then flash-class models this key can actually call (discovered at startup via ListModels).
let MODELS = [MODEL];
async function discoverModels() {
  if (!KEY) return;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(10000) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || r.status);
    const ok = (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace('models/', ''))
      .filter(n => /^gemini-.*flash/.test(n) && !/(image|tts|live|audio|robotics|computer|embedding)/.test(n));
    ok.sort((x, y) => (/lite/.test(x) - /lite/.test(y)) || y.localeCompare(x)); // full flash before lite, newest name first
    const extra = process.env.GEMINI_FALLBACKS ? process.env.GEMINI_FALLBACKS.split(',') : ok;
    MODELS = [MODEL, ...extra].filter((m, i, a) => m && a.indexOf(m) === i).slice(0, 5);
    if (!ok.includes(MODEL)) console.warn(`warning: ${MODEL} not in your key's model list; available: ${ok.join(', ')}`);
    console.log('model chain:', MODELS.join(' -> '));
  } catch (e) { console.warn('could not list models:', String(e.message || e).slice(0, 120)); }
}
discoverModels();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const names = Object.keys(AGENTS);

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
const roster = () => names.map(n => `- ${n}: ${AGENTS[n]}`).join('\n');
const cut = (t, open, close) => JSON.parse(t.slice(t.indexOf(open), t.lastIndexOf(close) + 1));

// One call per turn returns all four reactions to the founder.
async function panelTurn(transcript, founder, mem) {
  if (!client) return { ok: true, results: names.map(agent => { const score = 3 + Math.floor(Math.random() * 6);
    return { agent, reply: `(${agent}) Be more specific about that.`, topic: TOPICS[Math.floor(Math.random() * 6)], stance: score > 5 ? 'warming' : 'skeptical', score, reason: 'offline mock' }; }) };
  const system = `You play a startup investor panel of ${names.length} distinct characters. Never claim to be a real person.
${roster()}
${memText(mem)}
Each character reacts to the founder's latest message in their own voice, and may reference what another panelist said. Reply ONLY with a JSON array of ${names.length} objects, one per character in this order: ${names.join(', ')}.
Each object: {"agent":"<name>","reply":"<=2 sentences, in character, challenge a specific claim","topic":"one of ${TOPICS.join('|')}","stance":"skeptical|neutral|warming|sold","score":<0-10 rating of the founder's latest answer>,"reason":"one sentence citing what the founder said"}`;
  const out = await gemini(system, `Transcript so far:\n${transcript}\n\nFounder's latest: "${founder}"`, (t) => {
    const arr = cut(t, '[', ']');
    const results = names.map(agent => arr.find(x => x.agent === agent)).filter(Boolean).map(x => ({ ...x, score: Number(x.score) }));
    if (results.length !== names.length) throw new Error('incomplete panel response');
    return results;
  });
  return out.ok ? { ok: true, results: out.value } : out;
}

// "idea": one panelist pitches an idea / societal problem fitting their persona; the other three debate it.
async function ideaTurn(transcript, mem, proposer) {
  const others = names.filter(n => n !== proposer);
  if (!client) return { ok: true, proposer, idea: { title: 'Offline idea', pitch: `(${proposer}) An idea would go here.` },
    debate: others.map(agent => ({ agent, reply: `(${agent}) I disagree.`, topic: 'vision', stance: 'neutral', score: 5, reason: 'offline mock' })) };
  const system = `You play a startup investor panel. Never claim to be a real person.
${roster()}
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
    if (req.url === '/api/start') return send(res, { agents: Object.keys(AGENTS), memory: memory() });
    if (req.url === '/api/turn') {
      const { session_id, turn, transcript, founder } = await body(req);
      const mem = memory();
      const out = await panelTurn(transcript, founder, mem);
      if (!out.ok) return send(res, { error: `The panel could not respond (${out.error}). Try again in a moment.` }, 503);
      const { results } = out; // only real model output reaches the Bruin event log
      for (const r of results) log({ session_id, ts: new Date().toISOString().replace('T', ' ').slice(0, 19), turn, agent: r.agent, topic: r.topic, stance: r.stance, score: r.score, founder_quote: founder, reason: r.reason });
      return send(res, { results });
    }
    if (req.url === '/api/idea') {
      const { transcript, last } = await body(req);
      const pool = names.filter(n => n !== last); // don't let the same panelist pitch twice in a row
      const out = await ideaTurn(transcript, memory(), pool[Math.floor(Math.random() * pool.length)]);
      if (!out.ok) return send(res, { error: `The panel could not come up with an idea (${out.error}). Try again in a moment.` }, 503);
      return send(res, out); // idea debate is the panel's, not the founder's: it is not written to the Bruin event log
    }
    if (req.url === '/api/finish') { refreshBruin(); return send(res, { memory: memory() }); }
    send(res, { error: 'not found' }, 404);
  } catch (e) { send(res, { error: String(e) }, 500); }
}).listen(8787, () => console.log('api on :8787', client ? '(live)' : '(offline mock — set GEMINI_API_KEY)'));
