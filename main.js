import * as THREE from 'three';

const COLORS = { Contrarian: 0xc0392b, Purist: 0x27ae60, Scaler: 0x8e44ad, Operator: 0xe67e22 };
const PITCH = { Contrarian: 0.7, Purist: 1.3, Scaler: 1.0, Operator: 0.85 };
const STANCE_Y = { skeptical: -0.25, neutral: 0, warming: 0.15, sold: 0.35 };
const session_id = 's' + Date.now();
const $ = (id) => document.getElementById(id);
const history = []; const events = []; let turn = 0, busy = false;

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0d12);
const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.set(0, 4.2, 7.5); cam.lookAt(0, 1, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 8, 5); scene.add(sun);
const table = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.15, 48), new THREE.MeshStandardMaterial({ color: 0x4a3626 }));
table.position.y = 0.8; scene.add(table);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x151922 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);

const avatars = {};
function addAgent(name, i, n) {
  const g = new THREE.Group();
  g.position.set((i - (n - 1) / 2) * 2.1, 0, -2.6 + Math.abs(i - (n - 1) / 2) * 0.5);
  const mat = new THREE.MeshStandardMaterial({ color: COLORS[name] });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 8, 16), mat); body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf1c9a5 })); head.position.y = 1.9;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 8), mat); arm.position.set(0.5, 1.2, 0.2); arm.rotation.z = 0.3;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; ring.visible = false;
  g.add(body, head, arm, ring); g.lookAt(0, 0, 3); scene.add(g);
  const bub = document.createElement('div'); bub.className = 'bub'; document.body.appendChild(bub);
  avatars[name] = { g, body, head, arm, ring, bub, speaking: 0, targetY: 0, home: g.position.clone(), homeRot: g.rotation.y, target: g.position.clone(), targetRot: g.rotation.y, stance: 'neutral', t: Math.random() * 6 };
}
let names = [];

