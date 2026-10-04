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
function me() { return state && state.players.find(p => p.id === state.me); }
function myHand() { return (state && state.hands[state.me]) || []; }
function amHost() { const m = me(); return !!(m && m.host); }

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
  lock() { tone(150, 0.3, "square", 0.08); tone(110, 0.35, "square", 0.08, 0.2); }
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
});

socket.on("notice", message => {
  toast(message);
  if (/pasó/.test(message)) sfx.pass();
});

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
socket.on("state", s => {
  const old = state;
  state = s;
  $("homeStatus").textContent = "";

  if (!old || old.code !== s.code) resetClientTracking();

  render();
  playSounds(old, s);
  prevBoardLen = s.board.length;
  prevTurn = s.turn;
  prevPhase = s.phase;
});

function playSounds(old, s) {
  if (!old) return;
  if (s.board.length > prevBoardLen && s.phase !== "lobby") sfx.place();
  if (s.phase === "playing" && s.turn === s.me && prevTurn !== s.me) {
    sfx.turn();
    try { navigator.vibrate && navigator.vibrate(35); } catch {}
  }
  if (s.phase === "starter-choice" && prevPhase !== "starter-choice" && s.starterPlayer === s.me) sfx.turn();
  if (prevPhase !== s.phase && s.lastResult) {
    if (s.phase === "finished") sfx.win();
    else if (s.phase === "hand-result") (s.lastResult.reason === "sin-fichas" ? sfx.hand : sfx.lock)();
  }
}

function render() {
  if (!state) return;
  $("lcode").textContent = state.code;
  $("gcode").textContent = state.code;

  if (state.phase === "lobby") {
    closeModals();
    renderLobby();
    screen("lobby");
    return;
  }
  screen("game");
  renderScore();
  renderStatus();
  renderSeats();
  renderBoard();
  renderHand();
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
  const mine = me();
  $("count").textContent = `${state.players.length}/4`;

  $("players").innerHTML = state.players.map((p, i) => {
    const isMe = p.id === state.me;
    const sub = team ? teamLabel(p.team) : "Individual";
    const teamBtn = team && isMe
      ? `<button class="team-btn ${p.team ? "b" : "a"}" data-switch="${p.team ? 0 : 1}">Cambiar a ${p.team ? "A" : "B"}</button>`
      : "";
    return `
      <div class="player">
        <div class="avatar ${avatarClass(p, i)}">${esc(initial(p.name))}</div>
        <div>
          <b>${esc(p.name)}${isMe ? " (tú)" : ""}${p.host ? " 👑" : ""}</b>
          <small><span class="dot ${p.connected ? "on" : ""}"></span>${esc(sub)} · ${p.connected ? "Conectado" : "Desconectado"}</small>
        </div>
        ${teamBtn}
      </div>`;
  }).join("");

  $("players").querySelectorAll("[data-switch]").forEach(b => {
    b.onclick = () => socket.emit("set-team", { team: Number(b.dataset.switch) });
  });

  const host = amHost();
  document.querySelectorAll("[data-v]").forEach(b => {
    b.classList.toggle("selected", Number(b.dataset.v) === state.variant);
    b.disabled = !host;
  });
  document.querySelectorAll("[data-mode]").forEach(b => {
    b.classList.toggle("selected", b.dataset.mode === state.mode);
    b.disabled = !host;
  });
  $("cfgHint").textContent = host ? "" : "Solo el anfitrión puede cambiarla";

  const n = state.players.length;
  const t0 = state.players.filter(p => p.team === 0).length;
  const t1 = n - t0;
  let hint = "";
  let ok = host && n >= 2;
  if (!host) hint = "Esperando a que el anfitrión comience la partida…";
  else if (n < 2) hint = "Comparte el código: se necesitan al menos 2 jugadores.";
  else if (team && (!t0 || !t1 || Math.abs(t0 - t1) > 1)) {
    ok = false;
    hint = "Equipos desparejos: usa «Cambiar» para dejarlos 2 contra 2.";
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
  if (!confirm("¿Quieres salir de esta sala?")) return;
  socket.emit("leave-room");
  clearSession();
  session = null;
  state = null;
  resetClientTracking();
  closeModals();
  screen("home");
  toast("Has salido de la sala.");
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
    if (state.starterPlayer === state.me) { text = "Sales tú: elige cualquier ficha"; mine = true; }
    else text = `${name(state.starterPlayer)} sale: está eligiendo su ficha`;
  } else if (state.phase === "playing") {
    if (state.turn === state.me) { text = "Tu turno"; mine = true; }
    else text = `Turno de ${name(state.turn)}`;
  } else {
    text = "Mano terminada";
  }
  el.textContent = text;
  el.classList.toggle("mine", mine);
  $("handbar").classList.toggle("myturn", mine);
}

