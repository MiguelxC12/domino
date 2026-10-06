"use strict";

/* =========================================================
   DOMINÓ CUBANO — cliente
   El navegador MUESTRA el juego; el servidor decide si una
   jugada es válida.
========================================================= */

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

const $ = id => document.getElementById(id);

let state = null;
let pendingTile = null;
let prevBoardLen = 0;
let prevTurn = null;
let prevPhase = null;
let seenTiles = new Set();
let admin = false;
let watching = false; // el admin mira una partida (vista con todas las manos)

/* ---------- sesión local (sobrevive a F5) ---------- */
const KEY = "dominoSession";

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}
function saveSession(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
function clearSession() {
  try { localStorage.removeItem(KEY); } catch {}
}
function savedName() {
  try { return localStorage.getItem("dominoName") || ""; } catch { return ""; }
}
function saveName(n) {
  try { localStorage.setItem("dominoName", n); } catch {}
}

let session = loadSession(); // { room, token, name }

/* ---------- utilidades ---------- */
function esc(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function screen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function teamLabel(t) { return t ? "Equipo B" : "Equipo A"; }
function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }
function avatarClass(p, index) {
  if (state && state.mode === "individual") return `ind${index % 4}`;
  return p.team ? "t1" : "";
}
function playerIndex(id) { return state.players.findIndex(p => p.id === id); }
function me() {
  if (!state || !state.me) return null;
  return state.players.find(p => p.id === state.me) ||
    (state.spectators || []).find(p => p.id === state.me) || null;
}
function isViewer() { return !!(state && (state.spectator || state.god)); }
function myHand() {
  const h = state && state.hands[state.me];
  return Array.isArray(h) ? h : [];
}
function amHost() { return !!(state && state.isHost); }
function handCount(id) {
  const h = state.hands[id];
  return Array.isArray(h) ? h.length : (h && h.count) || 0;
}

/* =========================================================
   SONIDO (sintetizado, sin archivos)
========================================================= */
let soundOn = true;
try { soundOn = localStorage.getItem("dominoSound") !== "0"; } catch {}
let ac = null;

function audio() {
  if (!soundOn) return null;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
function tone(freq, dur = 0.1, type = "sine", vol = 0.12, delay = 0) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const sfx = {
  place() { tone(190, 0.06, "square", 0.1); tone(120, 0.09, "triangle", 0.14, 0.015); },
  turn() { tone(660, 0.09, "sine", 0.12); tone(880, 0.13, "sine", 0.12, 0.1); },
  pass() { tone(220, 0.16, "sawtooth", 0.05); },
  hand() { [440, 554, 659].forEach((f, i) => tone(f, 0.14, "triangle", 0.12, i * 0.1)); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "triangle", 0.14, i * 0.14)); },
  lock() { tone(150, 0.3, "square", 0.08); tone(110, 0.35, "square", 0.08, 0.2); },
  capicua() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, "triangle", 0.15, i * 0.09)); },
  tick() { tone(880, 0.05, "square", 0.06); }
};

function updateSoundButton() { $("sound").textContent = soundOn ? "🔊" : "🔇"; }
$("sound").onclick = () => {
  soundOn = !soundOn;
  try { localStorage.setItem("dominoSound", soundOn ? "1" : "0"); } catch {}
  updateSoundButton();
  if (soundOn) sfx.place();
};
updateSoundButton();

/* =========================================================
   FICHAS (puntos de colores; el color depende del NÚMERO)
========================================================= */
const PIPS = {
  0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9], 7: [1, 2, 3, 5, 7, 8, 9], 8: [1, 2, 3, 4, 6, 7, 8, 9],
  9: [1, 2, 3, 4, 5, 6, 7, 8, 9]
};

function halfHTML(n) {
  const on = new Set(PIPS[n] || []);
  let out = '<span class="half">';
  for (let i = 1; i <= 9; i++) {
    out += `<i class="pip pip-${n}${on.has(i) ? "" : " off"}"></i>`;
  }
  return out + "</span>";
}

function tileHTML(a, b) {
  return `<span class="domino${a === b ? " double" : ""}">${halfHTML(a)}<span class="dvd"></span>${halfHTML(b)}</span>`;
}

/* =========================================================
   INICIO
========================================================= */
$("name").value = savedName() || (session && session.name) || "";

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) {
  $("code").value = urlRoom.toUpperCase().slice(0, 5);
  $("joinBox").classList.remove("hidden");
}

function readName() {
  const n = $("name").value.trim();
  if (!n) { toast("Escribe tu nombre."); $("name").focus(); return null; }
  saveName(n);
  return n;
}

$("create").onclick = () => {
  const name = readName();
  if (!name) return;
  audio();
  socket.emit("create-room", { name });
};
$("toggleJoin").onclick = () => $("joinBox").classList.toggle("hidden");
$("code").oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
$("join").onclick = () => {
  const name = readName();
  if (!name) return;
  const code = $("code").value.trim().toUpperCase();
  if (code.length < 5) { toast("El código tiene 5 letras o números."); return; }
  audio();
  socket.emit("join-room", { name, code });
};
$("name").addEventListener("keydown", e => { if (e.key === "Enter") $("create").click(); });
$("code").addEventListener("keydown", e => { if (e.key === "Enter") $("join").click(); });

/* =========================================================
   CONEXIÓN / F5
========================================================= */
socket.on("connect", () => {
  $("conn").classList.add("hidden");
  // F5, mala señal o teléfono bloqueado: volvemos a la misma sala y asiento.
  if (session && session.room && session.token) {
    $("homeStatus").textContent = "Reconectando a tu sala…";
    socket.emit("join-room", { code: session.room, token: session.token, name: session.name });
  }
});
socket.on("disconnect", () => $("conn").classList.remove("hidden"));
socket.on("connect_error", () => $("conn").classList.remove("hidden"));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !socket.connected) socket.connect();
});

socket.on("joined", data => {
  session = { room: data.room, token: data.token, name: savedName() };
  saveSession(session);
});

socket.on("session-invalid", message => {
  clearSession();
  session = null;
  state = null;
  resetClientTracking();
  $("homeStatus").textContent = "";
  closeModals();
  screen("home");
  if (message) toast(message);
});

socket.on("game-error", message => {
  $("homeStatus").textContent = "";
  toast(message);
  if (watching && (!state || !state.god)) watching = false;
});

socket.on("notice", message => toast(message));

// Eventos del juego: pase (suena a todos), capicúa, tiempo agotado.
socket.on("game-event", ev => {
  if (ev.type === "pass") {
    if (!playCustom("pass")) sfx.pass();
  } else if (ev.type === "capicua") {
    showBanner(`¡CAPICÚA! ${ev.name}`);
    if (!playCustom("capicua")) sfx.capicua();
  }
});

