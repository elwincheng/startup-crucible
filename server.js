import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Google AI Studio (Gemini). Get a key at aistudio.google.com/apikey
const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

async function agentTurn(name, transcript, founder, mem) {
  const memLine = mem.length ? `Memory from past sessions (press on these): ${mem.map(m => `${m.topic} (avg ${m.avg}/10, e.g. "${m.quote}")`).join('; ')}.` : '';
  if (!client) { // offline fallback so the demo never dies
    const score = 3 + Math.floor(Math.random() * 6);
    return { agent: name, reply: `(${name}) Be more specific about that.`, topic: TOPICS[Math.floor(Math.random() * 6)], stance: score > 5 ? 'warming' : 'skeptical', score, reason: 'offline mock' };
  }
  const system = `You are ${name}, ${AGENTS[name]} You sit on a startup investor panel. Never claim to be a real person. ${memLine}
Reply ONLY with JSON: {"reply":"<=2 sentences, in character, challenge a specific claim","topic":"one of ${TOPICS.join('|')}","stance":"skeptical|neutral|warming|sold","score":0-10 rating of the founder's latest answer,"reason":"one sentence citing what the founder said"}`;
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: `Transcript so far:\n${transcript}\n\nFounder's latest: "${founder}"` }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
  };
  let j;
  for (let attempt = 0; attempt < 2 && !j; attempt++) { // one retry on bad JSON / transient error
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || r.status);
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '{}';
      j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) { console.error(`${name} attempt ${attempt + 1}:`, String(e)); }
  }
  if (!j) j = { reply: "I'm not convinced. Say more.", topic: 'vision', stance: 'neutral', score: 5, reason: 'model call failed' };
  return { agent: name, ...j, score: Number(j.score) };
}

const body = (req) => new Promise(res => { let d = ''; req.on('data', c => d += c); req.on('end', () => res(JSON.parse(d || '{}'))); });
const send = (res, o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/start') return send(res, { agents: Object.keys(AGENTS), memory: memory() });
    if (req.url === '/api/turn') {
      const { session_id, turn, transcript, founder } = await body(req);
      const mem = memory();
      const results = await Promise.all(Object.keys(AGENTS).map(a => agentTurn(a, transcript, founder, mem)));
      for (const r of results) log({ session_id, ts: new Date().toISOString().replace('T', ' ').slice(0, 19), turn, agent: r.agent, topic: r.topic, stance: r.stance, score: r.score, founder_quote: founder, reason: r.reason });
      return send(res, { results });
    }
    if (req.url === '/api/finish') { refreshBruin(); return send(res, { memory: memory() }); }
    send(res, { error: 'not found' }, 404);
  } catch (e) { send(res, { error: String(e) }, 500); }
}).listen(8787, () => console.log('api on :8787', client ? '(live)' : '(offline mock — set GEMINI_API_KEY)'));