/* =========================================================
   JUGADORES ALREDEDOR DE LA MESA
   Tú abajo · siguiente a tu derecha · anterior a tu izquierda ·
   compañero (opuesto) arriba.
========================================================= */
function relativeSeats() {
  const list = state.players;
  const i = list.findIndex(p => p.id === state.me);
  if (i < 0) return {};
  const n = list.length;
  const at = k => list[(i + k + n) % n];
  if (n === 2) return { top: at(1) };
  if (n === 3) return { right: at(1), left: at(2) };
  return { right: at(1), top: at(2), left: at(3) };
}

function seatHTML(p, pos) {
  if (!p) return "";
  const active = state.turn === p.id && state.phase === "playing";
  const count = (state.hands[p.id] && state.hands[p.id].count) ?? 0;
  const idx = playerIndex(p.id);
  const picking = state.phase === "starter-choice" && state.starterPlayer === p.id;
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
  $("seats").innerHTML = seatHTML(s.left, "left") + seatHTML(s.top, "top") + seatHTML(s.right, "right");

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
function fits(tile, side) {
  if (!state.board.length) return false;
  const v = side === "left" ? state.board[0].left : state.board[state.board.length - 1].right;
  return tile.a === v || tile.b === v;
}

function renderHand() {
  const hand = myHand();
  $("hc").textContent = `${hand.length} ${hand.length === 1 ? "ficha" : "fichas"}`;

  const choosing = state.phase === "starter-choice" && state.starterPlayer === state.me;
  const myTurn = state.phase === "playing" && state.turn === state.me;

  const bar = $("handbar").clientWidth || window.innerWidth;
  const n = Math.max(hand.length, 7);
  const byWidth = Math.floor((bar - 12 - (n - 1) * 4) / n);
  const byHeight = Math.floor(Math.max(56, Math.min(120, window.innerHeight * 0.17)) / 2);
  const tw = Math.max(24, Math.min(56, byWidth, byHeight));
  $("hand").style.setProperty("--tw", tw + "px");

  $("hand").innerHTML = hand.map(t => {
    const ok = choosing || (myTurn && (fits(t, "left") || fits(t, "right")));
    const cls = ok ? "playable" : myTurn ? "dim" : "";
    return `<button class="hand-tile ${cls}" data-id="${t.id}" ${ok ? "" : "disabled"} aria-label="Ficha ${t.a}-${t.b}">${tileHTML(t.a, t.b)}</button>`;
  }).join("");

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

  const iWon = r.reason !== "empate-tranca" &&
    (team ? m && m.team === r.winningTeam : r.winningPlayer === state.me);

  $("icon").textContent = finished ? (iWon ? "🏆" : "🎖️") : r.reason === "empate-tranca" ? "🤝" : "🎲";
  $("mtitle").textContent = r.reason === "empate-tranca"
    ? "Tranca empatada"
    : finished ? `${winnerName} gana la partida` : `${winnerName} gana la mano`;

  $("mtext").textContent =
    r.reason === "trancada" ? `Tranca: ${r.detail}.`
    : r.reason === "empate-tranca" ? `Empate en la menor suma (${r.lowest}) entre ${r.detail}. Nadie suma puntos: se juega otra mano.`
    : `${r.detail}.`;

  $("mscore").textContent = r.reason === "empate-tranca" ? "Sin puntos" : `+${r.awarded} puntos`;

  const labels = team ? ["Equipo A", "Equipo B"] : state.players.map(p => p.name);
  $("mtotals").innerHTML = r.scores.map((s, i) => `<span>${esc(labels[i] || "")}: <b>${s}</b></span>`).join("");

  $("mhands").innerHTML = (r.reveal || []).map(h => {
    const won = r.reason !== "empate-tranca" && h.id === r.winningPlayer;
    const tiles = h.tiles.length
      ? h.tiles.map(t => `<span class="mt">${tileHTML(t.a, t.b)}</span>`).join("")
      : '<span class="none">Se quedó sin fichas</span>';
    return `<div class="mh${won ? " winner" : ""}"><div class="who">${esc(h.name)}<small>${h.value} pts</small></div><div class="tiles">${tiles}</div></div>`;
  }).join("");

  $("next").classList.toggle("hidden", finished);
  $("again").classList.toggle("hidden", !finished);
  $("modal").classList.remove("hidden");
}

$("next").onclick = () => socket.emit("next-hand");
$("again").onclick = () => socket.emit("new-match");

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
   ADMINISTRADOR
========================================================= */
function openAdmin() { $("adminModal").classList.remove("hidden"); if (admin) socket.emit("admin-refresh"); }
$("adminBtn").onclick = openAdmin;
$("gameAdmin").onclick = openAdmin;
$("closeAdmin").onclick = () => $("adminModal").classList.add("hidden");
$("adminLoginBtn").onclick = () => socket.emit("admin-auth", { password: $("adminPassword").value });
$("adminPassword").addEventListener("keydown", e => { if (e.key === "Enter") $("adminLoginBtn").click(); });

socket.on("admin-auth-result", r => {
  if (!r.ok) { toast(r.message || "Contraseña incorrecta."); return; }
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
  if (!rooms.length) { box.innerHTML = '<p>No hay salas activas.</p>'; return; }
  const phases = { lobby: "en sala", "starter-choice": "eligiendo salida", playing: "jugando", "hand-result": "resultado", finished: "terminada" };
  box.innerHTML = rooms.map(r => {
    const lobby = r.phase === "lobby";
    const players = r.players.map(p => `
      <div class="admin-player" data-code="${r.code}" data-id="${p.id}">
        <span class="nm">${esc(p.name)}${p.host ? " 👑" : ""}${p.left ? " (salió)" : ""}</span>
        <span>${p.connected ? "🟢" : "⚪"}</span>
        ${r.mode === "team" ? `<button data-act="team" data-v="${p.team ? 0 : 1}">Equipo ${p.team ? "B" : "A"}</button>` : ""}
        <button data-act="rename">Nombre</button>
        <button data-act="host">Anfitrión</button>
      </div>`).join("");
    return `
      <div class="admin-room" data-code="${r.code}">
        <h3>Sala ${r.code}<span>${phases[r.phase] || r.phase} · ${r.scores.join(" / ")}</span></h3>
        <div class="admin-row">
          <button data-act="mode" data-v="team" class="${r.mode === "team" ? "on" : ""}" ${lobby ? "" : "disabled"}>Equipos</button>
          <button data-act="mode" data-v="individual" class="${r.mode === "individual" ? "on" : ""}" ${lobby ? "" : "disabled"}>Individual</button>
          <button data-act="variant" data-v="6" class="${r.variant === 6 ? "on" : ""}" ${lobby ? "" : "disabled"}>Doble-6</button>
          <button data-act="variant" data-v="9" class="${r.variant === 9 ? "on" : ""}" ${lobby ? "" : "disabled"}>Doble-9</button>
        </div>
        ${players}
        <div class="admin-row">
          <button data-act="start" ${lobby ? "" : "disabled"}>Iniciar partida</button>
          <button data-act="close" class="danger">Cerrar sala</button>
        </div>
      </div>`;
  }).join("");

  box.querySelectorAll("button[data-act]").forEach(b => {
    b.onclick = () => {
      const roomEl = b.closest(".admin-room");
      const code = roomEl.dataset.code;
      const act = b.dataset.act;
      const row = b.closest(".admin-player");
      if (act === "mode" || act === "variant") adminSend(code, act, b.dataset.v);
      else if (act === "start") adminSend(code, "start");
      else if (act === "close") { if (confirm(`¿Cerrar la sala ${code}?`)) adminSend(code, "close"); }
      else if (act === "team") adminSend(code, "team", { id: row.dataset.id, team: Number(b.dataset.v) });
      else if (act === "host") adminSend(code, "host", { id: row.dataset.id });
      else if (act === "rename") {
        const name = prompt("Nuevo nombre:");
        if (name) adminSend(code, "rename", { id: row.dataset.id, name });
      }
    };
  });
}

/* ---------- arranque ---------- */
if (session && session.room && session.token) {
  $("homeStatus").textContent = "Reconectando a tu sala…";
}