let bannerTimer;
function showBanner(text) {
  const el = $("banner");
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function resetClientTracking() {
  prevBoardLen = 0; prevTurn = null; prevPhase = null; seenTiles = new Set(); pendingTile = null;
}

function closeModals() {
  $("modal").classList.add("hidden");
  $("sideModal").classList.add("hidden");
}

/* =========================================================
   ESTADO
========================================================= */
function applyState(s) {
  const old = state;
  state = s;
  if (s.serverNow) clockOffset = s.serverNow - Date.now();
  const myMove =
    (s.phase === "playing" && s.turn === s.me) ||
    (s.phase === "starter-choice" && (s.starterPlayers || []).includes(s.me));
  const wasMyMove = old && (
    (old.phase === "playing" && old.turn === old.me) ||
    (old.phase === "starter-choice" && (old.starterPlayers || []).includes(old.me)));
  if (organizing && myMove && !wasMyMove) {
    organizing = false;
    toast("Es tu turno: organizar desactivado.");
  }
  $("homeStatus").textContent = "";

  if (!old || old.code !== s.code) resetClientTracking();

  render();
  playSounds(old, s);
  prevBoardLen = s.board.length;
  prevTurn = s.turn;
  prevPhase = s.phase;
}

socket.on("state", s => { if (!watching) applyState(s); });
socket.on("watch-state", s => { if (watching) applyState(s); });
socket.on("watch-ended", () => { if (watching) exitWatch("La sala se cerró."); });

function playSounds(old, s) {
  if (!old) return;
  if (s.board.length > prevBoardLen && s.phase !== "lobby") sfx.place();
  if (s.phase === "playing" && s.turn === s.me && prevTurn !== s.me) {
    sfx.turn();
    try { navigator.vibrate && navigator.vibrate(35); } catch {}
  }
  if (s.phase === "starter-choice" && prevPhase !== "starter-choice" && (s.starterPlayers || []).includes(s.me)) sfx.turn();
  if (prevPhase !== s.phase && s.lastResult) {
    const r = s.lastResult;
    const result = outcomeFor(s, r);       // "win" | "lose" | null
    const finished = s.phase === "finished";
    const custom = result && (finished || theme.when === "hand");
    if (custom && playCustom(result)) return;
    if (finished) sfx.win();
    else if (s.phase === "hand-result") (r.reason === "sin-fichas" ? sfx.hand : sfx.lock)();
  }
}

function render() {
  if (!state) return;
  $("lcode").textContent = state.code;
  $("gcode").textContent = state.code;
  $("leaveGame").textContent = state.god ? "Cerrar vista" : "Salir";
  $("back").textContent = state.god ? "← Cerrar vista" : "← Salir";

  if (state.phase === "lobby") {
    closeModals();
    renderLobby();
    screen("lobby");
    return;
  }
  screen("game");
  document.body.classList.toggle("spectating", isViewer());
  renderScore();
  renderStatus();
  renderSeats();
  renderBoard();
  if (isViewer()) renderViewerBar(); else renderHand();
  $("handbar").classList.toggle("hidden", isViewer());
  $("specbar").classList.toggle("hidden", !isViewer());
  if (state.phase === "hand-result" || state.phase === "finished") scheduleResult();
  else { clearTimeout(resultTimer); resultKey = null; $("modal").classList.add("hidden"); }
  // si dejó de ser mi turno mientras elegía lado, cierro la ventana
  if (!(state.phase === "playing" && state.turn === state.me)) {
    $("sideModal").classList.add("hidden");
    pendingTile = null;
  }
}

/* =========================================================
   LOBBY
========================================================= */
function renderLobby() {
  const team = state.mode === "team";
  const host = amHost();
  const spec = state.spectator;
  $("count").textContent = `${state.players.length}/4`;
  $("scount").textContent = state.spectators.length ? String(state.spectators.length) : "";
  $("specHint").textContent = host ? "tú decides quién juega" : "";

  const full = state.players.length >= 4;

  $("players").innerHTML = state.players.map((p, i) => {
    const isMe = p.id === state.me;
    const sub = team ? teamLabel(p.team) : "Individual";
    const canTeam = team && (isMe || host);
    const teamBtn = canTeam
      ? `<button class="team-btn ${p.team ? "b" : "a"}" data-switch="${p.team ? 0 : 1}" data-id="${p.id}">→ ${p.team ? "A" : "B"}</button>`
      : "";
    const moveBtn = host
      ? `<button class="team-btn" data-move="spectators" data-id="${p.id}" title="Pasar a espectador">👁 Espectador</button>`
      : "";
    return `
      <div class="player">
        <div class="avatar ${avatarClass(p, i)}">${esc(initial(p.name))}</div>
        <div>
          <b>${esc(p.name)}${isMe ? " (tú)" : ""}${p.host ? " 👑" : ""}</b>
          <small><span class="dot ${p.connected ? "on" : ""}"></span>${esc(sub)} · ${p.connected ? "Conectado" : "Desconectado"}</small>
        </div>
        <div class="player-actions">${teamBtn}${moveBtn}</div>
      </div>`;
  }).join("") || '<p class="hint left">Nadie juega todavía.</p>';

  $("spectators").innerHTML = state.spectators.map(p => {
    const isMe = p.id === state.me;
    const moveBtn = host
      ? `<button class="team-btn" data-move="players" data-id="${p.id}" ${full ? "disabled" : ""} title="${full ? "Ya hay 4 jugadores" : "Pasar a jugador"}">🎲 Jugador</button>`
      : "";
    return `
      <div class="player spectator">
        <div class="avatar spec">${esc(initial(p.name))}</div>
        <div>
          <b>${esc(p.name)}${isMe ? " (tú)" : ""}${p.host ? " 👑" : ""}</b>
          <small><span class="dot ${p.connected ? "on" : ""}"></span>Espectador</small>
        </div>
        <div class="player-actions">${moveBtn}</div>
      </div>`;
  }).join("") || '<p class="hint left">Los que entren con la sala llena, o con la partida empezada, miran desde aquí.</p>';

  document.querySelectorAll("#players [data-switch]").forEach(b => {
    b.onclick = () => socket.emit("set-team", { id: b.dataset.id, team: Number(b.dataset.switch) });
  });
  document.querySelectorAll("#lobby [data-move]").forEach(b => {
    b.onclick = () => socket.emit("move-member", { id: b.dataset.id, to: b.dataset.move });
  });

  document.querySelectorAll("[data-v]").forEach(b => {
    b.classList.toggle("selected", Number(b.dataset.v) === state.variant);
    b.disabled = !host;
  });
  document.querySelectorAll("[data-mode]").forEach(b => {
    b.classList.toggle("selected", b.dataset.mode === state.mode);
    b.disabled = !host;
  });
  document.querySelectorAll("[data-capicua]").forEach(b => {
    b.classList.toggle("selected", (b.dataset.capicua === "1") === !!state.capicua);
    b.disabled = !host;
  });
  $("capBonus").textContent = state.capicuaBonus || 30;
  $("cfgHint").textContent = host ? "" : "Solo el anfitrión puede cambiarla";

  const n = state.players.length;
  const t0 = state.players.filter(p => p.team === 0).length;
  const t1 = n - t0;
  let hint = "";
  let ok = host && n >= 2;
  if (!host) hint = spec
    ? "Estás como espectador. El anfitrión decide quién juega."
    : "Esperando a que el anfitrión comience la partida…";
  else if (n < 2) hint = "Se necesitan al menos 2 jugadores (puedes subir espectadores).";
  else if (team && (!t0 || !t1 || Math.abs(t0 - t1) > 1)) {
    ok = false;
    hint = "Equipos desparejos: usa → A / → B para dejarlos 2 contra 2.";
  } else if (team && n === 4) hint = "Compañeros frente a frente: Equipo A contra Equipo B.";
  $("start").disabled = !ok;
  $("startHint").textContent = hint;
}

document.querySelectorAll("[data-v]").forEach(b => {
  b.onclick = () => socket.emit("configure", { variant: Number(b.dataset.v) });
});
document.querySelectorAll("[data-mode]").forEach(b => {
  b.onclick = () => socket.emit("configure", { mode: b.dataset.mode });
});
document.querySelectorAll("[data-capicua]").forEach(b => {
  b.onclick = () => socket.emit("configure", { capicua: b.dataset.capicua === "1" });
});
$("start").onclick = () => socket.emit("start-game");

$("copy").onclick = async () => {
  const url = `${location.origin}/?room=${state.code}`;
  const text = `Juega dominó conmigo. Sala ${state.code}: ${url}`;
  try {
    if (navigator.share) { await navigator.share({ title: "Dominó Cubano", text, url }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Enlace copiado."); }
  catch { toast(url); }
};

/* =========================================================
   SALIR (diferente de F5)
========================================================= */
function leaveGame() {
  if (watching) { exitWatch(); return; }
  if (!confirm("¿Quieres salir de esta sala?")) return;
  socket.emit("leave-room");
  clearSession();
  session = null;
  state = null;
  resetClientTracking();
  closeModals();
  document.body.classList.remove("spectating");
  screen("home");
  toast("Has salido de la sala.");
}

function exitWatch(message) {
  socket.emit("admin-unwatch");
  watching = false;
  state = null;
  resetClientTracking();
  closeModals();
  document.body.classList.remove("spectating");
  screen("home");
  // si el admin también jugaba en otra sala, vuelve a su asiento
  if (session && session.room && session.token) {
    socket.emit("join-room", { code: session.room, token: session.token, name: session.name });
  }
  if (message) toast(message);
}
$("back").onclick = leaveGame;
$("leaveGame").onclick = leaveGame;

/* =========================================================
   MARCADOR Y ESTADO
========================================================= */
function renderScore() {
  const team = state.mode === "team";
  const m = me();
  const labels = team ? ["Equipo A", "Equipo B"] : state.players.map(p => p.name);
  let html = "";
  state.scores.forEach((score, i) => {
    const mine = team ? m && m.team === i : state.players[i] && state.players[i].id === state.me;
    html += `<div class="score-item${mine ? " mine" : ""}"><small>${esc(labels[i] || "")}</small><b>${score}</b></div>`;
    if (team && i === 0) html += `<div class="score-vs">a ${state.maxScore}</div>`;
  });
  $("score").innerHTML = html;
}

function renderStatus() {
  const el = $("status");
  const name = id => { const p = state.players.find(x => x.id === id); return p ? p.name : "—"; };
  let text = "";
  let mine = false;
  if (state.phase === "starter-choice") {
    const cands = state.starterPlayers || [];
    const amCand = cands.includes(state.me) && !isViewer();
    if (amCand) {
      text = cands.length > 1
        ? "Sale tu equipo: elige tú cualquier ficha (o tu compañero)"
        : "Sales tú: elige cualquier ficha";
      mine = true;
    } else if (cands.length > 1) {
      text = `Sale ${cands.map(name).join(" o ")}: el primero que elija`;
    } else {
      text = `${name(cands[0])} sale: está eligiendo su ficha`;
    }
  } else if (state.phase === "playing") {
    if (state.turn === state.me) { text = "Tu turno"; mine = true; }
    else text = `Turno de ${name(state.turn)}`;
  } else {
    text = "Mano terminada";
  }
  $("statusText").textContent = text;
  el.classList.toggle("mine", mine);
  $("handbar").classList.toggle("myturn", mine);
  updateClock();
}

/* ---- reloj del turno (el servidor juega solo cuando llega a 0) ---- */
let clockOffset = 0;
let lastTickSecond = null;
function updateClock() {
  const el = $("clock");
  if (!state || !state.deadline || !(state.phase === "playing" || state.phase === "starter-choice")) {
    el.textContent = "";
    el.classList.remove("urgent");
    return;
  }
  const ms = state.deadline - (Date.now() + clockOffset);
  const secs = Math.max(0, Math.ceil(ms / 1000));
  el.textContent = ` · ⏱ ${secs}s`;
  el.classList.toggle("urgent", secs <= 10);
  const iAct = state.phase === "playing"
    ? state.turn === state.me
    : (state.starterPlayers || []).includes(state.me);
  if (iAct && !isViewer() && secs <= 5 && secs > 0 && secs !== lastTickSecond) {
    lastTickSecond = secs;
    sfx.tick();
  }
  if (secs > 5) lastTickSecond = null;
}
setInterval(updateClock, 250);

/* =========================================================
   JUGADORES ALREDEDOR DE LA MESA
   Tú abajo · siguiente a tu derecha · anterior a tu izquierda ·
   compañero (opuesto) arriba.
========================================================= */
function relativeSeats() {
  const list = state.players;
  const n = list.length;
  if (!n) return {};
  if (isViewer()) {
    // El espectador mira la mesa desde fuera: el primer jugador abajo.
    const at = k => list[k % n];
    if (n === 1) return { bottom: at(0) };
    if (n === 2) return { bottom: at(0), top: at(1) };
    if (n === 3) return { bottom: at(0), right: at(1), left: at(2) };
    return { bottom: at(0), right: at(1), top: at(2), left: at(3) };
  }
  const i = list.findIndex(p => p.id === state.me);
  if (i < 0) return {};
  const at = k => list[(i + k + n) % n];
  if (n === 2) return { top: at(1) };
  if (n === 3) return { right: at(1), left: at(2) };
  return { right: at(1), top: at(2), left: at(3) };
}

function seatHTML(p, pos) {
  if (!p) return "";
  const active = state.turn === p.id && state.phase === "playing";
  const count = handCount(p.id);
  const idx = playerIndex(p.id);
  const picking = state.phase === "starter-choice" && (state.starterPlayers || []).includes(p.id);
  const started = state.phase === "playing" && state.starterPlayer === p.id;
  const tag = picking ? '<span class="tag">elige salida</span>' : started ? '<span class="tag">salió</span>' : "";
  const teamTxt = state.mode === "team" ? `<span class="seat-team">${teamLabel(p.team)} · </span>` : "";
  const online = p.left ? "" : `<i class="${p.connected ? "on" : ""}"></i>`;
  return `
    <div class="seat ${pos}${active ? " active" : ""}${p.left || !p.connected ? " gone" : ""}">
      <div class="avatar ${avatarClass(p, idx)}">${esc(initial(p.name))}${online}</div>
      <div class="seat-info">
        <div class="seat-name">${esc(p.name)}${p.host ? " 👑" : ""}</div>
        <small>${teamTxt}${count} ${count === 1 ? "ficha" : "fichas"}</small>
        ${p.left ? '<span class="tag">salió (auto)</span>' : tag}
      </div>
    </div>`;
}

function renderSeats() {
  const s = relativeSeats();
  $("seats").innerHTML = seatHTML(s.left, "left") + seatHTML(s.top, "top") + seatHTML(s.right, "right") + seatHTML(s.bottom, "bottom");
  $("table").classList.toggle("spec", isViewer());
  if (isViewer()) return;

  const m = me();
  const idx = playerIndex(state.me);
  if (m) {
    $("meSeat").innerHTML = `<div class="avatar ${avatarClass(m, idx)}">${esc(initial(m.name))}</div>
      <span>${esc(m.name)} <small>${state.mode === "team" ? teamLabel(m.team) : "Individual"}</small></span>`;
  }
}

/* =========================================================
   TABLERO — una cadena real que dobla en las esquinas
========================================================= */
/*
  Unidades: lado corto de una ficha = 2, lado largo = 4.
  La ficha de salida va EXACTAMENTE en el centro (0,0).
  Desde ella salen dos brazos:
    · derecho: avanza hacia la derecha y, al llegar al límite, baja,
      vuelve hacia la izquierda, y así sucesivamente.
    · izquierdo: lo mismo girado 180° (sube y regresa hacia la derecha).
  Los dos brazos usan bandas verticales distintas, así que nunca chocan.
  Los dobles se colocan atravesados.
*/
const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
const ROT_NORMAL = { E: -90, W: 90, S: 0, N: 180 }; // la mitad "cercana" va arriba en la ficha vertical

function walkArm(board, indices, side, items, xmax) {
  const sIdx = side === 1 ? indices.from - 1 : indices.from + 1;
  const starter = board[sIdx];
  const startLen = starter.left === starter.right ? 2 : 4;
  let d = side === 1 ? "E" : "W";
  const vs = side === 1 ? "S" : "N"; // sentido vertical de este brazo
  let hdir = DIRS[d][0];
  let ex = side * (startLen / 2);
  let ey = 0;
  let vrun = 0;

  for (let i = indices.from; i !== indices.to + side; i += side) {
    const p = board[i];
    const dbl = p.left === p.right;
    const len = dbl ? 2 : 4;
    const horizontal = d === "E" || d === "W";
    let turnTo = null;

    if (!dbl) {
      if (horizontal && Math.abs(ex + DIRS[d][0] * len) > xmax) turnTo = vs;
      else if (!horizontal && vrun >= 1) turnTo = hdir === 1 ? "W" : "E";
    }

    let cx, cy, heading;
    if (turnTo) {
      const [dx, dy] = DIRS[d];
      const [tx, ty] = DIRS[turnTo];
      // la ficha de esquina queda pegada al costado de la anterior
      cx = ex + dx * 1 + tx * 1;
      cy = ey + dy * 1 + ty * 1;
      heading = turnTo;
      ex = cx + tx * 2;
      ey = cy + ty * 2;
      d = turnTo;
      if (d === "E" || d === "W") { hdir = DIRS[d][0]; vrun = 0; } else vrun = 1;
    } else {
      const [dx, dy] = DIRS[d];
      cx = ex + dx * (len / 2);
      cy = ey + dy * (len / 2);
      ex += dx * len;
      ey += dy * len;
      heading = d;
      if (!horizontal) vrun++;
    }

    // valor que toca a la ficha anterior ("cerca") y el del extremo libre ("lejos")
    const near = side === 1 ? p.left : p.right;
    const far = side === 1 ? p.right : p.left;
    items[i] = { cx, cy, heading, dbl, near, far };
  }
}

function layoutBoard(board, starterIdx, xmax) {
  const items = new Array(board.length);
  const s = board[starterIdx];
  items[starterIdx] = {
    cx: 0, cy: 0, heading: "E", dbl: s.left === s.right, near: s.left, far: s.right
  };
  if (starterIdx + 1 < board.length) {
    walkArm(board, { from: starterIdx + 1, to: board.length - 1 }, 1, items, xmax);
  }
  if (starterIdx - 1 >= 0) {
    walkArm(board, { from: starterIdx - 1, to: 0 }, -1, items, xmax);
  }
  let halfW = 2, halfH = 2;
  items.forEach(it => {
    const horiz = it.heading === "E" || it.heading === "W";
    // medidas (en unidades) que ocupa la ficha según su rumbo; el doble va atravesado
    let w, h;
    if (it.dbl) { w = horiz ? 1 : 2; h = horiz ? 2 : 1; }
    else { w = horiz ? 2 : 1; h = horiz ? 1 : 2; }
    halfW = Math.max(halfW, Math.abs(it.cx) + w);
    halfH = Math.max(halfH, Math.abs(it.cy) + h);
  });
  return { items, halfW: halfW + 0.5, halfH: halfH + 0.5 };
}

function bestLayout(board, starterIdx, W, H, maxU) {
  let best = null;
  for (let xmax = 8; xmax <= 80; xmax += 2) {
    const lay = layoutBoard(board, starterIdx, xmax);
    const u = Math.min(W / (2 * lay.halfW), H / (2 * lay.halfH), maxU);
    if (!best || u >= best.u - 1e-6) best = { lay, u, xmax };
  }
  return best;
}

function renderBoard() {
  const boardEl = $("board");
  const area = $("boardArea");
  const board = state.board;
  $("empty").classList.toggle("hidden", board.length > 0);

  if (!board.length) {
    boardEl.innerHTML = "";
    $("empty").textContent =
      state.phase === "starter-choice" ? "Esperando la ficha de salida…" : "La mesa está vacía";
    $("ends").innerHTML = "";
    seenTiles = new Set();
    return;
  }

  const W = area.clientWidth;
  const H = area.clientHeight;
  if (!W || !H) return;

  let starterIdx = board.findIndex(p => p.starter);
  if (starterIdx < 0) starterIdx = 0;

  const maxU = Math.max(10, Math.min(22, Math.min(W, H) / 9));
  const { lay, u } = bestLayout(board, starterIdx, W, H, maxU);

  // el centro de la mesa es la ficha de salida
  const ox = W / 2;
  const oy = H / 2;
  let html = "";
  const nowSeen = new Set();
  board.forEach((p, i) => {
    const it = lay.items[i];
    nowSeen.add(p.id);
    const isNew = seenTiles.size > 0 && !seenTiles.has(p.id);
    const wUnits = 2, hUnits = 4;
    const rot = it.dbl ? (it.heading === "E" || it.heading === "W" ? 0 : 90) : ROT_NORMAL[it.heading];
    html += `<div class="btile${p.starter ? " starter" : ""}${isNew ? " new" : ""}" style="left:${(ox + it.cx * u).toFixed(1)}px;top:${(oy + it.cy * u).toFixed(1)}px;width:${wUnits * u}px;height:${hUnits * u}px;--rot:${rot}deg">${tileHTML(it.near, it.far)}</div>`;
  });
  boardEl.innerHTML = html;
  seenTiles = nowSeen;

  const L = board[0].left;
  const R = board[board.length - 1].right;
  $("ends").innerHTML = `Extremos <span class="endnum n${L}">${L}</span><span class="endnum n${R}">${R}</span>`;
}

/* =========================================================
   MANO
========================================================= */
/* ---- preferencias de la mano (orden y giro), por mano y sobreviven a F5 ---- */
let organizing = false;
let dragging = false;
let handPrefs = (() => {
  try { return JSON.parse(localStorage.getItem("dominoHandPrefs")) || {}; } catch { return {}; }
})();
function saveHandPrefs() {
  try { localStorage.setItem("dominoHandPrefs", JSON.stringify(handPrefs)); } catch {}
}
function orderedHand(hand) {
  const key = `${state.code}:${state.handNumber}`;
  if (handPrefs.key !== key) handPrefs = { key, order: [], flips: {} };
  const ids = hand.map(t => t.id);
  handPrefs.order = (handPrefs.order || []).filter(id => ids.includes(id));
  ids.forEach(id => { if (!handPrefs.order.includes(id)) handPrefs.order.push(id); });
  return handPrefs.order.map(id => hand.find(t => t.id === id));
}

function fits(tile, side) {
  if (!state.board.length) return false;
  const v = side === "left" ? state.board[0].left : state.board[state.board.length - 1].right;
  return tile.a === v || tile.b === v;
}

function renderHand(force) {
  if (dragging && !force) return;
  const hand = orderedHand(myHand());
  $("hc").textContent = `${hand.length} ${hand.length === 1 ? "ficha" : "fichas"}`;

  const choosing = state.phase === "starter-choice" && (state.starterPlayers || []).includes(state.me);
  const myTurn = state.phase === "playing" && state.turn === state.me;
  const canOrganize = state.phase === "playing" || state.phase === "starter-choice";
  if (!canOrganize) organizing = false;

  $("organize").classList.toggle("active", organizing);
  $("organize").textContent = organizing ? "✓ Listo" : "↔ Organizar";
  $("organize").setAttribute("aria-pressed", organizing ? "true" : "false");
  $("organize").classList.toggle("hidden", !canOrganize || !hand.length);
  $("organizeHint").classList.toggle("hidden", !organizing);
  $("hand").classList.toggle("organizing", organizing);

  const bar = $("handbar").clientWidth || window.innerWidth;
  const n = Math.max(hand.length, 7);
  const byWidth = Math.floor((bar - 12 - (n - 1) * 4) / n);
  const byHeight = Math.floor(Math.max(56, Math.min(120, window.innerHeight * 0.17)) / 2);
  const tw = Math.max(24, Math.min(56, byWidth, byHeight));
  $("hand").style.setProperty("--tw", tw + "px");

  $("hand").innerHTML = hand.map(t => {
    const flipped = !!(handPrefs.flips && handPrefs.flips[t.id]);
    const top = flipped ? t.b : t.a;
    const bottom = flipped ? t.a : t.b;
    const ok = organizing || choosing || (myTurn && (fits(t, "left") || fits(t, "right")));
    const cls = organizing ? "movable" : ok ? "playable" : myTurn ? "dim" : "";
    return `<button class="hand-tile ${cls}" data-id="${t.id}" ${ok ? "" : "disabled"} aria-label="Ficha ${t.a}-${t.b}">${tileHTML(top, bottom)}</button>`;
  }).join("");

  if (organizing) {
    $("hand").querySelectorAll(".hand-tile").forEach(btn => {
      btn.onpointerdown = e => startDrag(e, btn);
    });
    return;
  }

  $("hand").querySelectorAll(".hand-tile:not(:disabled)").forEach(btn => {
    btn.onclick = () => {
      audio();
      const tile = hand.find(t => t.id === btn.dataset.id);
      if (!tile) return;
      if (choosing) socket.emit("choose-starter", { tileId: tile.id });
      else chooseSide(tile);
    };
  });
}

/* Arrastrar para mover; tocar (sin arrastrar) para girar la ficha. */
function startDrag(e, btn) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const id = btn.dataset.id;
  const handEl = $("hand");
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;

  const move = ev => {
    if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 8) return;
    moved = true;
    dragging = true;
    const tiles = [...handEl.querySelectorAll(".hand-tile")];
    const others = tiles.filter(t => t.dataset.id !== id);
    let idx = others.findIndex(t => {
      const r = t.getBoundingClientRect();
      return ev.clientX < r.left + r.width / 2;
    });
    if (idx < 0) idx = others.length;
    const cur = handPrefs.order.indexOf(id);
    if (idx !== cur) {
      const rest = handPrefs.order.filter(x => x !== id);
      rest.splice(idx, 0, id);
      handPrefs.order = rest;
      renderHand(true);
    }
    const el = handEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2);
    el.classList.add("dragging");
    el.style.transform = `translate(${dx}px, -12px) scale(1.1)`;
  };

  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
    if (!moved) {
      handPrefs.flips = handPrefs.flips || {};
      handPrefs.flips[id] = !handPrefs.flips[id];
    }
    dragging = false;
    saveHandPrefs();
    if (state) renderHand(true);
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
}

$("organize").onclick = () => {
  organizing = !organizing;
  if (state) renderHand(true);
};

function renderViewerBar() {
  const specs = state.spectators;
  const names = specs.map(s => esc(s.name)).join(", ");
  $("specTitle").innerHTML = state.god
    ? `👁 Vista del administrador · todas las manos${specs.length ? ` · mirando: ${names}` : ""}`
    : `👁 Eres espectador${specs.length > 1 ? ` · mirando: ${names}` : ""}`;
  if (!state.god) { $("godHands").innerHTML = ""; return; }
  $("godHands").innerHTML = state.players.map(p => {
    const hand = Array.isArray(state.hands[p.id]) ? state.hands[p.id] : [];
    const tiles = hand.length
      ? hand.map(t => `<span class="mt">${tileHTML(t.a, t.b)}</span>`).join("")
      : '<span class="none">sin fichas</span>';
    const active = state.turn === p.id ? " winner" : "";
    return `<div class="mh${active}"><div class="who">${esc(p.name)}<small>${hand.reduce((s, t) => s + t.a + t.b, 0)} pts</small></div><div class="tiles">${tiles}</div></div>`;
  }).join("");
}

function chooseSide(tile) {
  const l = fits(tile, "left");
  const r = fits(tile, "right");
  if (!l && !r) { toast("Esa ficha no encaja en la mesa."); return; }

  const lv = state.board[0].left;
  const rv = state.board[state.board.length - 1].right;

  // Si solo encaja en un extremo, o los dos extremos valen lo mismo,
  // no hay nada que decidir.
  if (!(l && r) || lv === rv) { sendSide(tile, l ? "left" : "right"); return; }

  pendingTile = tile;
  $("sideChoices").innerHTML = `
    <button class="side-choice" id="chooseLeft"><span class="arrow">←</span><span>IZQUIERDA</span><span class="endnum n${lv}">${lv}</span></button>
    <button class="side-choice" id="chooseRight"><span class="arrow">→</span><span>DERECHA</span><span class="endnum n${rv}">${rv}</span></button>`;
  $("chooseLeft").onclick = () => sendSide(pendingTile, "left");
  $("chooseRight").onclick = () => sendSide(pendingTile, "right");
  $("sideModal").classList.remove("hidden");
}

function sendSide(tile, side) {
  $("sideModal").classList.add("hidden");
  pendingTile = null;
  if (!tile) return;
  socket.emit("play-tile", { tileId: tile.id, side });
}
$("cancelChoice").onclick = () => { pendingTile = null; $("sideModal").classList.add("hidden"); };

/* =========================================================
   RESULTADO
========================================================= */
let resultKey = null;
let resultTimer = null;

// Se espera un momento para que se vea cómo quedó la mesa.
function scheduleResult() {
  const key = `${state.handNumber}:${state.phase}`;
  if (!$("modal").classList.contains("hidden")) { showResult(); return; }
  if (resultKey === key) return;
  resultKey = key;
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    if (state && (state.phase === "hand-result" || state.phase === "finished")) showResult();
  }, 1300);
}

