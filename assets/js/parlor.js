/* Parlor core: shared roster, teams, scoring, dealing, timers, sound and screens.
   Every game page loads this file first. Everything lives on window.GN. */
(function(){
"use strict";
const GN = window.GN = {};
const PREFIX = "parlor.";

/* ---------- storage (never throws) ---------- */
GN.get = (k, d) => { try { const v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
GN.set = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch(e){} };
/* Bump when game defaults change: clears saved per-game settings (not players or standings). */
const CFG_VERSION = 2;
try { if (GN.get("cfgver") !== CFG_VERSION) { Object.keys(localStorage).filter(k => k.startsWith(PREFIX) && k.endsWith(".cfg")).forEach(k => localStorage.removeItem(k)); GN.set("cfgver", CFG_VERSION); } } catch(e){}

/* ---------- tiny DOM helpers ---------- */
/* While a full-screen stage is open, lookups resolve inside it first, so ids reused
   between the setup page and a stage (e.g. "#go") always hit the visible one. */
const openStage = () => { const st = document.getElementById("gn-stage"); return st && !st.hidden ? st : null; };
GN.$ = (s, r) => r ? r.querySelector(s) : ((openStage() && openStage().querySelector(s)) || document.querySelector(s));
GN.$$ = (s, r) => [...(r || openStage() || document).querySelectorAll(s)];
GN.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
GN.shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
GN.pick = a => a[Math.random() * a.length | 0];
GN.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
GN.norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/* Seeded PRNG so several phones can show the same round from a short code */
GN.rng = seed => { let h = 1779033703 ^ String(seed).length; for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; };
GN.seededShuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = r() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- dealing without repeats ----------
   Remembers which items were used (per key) across sessions on this device,
   so a deck doesn't repeat until it has been played through. */
GN.deal = (key, items, n, idOf = x => typeof x === "string" ? x : JSON.stringify(x).slice(0, 80)) => {
  const used = new Set(GN.get("used." + key, []));
  let fresh = items.filter(x => !used.has(idOf(x)));
  if (fresh.length < n) { used.clear(); fresh = items.slice(); }
  const out = GN.shuffle(fresh).slice(0, n);
  out.forEach(x => used.add(idOf(x)));
  GN.set("used." + key, [...used].slice(-4000));
  return out;
};
/* A lazy dealer: draws one at a time, marks used only when drawn */
GN.dealer = (key, items, idOf) => {
  idOf = idOf || (x => typeof x === "string" ? x : (x.id || x.w || x.e || x.q || x.a || x.cat || JSON.stringify(x)).toString().slice(0, 80));
  let pool = null;
  const refill = () => { const used = new Set(GN.get("used." + key, [])); let fresh = items.filter(x => !used.has(idOf(x)));
    if (fresh.length < Math.min(10, items.length)) { GN.set("used." + key, []); fresh = items.slice(); } pool = GN.shuffle(fresh); };
  return { next(){ if (!pool || !pool.length) refill(); const x = pool.pop(); const u = GN.get("used." + key, []); u.push(idOf(x)); GN.set("used." + key, u.slice(-4000)); return x; },
           left(){ return pool ? pool.length : items.length; } };
};

/* ---------- roster & sides ---------- */
const COLORS = ["var(--s0)","var(--s1)","var(--s2)","var(--s3)","var(--s4)","var(--s5)","var(--s6)","var(--s7)"];
GN.color = i => COLORS[i % COLORS.length];
const DEFAULT_ROSTER = { players:["Player 1","Player 2","Player 3","Player 4","Player 5","Player 6"], mode:"pairs", order:null, teamNames:{} };
GN.roster = () => { const r = Object.assign({}, DEFAULT_ROSTER, GN.get("roster", {}));
  r.players = (r.players || []).map(s => String(s).trim()).filter(Boolean);
  if (!r.order || r.order.length !== r.players.length || r.order.some(i => i >= r.players.length)) r.order = r.players.map((_, i) => i);
  return r; };
GN.saveRoster = r => { GN.set("roster", r); GN.emit("roster"); };
GN.hasRoster = () => GN.get("roster", null) != null;

/* Sides are what scores attach to: individual players, or teams of two (a trio if the count is odd). */
GN.sides = (forceSolo = false) => {
  const r = GN.roster();
  if (r.mode !== "pairs" || forceSolo || r.players.length < 4) {
    return r.players.map((n, i) => ({ id:"p:" + n, name:n, members:[n], color:GN.color(i), i }));
  }
  const ord = r.order.map(i => r.players[i]); const teams = [];
  for (let i = 0; i < ord.length; i += 2) teams.push(ord.slice(i, i + 2));
  if (teams.length > 1 && teams[teams.length - 1].length === 1) teams[teams.length - 2].push(teams.pop()[0]);
  return teams.map((m, i) => { const key = m.slice().sort().join("|"); const name = r.teamNames[key] || m.join(" & ");
    return { id:"t:" + key, name, members:m, color:GN.color(i), i, key }; });
};
GN.isPairs = () => { const r = GN.roster(); return r.mode === "pairs" && r.players.length >= 4; };
GN.sideOfPlayer = (sides, player) => sides.find(s => s.members.includes(player));

/* ---------- simple event bus ---------- */
const subs = {};
GN.on = (ev, fn) => (subs[ev] = subs[ev] || []).push(fn);
GN.emit = (ev, data) => (subs[ev] || []).forEach(fn => fn(data));

/* ---------- game-night standings ----------
   Each finished game is recorded. Night points come from placement so a 40-point
   Forehead round and a 6-point Spectrum game count the same: 1st 5, 2nd 3, 3rd 2, 4th 1. */
const PLACE_PTS = [5, 3, 2, 1];
GN.placements = scored => { // scored: [{name, pts, id}] -> adds rank (ties share)
  const s = scored.slice().sort((a, b) => b.pts - a.pts); let rank = 0;
  s.forEach((x, i) => { if (i === 0 || x.pts !== s[i - 1].pts) rank = i; x.rank = rank; x.night = PLACE_PTS[rank] || 0; });
  return s;
};
GN.record = (gameId, gameName, scored) => {
  const placed = GN.placements(scored.map(x => ({ id:x.id, name:x.name, members:x.members || [x.name], pts:x.pts })));
  const hist = GN.get("night", []);
  hist.push({ game:gameId, name:gameName, at:Date.now(), results:placed.map(p => ({ name:p.name, members:p.members, pts:p.pts, rank:p.rank, night:p.night })) });
  GN.set("night", hist.slice(-80));
  return placed;
};
GN.night = () => {
  const hist = GN.get("night", []); const tot = {};
  hist.forEach(g => g.results.forEach(r => { // credit night points to each member, so standings survive team shuffles
    r.members.forEach(m => { const t = tot[m] = tot[m] || { name:m, night:0, wins:0, games:0 };
      t.night += r.night; t.games++; if (r.rank === 0) t.wins++; });
  }));
  return { games:hist, players:Object.values(tot).sort((a, b) => b.night - a.night || b.wins - a.wins) };
};
GN.resetNight = () => GN.set("night", []);

/* ---------- sound ---------- */
let ac = null;
GN.soundOn = () => GN.get("sound", true);
GN.audio = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); } catch(e){} return ac; };
GN.tone = (f, d = .12, type = "sine", vol = .14, delay = 0) => {
  if (!GN.soundOn()) return; const a = GN.audio(); if (!a) return;
  try { const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .02); } catch(e){}
};
GN.sfx = {
  tap:  () => GN.tone(600, .05, "triangle", .07),
  tick: () => GN.tone(880, .05, "square", .05),
  good: () => { GN.tone(660, .1); GN.tone(990, .16, "sine", .14, .08); },
  bad:  () => GN.tone(170, .25, "sawtooth", .1),
  pass: () => GN.tone(320, .2, "triangle", .12),
  buzz: () => { GN.tone(120, .6, "sawtooth", .16); GN.tone(90, .6, "square", .06); },
  ding: () => GN.tone(1320, .35, "sine", .12),
  win:  () => [523, 659, 784, 1047, 1319].forEach((f, i) => GN.tone(f, .22, "triangle", .15, i * .11)),
  alarm:() => { for (let k = 0; k < 4; k++) { GN.tone(520, .2, "sawtooth", .18, k * .22); GN.tone(900, .1, "sawtooth", .12, k * .22 + .1); } },
  boom: () => { if (!GN.soundOn()) return; const a = GN.audio(); if (!a) return;
    try { const t = a.currentTime, buf = a.createBuffer(1, a.sampleRate * .9, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
      const s = a.createBufferSource(); s.buffer = buf; const f = a.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(1000, t); f.frequency.exponentialRampToValueAtTime(70, t + .8);
      const g = a.createGain(); g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .9);
      s.connect(f).connect(g).connect(a.destination); s.start(); } catch(e){} }
};
GN.vibe = p => { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} };

