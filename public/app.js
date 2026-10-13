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
  if (id !== "game" && document.body.classList.contains("immersive")) setImmersive(false);
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
   MI AVATAR: color de la camisa y tono de piel
========================================================= */
const AV_COLORS = ["#38bdf8", "#fb7185", "#a3e635", "#fbbf24", "#a855f7", "#f97316", "#22c55e", "#ef4444", "#14b8a6", "#e5e7eb", "#1f2937", "#ec4899"];
const AV_SKINS = ["#f6d9c3", "#f1c9a5", "#e0ac82", "#c68642", "#8d5524", "#5a3825"];
const AV_KEYS = ["color", "skin", "hairColor", "hair", "hat", "glasses", "beard", "extra"];
const emptyAvatar = () => ({ color: null, skin: null, hairColor: null, hair: null, hat: null, glasses: null, beard: null, extra: null });
let myAvatar = emptyAvatar();
try { const s = JSON.parse(localStorage.getItem("dominoAvatar")); if (s) AV_KEYS.forEach(k => { if (s[k] !== undefined) myAvatar[k] = s[k]; }); } catch {}
const AV_HAIRCOLORS = ["#16110d", "#3d2312", "#6f4a24", "#a07a3c", "#d6b25f", "#8a3b1c", "#9b9b9b", "#f1f1f1"];
const AV_OPTS = [
  { k: "hair", label: "Peinado", opts: ["Calvo", "Corto", "Largo", "Afro", "Pelado", "Moño"] },
  { k: "hat", label: "Gorra o sombrero", opts: ["Ninguno", "Gorra", "Sombrero de paja", "Boina", "Panamá"] },
  { k: "glasses", label: "Lentes", opts: ["Ninguno", "Redondos", "De sol"] },
  { k: "beard", label: "Barba", opts: ["Ninguna", "Bigote", "Candado", "Completa"] },
  { k: "extra", label: "Accesorio", opts: ["Ninguno", "Tabaco 🚬", "Cadena dorada", "Aretes"] }
];

function saveAvatar() {
  try { localStorage.setItem("dominoAvatar", JSON.stringify(myAvatar)); } catch {}
  if (state && state.me) socket.emit("set-avatar", myAvatar);   // los demás me ven al instante
}

function avatarStyle(p) {
  return p && p.avatar && p.avatar.color ? `style="background:${p.avatar.color};color:#0b1220"` : "";
}