function showResult() {
  const r = state.lastResult;
  if (!r) return;
  const finished = state.phase === "finished";
  const team = state.mode === "team";
  const m = me();

  let winnerName;
  if (r.reason === "empate-tranca") winnerName = "Empate";
  else if (team) winnerName = teamLabel(r.winningTeam);
  else winnerName = r.winnerName;

  const iWon = !isViewer() && outcomeFor(state, r) === "win";

  $("icon").textContent = r.capicua ? "🎉" : finished ? (iWon ? "🏆" : "🎖️") : r.reason === "empate-tranca" ? "🤝" : "🎲";
  // imagen distinta para ganadores y perdedores (la elige el administrador)
  const outcome = outcomeFor(state, r);
  const img = outcome && (finished || theme.when === "hand")
    ? (outcome === "win" ? theme.winImg : theme.loseImg)
    : null;
  const imgEl = $("resultImg");
  if (img) { imgEl.src = img; imgEl.classList.remove("hidden"); $("icon").classList.add("hidden"); }
  else { imgEl.removeAttribute("src"); imgEl.classList.add("hidden"); $("icon").classList.remove("hidden"); }
  $("mtitle").textContent = r.reason === "empate-tranca"
    ? "Tranca empatada"
    : finished ? `${winnerName} gana la partida` : `${winnerName} gana la mano`;

  $("mtext").textContent =
    r.reason === "trancada" ? `Tranca: ${r.detail}.`
    : r.reason === "empate-tranca" ? `Empate en la menor suma (${r.lowest}) entre ${r.detail}. Nadie suma puntos: se juega otra mano.`
    : `${r.detail}.`;

  $("mscore").textContent =
    r.reason === "empate-tranca" ? "Sin puntos"
    : r.reason === "ajuste" ? "Marcador ajustado"
    : r.capicua ? `+${r.awarded} puntos (¡capicúa!)`
    : `+${r.awarded} puntos`;

  const labels = team ? ["Equipo A", "Equipo B"] : state.players.map(p => p.name);
  $("mtotals").innerHTML = r.scores.map((s, i) => `<span>${esc(labels[i] || "")}: <b>${s}</b></span>`).join("");

  $("mhands").innerHTML = (r.reveal || []).map(h => {
    const won = r.reason !== "empate-tranca" && h.id === r.winningPlayer;
    const tiles = h.tiles.length
      ? h.tiles.map(t => `<span class="mt">${tileHTML(t.a, t.b)}</span>`).join("")
      : '<span class="none">Se quedó sin fichas</span>';
    return `<div class="mh${won ? " winner" : ""}"><div class="who">${esc(h.name)}<small>${h.value} pts</small></div><div class="tiles">${tiles}</div></div>`;
  }).join("");

  const viewer = isViewer();
  $("next").classList.toggle("hidden", finished || viewer);
  $("again").classList.toggle("hidden", !finished || viewer);
  $("toLobby").classList.toggle("hidden", !(finished && amHost()));
  const wait = $("waitText");
  wait.classList.toggle("hidden", !viewer);
  wait.textContent = viewer ? "Esperando a los jugadores…" : "";
  $("modal").classList.remove("hidden");
}