function resize() { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize(); renderer.setPixelRatio(devicePixelRatio);

const v = new THREE.Vector3();
(function loop(now = 0) {
  requestAnimationFrame(loop);
  for (const a of Object.values(avatars)) {
    a.t += 0.02;
    const bob = a.speaking > 0 ? Math.sin(a.t * 12) * 0.05 : Math.sin(a.t) * 0.01;
    a.g.position.x += (a.target.x - a.g.position.x) * 0.05; a.g.position.z += (a.target.z - a.g.position.z) * 0.05; // walk to/from the pitch spot
    a.g.rotation.y += (a.targetRot - a.g.rotation.y) * 0.06;
    a.g.position.y += (a.targetY - a.g.position.y) * 0.08; // stance: sink when skeptical, rise when sold
    a.head.position.y = 1.9 + bob; a.arm.rotation.z = a.speaking > 0 ? 0.3 + Math.sin(a.t * 10) * 0.8 : 0.3;
    a.head.rotation.z = a.stance === 'skeptical' ? 0.3 : 0; a.ring.visible = a.speaking > 0; a.speaking = Math.max(0, a.speaking - 0.016);
    v.copy(a.g.position); v.y += 2.5; v.project(cam);
    a.bub.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px'; a.bub.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px';
  }
  renderer.render(scene, cam);
})();

const voices = () => speechSynthesis.getVoices().filter(x => x.lang.startsWith('en'));
function speak(name, text) {
  return new Promise(res => {
    const a = avatars[name]; a.bub.textContent = text; a.bub.classList.add('on'); a.speaking = Math.max(2.5, text.length / 15);
    let done = false; const finish = () => { if (done) return; done = true; a.bub.classList.remove('on'); res(); };
    setTimeout(finish, Math.max(3000, text.length * 90)); // Chrome sometimes never fires onend
    try {
      const u = new SpeechSynthesisUtterance(text); const vs = voices(); if (vs.length) u.voice = vs[names.indexOf(name) % vs.length];
      u.pitch = PITCH[name]; u.rate = 1.1; u.onend = finish; u.onerror = finish; speechSynthesis.speak(u);
    } catch { /* silent fallback: bubble timeout above */ }
  });
}
function logEntry(html, cls = '') { const d = document.createElement('div'); d.className = 'e ' + cls; d.innerHTML = html; $('log').appendChild(d); $('log').scrollTop = 1e9; }
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function api(path, body) { const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return r.json(); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let lastProposer = null;
async function pitchIdea() {
  logEntry('<b>You</b>idea');
  const { proposer, idea, debate, error } = await api('idea', { transcript: history.join('\n'), last: lastProposer });
  if (!idea) throw new Error(error || 'no idea returned');
  lastProposer = proposer; const p = avatars[proposer];
  logEntry(`<b>${proposer} proposes: ${esc(idea.title)}</b>${esc(idea.pitch)}`, 'mem');
  history.push(`${proposer} pitched the idea "${idea.title}": ${idea.pitch}`);
  p.target.set(0, 0, 3.4); p.targetRot = Math.PI; await sleep(1500); // walk out in front of the table, face the panel
  await speak(proposer, idea.pitch);
  for (const r of debate) {
    const a = avatars[r.agent]; a.stance = r.stance; a.targetY = STANCE_Y[r.stance] ?? 0;
    logEntry(`<b>${r.agent} on ${proposer}'s idea → ${esc(r.stance)} (${r.score}/10 fundable, ${esc(r.topic)})</b>Why: ${esc(r.reason)}`);
    history.push(`${r.agent}: ${r.reply}`); await speak(r.agent, r.reply);
  }
  p.target.copy(p.home); p.targetRot = p.homeRot;
  logEntry('<b>Your turn</b>Defend, reshape, or pivot the idea. Type "idea" for a different one.');
}

async function say() {
  const text = $('in').value.trim(); if (!text) return;
  if (busy) { logEntry('<b>Panel is still responding…</b>'); return; }
  busy = true; $('in').value = '';
  if (/^\/?idea\b/i.test(text)) { try { await pitchIdea(); } catch (e) { logEntry(`<b>Error</b>${esc(e.message || e)}`); } finally { busy = false; $('in').focus(); } return; }
  try {
    turn++; $('t').textContent = turn; history.push('Founder: ' + text);
    logEntry(`<b>You</b>${esc(text)}`);
    const { results, error } = await api('turn', { session_id, turn, transcript: history.join('\n'), founder: text });
    if (!results) { turn--; $('t').textContent = turn; history.pop(); throw new Error(error || 'server returned no results'); }
    for (const r of results) { // react simultaneously, then speak in turn
      const a = avatars[r.agent]; if (a) { a.stance = r.stance; a.targetY = STANCE_Y[r.stance] ?? 0; }
      events.push({ ...r, turn, founder_quote: text });
      logEntry(`<b>${r.agent} → ${esc(r.stance)} (${r.score}/10, ${esc(r.topic)})</b>Why: ${esc(r.reason)}`);
    }
    for (const r of results) { history.push(`${r.agent}: ${r.reply}`); await speak(r.agent, r.reply); }
  } catch (e) { logEntry(`<b>Error</b>${esc(e.message || e)}`); }
  finally { busy = false; $('in').focus(); }
  if (turn >= 6) verdict();
}

async function verdict() {
  busy = true; const { memory } = await api('finish');
  const byAgent = {}; events.forEach(e => (byAgent[e.agent] ??= []).push(e));
  const avg = (xs) => xs.reduce((s, e) => s + e.score, 0) / xs.length;
  const total = avg(events); const funded = total >= 6.5;
  let h = `<h2>${funded ? 'FUNDED' : 'PASS'} — ${total.toFixed(1)}/10</h2>`;
  for (const [a, es] of Object.entries(byAgent)) {
    const best = es.reduce((x, y) => y.score > x.score ? y : x), worst = es.reduce((x, y) => y.score < x.score ? y : x);
    h += `<p><b>${a}</b>: avg ${avg(es).toFixed(1)}/10.<br>Best: “${esc(best.founder_quote)}” (${best.score}/10 — ${esc(best.reason)})<br>Worst: “${esc(worst.founder_quote)}” (${worst.score}/10 — ${esc(worst.reason)})</p>`;
  }
  if (memory?.length) h += `<h3>Bruin memory (all sessions)</h3>` + memory.map(m => `<p>${esc(m.topic)}: avg ${m.avg}/10 — “${esc(m.quote)}”</p>`).join('');
  $('vbody').innerHTML = h + '<button onclick="location.reload()">New session</button>'; $('verdict').style.display = 'flex';
}

$('go').onclick = say; $('end').onclick = verdict; $('in').addEventListener('keydown', (e) => { if (e.key === 'Enter') say(); });
$('in').focus();
try {
  const start = await api('start');
  names = start.agents; names.forEach((n, i) => addAgent(n, i, names.length));
  start.memory.forEach(m => logEntry(`<b>Memory (Bruin)</b>Past weak spot: ${esc(m.topic)} avg ${m.avg}/10 — “${esc(m.quote)}”. Panel will press here.`, 'mem'));
} catch (e) { logEntry(`<b>Startup error</b>${esc(e.message || e)}`); }
