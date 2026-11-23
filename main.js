import * as THREE from 'three';

const COLORS = { Contrarian: 0xc0392b, Purist: 0x27ae60, Scaler: 0x8e44ad, Operator: 0xe67e22, Hacker: 0x16a5b8, Bootstrapper: 0x7f8c3a, Impact: 0x2e86de, Distributor: 0xd6336c };
const PITCH = { Contrarian: 0.7, Purist: 1.3, Scaler: 1.0, Operator: 0.85, Hacker: 1.15, Bootstrapper: 0.9, Impact: 1.25, Distributor: 1.05 };
const STANCE_Y = { skeptical: -0.25, neutral: 0, warming: 0.15, sold: 0.35 };
const $ = (id) => document.getElementById(id);
let busy = false;

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
function addAgent(name) {
  const g = new THREE.Group();
  g.visible = false;
  const mat = new THREE.MeshStandardMaterial({ color: COLORS[name] });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 8, 16), mat); body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf1c9a5 })); head.position.y = 1.9;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 8), mat); arm.position.set(0.5, 1.2, 0.2); arm.rotation.z = 0.3;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; ring.visible = false;
  g.add(body, head, arm, ring); scene.add(g);
  const bub = document.createElement('div'); bub.className = 'bub'; document.body.appendChild(bub);
  avatars[name] = { g, body, head, arm, ring, bub, speaking: 0, targetY: 0, home: new THREE.Vector3(), homeRot: 0, target: new THREE.Vector3(), targetRot: 0, stance: 'neutral', t: Math.random() * 6 };
}

// Seat the chosen archetypes in an arc behind the table; everyone else is hidden.
function seat(list) {
  const n = list.length, gap = n >= 5 ? 1.9 : 2.1;
  for (const [name, a] of Object.entries(avatars)) {
    const i = list.indexOf(name); a.g.visible = i >= 0; a.bub.classList.remove('on'); a.speaking = 0;
    if (i < 0) continue;
    const off = i - (n - 1) / 2; a.home.set(off * gap, 0, -2.6 + Math.abs(off) * 0.5);
    a.g.position.copy(a.home); a.g.lookAt(0, 0, 3); a.homeRot = a.g.rotation.y; a.targetRot = a.homeRot; a.target.copy(a.home); a.stance = 'neutral'; a.targetY = 0;
  }
}
let names = []; let ROSTER = [], LIMITS = { min: 3, max: 5 }, DEFAULT = ['Contrarian', 'Purist', 'Scaler'];

function resize() { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.setViewOffset(innerWidth, innerHeight, 170, 0, innerWidth, innerHeight); cam.updateProjectionMatrix(); } // 170px shift: centre the room in the space left of the 340px log
addEventListener('resize', resize); resize(); renderer.setPixelRatio(devicePixelRatio);