$("next").onclick = () => socket.emit("next-hand");
$("again").onclick = () => socket.emit("new-match");
$("toLobby").onclick = () => socket.emit("to-lobby");

// ¿ganó o perdió quien está mirando? (null = empate o espectador)
function outcomeFor(s, r) {
  if (!s || s.spectator || s.god || !r) return null;
  if (r.reason === "empate-tranca") return null;
  const m = s.players.find(p => p.id === s.me);
  if (!m) return null;
  const won = s.mode === "team" ? m.team === r.winningTeam : r.winningPlayer === s.me;
  return won ? "win" : "lose";
}

/* =========================================================
   PANTALLA COMPLETA / HORIZONTAL
========================================================= */
$("landscape").onclick = async () => {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
    toast("Modo horizontal activado.");
  } catch {
    toast("Gira el teléfono para jugar en horizontal.");
  }
};

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state && state.phase !== "lobby") { renderBoard(); renderHand(); }
  }, 80);
});
window.addEventListener("orientationchange", () => {
  setTimeout(() => { if (state && state.phase !== "lobby") { renderBoard(); renderHand(); } }, 250);
});


/* =========================================================
   APARIENCIA COMPARTIDA
   La foto de fondo y los sonidos de ganar/perder los define el
   administrador en el servidor; todos los jugadores los reciben.
========================================================= */
let theme = { bg: null, win: null, lose: null, pass: null, capicua: null, winImg: null, loseImg: null, dim: 35, when: "hand" };
const soundBuffers = {};   // kind -> { url, buffer }
let adminPass = "";        // solo en memoria, para subir archivos