/* keep the screen awake during play */
let lock = null;
GN.wake = async (on = true) => { try { if (on && "wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => lock = null); }
  else if (!on && lock) { await lock.release(); lock = null; } } catch(e){} };
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && GN._wantWake) GN.wake(true); });

/* ---------- timer (pausable) ---------- */
GN.timer = ({ seconds, onTick, onEnd, warn = 5 }) => {
  let remaining = seconds * 1000, last = performance.now(), paused = false, iv = null, lastSec = null, done = false;
  const t = {
    get left(){ return Math.max(0, remaining / 1000); },
    get paused(){ return paused; },
    add(s){ remaining += s * 1000; },
    pause(){ paused = true; }, resume(){ last = performance.now(); paused = false; },
    stop(){ clearInterval(iv); done = true; },
  };
  const step = () => { const now = performance.now(); if (!paused) remaining -= now - last; last = now;
    const sec = Math.ceil(Math.max(0, remaining) / 1000);
    if (sec !== lastSec) { if (sec <= warn && sec > 0 && !paused) GN.sfx.tick(); lastSec = sec; }
    onTick && onTick(t.left, sec);
    if (remaining <= 0 && !done) { done = true; clearInterval(iv); onEnd && onEnd(); } };
  iv = setInterval(step, 100); step();
  return t;
};
GN.fmtTime = s => { s = Math.ceil(s); return s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : String(s); };