const v = new THREE.Vector3();
(function loop(now = 0) {
  requestAnimationFrame(loop);
  for (const a of Object.values(avatars)) {
    if (!a.g.visible) continue;
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
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(path, body) { const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return r.json(); }

// ---- Sessions: S is the open boardroom session; everything is persisted server-side after each step ----
let S = null;
const blank = (id, agents) => ({ id, agents, title: 'New boardroom', created: Date.now(), updated: Date.now(), turn: 0, history: [], log: [], events: [], stances: {}, lastProposer: null, verdictHtml: null, funded: null, score: null });
const live = (s) => s === S; // false once the user navigated away mid-turn
async function save(s) { if (!s.log.length) return; s.updated = Date.now(); try { await api('session/save', { session: s }); } catch {} }
function renderLogEntry(e) { const d = document.createElement('div'); d.className = 'e ' + (e.cls || ''); d.innerHTML = e.html; $('log').appendChild(d); $('log').scrollTop = 1e9; }
function logEntry(s, html, cls = '') { const e = { html, cls }; s.log.push(e); if (live(s)) renderLogEntry(e); }
const setTurn = (s) => { if (live(s)) $('t').textContent = s.turn; };
const setStance = (s, agent, stance) => { s.stances[agent] = stance; if (live(s)) { const a = avatars[agent]; if (a) { a.stance = stance; a.targetY = STANCE_Y[stance] ?? 0; } } };
function resetAvatars() { for (const a of Object.values(avatars)) { a.stance = 'neutral'; a.targetY = 0; a.target.copy(a.home); a.targetRot = a.homeRot; a.bub.classList.remove('on'); a.speaking = 0; } speechSynthesis.cancel?.(); }

async function pitchIdea(s) {
  logEntry(s, '<b>You</b>idea');
  const { proposer, idea, debate, error } = await api('idea', { transcript: s.history.join('\n'), last: s.lastProposer, agents: s.agents });
  if (!idea) throw new Error(error || 'no idea returned');
  s.lastProposer = proposer; if (s.title === 'New boardroom') s.title = `Idea: ${idea.title}`;
  logEntry(s, `<b>${proposer} proposes: ${esc(idea.title)}</b>${esc(idea.pitch)}`, 'mem');
  s.history.push(`${proposer} pitched the idea "${idea.title}": ${idea.pitch}`);
  for (const r of debate) { logEntry(s, `<b>${r.agent} on ${proposer}'s idea → ${esc(r.stance)} (${r.score}/10 fundable, ${esc(r.topic)})</b>Why: ${esc(r.reason)}`); s.history.push(`${r.agent}: ${r.reply}`); setStance(s, r.agent, r.stance); }
  logEntry(s, '<b>Your turn</b>Defend, reshape, or pivot the idea. Type "idea" for a different one.');
  await save(s);
  if (!live(s)) return;
  const p = avatars[proposer]; p.target.set(0, 0, 3.4); p.targetRot = Math.PI; await sleep(1500); // walk out in front of the table, face the panel
  if (live(s)) await speak(proposer, idea.pitch);
  for (const r of debate) { if (!live(s)) return; await speak(r.agent, r.reply); }
  p.target.copy(p.home); p.targetRot = p.homeRot;
}

async function say() {
  const s = S; if (!s || s.verdictHtml) return;
  const text = $('in').value.trim(); if (!text) return;
  if (busy) { logEntry(s, '<b>Panel is still responding…</b>'); return; }
  busy = true; $('in').value = '';
  try {
    if (/^\/?idea\b/i.test(text)) { await pitchIdea(s); return; }
    s.turn++; setTurn(s); s.history.push('Founder: ' + text);
    if (s.title === 'New boardroom') s.title = text.length > 48 ? text.slice(0, 48) + '…' : text;
    logEntry(s, `<b>You</b>${esc(text)}`);
    const { results, error } = await api('turn', { session_id: s.id, turn: s.turn, transcript: s.history.join('\n'), founder: text, agents: s.agents });
    if (!results) { s.turn--; setTurn(s); s.history.pop(); throw new Error(error || 'server returned no results'); }
    for (const r of results) { // react simultaneously, then speak in turn
      setStance(s, r.agent, r.stance); s.events.push({ ...r, turn: s.turn, founder_quote: text });
      logEntry(s, `<b>${r.agent} → ${esc(r.stance)} (${r.score}/10, ${esc(r.topic)})</b>Why: ${esc(r.reason)}`);
    }
    for (const r of results) s.history.push(`${r.agent}: ${r.reply}`);
    await save(s);
    for (const r of results) { if (!live(s)) break; await speak(r.agent, r.reply); }
  } catch (e) { logEntry(s, `<b>Error</b>${esc(e.message || e)}`); await save(s); }
  finally { busy = false; if (live(s)) $('in').focus(); }
  if (live(s) && s.turn >= 6) verdict();
}

function showVerdict(s) { $('vbody').innerHTML = s.verdictHtml + '<p><button id="vhome">Back to sessions</button> <button id="vclose" class="alt">Close</button></p>'; $('verdict').style.display = 'flex';
  $('vhome').onclick = () => { $('verdict').style.display = 'none'; location.hash = '#/'; }; $('vclose').onclick = () => { $('verdict').style.display = 'none'; }; }
async function verdict() {
  const s = S; if (!s || s.verdictHtml) { if (s?.verdictHtml) showVerdict(s); return; }
  if (!s.events.length) { logEntry(s, '<b>No verdict yet</b>Say something to the panel first so there is evidence to judge.'); return; }
  if (busy) return; busy = true;
  try {
    const { memory } = await api('finish');
    const byAgent = {}; s.events.forEach(e => (byAgent[e.agent] ??= []).push(e));
    const avg = (xs) => xs.reduce((t, e) => t + e.score, 0) / xs.length;
    const total = avg(s.events); const funded = total >= 6.5;
    let h = `<h2>${funded ? 'FUNDED' : 'PASS'} — ${total.toFixed(1)}/10</h2>`;
    for (const [a, es] of Object.entries(byAgent)) {
      const best = es.reduce((x, y) => y.score > x.score ? y : x), worst = es.reduce((x, y) => y.score < x.score ? y : x);
      h += `<p><b>${a}</b>: avg ${avg(es).toFixed(1)}/10.<br>Best: “${esc(best.founder_quote)}” (${best.score}/10 — ${esc(best.reason)})<br>Worst: “${esc(worst.founder_quote)}” (${worst.score}/10 — ${esc(worst.reason)})</p>`;
    }
    if (memory?.length) h += `<h3>Bruin memory (all sessions)</h3>` + memory.map(m => `<p>${esc(m.topic)}: avg ${m.avg}/10 — “${esc(m.quote)}”</p>`).join('');
    s.verdictHtml = h; s.funded = funded; s.score = Number(total.toFixed(1)); await save(s);
    if (live(s)) { $('in').disabled = true; showVerdict(s); }
  } finally { busy = false; }
}

// ---- Home screen + routing ----
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
async function showHome() {
  S = null; seat(DEFAULT); resetAvatars(); $('verdict').style.display = 'none'; document.body.classList.remove('pick'); document.body.classList.add('home');
  const grid = $('grid'); grid.innerHTML = '';
  const nc = document.createElement('div'); nc.className = 'card new'; nc.textContent = '+ New boardroom'; nc.onclick = () => { location.hash = '#/new'; }; grid.appendChild(nc);
  let sessions = []; try { sessions = (await api('sessions')).sessions || []; } catch { grid.append('Could not reach the server.'); }
  for (const x of sessions) {
    const c = document.createElement('div'); c.className = 'card';
    const badge = x.finished ? `<span class="badge ${x.funded ? 'ok' : 'no'}">${x.funded ? 'FUNDED' : 'PASS'} ${x.score}/10</span>` : `<span class="badge">In progress · turn ${x.turn}/6</span>`;
    c.innerHTML = `<button class="del" title="Delete">×</button><div class="t">${esc(x.title)}</div><div class="m">Updated ${ago(x.updated)}</div>${badge}`;
    c.onclick = () => { location.hash = '#/s/' + x.id; };
    c.querySelector('.del').onclick = async (ev) => { ev.stopPropagation(); if (confirm(`Delete "${x.title}"? Its Bruin events stay in the analytics data.`)) { await api('session/delete', { id: x.id }); showHome(); } };
    grid.appendChild(c);
  }
}
async function openSession(id, agentsParam) {
  document.body.classList.remove('home', 'pick'); resetAvatars(); $('log').innerHTML = '<h3>Decision log</h3>'; $('verdict').style.display = 'none'; $('in').value = ''; $('in').disabled = false;
  let s = null; try { s = (await api('session/get', { id })).session; } catch {}
  const fresh = !s; if (fresh) s = blank(id, agentsParam || DEFAULT);
  if (!s.agents) s.agents = ['Contrarian', 'Purist', 'Scaler', 'Operator']; // sessions saved before the picker existed
  seat(s.agents); S = s; setTurn(s); s.log.forEach(renderLogEntry);
  for (const [agent, stance] of Object.entries(s.stances)) { const a = avatars[agent]; if (a) { a.stance = stance; a.targetY = STANCE_Y[stance] ?? 0; } }
  if (fresh) { try { (await api('start')).memory.forEach(m => logEntry(s, `<b>Memory (Bruin)</b>Past weak spot: ${esc(m.topic)} avg ${m.avg}/10 — “${esc(m.quote)}”. Panel will press here.`, 'mem')); } catch {} }
  if (s.verdictHtml) { $('in').disabled = true; showVerdict(s); } else $('in').focus();
}
function showPick() {
  S = null; seat(DEFAULT); document.body.classList.remove('home'); document.body.classList.add('pick'); $('verdict').style.display = 'none';
  const chosen = new Set(DEFAULT); const grid = $('pickgrid'); grid.innerHTML = '';
  const refresh = () => { const n = chosen.size; $('pickn').textContent = `${n} of ${LIMITS.max} selected (min ${LIMITS.min})`; $('pickgo').disabled = n < LIMITS.min; seat([...chosen]); };
  for (const kind of ['Investor', 'Founder']) {
    const h = document.createElement('h2'); h.textContent = kind + ' archetypes'; grid.appendChild(h);
    const g = document.createElement('div'); g.id = 'grid'; g.style.marginTop = '10px'; grid.appendChild(g);
    for (const r of ROSTER.filter(x => x.kind === kind)) {
      const c = document.createElement('div'); c.className = 'card' + (chosen.has(r.name) ? ' sel' : '');
      c.innerHTML = `<span class="chk"></span><div class="t"><span class="dot" style="background:#${COLORS[r.name].toString(16).padStart(6, '0')}"></span>${esc(r.title)}</div><div class="m">${esc(r.blurb)}</div>`;
      const mark = () => { c.classList.toggle('sel', chosen.has(r.name)); c.querySelector('.chk').textContent = chosen.has(r.name) ? '✓' : ''; };
      c.onclick = () => { if (chosen.has(r.name)) chosen.delete(r.name); else if (chosen.size < LIMITS.max) chosen.add(r.name); mark(); refresh(); };
      mark(); g.appendChild(c);
    }
  }
  refresh();
  $('pickback').onclick = () => { location.hash = '#/'; };
  $('pickgo').onclick = () => { if (chosen.size >= LIMITS.min) location.hash = `#/s/s${Date.now()}?a=${[...chosen].join(',')}`; };
}
function route() {
  document.body.classList.remove('pick');
  const m = location.hash.match(/^#\/s\/([\w-]+)(?:\?a=([\w,]+))?/);
  const picked = m?.[2] ? [...new Set(m[2].split(','))].filter(n => names.includes(n)).slice(0, LIMITS.max) : [];
  if (m) openSession(m[1], picked.length >= LIMITS.min ? picked : null); else if (location.hash === '#/new') showPick(); else showHome();
}

$('go').onclick = say; $('end').onclick = verdict; $('back').onclick = () => { location.hash = '#/'; };
$('in').addEventListener('keydown', (e) => { if (e.key === 'Enter') say(); });
addEventListener('hashchange', route);
try {
  const start = await api('start');
  if (!start.roster || !start.defaults) throw new Error('The API server is out of date. Stop it (Ctrl+C) and run `npm run dev` again.');
  names = start.agents; ROSTER = start.roster; LIMITS = { min: start.min, max: start.max }; DEFAULT = start.defaults.slice(0, 3); names.forEach(addAgent);
} catch (e) { document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;top:60px;left:16px;color:#f88">Startup error: ${esc(e.message || e)}</div>`); }
route();