function applyTheme(t) {
  const prev = theme;
  theme = t;
  const table = $("table");
  if (t.bg) {
    table.style.setProperty("--table-bg", `url("${t.bg}")`);
    table.classList.add("has-bg");
  } else {
    table.style.removeProperty("--table-bg");
    table.classList.remove("has-bg");
  }
  table.style.setProperty("--dim", String(t.dim / 100));
  ["win", "lose", "pass", "capicua"].forEach(k => {
    if (prev[k] !== t[k]) delete soundBuffers[k];
  });
  preloadSounds();
  renderAdminTheme();
  // si la ventana de resultado está abierta, que refleje la imagen nueva
  if (state && !$("modal").classList.contains("hidden") && (state.phase === "hand-result" || state.phase === "finished")) showResult();
}
socket.on("theme", applyTheme);

async function soundBuffer(kind) {
  const url = theme[kind];
  const ctx = audio();
  if (!url || !ctx) return null;
  const cached = soundBuffers[kind];
  if (cached && cached.url === url) return cached.buffer;
  const res = await fetch(url);
  if (!res.ok) throw new Error("audio no disponible");
  const data = await res.arrayBuffer();
  const buffer = await new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
  soundBuffers[kind] = { url, buffer };
  return buffer;
}

// Descarga y prepara los sonidos antes de necesitarlos (así suenan al instante).
function preloadSounds() {
  if (!soundOn || !ac) return;
  ["win", "lose", "pass", "capicua"].forEach(k => { if (theme[k]) soundBuffer(k).catch(() => {}); });
}
document.addEventListener("pointerdown", () => { audio(); preloadSounds(); }, { once: true });