/* ---------- page chrome ---------- */
GN.page = ({ title, accent, accentInk }) => {
  if (accent) document.documentElement.style.setProperty("--acc", accent);
  if (accentInk) document.documentElement.style.setProperty("--acc-ink", accentInk);
  const app = GN.$("#app");
  GN.app = app;
  GN.title = title;
  return app;
};
GN.topbar = (opts = {}) => `<div class="topbar">
  <a class="home" href="${opts.home || "../index.html"}" data-guard="${opts.guard ? 1 : 0}" aria-label="Back to all games">← Parlor</a>
  <div class="title">${GN.esc(opts.title || GN.title || "")}</div>
  <button class="iconbtn" data-sound aria-label="Toggle sound">${GN.soundOn() ? "🔊" : "🔇"}</button></div>`;
GN.render = (html, opts = {}) => {
  GN.closeStage();
  GN.app.innerHTML = (opts.bare ? "" : GN.topbar(opts)) + html;
  if (!opts.keepScroll) window.scrollTo(0, 0);
  GN.bindChrome(GN.app);
};
GN.bindChrome = root => {
  GN.$$("[data-sound]", root).forEach(b => b.onclick = () => { GN.set("sound", !GN.soundOn()); GN.$$("[data-sound]").forEach(x => x.textContent = GN.soundOn() ? "🔊" : "🔇"); if (GN.soundOn()) GN.sfx.tap(); });
  GN.$$('a.home[data-guard="1"]', root).forEach(a => a.onclick = e => { if (!confirm("Leave this game? Scores for the game in progress will be lost.")) e.preventDefault(); });
};
/* full-screen overlay stage (for play screens, handoffs, countdowns) */
GN.stage = (html, cls = "") => {
  let el = GN.$("#gn-stage");
  if (!el) { el = document.createElement("section"); el.id = "gn-stage"; document.body.appendChild(el); }
  el.className = "stage " + cls; el.style.cssText = ""; el.hidden = false; if (GN.app) GN.app.hidden = true; el.innerHTML = html; el.scrollTop = 0; GN.bindChrome(el);
  return el;
};
GN.closeStage = () => { const el = document.getElementById("gn-stage"); if (el) { el.hidden = true; el.innerHTML = ""; } if (GN.app) GN.app.hidden = false; };