function renderAvatarModal() {
  $("avColors").innerHTML = AV_COLORS.map(c => `<button class="sw${myAvatar.color === c ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("");
  $("avSkins").innerHTML = AV_SKINS.map(c => `<button class="sw${myAvatar.skin === c ? " on" : ""}" data-s="${c}" style="background:${c}" aria-label="Piel ${c}"></button>`).join("");
  $("avHairColors").innerHTML = AV_HAIRCOLORS.map(c => `<button class="sw${myAvatar.hairColor === c ? " on" : ""}" data-h="${c}" style="background:${c}" aria-label="Pelo ${c}"></button>`).join("");
  $("avOpts").innerHTML = AV_OPTS.map(o =>
    `<div class="setting-title">${o.label}</div><div class="chips">` +
    `<button class="chip-btn${myAvatar[o.k] == null ? " on" : ""}" data-k="${o.k}" data-i="auto">🎲 Auto</button>` +
    o.opts.map((t, i) => `<button class="chip-btn${myAvatar[o.k] === i ? " on" : ""}" data-k="${o.k}" data-i="${i}">${t}</button>`).join("") +
    `</div>`).join("");
  $("avPreview").innerHTML = `<div class="avp-head" style="background:${myAvatar.skin || "#e0ac82"}"></div><div class="avp-body" style="background:${myAvatar.color || "#38bdf8"}"></div>`;
  const parts = AV_OPTS.filter(o => myAvatar[o.k] != null).map(o => `${o.label}: ${o.opts[myAvatar[o.k]]}`);
  $("avSummary").textContent = parts.length ? parts.join(" · ") : "Todo en automático: la mesa te asigna un look.";
  $("avColors").querySelectorAll("[data-c]").forEach(b => { b.onclick = () => { myAvatar.color = b.dataset.c; saveAvatar(); renderAvatarModal(); }; });
  $("avSkins").querySelectorAll("[data-s]").forEach(b => { b.onclick = () => { myAvatar.skin = b.dataset.s; saveAvatar(); renderAvatarModal(); }; });
  $("avHairColors").querySelectorAll("[data-h]").forEach(b => { b.onclick = () => { myAvatar.hairColor = b.dataset.h; saveAvatar(); renderAvatarModal(); }; });
  $("avOpts").querySelectorAll("[data-k]").forEach(b => {
    b.onclick = () => { myAvatar[b.dataset.k] = b.dataset.i === "auto" ? null : Number(b.dataset.i); saveAvatar(); renderAvatarModal(); };
  });
}
function openAvatar() { renderAvatarModal(); $("avatarModal").classList.remove("hidden"); }
$("avatarBtn").onclick = openAvatar;
$("lobbyAvatar").onclick = openAvatar;
$("avClose").onclick = $("avDone").onclick = () => $("avatarModal").classList.add("hidden");
$("avReset").onclick = () => { myAvatar = emptyAvatar(); saveAvatar(); renderAvatarModal(); };

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
  tick() { tone(880, 0.05, "square", 0.06); },
  bt() { tone(659, 0.12, "sine", 0.12); tone(880, 0.12, "sine", 0.12, 0.13); tone(1319, 0.22, "sine", 0.12, 0.26); },
  coin() { tone(1568, 0.07, "triangle", 0.1); tone(2093, 0.14, "triangle", 0.1, 0.06); },
  glug() { [0, 0.16, 0.34, 0.5].forEach((d, i) => tone(190 - i * 22, 0.11, "sine", 0.16, d)); tone(95, 0.3, "triangle", 0.1, 0.55); },
  pour() {
    const a = audio();
    if (!a) return;
    const n = a.createBuffer(1, Math.floor(a.sampleRate * 1.1), a.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.4 + 0.6 * Math.sin(i / 380)) * Math.min(1, i / 2000) * Math.min(1, (d.length - i) / 4000);
    const s = a.createBufferSource(); s.buffer = n;
    const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1700; f.Q.value = 0.7;
    const g = a.createGain(); g.gain.value = 0.22;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start();
  },
  slam() {
    tone(78, 0.4, "sine", 0.4); tone(48, 0.5, "triangle", 0.32, 0.015);
    const a = audio();
    if (!a) return;
    const n = a.createBuffer(1, Math.floor(a.sampleRate * 0.16), a.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = a.createBufferSource(); s.buffer = n;
    const g = a.createGain(); g.gain.value = 0.35;
    s.connect(g); g.connect(a.destination); s.start();
  }
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
  socket.emit("create-room", { name, avatar: myAvatar });
};
$("toggleJoin").onclick = () => $("joinBox").classList.toggle("hidden");
$("code").oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
$("join").onclick = () => {
  const name = readName();
  if (!name) return;
  const code = $("code").value.trim().toUpperCase();
  if (code.length < 5) { toast("El código tiene 5 letras o números."); return; }
  audio();
  socket.emit("join-room", { name, code, avatar: myAvatar });
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
  } else if (ev.type === "drink" || ev.type === "pour") {
    const seat = seatMap()[ev.id];
    if (t3d && t3d.mode === "fp" && seat) t3d.startAct(ev.type, seat);
    else {
      toast(ev.type === "drink" ? `🥃 ${ev.name} bebe` : `🍾 ${ev.name} se sirve`);
      (ev.type === "drink" ? sfx.glug : sfx.pour)();
    }
  } else if (ev.type === "coin") {
    const seat = seatMap()[ev.id];
    if (t3d && t3d.mode === "fp" && seat) t3d.startCoin(seat);
    sfx.coin();
    toast(`🪙 ${ev.name} puso su CUC`);
  } else if (ev.type === "music") {
    if (!ev.announce) toast(`🎵 ${ev.name} puso «${ev.title}»`);
  } else if (ev.type === "music-stop") {
    toast(`⏹ ${ev.name} apagó la bocina`);
  } else if (ev.type === "refill") {
    toast("🍾 ¡Colecta completa! La botella vacía se queda y llega una nueva");
    setTimeout(() => sfx.hand(), 900);
  } else if (ev.type === "slam") {
    if (t3d) t3d.slam(ev.tileId); else play2DSlam(ev.name);
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
  updateDebugUI();
  syncMusic();
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
  if (s.board.length > prevBoardLen && s.phase !== "lobby" && !t3d) sfx.place();
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
  if (view3d && !t3d && !t3dLoading) enable3D(false);
  if (t3d && t3d.mode !== effectiveCam()) applyViewMode();
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
        <div class="avatar ${avatarClass(p, i)}" ${avatarStyle(p)}>${esc(initial(p.name))}</div>
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
        <div class="avatar spec" ${avatarStyle(p)}>${esc(initial(p.name))}</div>
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
      <div class="avatar ${avatarClass(p, idx)}" ${avatarStyle(p)}>${esc(initial(p.name))}${online}</div>
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
  // 3D primera persona: los nombres van en una tira ENCIMA de la mesa, nunca sobre ella
  const fpNames = !!(t3d && t3d.mode === "fp");
  $("nameStrip").classList.toggle("hidden", !fpNames);
  $("nameStrip").innerHTML = fpNames ? [s.left, s.top, s.right].map(p => seatHTML(p, "chip")).join("") : "";
  updateCoinButton();
  updateSeats3D();
  if (isViewer()) return;

  const m = me();
  const idx = playerIndex(state.me);
  if (m) {
    $("meSeat").innerHTML = `<div class="avatar ${avatarClass(m, idx)}" ${avatarStyle(m)}>${esc(initial(m.name))}</div>
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
    if (t3d) { syncTable3D(); t3d.setBoard({ board: [], items: [], starterIdx: 0, slots: {}, seatOf: seatFn(), styleOf: styleOf3D }); }
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
  const { lay, u, xmax } = bestLayout(board, starterIdx, W, H, maxU);

  if (t3d) {
    // Vista 3D: mismo tablero, dibujado con perspectiva, brazos y fichas algo corridas.
    syncTable3D();
    let L3 = lay, X3 = xmax;
    if (t3d.mode === "fp") { const b = bestLayout(board, starterIdx, 39, 39, 40); L3 = b.lay; X3 = b.xmax; }
    const L0 = board[0].left, R0 = board[board.length - 1].right;
    const rightSlot = layoutBoard(board.concat([{ id: "__r", left: R0, right: -1 }]), starterIdx, X3).items[board.length];
    const leftSlot = layoutBoard([{ id: "__l", left: -1, right: L0 }].concat(board), starterIdx + 1, X3).items[0];
    t3d.setBoard({ board, items: L3.items, starterIdx, slots: { left: leftSlot, right: rightSlot }, seatOf: seatFn(), styleOf: styleOf3D });
    $("ends").innerHTML = `Extremos <span class="endnum n${L0}">${L0}</span><span class="endnum n${R0}">${R0}</span>`;
    return;
  }

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

  updateSlamButton(myTurn, hand);

  if (t3d && t3d.mode === "fp") {
    // primera persona: tus fichas están en 3D, delante de ti
    t3d.setRack({
      organizing,
      myTurn: myTurn || choosing,
      tiles: hand.map(t => {
        const flipped = !!(handPrefs.flips && handPrefs.flips[t.id]);
        const ok = choosing || (myTurn && (fits(t, "left") || fits(t, "right")));
        return { id: t.id, a: flipped ? t.b : t.a, b: flipped ? t.a : t.b, state: ok ? "playable" : myTurn ? "dim" : "normal" };
      })
    });
    return;
  }

  if (organizing) {
    $("hand").querySelectorAll(".hand-tile").forEach(btn => {
      btn.onpointerdown = e => startDrag(e, btn);
    });
    return;
  }

  if (t3d) {
    $("hand").querySelectorAll(".hand-tile:not(:disabled)").forEach(btn => {
      btn.classList.add("draggable3d");
      btn.onpointerdown = e => {
        const tile = hand.find(t => t.id === btn.dataset.id);
        if (tile) startDrag3D(e, btn, tile, choosing);
      };
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
   VISTA 2D / 3D
   2D: ligera, ahorra datos (por defecto).
   3D: mesa con perspectiva, brazos, fichas algo corridas y
       fichas que se arrastran con tu propio brazo.
   El motor 3D (table3d.js) solo se descarga si se activa.
========================================================= */
let view3d = false;
try { view3d = localStorage.getItem("dominoView") === "3d"; } catch {}
let t3d = null;
let t3dLoading = false;

function numberColors() {
  const cs = getComputedStyle(document.documentElement);
  return Array.from({ length: 10 }, (_, i) => cs.getPropertyValue(`--number-${i}`).trim() || "#64748b");
}

function hexToRgb(hex) {
  let n = parseInt(String(hex || "").replace("#", ""), 16);
  if (!Number.isFinite(n)) n = 0x94a3b8;   // gris por defecto si el color falta o no es válido
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const SKINS = ["#f6d9c3", "#f1c9a5", "#e0ac82", "#c68642", "#8d5524", "#5a3825"];
const TEAM_COLORS = ["#38bdf8", "#fb7185"];
const IND_COLORS = ["#38bdf8", "#fb7185", "#a3e635", "#fbbf24"];

function styleOf3D(ownerId) {
  const idx = state ? state.players.findIndex(p => p.id === ownerId) : -1;
  const p = idx >= 0 ? state.players[idx] : null;
  const team = p && state.mode === "team";
  const auto = !p ? "#94a3b8" : team ? TEAM_COLORS[p.team ? 1 : 0] : IND_COLORS[idx % 4];
  const sleeve = (p && p.avatar && p.avatar.color) || auto;
  let h = 0;
  String(ownerId || "").split("").forEach(ch => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
  const skin = (p && p.avatar && p.avatar.skin) || SKINS[h % SKINS.length];
  const av = (p && p.avatar) || {};
  const ph = (h >>> 6) % 5;   // aspecto automático (el de siempre) cuando el jugador no eligió nada
  const look = { hair: ph === 1 ? 0 : ph === 4 ? 4 : 1, hat: ph === 3 ? 2 : ph === 4 ? 1 : 0, beard: ph === 2 ? 2 : 0 };
  const pick = (v, d) => (v === null || v === undefined ? d : v);
  const HAIR_AUTO = ["#12100d", "#3d2412", "#704c24", "#9e9e9e", "#d6b361"];
  return {
    skin: hexToRgb(skin), sleeve: hexToRgb(sleeve),
    hair: (h >>> 3) % 5, pants: (h >>> 9) % 4,
    hairRGB: hexToRgb(av.hairColor || HAIR_AUTO[(h >>> 3) % 5]),
    hairShape: pick(av.hair, look.hair), hat: pick(av.hat, look.hat), beard: pick(av.beard, look.beard),
    glasses: pick(av.glasses, 0), extra: pick(av.extra, 0),
    band: team ? hexToRgb(TEAM_COLORS[p.team ? 1 : 0]) : null   // gorra o cinta del color del equipo
  };
}

function seatMap() {
  const m = {};
  const rs = relativeSeats();
  Object.keys(rs).forEach(pos => { if (rs[pos]) m[rs[pos].id] = pos; });
  if (!isViewer() && state && state.me) m[state.me] = "bottom";
  return m;
}

function seatFn() { const m = seatMap(); return id => m[id]; }

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("no se pudo cargar " + src));
    document.head.appendChild(s);
  });
}

let camMode = "fp";   // "fp" = primera persona · "top" = vista de mesa
try { camMode = localStorage.getItem("dominoCam") === "top" ? "top" : "fp"; } catch {}
let slamNext = false;

function effectiveCam() { return isViewer() ? "top" : camMode; }
function saveCam() { try { localStorage.setItem("dominoCam", camMode); } catch {} }

function updateViewButtons() {
  $("viewToggle").textContent = !view3d ? "2D" : camMode === "fp" ? "3D 👁" : "3D ▦";
  $("viewToggle").classList.toggle("on3d", view3d);
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("selected", (b.dataset.view === "3d") === view3d));
}

// ajusta la pantalla al modo de cámara (primera persona / mesa)
function applyViewMode() {
  if (!t3d) return;
  const m = effectiveCam();
  t3d.setMode(m);
  const fp = m === "fp";
  $("table").classList.toggle("fp", fp);
  $("gl").style.pointerEvents = fp ? "auto" : "none";
  $("fpTools").classList.toggle("hidden", !fp);
  if (fp) {
    try {
      if (!localStorage.getItem("dominoRackHint")) {
        localStorage.setItem("dominoRackHint", "1");
        toast("Arrastra tus fichas de lado a lado para ordenarlas, tócalas para girarlas y llévalas a la mesa para jugar.");
      }
    } catch {}
  }
  $("handbar").classList.toggle("fp-hand", fp);
  if (state && state.phase !== "lobby") { renderSeats(); renderBoard(); renderHand(true); }
}

function placeSeatBadges(t) {
  return;   // los nombres ya no se pintan sobre la mesa (van en #nameStrip)
  // eslint-disable-next-line no-unreachable
  if (t.mode !== "fp") return;
  document.querySelectorAll("#seats .seat").forEach(el => {
    const pos = ["top", "left", "right"].find(k => el.classList.contains(k));
    if (!pos) return;
    const b = t.seatBadge(pos);
    if (!b) return;
    el.style.display = "";
    el.classList.toggle("edge", !b.vis);   // fuera de pantalla: etiqueta pegada al borde
    el.style.left = b.x + "px";
    el.style.top = b.y + "px";
  });
}

function updateSeats3D() {
  if (!t3d || !state) return;
  const rs = relativeSeats();
  const info = {};
  ["top", "left", "right"].forEach(pos => {
    const p = rs[pos];
    if (!p) return;
    info[pos] = { present: true, count: handCount(p.id), style: styleOf3D(p.id), turn: state.phase === "playing" && state.turn === p.id, cup: p.cup };
  });
  const mine = !isViewer() && state.players.find(p => p.id === state.me);
  if (mine) info.bottom = { present: true, cup: mine.cup, mine: true };   // mi vaso (yo no me dibujo)
  t3d.setSeats(info);
  t3d.setSpeaker(!!state.music);
  t3d.setBottles(state.bottleNo || 0);
  t3d.setPot((state.pot || []).length, state.potNeed || 4);
  t3d.setBottle(state.bottle === undefined ? 1 : state.bottle);
  if (t3d.envCode !== state.code) { t3d.envCode = state.code; t3d.setEnv(state.code); }
}

async function enable3D(userAction) {
  if (t3d || t3dLoading) return;
  if (!(window.Table3D || window.WebGLRenderingContext)) {
    toast("Tu dispositivo no soporta la vista 3D.");
    setView(false);
    return;
  }
  t3dLoading = true;
  try {
    if (userAction) toast("Cargando la vista 3D…");
    if (!window.Table3D) await loadScript("/table3d.js?v=4");
    if (!Table3D.supported()) throw new Error("sin WebGL");
    const canvas = $("gl");
    canvas.classList.remove("hidden");
    $("table").classList.add("view3d");
    t3d = new Table3D(canvas, {
      mode: effectiveCam(),
      numberColors: numberColors(),
      getArea: () => {
        const a = $("boardArea");
        return { x: a.offsetLeft, y: a.offsetTop, w: a.clientWidth, h: a.clientHeight };
      },
      onLand: (id, slam) => { if (!slam) sfx.place(); },
      onAct: kind => { (kind === "drink" ? sfx.glug : sfx.pour)(); },
      onSlam: () => { if (!playCustom("slam")) sfx.slam(); try { navigator.vibrate && navigator.vibrate([60, 40, 90]); } catch {} },
      onFrame: placeSeatBadges,
      myStyle: () => styleOf3D(state && state.me),
      onLost: () => { toast("Se perdió el 3D en este dispositivo: vuelvo a 2D."); setView(false); }
    });
    canvas.addEventListener("pointerdown", onCanvasDown);
    t3d.setTheme(theme.bg, theme.dim / 100);
    applyViewMode();
  } catch (e) {
    $("table").classList.remove("view3d", "fp");
    $("gl").classList.add("hidden");
    $("fpTools").classList.add("hidden");
  $("nameStrip").classList.add("hidden");
    $("handbar").classList.remove("fp-hand");
    t3d = null;
    toast("No se pudo iniciar el 3D en este dispositivo. Sigues en 2D.");
    view3d = false;
    try { localStorage.setItem("dominoView", "2d"); } catch {}
    updateViewButtons();
  } finally {
    t3dLoading = false;
  }
}

function disable3D() {
  if (t3d) { t3d.destroy(); t3d = null; }
  // un canvas con el contexto perdido no se puede reutilizar: se crea uno nuevo
  const old = $("gl");
  const fresh = document.createElement("canvas");
  fresh.id = "gl"; fresh.className = "gl hidden";
  old.replaceWith(fresh);
  $("table").classList.remove("view3d", "fp");
  $("fpTools").classList.add("hidden");
  $("nameStrip").classList.add("hidden");
  $("handbar").classList.remove("fp-hand");
  slamNext = false;
  $("slamBtn").classList.add("hidden");
  if (state && state.phase !== "lobby") { renderSeats(); renderBoard(); renderHand(true); }
}

function setView(to3d, userAction) {
  view3d = !!to3d;
  try { localStorage.setItem("dominoView", view3d ? "3d" : "2d"); } catch {}
  updateViewButtons();
  if (view3d) { if (state && state.phase !== "lobby") enable3D(userAction); }
  else disable3D();
}

// 2D → 3D primera persona → 3D mesa → 2D
function cycleView() {
  if (!view3d) { camMode = "fp"; saveCam(); setView(true, true); }
  else if (camMode === "fp" && !isViewer()) { camMode = "top"; saveCam(); updateViewButtons(); applyViewMode(); }
  else { setView(false); }
}
$("viewToggle").onclick = cycleView;
document.querySelectorAll("[data-view]").forEach(b => {
  b.onclick = () => {
    if (b.dataset.view === "3d") { camMode = "fp"; saveCam(); setView(true, true); }
    else setView(false);
  };
});
updateViewButtons();

$("drinkBtn").onclick = () => { audio(); socket.emit("drink"); };
$("pourBtn").onclick = () => { audio(); socket.emit("pour"); };
$("coinBtn").onclick = () => { audio(); socket.emit("coin"); };

// botón 🪙: cuántos han puesto su CUC (la botella se rellena cuando ponen todos)
function updateCoinButton() {
  const b = $("coinBtn");
  if (!b || !state) return;
  const pot = state.pot || [];
  const paid = pot.includes(state.me);
  b.innerHTML = `🪙<small>${pot.length}/${state.potNeed || 0}</small>`;
  b.classList.toggle("paid", paid);
  b.classList.toggle("dim", !paid && state.bottle > 0.3);
  b.title = paid ? "Ya pusiste tu CUC" : "Colecta: poner 1 CUC para rellenar la botella";
}
$("zoomIn").onclick = () => t3d && t3d.zoomBy(1.25);
$("zoomOut").onclick = () => t3d && t3d.zoomBy(0.8);
$("recenter").onclick = () => t3d && t3d.recenter();

/* ---- azotar la última ficha (solo 3D) ---- */
function updateSlamButton(myTurn, hand) {
  const show = !!t3d && state && state.phase === "playing" && myTurn && hand.length === 1;
  if (!show) slamNext = false;
  const b = $("slamBtn");
  b.classList.toggle("hidden", !show);
  b.classList.toggle("on", slamNext);
  b.setAttribute("aria-pressed", slamNext ? "true" : "false");
  b.textContent = slamNext ? "💥 Azotar: ¡SÍ!" : "💥 Azotar la ficha";
}
$("slamBtn").onclick = () => { slamNext = !slamNext; updateSlamButton(true, [1]); audio(); };
const playPayload = (tile, side) => ({ tileId: tile.id, side, slam: slamNext && myHand().length === 1 });

function play2DSlam(name) {
  toast(`💥 ¡${name} azotó la ficha!`);
  if (!playCustom("slam")) sfx.slam();
  const t = $("table");
  t.classList.remove("shake2d"); void t.offsetWidth; t.classList.add("shake2d");
  setTimeout(() => t.classList.remove("shake2d"), 800);
}

/* ---- primera persona: tocar el lienzo ---- */
function onCanvasDown(e) {
  if (!t3d || t3d.mode !== "fp") return;
  if (e.button !== undefined && e.button !== 0) return;
  audio();
  const hit = isViewer() ? null : t3d.pickRack(e.clientX, e.clientY);
  if (!hit) { t3d.pointerDown(e); return; }
  e.preventDefault();
  const tile = orderedHand(myHand()).find(t => t.id === hit.id);
  if (!tile) return;
  startRackDrag(e, tile);
}

/* Fichas en 3D, sin botón de organizar:
   · arrastrar por el atril (izquierda/derecha) = reordenar,
   · llevarla hasta la mesa = jugarla,
   · tocarla sin mover = girarla (cambiar qué número queda arriba). */
function startRackDrag(e, tile) {
  const choosing = state.phase === "starter-choice" && (state.starterPlayers || []).includes(state.me);
  const myTurn = state.phase === "playing" && state.turn === state.me;
  const playable = choosing || (myTurn && (fits(tile, "left") || fits(tile, "right")));
  const mode = choosing ? "starter" : "play";
  const valid = choosing ? ["center"] : ["left", "right"].filter(s => fits(tile, s));
  const sx = e.clientX, sy = e.clientY;
  let moved = false, playing = false, warned = false;
  const reorder = ev => {
    const idx = t3d.rackIndexAt(ev.clientX);
    const cur = handPrefs.order.indexOf(tile.id);
    if (idx >= 0 && idx !== cur) {
      const rest = handPrefs.order.filter(x => x !== tile.id);
      rest.splice(idx, 0, tile.id);
      handPrefs.order = rest;
      renderHand(true);
    }
  };
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
    moved = true; dragging = true;
    const onTable = t3d.overTable(ev.clientX, ev.clientY);
    if (!playing && onTable) {
      if (playable) { playing = true; t3d.dragBegin(tile, mode, valid); }
      else if (!warned) { warned = true; toast(myTurn ? "Esa ficha no encaja en la mesa." : "Todavía no es tu turno."); }
    }
    if (playing) t3d.dragMove(ev.clientX, ev.clientY, ev.pointerType);
    else reorder(ev);
  };
  const stop = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
  };
  const finish = ev => {
    stop();
    dragging = false;
    if (!moved) {   // un toque: girar la ficha
      handPrefs.flips = handPrefs.flips || {};
      handPrefs.flips[tile.id] = !handPrefs.flips[tile.id];
      saveHandPrefs();
      if (state) renderHand(true);
      return;
    }
    if (playing) {
      const r = t3d.dragMove(ev.clientX, ev.clientY, ev.pointerType);
      if (r.over && r.side) {
        t3d.dragEnd(true);
        if (choosing) socket.emit("choose-starter", { tileId: tile.id });
        else { socket.emit("play-tile", playPayload(tile, r.side)); slamNext = false; }
      } else {
        t3d.dragEnd(false);
        if (r.over) toast("Esa ficha no encaja ahí.");
        else reorder(ev);   // la soltaste de vuelta en el atril: queda ahí
      }
    }
    saveHandPrefs();
    if (state) renderHand(true);
  };
  const cancel = () => { stop(); dragging = false; if (t3d) t3d.dragEnd(false); if (state) renderHand(true); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
}

// la mesa 3D debe tener el tamaño del contenedor (cambia al volver de otra pantalla)
function syncTable3D() {
  const c = $("gl");
  if (!c) return;
  const r = c.getBoundingClientRect();
  if (Math.abs(r.width - (t3d.cssW || 0)) > 1 || Math.abs(r.height - (t3d.cssH || 0)) > 1) t3d.resize();
}

/* ---- arrastrar una ficha de la mano hasta la mesa (3D) ---- */
function startDrag3D(e, btn, tile, starter) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  audio();
  const mode = starter ? "starter" : "play";
  const valid = starter ? ["center"] : ["left", "right"].filter(s => fits(tile, s));
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  let ghost = null;

  const place = (x, y) => { if (ghost) { ghost.style.left = x + "px"; ghost.style.top = y + "px"; } };

  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
    if (!moved) {
      moved = true;
      dragging = true;
      ghost = btn.cloneNode(true);
      ghost.className = "drag-ghost";
      ghost.style.width = btn.offsetWidth + "px";
      ghost.style.height = btn.offsetHeight + "px";
      document.body.appendChild(ghost);
      btn.classList.add("lifted");
      t3d.dragBegin(tile, mode, valid);
    }
    place(ev.clientX, ev.clientY);
    const r = t3d.dragMove(ev.clientX, ev.clientY, ev.pointerType);
    ghost.style.opacity = r.over ? "0" : "1";   // sobre la mesa se ve la ficha en TU mano 3D
  };

  const finish = ev => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
    if (!moved) { toast("Arrastra la ficha hasta la mesa para jugarla."); return; }
    const r = t3d.dragMove(ev.clientX, ev.clientY, ev.pointerType);
    if (ghost) ghost.remove();
    btn.classList.remove("lifted");
    dragging = false;
    if (r.over && r.side) {
      t3d.dragEnd(true);
      if (starter) socket.emit("choose-starter", { tileId: tile.id });
      else { socket.emit("play-tile", playPayload(tile, r.side)); slamNext = false; }
    } else {
      t3d.dragEnd(false);
      if (r.over) toast("Esa ficha no encaja ahí.");
    }
    if (state) renderHand(true);
  };
  const cancel = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
    if (ghost) ghost.remove();
    btn.classList.remove("lifted");
    dragging = false;
    if (t3d) t3d.dragEnd(false);
    if (state) renderHand(true);
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
}

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
  const wait = state.lastResult && state.lastResult.slam ? 3800 : 1300;
  resultTimer = setTimeout(() => {
    if (state && (state.phase === "hand-result" || state.phase === "finished")) showResult();
  }, wait);
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
// Pantalla completa = solo la pantalla de jugar: se esconden marcador, estado, nombres y demás.
function setImmersive(on) {
  document.body.classList.toggle("immersive", on);
  $("immExit").classList.toggle("hidden", !on);
  setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
}

async function exitImmersive() {
  setImmersive(false);
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
  try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch {}
}

$("landscape").onclick = async () => {
  setImmersive(true);   // primero se limpia la pantalla (en iPhone no hay API de pantalla completa)
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
  } catch { /* sin pantalla completa del navegador: queda la pantalla limpia igual */ }
};
$("immExit").onclick = exitImmersive;
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("immersive")) setImmersive(false);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state && state.phase !== "lobby") { if (t3d) t3d.resize(); renderBoard(); renderHand(); }
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
let theme = { bg: null, win: null, lose: null, pass: null, capicua: null, slam: null, winImg: null, loseImg: null, dim: 35, when: "hand" };
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
  ["win", "lose", "pass", "capicua", "slam"].forEach(k => {
    if (prev[k] !== t[k]) delete soundBuffers[k];
  });
  preloadSounds();
  if (t3d && (prev.bg !== t.bg || prev.dim !== t.dim)) t3d.setTheme(t.bg, t.dim / 100);
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
  ["win", "lose", "pass", "capicua", "slam"].forEach(k => { if (theme[k]) soundBuffer(k).catch(() => {}); });
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
  { kind: "capicua", label: "Sonido de capicúa",                 sfx: "capicua" },
  { kind: "slam",    label: "Sonido del azote (ficha contra la mesa)", sfx: "slam" }
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
    return `⚠ Temporal (${n ? n : "archivo"}): se pierde si el servidor se reinicia`;
  }
  if (src === "archivo") return "🔒 Fijo: viene de public/theme/ y no se pierde";
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
    "Lo que subas aquí se guarda en el servidor y en Render gratis se borra al reiniciar (⚠ temporal). Para dejarlo FIJO (🔒), descarga el paquete, copia los archivos a public/theme/ y súbelos a GitHub.";
  $("themePack").disabled = !THEME_ROWS.some(r => theme[r.kind + "Source"] === "panel");
}

$("themePack").onclick = async () => {
  try {
    const res = await fetch("/api/admin/theme-pack", { headers: { "x-admin-password": adminPass } });
    if (!res.ok) {
      let msg = "No se pudo descargar.";
      try { msg = (await res.json()).message || msg; } catch {}
      toast(msg);
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "theme-fijos.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Listo: copia los archivos del zip a public/theme/ y súbelos a GitHub.");
  } catch { toast("No se pudo descargar."); }
};

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


/* =========================================================
   BOCINA: canciones de la carpeta public/music o enlaces de YouTube.
   Suena igual para toda la mesa; el volumen y el silencio son de cada uno.
========================================================= */
const music = { current: null, el: null, yt: null, ytP: null, timer: 0, blockTimer: 0, playing: false, blocked: false, clockOffset: 0, vol: 70, muted: false };
try {
  const sv = localStorage.getItem("dominoVol");
  if (sv !== null && Number.isFinite(Number(sv))) music.vol = Math.max(0, Math.min(100, Number(sv)));
  music.muted = localStorage.getItem("dominoMute") === "1";
} catch {}
const musicVol = () => (music.muted ? 0 : music.vol / 100);
const serverNow = () => Date.now() + music.clockOffset;

function applyMusicVolume() {
  if (music.el) music.el.volume = musicVol();
  if (music.yt && music.yt.setVolume) { try { music.yt.setVolume(musicVol() * 100); } catch {} }
}

// la bocina "se conecta" con su voz de siempre
function announceBluetooth() {
  sfx.bt();
  toast("🔵 The Bluetooth device is connected");
  try {
    if (!music.muted && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance("The Bluetooth device is connected");
      u.lang = "en-US"; u.rate = 0.95; u.volume = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  } catch {}
}

function ensureYT() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (music.ytP) return music.ytP;
  music.ytP = new Promise((ok, fail) => {
    window.onYouTubeIframeAPIReady = ok;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { music.ytP = null; fail(new Error("yt")); };
    document.head.appendChild(s);
  });
  return music.ytP;
}

function stopMusicLocal() {
  clearTimeout(music.timer);
  clearTimeout(music.blockTimer);
  if (music.el) { try { music.el.pause(); } catch {} music.el = null; }
  if (music.yt && music.yt.stopVideo) { try { music.yt.stopVideo(); } catch {} }
  music.current = null; music.playing = false; music.blocked = false;
  updateMusicUI();
}

function musicBlocked() {
  music.blocked = true;
  updateMusicUI();
  toast("🔇 Toca 🎵 y «Activar sonido» para oír la bocina");
}

function startMusic(m) {
  if (!music.current || music.current.seq !== m.seq) return;
  const offset = Math.max(0, (serverNow() - m.startedAt - (m.announceMs || 0)) / 1000);   // entrar tarde = oír por donde va
  if (m.kind === "file") {
    const el = new Audio(m.src);
    el.volume = musicVol();
    el.addEventListener("loadedmetadata", () => { if (offset > 1 && offset < el.duration - 1) el.currentTime = offset; });
    el.onended = () => { if (music.el === el) { music.el = null; music.playing = false; updateMusicUI(); } };
    el.onerror = () => { toast("No se pudo reproducir esa canción."); music.playing = false; updateMusicUI(); };
    music.el = el;
    el.play().then(() => { music.playing = true; updateMusicUI(); }).catch(musicBlocked);
  } else {
    ensureYT().then(() => {
      if (!music.current || music.current.seq !== m.seq) return;
      const start = Math.floor(offset);
      if (music.yt && music.yt.loadVideoById) {
        music.yt.loadVideoById({ videoId: m.src, startSeconds: start });
        applyMusicVolume();
      } else {
        music.yt = new YT.Player("ytHost", {
          width: "2", height: "2", videoId: m.src,
          playerVars: { autoplay: 1, controls: 0, playsinline: 1, start },
          events: {
            onReady: e => { e.target.setVolume(musicVol() * 100); e.target.playVideo(); },
            onStateChange: e => { music.playing = e.data === 1; if (music.playing) music.blocked = false; updateMusicUI(); },
            onError: () => { toast("No se pudo reproducir ese video (puede que no permita sonar fuera de YouTube)."); music.playing = false; updateMusicUI(); }
          }
        });
      }
      clearTimeout(music.blockTimer);
      music.blockTimer = setTimeout(() => { if (music.current && music.current.seq === m.seq && !music.playing) musicBlocked(); }, 4500);
    }).catch(() => toast("No se pudo cargar YouTube (¿sin internet?)."));
  }
  updateMusicUI();
}

// se llama con cada estado: arranca, cambia o apaga la música para que coincida con la del servidor
function syncMusic() {
  if (!state) { if (music.current) stopMusicLocal(); return; }
  music.clockOffset = (state.serverNow || Date.now()) - Date.now();
  const m = state.music;
  if (!m) { if (music.current) stopMusicLocal(); return; }
  if (music.current && music.current.seq === m.seq) { updateMusicUI(); return; }
  stopMusicLocal();
  music.current = m;
  const age = serverNow() - m.startedAt;
  if (m.announce && age < (m.announceMs || 0)) announceBluetooth();   // solo a quien estaba cuando se conectó
  music.timer = setTimeout(() => startMusic(m), Math.max(0, (m.announceMs || 0) - age));
  updateMusicUI();
}

function updateMusicUI() {
  const m = music.current;
  ["musicBtn", "musicBtnTop"].forEach(id => { const b = $(id); if (b) b.classList.toggle("on", !!m); });
  const now = $("musicNow");
  if (!now) return;
  if (!m) now.textContent = "La bocina está en silencio.";
  else {
    const what = m.kind === "youtube" ? "una canción de YouTube" : `«${m.title}»`;
    const st = music.blocked ? " · sin sonido (toca «Activar sonido»)" : music.playing ? " · sonando" : " · conectando…";
    now.textContent = `🎵 ${what} · puesta por ${m.by}${st}`;
  }
  $("musicEnable").classList.toggle("hidden", !music.blocked);
}

async function loadMusicList() {
  const box = $("musicList");
  box.textContent = "Cargando…";
  try {
    const j = await (await fetch("/api/music")).json();
    box.innerHTML = j.files.length
      ? j.files.map(f => `<button class="song" data-f="${esc(f.file)}">▶ ${esc(f.title)}</button>`).join("")
      : `<p class="hint">Todavía no hay canciones en la carpeta <b>public/music</b>.</p>`;
    box.querySelectorAll("[data-f]").forEach(b => { b.onclick = () => { audio(); socket.emit("music-play", { kind: "file", file: b.dataset.f }); }; });
  } catch { box.textContent = "No se pudo cargar la lista."; }
}

function openMusic() {
  $("musicVol").value = music.vol;
  $("musicVolVal").textContent = music.vol + "%";
  $("musicMute").checked = music.muted;
  updateMusicUI();
  $("musicModal").classList.remove("hidden");
  loadMusicList();
}
$("musicBtn").onclick = $("musicBtnTop").onclick = () => { audio(); openMusic(); };
$("musicClose").onclick = () => $("musicModal").classList.add("hidden");
$("musicStop").onclick = () => socket.emit("music-stop");
$("musicEnable").onclick = () => {
  music.blocked = false;
  if (music.el) music.el.play().then(() => { music.playing = true; updateMusicUI(); }).catch(() => {});
  if (music.yt && music.yt.playVideo) { try { music.yt.playVideo(); } catch {} }
  updateMusicUI();
};
$("musicConnect").onclick = () => {
  const url = $("musicUrl").value.trim();
  if (!url) { toast("Pega primero un enlace de YouTube."); return; }
  audio();
  socket.emit("music-play", { kind: "youtube", url });
  $("musicUrl").value = "";
};
$("musicVol").oninput = e => {
  music.vol = Number(e.target.value);
  $("musicVolVal").textContent = music.vol + "%";
  try { localStorage.setItem("dominoVol", String(music.vol)); } catch {}
  applyMusicVolume();
};
$("musicMute").onchange = e => {
  music.muted = e.target.checked;
  try { localStorage.setItem("dominoMute", music.muted ? "1" : "0"); } catch {}
  applyMusicVolume();
};

/* =========================================================
   MODO DEBUG (solo administrador, en la sala de pruebas)
   Admin → «Crear sala de pruebas»: sala ya empezada con 3 bots.
   Aquí se prueban bebidas, azote, manos y la cámara 3D sin esperar a nadie.
========================================================= */
let debugOpen = false;
let debugKey = "";
let debugPaused = false;

$("debugCreate").onclick = () => {
  if (!admin) { toast("Entra primero como administrador."); return; }
  debugPaused = $("debugPause").checked;
  $("adminModal").classList.add("hidden");
  socket.emit("admin-debug-create", { name: savedName() || "Admin", avatar: myAvatar, pause: debugPaused });
};

function dbgSend(action, value) {
  if (!state) return;
  const who = $("dbgWho");
  socket.emit("admin-debug", { code: state.code, action, id: who ? who.value : "", value });
}

function updateDebugUI() {
  const on = !!(admin && state && state.debug && !state.god && state.phase !== "lobby");
  $("debugBtn").classList.toggle("hidden", !on);
  if (!on) { $("debugPanel").classList.add("hidden"); debugKey = ""; return; }
  $("debugPanel").classList.toggle("hidden", !debugOpen);
  // el panel solo se reconstruye si cambian los jugadores o el modo 3D (así no se corta un deslizador)
  const key = state.players.map(p => p.id).join(",") + "|" + (t3d ? t3d.mode : "2d");
  if (debugOpen && key !== debugKey) buildDebugPanel(key);
}

function buildDebugPanel(key) {
  debugKey = key;
  const tn = t3d ? t3d.tune : null;
  const who = $("dbgWho") ? $("dbgWho").value : state.me;
  const sel = state.players
    .map(p => `<option value="${p.id}" ${p.id === who ? "selected" : ""}>${esc(p.name)}${p.id === state.me ? " (yo)" : ""}</option>`)
    .join("");
  const sl = (k, label, min, max, step) => `
    <label class="dbg-sl">${label}<b id="dv_${k}">${tn[k]}</b>
      <input type="range" data-tune="${k}" min="${min}" max="${max}" step="${step}" value="${tn[k]}"></label>`;
  const B = (d, v, label) => `<button data-d="${d}" ${v !== undefined ? `data-v="${v}"` : ""}>${label}</button>`;
  $("debugPanel").innerHTML = `
    <div class="dbg-head"><b>🛠 Debug · sala de pruebas</b><button id="dbgClose" aria-label="Cerrar">✕</button></div>
    <label class="dbg-who">Jugador <select id="dbgWho">${sel}</select></label>
    <div class="admin-sub">Bebidas</div>
    <div class="admin-row">${B("drink", undefined, "🥃 Beber")}${B("pour", undefined, "🍾 Servir")}</div>
    <div class="admin-row"><small>Vaso:</small>${B("cup", 0, "vacío")}${B("cup", 0.5, "½")}${B("cup", 1, "lleno")}
      <small>Botella:</small>${B("bottle", 0.1, "casi vacía")}${B("bottle", 1, "llena")}</div>
    <div class="admin-row">${B("coin", undefined, "🪙 Poner su CUC")}${B("potfill", undefined, "🪙 Completar colecta")}</div>
    <div class="admin-sub">Efectos</div>
    <div class="admin-row">${B("slam", undefined, "💥 Azote")}${B("capicua", undefined, "🎉 Capicúa")}${B("pass", undefined, "⏭ Pase")}</div>
    <div class="admin-sub">Fichas del jugador elegido</div>
    <div class="admin-row"><small>dejar:</small>${B("hand", 1, "1")}${B("hand", 3, "3")}${B("hand", 7, "7")}${B("hand", 10, "10")}</div>
    <div class="admin-sub">Partida</div>
    <div class="admin-row">${B("deal", undefined, "🔄 Repartir de nuevo")}${B("step", undefined, "▶ Jugada auto")}
      <button id="dbgPause" class="${debugPaused ? "on" : ""}">⏸ Bots en pausa</button></div>
    <div class="admin-sub">Cámara y atril (3D)</div>
    ${tn
      ? sl("eyeY", "Altura de los ojos", 15, 80, 1) + sl("eyeZ", "Ojos hacia atrás", -5, 35, 1) + sl("pitch", "Mirar hacia abajo (°)", 10, 85, 1) +
        sl("fovP", "Zoom vertical (pantalla vertical)", 40, 95, 1) + sl("fovL", "Zoom (pantalla horizontal)", 40, 95, 1) +
        sl("rackAng", "Inclinación de las fichas (°)", 45, 90, 1) + `<div class="admin-row"><button id="dbgReset">Restablecer cámara</button></div>`
      : `<p class="hint left">Activa la vista 3D para ajustar la cámara.</p>`}
  `;
}

$("debugBtn").onclick = () => {
  debugOpen = !debugOpen;
  debugKey = "";
  updateDebugUI();
};

$("debugPanel").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "dbgClose") { debugOpen = false; updateDebugUI(); return; }
  if (b.id === "dbgPause") {
    debugPaused = !debugPaused;
    b.classList.toggle("on", debugPaused);
    dbgSend("pause", debugPaused);
    return;
  }
  if (b.id === "dbgReset") { t3d && t3d.resetTune(); debugKey = ""; updateDebugUI(); return; }
  if (b.dataset.d) dbgSend(b.dataset.d, b.dataset.v === undefined ? undefined : Number(b.dataset.v));
});

$("debugPanel").addEventListener("input", e => {
  const k = e.target.dataset && e.target.dataset.tune;
  if (!k || !t3d) return;
  t3d.setTune(k, e.target.value);
  const out = $("dv_" + k);
  if (out) out.textContent = e.target.value;
});

/* ---------- arranque ---------- */
if (session && session.room && session.token) {
  $("homeStatus").textContent = "Reconectando a tu sala…";
}