// true si hay un sonido definido para ese resultado (y lo reproduce)
function playCustom(kind) {
  if (!soundOn || !theme[kind]) return false;
  soundBuffer(kind).then(buf => {
    const ctx = audio();
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    try { src.stop(ctx.currentTime + 12); } catch {}
  }).catch(() => {});
  return true;
}

/* ---- panel del administrador: cambiar la apariencia ---- */
const THEME_ROWS = [
  { kind: "bg",      label: "Foto de fondo de la mesa",          image: true, max: 1600 },
  { kind: "winImg",  label: "Imagen para los ganadores",         image: true, max: 900 },
  { kind: "loseImg", label: "Imagen para los perdedores",        image: true, max: 900 },
  { kind: "win",     label: "Sonido cuando un equipo gana",      sfx: "win" },
  { kind: "lose",    label: "Sonido cuando un equipo pierde",    sfx: "lock" },
  { kind: "pass",    label: "Sonido cuando alguien pasa",        sfx: "pass" },
  { kind: "capicua", label: "Sonido de capicúa",                 sfx: "capicua" }
];

async function fileToResizedBlob(file, max = 1600) {
  if (file.type === "image/gif" && file.size <= 3 * 1024 * 1024) return file; // conserva la animación
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, "image/jpeg", 0.84));
}