/* hand the phone to someone, then continue */
GN.handoff = ({ to, color, emoji = "📱", msg = "", button = "I'm ready", onReady }) => {
  const el = GN.stage(`<div class="handoff" style="--sc:${color || "var(--acc)"}">
    <div class="emoji">${emoji}</div><div class="kicker">Pass the phone to</div><div class="who">${GN.esc(to)}</div>
    ${msg ? `<p>${msg}</p>` : ""}<div class="btns" style="max-width:340px;margin:22px auto 0"><button class="btn primary big" id="gn-ready">${GN.esc(button)}</button></div></div>`, "handoff");
  GN.$("#gn-ready", el).onclick = () => { GN.sfx.tap(); onReady && onReady(); };
};
/* 3-2-1 countdown */
GN.countdown = (label, sub, then, n = 3) => {
  const el = GN.stage(`<div><div class="kicker" style="font-size:15px">${GN.esc(label)}</div><div class="countdown" id="gn-cd">${n}</div><p class="muted">${sub || ""}</p></div>`);
  GN.sfx.tick();
  const iv = setInterval(() => { n--; if (n > 0) { GN.$("#gn-cd", el).textContent = n; GN.sfx.tick(); } else { clearInterval(iv); GN.tone(990, .25); then(); } }, 900);
};

/* toast */
GN.toast = (msg, ms = 1800) => { let t = GN.$("#gn-toast"); if (!t) { t = document.createElement("div"); t.id = "gn-toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); };

/* press-and-hold to peek at a secret */
GN.peek = (el, onFirst) => {
  const show = e => { e.preventDefault(); el.classList.add("on"); if (onFirst) { onFirst(); onFirst = null; } };
  const hide = () => el.classList.remove("on");
  el.addEventListener("pointerdown", show); ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, hide));
  el.addEventListener("contextmenu", e => e.preventDefault());
};

/* ---------- scoreboard html ---------- */
GN.board = (sides, scores, { up = -1, delta = null, sort = false, sub = null } = {}) => {
  let rows = sides.map((s, i) => ({ s, i, pts:scores[i] || 0 }));
  if (sort) rows.sort((a, b) => b.pts - a.pts);
  return `<div class="board">${rows.map(({ s, i, pts }) => `<div class="srow${i === up ? " up" : ""}" style="--sc:${s.color}">
    <div class="nm">${GN.esc(s.name)}${sub ? `<div class="sub">${sub(s, i)}</div>` : (s.members.length > 1 && s.name !== s.members.join(" & ") ? `<div class="sub">${GN.esc(s.members.join(" & "))}</div>` : "")}</div>
    ${delta && delta[i] ? `<span class="delta" style="color:${delta[i] < 0 ? "var(--bad)" : "var(--good)"}">${delta[i] > 0 ? "+" : ""}${delta[i]}</span>` : ""}
    <span class="pts">${pts}</span></div>`).join("")}</div>`;
};
GN.sidePill = s => `<span class="sidepill" style="--sc:${s.color}">${GN.esc(s.name)}</span>`;

/* ---------- final screen ---------- */
GN.finish = ({ gameId, gameName, sides, scores, note = "", onRematch, unit = "pts" }) => {
  GN.closeStage(); GN._wantWake = false; GN.wake(false);
  const placed = GN.record(gameId, gameName, sides.map((s, i) => ({ id:s.id, name:s.name, members:s.members, pts:scores[i] || 0 })));
  const top = placed.filter(p => p.rank === 0); const tie = top.length > 1;
  const winSide = sides.find(s => s.id === top[0].id);
  GN.render(`<div class="center stack" style="padding-top:10px">
    <div class="trophy">${tie ? "🤝" : "🏆"}</div>
    <div class="kicker">${GN.esc(gameName)} · final</div>
    <div class="winner" style="--sc:${tie ? "var(--ink)" : winSide.color}">${tie ? "It's a tie!" : GN.esc(winSide.name) + " wins"}</div>
    ${tie ? `<p class="muted">${top.map(t => GN.esc(t.name)).join(" and ")} share the top spot.</p>` : ""}
    ${note ? `<p class="muted">${note}</p>` : ""}
  </div>
  <div class="card" style="margin-top:18px">${GN.board(sides, scores, { sort:true, sub:(s, i) => { const p = placed.find(x => x.id === s.id); return (p.night ? "+" + p.night + " game-night points" : "no game-night points") + (s.members.length > 1 ? " · " + GN.esc(s.members.join(" & ")) : ""); } })}</div>
  <div class="btns two"><button class="btn primary" id="gn-again">Play again</button><a class="btn" href="../index.html#standings">Standings</a></div>`);
  GN.sfx.win(); GN.confetti();
  GN.$("#gn-again").onclick = () => onRematch ? onRematch() : location.reload();
};

/* ---------- confetti ---------- */
GN.confetti = () => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let cv = GN.$("#gn-confetti"); if (!cv) { cv = document.createElement("canvas"); cv.id = "gn-confetti"; document.body.appendChild(cv); }
  const ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement); const cols = ["--s0","--s1","--s2","--s3","--s4","--acc"].map(v => cs.getPropertyValue(v).trim());
  const P = Array.from({ length:170 }, () => ({ x:Math.random() * innerWidth, y:-20 - Math.random() * innerHeight * .6, vx:(Math.random() - .5) * 3, vy:2 + Math.random() * 4, r:Math.random() * 6.28, vr:(Math.random() - .5) * .3, s:6 + Math.random() * 7, c:GN.pick(cols) }));
  const t0 = performance.now();
  (function f(t){ ctx.clearRect(0, 0, innerWidth, innerHeight); P.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .05; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (t - t0 < 4200) requestAnimationFrame(f); else ctx.clearRect(0, 0, innerWidth, innerHeight); })(t0);
};

/* ---------- reusable setting controls ---------- */
GN.seg = (key, opts, val, fmt = v => v) => `<div class="seg" data-seg="${key}">${opts.map(o => `<button type="button" data-v="${o}" aria-pressed="${String(o) === String(val)}">${fmt(o)}</button>`).join("")}</div>`;
GN.bindSegs = (root, cfg, onChange) => GN.$$("[data-seg]", root).forEach(seg => seg.onclick = e => {
  const b = e.target.closest("button"); if (!b) return; const k = seg.dataset.seg, raw = b.dataset.v;
  cfg[k] = raw === "true" ? true : raw === "false" ? false : isNaN(+raw) ? raw : +raw;
  GN.$$("button", seg).forEach(x => x.setAttribute("aria-pressed", x === b)); GN.sfx.tap(); onChange && onChange(k, cfg[k]);
});