async function uploadTheme(kind, blob, name) {
  const res = await fetch(`/api/admin/theme/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "x-admin-password": adminPass,
      "x-file-name": encodeURIComponent(name || kind)
    },
    body: blob
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo subir.");
}

const MAX_SOUND_BYTES = 6 * 1024 * 1024;

function sourceLabel(kind) {
  const src = theme[kind + "Source"];
  if (src === "panel") {
    const n = theme[kind + "Name"];
    return `Subido: ${n ? n : "archivo"}`;
  }
  if (src === "archivo") return "Archivo fijo de public/theme/";
  return THEME_ROWS.find(r => r.kind === kind).image ? "Sin imagen" : "Sonido por defecto";
}

function renderAdminTheme() {
  const box = $("themeRows");
  if (!box) return;
  box.innerHTML = THEME_ROWS.map(r => `
    <div class="theme-row" data-kind="${r.kind}">
      <div class="setting-title">${r.label}</div>
      ${r.image ? `<div class="bg-preview" style="${theme[r.kind] ? `background-image:url('${theme[r.kind]}')` : ""}">${theme[r.kind] ? "" : "Sin imagen"}</div>` : ""}
      <div class="admin-row">
        <label class="file-btn">${r.image ? "Elegir imagen" : "Elegir sonido"}<input type="file" accept="${r.image ? "image/*" : "audio/*"}" hidden data-upload></label>
        ${r.image ? "" : '<button data-test>▶ Probar</button>'}
        <button data-clear ${theme[r.kind + "Source"] === "panel" ? "" : "disabled"}>Quitar</button>
      </div>
      <small class="file-name">${esc(sourceLabel(r.kind))}</small>
    </div>`).join("");

  box.querySelectorAll(".theme-row").forEach(row => {
    const cfg = THEME_ROWS.find(r => r.kind === row.dataset.kind);
    row.querySelector("[data-upload]").onchange = e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) themeUpload(cfg, f);
    };
    row.querySelector("[data-clear]").onclick = () => socket.emit("admin-theme-clear", { kind: cfg.kind });
    const test = row.querySelector("[data-test]");
    if (test) test.onclick = () => { audio(); if (!playCustom(cfg.kind)) sfx[cfg.sfx](); };
  });

  $("bgDim").value = theme.dim;
  $("bgDimVal").textContent = theme.dim + "%";
  document.querySelectorAll("[data-when]").forEach(b => {
    b.classList.toggle("selected", b.dataset.when === theme.when);
  });
  $("themeNote").textContent =
    "Lo que subas aquí se guarda en el servidor. En Render gratis se borra al reiniciar; para dejarlo fijo, ponlo en public/theme/ (ver LEEME.txt).";
}

async function themeUpload(cfg, file) {
  try {
    if (!adminPass) { toast("Vuelve a entrar como administrador."); return; }
    let blob = file;
    if (cfg.image) {
      if (!file.type.startsWith("image/")) { toast("Elige una imagen."); return; }
      blob = await fileToResizedBlob(file, cfg.max);
    } else {
      if (!file.type.startsWith("audio/")) { toast("Elige un archivo de audio."); return; }
      if (file.size > MAX_SOUND_BYTES) { toast("El audio pesa demasiado (máx. 6 MB)."); return; }
      const ctx = audio() || new (window.AudioContext || window.webkitAudioContext)();
      await new Promise((ok, fail) => file.arrayBuffer().then(d => ctx.decodeAudioData(d, ok, fail)));
    }
    await uploadTheme(cfg.kind, blob, file.name);
    toast("Guardado: ahora lo ven y oyen todos.");
  } catch (e) {
    toast(e && e.message && !/decode|Unable/i.test(e.message) ? e.message : "Ese archivo no se puede usar en este navegador.");
  }
}

$("bgDim").oninput = e => { $("bgDimVal").textContent = e.target.value + "%"; $("table").style.setProperty("--dim", String(e.target.value / 100)); };
$("bgDim").onchange = e => socket.emit("admin-theme-set", { dim: Number(e.target.value) });
document.querySelectorAll("[data-when]").forEach(b => {
  b.onclick = () => socket.emit("admin-theme-set", { when: b.dataset.when });
});

/* =========================================================
   ADMINISTRADOR
========================================================= */
function openAdmin() { $("adminModal").classList.remove("hidden"); if (admin) socket.emit("admin-refresh"); }
$("adminBtn").onclick = openAdmin;
$("gameAdmin").onclick = openAdmin;
$("closeAdmin").onclick = () => $("adminModal").classList.add("hidden");
$("adminLoginBtn").onclick = () => {
  adminPass = $("adminPassword").value;
  socket.emit("admin-auth", { password: adminPass });
};
$("adminPassword").addEventListener("keydown", e => { if (e.key === "Enter") $("adminLoginBtn").click(); });

socket.on("admin-auth-result", r => {
  if (!r.ok) { adminPass = ""; toast(r.message || "Contraseña incorrecta."); return; }
  admin = true;
  $("adminPassword").value = "";
  $("adminLogin").classList.add("hidden");
  $("adminPanel").classList.remove("hidden");
});

socket.on("admin-rooms", rooms => renderAdmin(rooms));

function adminSend(code, action, value) {
  socket.emit("admin-change", { code, action, value });
}

function renderAdmin(rooms) {
  const box = $("adminRooms");
  if (!rooms.length) { box.innerHTML = "<p>No hay salas activas.</p>"; return; }
  const phases = { lobby: "en sala", "starter-choice": "eligiendo salida", playing: "jugando", "hand-result": "resultado", finished: "terminada" };

  box.innerHTML = rooms.map(r => {
    const lobby = r.phase === "lobby";
    const inGame = !lobby;
    const team = r.mode === "team";

    const players = r.players.map(p => `
      <div class="admin-player" data-id="${p.id}">
        <span class="nm">${esc(p.name)}${p.host ? " 👑" : ""}${p.left ? " (salió)" : ""}</span>
        <span>${p.connected ? "🟢" : "⚪"}</span>
        ${team && lobby ? `<button data-act="team" data-v="${p.team ? 0 : 1}">→ ${p.team ? "A" : "B"}</button>` : team ? `<span class="muted">Eq. ${p.team ? "B" : "A"}</span>` : ""}
        <button data-act="rename">Nombre</button>
        <button data-act="host">👑</button>
        ${lobby ? '<button data-act="move" data-v="spectators">👁</button>' : ""}
        <button data-act="kick" class="danger">✕</button>
      </div>`).join("");

    const specs = r.spectators.map(p => `
      <div class="admin-player" data-id="${p.id}">
        <span class="nm">👁 ${esc(p.name)}${p.host ? " 👑" : ""}</span>
        <span>${p.connected ? "🟢" : "⚪"}</span>
        <button data-act="rename">Nombre</button>
        <button data-act="host">👑</button>
        ${lobby ? '<button data-act="move" data-v="players">🎲 Jugador</button>' : ""}
        <button data-act="kick" class="danger">✕</button>
      </div>`).join("");

    const scoreLabels = team ? ["Equipo A", "Equipo B"] : r.players.map(p => p.name);
    const scoreBtns = r.scores.map((s, i) =>
      `<button data-act="score" data-i="${i}" data-label="${esc(scoreLabels[i] || "")}">${esc(scoreLabels[i] || "")}: ${s} ✎</button>`).join("");

    return `
      <div class="admin-room" data-code="${r.code}">
        <h3>Sala ${r.code}<span>${phases[r.phase] || r.phase}${r.handNumber ? ` · mano ${r.handNumber}` : ""}</span></h3>
        <div class="admin-row">
          <button data-act="watch" class="primary-mini">👁 Ver partida (todas las manos)</button>
        </div>
        <div class="admin-row">
          <button data-act="mode" data-v="team" class="${team ? "on" : ""}" ${lobby ? "" : "disabled"}>Equipos</button>
          <button data-act="mode" data-v="individual" class="${!team ? "on" : ""}" ${lobby ? "" : "disabled"}>Individual</button>
          <button data-act="variant" data-v="6" class="${r.variant === 6 ? "on" : ""}" ${lobby ? "" : "disabled"}>Doble-6</button>
          <button data-act="variant" data-v="9" class="${r.variant === 9 ? "on" : ""}" ${lobby ? "" : "disabled"}>Doble-9</button>
          <button data-act="capicua" class="${r.capicua ? "on" : ""}" ${lobby ? "" : "disabled"}>Capicúa: ${r.capicua ? "sí" : "no"}</button>
        </div>
        <div class="admin-sub">Jugadores</div>
        ${players || '<div class="muted">—</div>'}
        <div class="admin-sub">Espectadores</div>
        ${specs || '<div class="muted">—</div>'}
        <div class="admin-sub">Marcador</div>
        <div class="admin-row">${scoreBtns}</div>
        <div class="admin-sub">Control de la partida</div>
        <div class="admin-row">
          <button data-act="start" ${lobby ? "" : "disabled"}>▶ Iniciar</button>
          <button data-act="restart" ${inGame ? "" : "disabled"}>↻ Reiniciar partida</button>
          <button data-act="next-hand" ${r.phase === "hand-result" ? "" : "disabled"}>⏭ Siguiente mano</button>
          <button data-act="auto" ${r.phase === "playing" || r.phase === "starter-choice" ? "" : "disabled"}>🤖 Jugada auto</button>
          <button data-act="lobby" ${inGame ? "" : "disabled"}>↩ Volver a la sala</button>
          <button data-act="close" class="danger">Cerrar sala</button>
        </div>
      </div>`;
  }).join("");

  box.querySelectorAll("button[data-act]").forEach(b => {
    b.onclick = () => {
      const code = b.closest(".admin-room").dataset.code;
      const act = b.dataset.act;
      const row = b.closest(".admin-player");
      const id = row && row.dataset.id;
      switch (act) {
        case "mode": case "variant": adminSend(code, act, b.dataset.v); break;
        case "capicua": adminSend(code, "capicua", !b.classList.contains("on")); break;
        case "start": case "restart": case "next-hand": case "auto": case "lobby": adminSend(code, act); break;
        case "team": adminSend(code, "team", { id, team: Number(b.dataset.v) }); break;
        case "host": adminSend(code, "host", { id }); break;
        case "move": adminSend(code, "move", { id, to: b.dataset.v }); break;
        case "kick": if (confirm("¿Sacar a esta persona de la sala?")) adminSend(code, "kick", { id }); break;
        case "rename": {
          const name = prompt("Nuevo nombre:");
          if (name) adminSend(code, "rename", { id, name });
          break;
        }
        case "score": {
          const val = prompt(`Puntos de ${b.dataset.label}:`);
          if (val !== null && val.trim() !== "" && !isNaN(Number(val))) {
            adminSend(code, "score", { index: Number(b.dataset.i), value: Number(val) });
          }
          break;
        }
        case "close": if (confirm(`¿Cerrar la sala ${code}?`)) adminSend(code, "close"); break;
        case "watch":
          watching = true;
          $("adminModal").classList.add("hidden");
          socket.emit("admin-watch", { code });
          break;
      }
    };
  });
}

/* ---------- arranque ---------- */
if (session && session.room && session.token) {
  $("homeStatus").textContent = "Reconectando a tu sala…";
}