/* ---------- roster editor (used by the hub and every game's setup) ---------- */
GN.rosterEditor = (mount, { compact = false, onChange } = {}) => {
  const draw = () => {
    const r = GN.roster(); const sides = GN.sides(); const pairs = r.mode === "pairs" && r.players.length >= 4;
    mount.innerHTML = `
      <div class="row between"><h3 style="margin:0">Who's playing?</h3>${GN.seg("mode", ["solo", "pairs"], r.mode, v => v === "solo" ? "Individuals" : "Teams of 2")}</div>
      <div class="roster-list" style="margin-top:12px">${r.players.map((p, i) => `<div class="pl">
        <span class="dot" style="background:${pairs ? (sides.find(s => s.members.includes(p)) || {}).color : GN.color(i)}"></span>
        <input class="input" data-i="${i}" value="${GN.esc(p)}" maxlength="16" aria-label="Player ${i + 1} name" autocomplete="off" enterkeyhint="next">
        <button class="x" data-del="${i}" aria-label="Remove ${GN.esc(p)}" ${r.players.length <= 2 ? "disabled" : ""}>×</button></div>`).join("")}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn sm" data-add ${r.players.length >= 12 ? "disabled" : ""}>+ Add player</button>
        ${pairs ? `<button class="btn sm" data-shuffle>🔀 Shuffle teams</button>` : ""}
        <span class="muted small grow" style="text-align:right">${r.players.length} players${pairs ? " · " + sides.length + " teams" : ""}</span></div>
      ${pairs ? `<div class="teams">${sides.map(s => `<div class="team" style="--sc:${s.color}"><div class="tn" contenteditable="true" spellcheck="false" data-key="${GN.esc(s.key)}" aria-label="Team name">${GN.esc(s.name)}</div>
        ${s.name !== s.members.join(" & ") || s.members.length === 3 ? `<div class="tm">${GN.esc(s.members.join(" & "))}${s.members.length === 3 ? " (trio)" : ""}</div>` : ""}</div>`).join("")}</div>
        <p class="tiny muted" style="margin:8px 0 0">Tap a team name to rename it.${r.players.length % 2 ? " Odd number of players, so one team is a trio." : ""}</p>` :
        (r.mode === "pairs" ? `<p class="tiny muted" style="margin:8px 0 0">Teams need at least 4 players.</p>` : "")}`;
    GN.bindSegs(mount, r, () => { GN.saveRoster(r); draw(); onChange && onChange(); });
    GN.$$("input[data-i]", mount).forEach(inp => {
      inp.onchange = () => { const rr = GN.roster(); const i = +inp.dataset.i; const old = rr.players[i]; let v = inp.value.trim() || "Player " + (i + 1);
        if (rr.players.some((p, j) => j !== i && p.toLowerCase() === v.toLowerCase())) v += " " + (i + 1);
        rr.players[i] = v; // carry team names over the rename
        Object.keys(rr.teamNames).forEach(k => { const parts = k.split("|"); if (parts.includes(old)) { const nk = parts.map(x => x === old ? v : x).sort().join("|"); rr.teamNames[nk] = rr.teamNames[k]; delete rr.teamNames[k]; } });
        GN.saveRoster(rr); draw(); onChange && onChange(); };
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } };
      inp.onfocus = () => inp.select();
    });
    GN.$$("[data-del]", mount).forEach(b => b.onclick = () => { const rr = GN.roster(); const i = +b.dataset.del; rr.players.splice(i, 1); rr.order = null; GN.saveRoster(rr); draw(); onChange && onChange(); });
    const add = GN.$("[data-add]", mount); if (add) add.onclick = () => { const rr = GN.roster(); let n = rr.players.length + 1; while (rr.players.includes("Player " + n)) n++; rr.players.push("Player " + n); rr.order = null; GN.saveRoster(rr); draw(); onChange && onChange();
      const ins = GN.$$("input[data-i]", mount); ins[ins.length - 1].focus(); };
    const sh = GN.$("[data-shuffle]", mount); if (sh) sh.onclick = () => { const rr = GN.roster(); rr.order = GN.shuffle(rr.players.map((_, i) => i)); GN.saveRoster(rr); GN.sfx.tap(); draw(); onChange && onChange(); };
    GN.$$(".tn", mount).forEach(el => { el.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } };
      el.onblur = () => { const rr = GN.roster(); const v = el.textContent.trim().slice(0, 24); if (v) rr.teamNames[el.dataset.key] = v; else delete rr.teamNames[el.dataset.key]; GN.saveRoster(rr); draw(); onChange && onChange(); }; });
  };
  draw();
  return { redraw:draw };
};

/* Compact "who's playing" summary with an inline editor toggle, for game setup screens */
GN.rosterBlock = (mount, { needPairs = false, minSides = 2, note = "", onChange } = {}) => {
  const draw = () => {
    const sides = GN.sides(); const pairs = GN.isPairs();
    mount.innerHTML = `<div class="card">
      <div class="row between"><h3 style="margin:0">${pairs ? "Teams" : "Players"} <span class="muted small">(${sides.length})</span></h3><button class="link small" data-edit>Edit</button></div>
      <div class="pillrow" style="margin-top:10px">${sides.map(GN.sidePill).join("")}</div>
      ${note ? `<p class="tiny muted" style="margin:10px 0 0">${note}</p>` : ""}
      ${sides.length < minSides ? `<p class="small" style="color:var(--bad);margin:10px 0 0">Needs at least ${minSides} ${pairs ? "teams" : "players"}.</p>` : ""}
      <div data-ed hidden style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px"></div></div>`;
    const ed = GN.$("[data-ed]", mount);
    GN.$("[data-edit]", mount).onclick = () => { if (ed.hidden) { ed.hidden = false; GN.rosterEditor(ed, { onChange:() => { const s = GN.sides(); GN.$(".pillrow", mount).innerHTML = s.map(GN.sidePill).join(""); onChange && onChange(); } }); GN.$("[data-edit]", mount).textContent = "Done"; } else draw(); };
  };
  draw(); return { redraw:draw };
};

/* turn order helper: rotate through sides, and through members within each side */
GN.rotation = sides => { let turn = 0; const memberIdx = sides.map(() => 0);
  return { get turn(){ return turn; }, side(){ return turn % sides.length; }, round(){ return Math.floor(turn / sides.length); },
    member(si){ const s = sides[si]; return s.members[memberIdx[si] % s.members.length]; },
    partner(si){ const s = sides[si]; return s.members.length > 1 ? s.members.filter((_, k) => k !== memberIdx[si] % s.members.length).join(" & ") : null; },
    advance(){ memberIdx[turn % sides.length]++; turn++; } };
};

/* number parsing for estimate games: "1.5m", "40k", "2,500", "3 billion" */
GN.parseNum = s => { s = String(s).trim().toLowerCase().replace(/[,$\s]/g, "").replace(/^\+/, "");
  const m = s.match(/^(-?\d*\.?\d+)(k|m|b|t|thousand|million|billion|trillion|bn|mn)?$/); if (!m) return null;
  const mult = { k:1e3, thousand:1e3, m:1e6, mn:1e6, million:1e6, b:1e9, bn:1e9, billion:1e9, t:1e12, trillion:1e12 }[m[2]] || 1;
  const v = parseFloat(m[1]) * mult; return isFinite(v) ? v : null; };
GN.fmtNum = v => { const a = Math.abs(v), t = x => Math.round(x * 100) / 100;
  if (a >= 1e12) return t(v / 1e12) + " trillion"; if (a >= 1e9) return t(v / 1e9) + " billion"; if (a >= 1e6) return t(v / 1e6) + " million";
  if (a >= 1e4) return Math.round(v).toLocaleString("en-US"); return t(v).toLocaleString("en-US", { maximumFractionDigits:3 }); };

})();
