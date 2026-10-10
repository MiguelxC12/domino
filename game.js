"use strict";

/* =========================================================
   LÓGICA DEL DOMINÓ CUBANO (sin sockets, sin Express)
   Todo lo que decide el resultado de una jugada vive aquí.
   server.js solo conecta esto con Socket.IO.
========================================================= */

const crypto = require("crypto");

const MAX_SCORE = 100;
const CAPICUA_BONUS = 30;
// segundos por turno antes de jugar automáticamente (TURN_SECONDS en el entorno)
const TURN_SECONDS = Number(process.env.TURN_SECONDS) > 0 ? Number(process.env.TURN_SECONDS) : 30;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const MAX_SPECTATORS = 30;

/* ---------- utilidades ---------- */

function uid(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(array) {
  return array[crypto.randomInt(array.length)];
}

function createTiles(max) {
  const tiles = [];
  for (let a = 0; a <= max; a++) {
    for (let b = a; b <= max; b++) {
      tiles.push({ id: `t${a}${b}`, a, b });
    }
  }
  return tiles;
}

function tileValue(tile) {
  return tile.a + tile.b;
}

function handValue(hand) {
  return (hand || []).reduce((sum, t) => sum + tileValue(t), 0);
}

function handSize(variant) {
  return variant === 6 ? 7 : 10;
}

/* ---------- salas ---------- */

function createRoom(code) {
  return {
    code,
    variant: 9,
    mode: "team",
    phase: "lobby", // lobby | starter-choice | playing | hand-result | finished
    players: [],
    spectators: [],
    hands: {},
    board: [],
    scores: [0, 0],
    turn: null,
    starterPlayer: null,
    starterCandidates: [],
    capicua: true,
    turnDeadline: null,
    events: [],
    starterChoice: null,
    nextStarters: [],
    lastResult: null,
    handNumber: 0,
    winner: null,
    notices: [],
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
}

function createPlayer(name, isHost) {
  return {
    id: uid(6), // público: lo ven todos
    token: uid(16), // secreto: solo lo conoce su dueño
    socketId: null,
    name: cleanName(name),
    team: 0,
    seat: 0,
    host: !!isHost,
    connected: true,
    left: false
  };
}

function cleanName(name) {
  const n = String(name || "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .substring(0, 18);
  return n || "Jugador";
}

function notice(room, message) {
  room.notices.push(message);
}

// Eventos para el cliente (sonidos, avisos): pase, capicúa, tiempo agotado...
function emitEvent(room, type, data = {}) {
  room.events.push({ type, ...data });
  if (room.events.length > 50) room.events.shift();
}

function drainEvents(room) {
  const list = room.events;
  room.events = [];
  return list;
}

function drainNotices(room) {
  const list = room.notices;
  room.notices = [];
  return list;
}

function touch(room) {
  room.lastActivity = Date.now();
}

function playerById(room, id) {
  return room.players.find(p => p.id === id);
}

function allMembers(room) {
  return [...room.players, ...room.spectators];
}

function memberById(room, id) {
  return allMembers(room).find(p => p.id === id);
}

function isSpectator(room, id) {
  return room.spectators.some(p => p.id === id);
}

function playerByToken(room, token) {
  if (!token) return undefined;
  return allMembers(room).find(p => p.token === token);
}

function activePlayers(room) {
  return room.players.filter(p => !p.left);
}

function resetScores(room) {
  room.scores =
    room.mode === "team" ? [0, 0] : room.players.map(() => 0);
}

/* ---------- equipos y asientos ---------- */

function assignTeams(room) {
  room.players.forEach((p, i) => {
    p.team = room.mode === "individual" ? i : i % 2;
  });
}

function reseat(room) {
  room.players.forEach((p, i) => {
    p.seat = i;
  });
}

/*
  En modo equipos los compañeros deben quedar frente a frente:
  se intercalan los asientos Equipo A, Equipo B, Equipo A, Equipo B.
*/
function arrangeSeats(room) {
  if (room.mode !== "team") {
    reseat(room);
    return { ok: true };
  }
  const t0 = room.players.filter(p => p.team === 0);
  const t1 = room.players.filter(p => p.team === 1);
  if (!t0.length || !t1.length || Math.abs(t0.length - t1.length) > 1) {
    return {
      ok: false,
      message:
        "Los equipos deben estar parejos (por ejemplo 2 contra 2)."
    };
  }
  const first = t0.length >= t1.length ? t0 : t1;
  const second = first === t0 ? t1 : t0;
  const ordered = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) ordered.push(first[i]);
    if (second[i]) ordered.push(second[i]);
  }
  room.players = ordered;
  reseat(room);
  return { ok: true };
}

/* ---------- configuración ---------- */

function configure(room, data) {
  if (room.phase !== "lobby") return;
  if (data.variant === 6 || data.variant === 9) {
    room.variant = Number(data.variant);
  }
  if (data.mode === "team" || data.mode === "individual") {
    room.mode = data.mode;
  }
  if (typeof data.capicua === "boolean") room.capicua = data.capicua;
  assignTeams(room);
  resetScores(room);
}

/* ---------- reglas de colocación ---------- */

function leftEnd(room) {
  return room.board.length ? room.board[0].left : null;
}

function rightEnd(room) {
  return room.board.length
    ? room.board[room.board.length - 1].right
    : null;
}

function fitsSide(room, tile, side) {
  if (!room.board.length) return false;
  const value = side === "left" ? leftEnd(room) : rightEnd(room);
  return tile.a === value || tile.b === value;
}

/*
  Cada pieza del tablero guarda el valor de su extremo izquierdo y
  derecho EN ORDEN DE CADENA, de modo que siempre se cumple:
    board[i].right === board[i + 1].left
*/
function orient(room, tile, side) {
  if (side === "left") {
    const v = leftEnd(room);
    // el número que toca la mesa queda a la DERECHA de la ficha nueva
    return tile.b === v
      ? { left: tile.a, right: tile.b }
      : { left: tile.b, right: tile.a };
  }
  const v = rightEnd(room);
  // el número que toca la mesa queda a la IZQUIERDA de la ficha nueva
  return tile.a === v
    ? { left: tile.a, right: tile.b }
    : { left: tile.b, right: tile.a };
}

function canMove(room, playerId) {
  const hand = room.hands[playerId] || [];
  return hand.some(
    t => fitsSide(room, t, "left") || fitsSide(room, t, "right")
  );
}

/* ---------- iniciar partida y manos ---------- */

function startMatch(room) {
  const actives = activePlayers(room);
  if (actives.length < MIN_PLAYERS) {
    return { ok: false, message: "Se necesitan al menos 2 jugadores." };
  }
  room.players = actives;
  const seats = arrangeSeats(room);
  if (!seats.ok) return seats;
  resetScores(room);
  room.handNumber = 0;
  room.nextStarters = [];
  room.starterPlayer = null;
  room.starterCandidates = [];
  room.winner = null;
  room.lastResult = null;
  startHand(room);
  return { ok: true };
}

function startHand(room) {
  room.handNumber++;
  room.board = [];
  room.hands = {};
  room.turn = null;
  room.starterChoice = null;
  room.lastResult = null;
  room.winner = null;

  const tiles = shuffle(createTiles(room.variant));
  const amount = handSize(room.variant);
  room.players.forEach(p => {
    room.hands[p.id] = tiles.splice(0, amount);
  });

  let candidates = [];

  const existing = (room.nextStarters || [])
    .map(id => playerById(room, id))
    .filter(Boolean);

  if (room.handNumber === 1 || !existing.length) {
    // Primera mano: equipo al azar y, dentro del equipo, jugador al azar.
    let starter;
    if (room.mode === "team") {
      const teams = [0, 1].filter(t =>
        room.players.some(p => p.team === t)
      );
      const team = pick(teams);
      starter = pick(room.players.filter(p => p.team === team));
    } else {
      starter = pick(room.players);
    }
    candidates = [starter];
  } else {
    // Siguientes manos: sale el equipo ganador y CUALQUIERA de sus
    // integrantes puede poner la primera ficha.
    candidates = existing;
  }

  room.starterCandidates = candidates.map(p => p.id);
  room.starterPlayer = candidates[0].id;
  room.phase = "starter-choice";
  touch(room);
}

function chooseStarter(room, playerId, tileId) {
  if (room.phase !== "starter-choice") {
    return { ok: false, message: "Ya no se está eligiendo la salida." };
  }
  if (!room.starterCandidates.includes(playerId)) {
    return { ok: false, message: "No eres el jugador que debe salir." };
  }
  const hand = room.hands[playerId] || [];
  const index = hand.findIndex(t => t.id === tileId);
  if (index < 0) {
    return { ok: false, message: "Esa ficha no está en tu mano." };
  }
  const tile = hand.splice(index, 1)[0];
  room.board = [
    { id: tile.id, left: tile.a, right: tile.b, owner: playerId, starter: true }
  ];
  room.starterChoice = { tileId: tile.id, playerId };
  room.starterPlayer = playerId;
  room.starterCandidates = [];
  room.phase = "playing";
  touch(room);

  if (hand.length === 0) {
    // (solo posible con manos de 1 ficha; por completitud)
    finishHand(room, playerById(room, playerId), "sin-fichas");
    return { ok: true };
  }
  advanceTurn(room, playerId);
  return { ok: true };
}

/* ---------- jugar ---------- */

function playTile(room, playerId, tileId, side, opts = {}) {
  if (room.phase !== "playing") {
    return { ok: false, message: "La partida no está en juego." };
  }
  if (room.turn !== playerId) {
    return { ok: false, message: "No es tu turno." };
  }
  if (side !== "left" && side !== "right") {
    return { ok: false, message: "Extremo inválido." };
  }
  const hand = room.hands[playerId] || [];
  const index = hand.findIndex(t => t.id === tileId);
  if (index < 0) {
    return { ok: false, message: "La ficha no está en tu mano." };
  }
  const tile = hand[index];
  if (!fitsSide(room, tile, side)) {
    return { ok: false, message: "Esa ficha no coincide con ese extremo." };
  }

  // CAPICÚA: ganar con una ficha que encaja en LOS DOS extremos (que valen lo mismo)
  const lv = leftEnd(room);
  const capicua =
    room.capicua &&
    hand.length === 1 &&
    lv === rightEnd(room) &&
    (tile.a === lv || tile.b === lv);

  // AZOTE: quien se pega puede estrellar su última ficha contra la mesa (solo vistoso)
  const slam = !!opts.slam && hand.length === 1;

  const o = orient(room, tile, side);
  hand.splice(index, 1);
  const piece = { id: tile.id, left: o.left, right: o.right, owner: playerId };
  if (side === "left") room.board.unshift(piece);
  else room.board.push(piece);
  touch(room);

  if (hand.length === 0) {
    finishHand(room, playerById(room, playerId), "sin-fichas", { capicua, slam, tileId: tile.id });
    return { ok: true };
  }
  advanceTurn(room, playerId);
  return { ok: true };
}

/*
  Pasa el turno al siguiente jugador que pueda jugar.
  Los jugadores sin ficha compatible pasan automáticamente.
  Si nadie puede jugar, la mano está trancada.
*/
function advanceTurn(room, fromId) {
  const order = room.players;
  const n = order.length;
  const start = order.findIndex(p => p.id === fromId);
  const skipped = [];

  for (let i = 1; i <= n; i++) {
    const candidate = order[(start + i) % n];
    if (canMove(room, candidate.id)) {
      skipped.forEach(p => {
        notice(room, `${p.name} pasó.`);
        emitEvent(room, "pass", { name: p.name });
      });
      room.turn = candidate.id;
      return;
    }
    skipped.push(candidate);
  }
  room.turn = null;
  finishBlocked(room);
}

/* ---------- fin de mano ---------- */

function revealHands(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    tiles: (room.hands[p.id] || []).map(t => ({ a: t.a, b: t.b })),
    value: handValue(room.hands[p.id])
  }));
}

function finishBlocked(room) {
  const values = room.players.map(p => ({
    player: p,
    value: handValue(room.hands[p.id])
  }));
  const lowest = Math.min(...values.map(v => v.value));
  const winners = values.filter(v => v.value === lowest);

  if (winners.length !== 1) {
    room.lastResult = {
      winningTeam: null,
      winningPlayer: null,
      winnerName: null,
      awarded: 0,
      reason: "empate-tranca",
      detail: winners.map(w => w.player.name).join(" y "),
      lowest,
      scores: [...room.scores],
      reveal: revealHands(room)
    };
    room.phase = "hand-result";
    // si hay empate, sale el mismo jugador que salió esta mano
    room.nextStarters = [room.starterPlayer];
    touch(room);
    return;
  }
  finishHand(room, winners[0].player, "trancada");
}

function finishHand(room, winner, reason, extra = {}) {
  const isTeam = room.mode === "team";
  const loserSum = isTeam
    ? room.players
        .filter(p => p.team !== winner.team)
        .reduce((s, p) => s + handValue(room.hands[p.id]), 0)
    : room.players
        .filter(p => p.id !== winner.id)
        .reduce((s, p) => s + handValue(room.hands[p.id]), 0);

  const scoreIndex = isTeam
    ? winner.team
    : room.players.findIndex(p => p.id === winner.id);
  const bonus = extra.capicua ? CAPICUA_BONUS : 0;
  room.scores[scoreIndex] += loserSum + bonus;
  if (extra.capicua) emitEvent(room, "capicua", { name: winner.name });
  if (extra.slam) emitEvent(room, "slam", { name: winner.name, tileId: extra.tileId });

  room.lastResult = {
    winningTeam: isTeam ? winner.team : null,
    winningPlayer: winner.id,
    winnerName: winner.name,
    awarded: loserSum + bonus,
    bonus,
    capicua: !!extra.capicua,
    slam: !!extra.slam,
    reason,
    detail:
      reason === "trancada"
        ? `${winner.name} tiene la menor suma (${handValue(
            room.hands[winner.id]
          )})`
        : extra.capicua
          ? `¡CAPICÚA! ${winner.name} se quedó sin fichas con una ficha que encajaba en los dos extremos (+${CAPICUA_BONUS} de bonus)`
          : `${winner.name} se quedó sin fichas`,
    scores: [...room.scores],
    reveal: revealHands(room)
  };

  room.nextStarters = isTeam
    ? room.players.filter(p => p.team === winner.team).map(p => p.id)
    : [winner.id];
  room.turn = null;

  if (room.scores[scoreIndex] >= MAX_SCORE) {
    room.phase = "finished";
    room.winner = isTeam ? winner.team : winner.id;
  } else {
    room.phase = "hand-result";
  }
  touch(room);
}

function nextHand(room) {
  if (room.phase !== "hand-result") return false;
  startHand(room);
  return true;
}

function newMatch(room) {
  if (room.phase !== "finished") return false;
  room.players = activePlayers(room);
  if (room.players.length < MIN_PLAYERS) return false;
  const seats = arrangeSeats(room);
  if (!seats.ok) return false;
  resetScores(room);
  room.handNumber = 0;
  room.nextStarters = [];
  room.winner = null;
  room.lastResult = null;
  startHand(room);
  return true;
}

/* ---------- salir / volver al lobby ---------- */

function backToLobby(room) {
  room.players = activePlayers(room);
  room.phase = "lobby";
  room.board = [];
  room.hands = {};
  room.turn = null;
  room.starterPlayer = null;
  room.starterCandidates = [];
  room.starterChoice = null;
  room.nextStarters = [];
  room.lastResult = null;
  room.winner = null;
  room.handNumber = 0;
  assignTeams(room);
  reseat(room);
  resetScores(room);
  room.players.forEach(p => {
    room.hands[p.id] = [];
  });
}

function ensureHost(room, preferConnected = false) {
  const candidates = allMembers(room).filter(p => !p.left);
  if (!candidates.length) return;
  const current = candidates.find(p => p.host);
  if (current && (!preferConnected || current.connected)) return;
  // el anfitrión pasa preferentemente a un jugador conectado
  const next =
    candidates.find(p => p.connected && p !== current && room.players.includes(p)) ||
    candidates.find(p => p.connected && p !== current) ||
    current ||
    candidates[0];
  allMembers(room).forEach(p => {
    p.host = p === next;
  });
}

/*
  Salida voluntaria (botón SALIR).
  - En el lobby se elimina al jugador.
  - En plena partida su asiento sigue jugando solo (modo automático)
    para no dejar colgados a los demás.
*/
function leavePlayer(room, playerId) {
  if (isSpectator(room, playerId)) {
    room.spectators = room.spectators.filter(p => p.id !== playerId);
    ensureHost(room);
    touch(room);
    return;
  }
  const player = playerById(room, playerId);
  if (!player) return;
  player.socketId = null;
  player.connected = false;

  const inGame =
    room.phase === "starter-choice" ||
    room.phase === "playing" ||
    room.phase === "hand-result";

  if (inGame) {
    player.left = true;
    notice(room, `${player.name} salió de la partida.`);
    player.host = false;
    if (activePlayers(room).length < MIN_PLAYERS) {
      notice(room, "Quedó un solo jugador: la sala vuelve al lobby.");
      backToLobby(room);
    }
  } else {
    room.players = room.players.filter(p => p.id !== playerId);
    delete room.hands[playerId];
    if (room.phase === "lobby") {
      assignTeams(room);
      reseat(room);
      resetScores(room);
    }
  }
  ensureHost(room);
  touch(room);
}

/* ---------- espectadores y reparto de roles ---------- */

/*
  Entra una persona nueva a la sala.
  - En el lobby, con sitio libre, entra como JUGADOR.
  - Si la partida ya empezó o los 4 asientos están ocupados, entra como ESPECTADOR.
*/
function joinRoom(room, name) {
  const total = allMembers(room).length;
  if (total >= MAX_PLAYERS + MAX_SPECTATORS) {
    return { ok: false, message: "La sala está llena." };
  }
  const first = total === 0;
  const person = createPlayer(name, first);
  const asPlayer =
    room.phase === "lobby" && room.players.length < MAX_PLAYERS;
  if (asPlayer) {
    if (room.mode === "team") {
      const t0 = room.players.filter(p => p.team === 0).length;
      const t1 = room.players.filter(p => p.team === 1).length;
      person.team = t0 <= t1 ? 0 : 1;
    } else {
      person.team = room.players.length;
    }
    room.players.push(person);
    room.hands[person.id] = [];
    reseat(room);
    resetScores(room);
  } else {
    room.spectators.push(person);
  }
  ensureHost(room);
  touch(room);
  return { ok: true, person, role: asPlayer ? "player" : "spectator" };
}

function normalizeLobby(room) {
  if (room.mode === "individual") assignTeams(room);
  reseat(room);
  resetScores(room);
}

/* El anfitrión (o el admin) decide quién juega y quién mira. Solo en el lobby. */
function moveMember(room, id, to) {
  if (room.phase !== "lobby") {
    return { ok: false, message: "Solo se puede cambiar en la sala de espera." };
  }
  if (to === "spectators") {
    const p = playerById(room, id);
    if (!p) return { ok: false, message: "Ese jugador no está en el bloque de jugadores." };
    room.players = room.players.filter(x => x.id !== id);
    delete room.hands[id];
    room.spectators.push(p);
    normalizeLobby(room);
  } else if (to === "players") {
    const p = room.spectators.find(x => x.id === id);
    if (!p) return { ok: false, message: "Esa persona no es espectadora." };
    if (room.players.length >= MAX_PLAYERS) {
      return { ok: false, message: "Ya hay 4 jugadores. Pasa a alguien a espectador primero." };
    }
    room.spectators = room.spectators.filter(x => x.id !== id);
    if (room.mode === "team") {
      const t0 = room.players.filter(x => x.team === 0).length;
      const t1 = room.players.filter(x => x.team === 1).length;
      p.team = t0 <= t1 ? 0 : 1;
    } else {
      p.team = room.players.length;
    }
    room.players.push(p);
    room.hands[id] = [];
    normalizeLobby(room);
  } else {
    return { ok: false, message: "Destino inválido." };
  }
  touch(room);
  return { ok: true };
}

function setTeam(room, id, team) {
  const p = playerById(room, id);
  if (!p || room.phase !== "lobby" || room.mode !== "team") return false;
  p.team = Number(team) === 1 ? 1 : 0;
  return true;
}

/* Vuelve a la sala de espera (para reorganizar jugadores/espectadores). */
function toLobby(room) {
  backToLobby(room);
  room.spectators = room.spectators.filter(p => !p.left);
  touch(room);
}

function setScore(room, index, value) {
  const v = Math.max(0, Math.min(999, Math.floor(Number(value))));
  if (!Number.isFinite(v) || index < 0 || index >= room.scores.length) return false;
  room.scores[index] = v;
  if (room.phase === "playing" || room.phase === "starter-choice" || room.phase === "hand-result") {
    if (room.scores[index] >= MAX_SCORE) {
      room.phase = "finished";
      room.turn = null;
      room.winner =
        room.mode === "team" ? index : (room.players[index] && room.players[index].id);
      if (!room.lastResult) {
        room.lastResult = {
          winningTeam: room.mode === "team" ? index : null,
          winningPlayer: room.mode === "team" ? null : room.winner,
          winnerName: room.mode === "team" ? null : room.players[index].name,
          awarded: 0,
          reason: "ajuste",
          detail: "Marcador ajustado por el administrador",
          scores: [...room.scores],
          reveal: revealHands(room)
        };
      }
    }
  }
  touch(room);
  return true;
}

/* ---------- jugadas automáticas ---------- */

/*
  Devuelve el jugador al que el servidor está esperando ahora mismo
  (quien debe elegir la salida o jugar), o null.
*/
function actingPlayer(room) {
  if (room.phase === "starter-choice") {
    const list = room.starterCandidates
      .map(id => playerById(room, id))
      .filter(Boolean);
    // si algún candidato está presente, se espera por él; si no, se juega por el primero
    return (
      list.find(p => !p.left && p.connected) ||
      list.find(p => !p.left) ||
      list[0] ||
      null
    );
  }
  if (room.phase === "playing") {
    return playerById(room, room.turn) || null;
  }
  return null;
}

/*
  Hace una jugada legal para el jugador al que se espera.
  - smart: elige la ficha de más puntos (quita peso de la mano). Se usa
    cuando se acaba el tiempo del turno o alguien se fue.
  - sin smart: jugada al azar (pruebas automáticas).
*/
function autoMove(room, opts = {}) {
  const player = actingPlayer(room);
  if (!player) return false;
  const hand = room.hands[player.id] || [];

  if (room.phase === "starter-choice") {
    // sale con la ficha de mayor valor (doble más alto si lo tiene)
    const best = [...hand].sort(
      (x, y) =>
        (y.a === y.b) - (x.a === x.b) || tileValue(y) - tileValue(x)
    )[0];
    return chooseStarter(room, player.id, best.id).ok;
  }

  const options = [];
  hand.forEach(t => {
    ["left", "right"].forEach(side => {
      if (fitsSide(room, t, side)) options.push({ t, side });
    });
  });
  if (!options.length) return false;
  let choice;
  if (opts.smart) {
    const top = Math.max(...options.map(o => tileValue(o.t)));
    choice = pick(options.filter(o => tileValue(o.t) === top));
  } else {
    choice = pick(options);
  }
  return playTile(room, player.id, choice.t.id, choice.side).ok;
}

/* ---------- estado que se envía a cada jugador ---------- */

function publicState(room, viewerId, opts = {}) {
  const god = !!opts.god;
  const spectator = !god && isSpectator(room, viewerId);
  const hands = {};
  room.players.forEach(p => {
    const hand = room.hands[p.id] || [];
    hands[p.id] =
      god || p.id === viewerId ? hand : { count: hand.length };
  });
  const viewer = memberById(room, viewerId);
  return {
    code: room.code,
    variant: room.variant,
    mode: room.mode,
    phase: room.phase,
    me: god ? null : viewerId,
    god,
    spectator,
    isHost: !!(viewer && viewer.host),
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      seat: p.seat,
      host: p.host,
      connected: !!p.connected,
      left: !!p.left
    })),
    spectators: room.spectators.map(p => ({
      id: p.id,
      name: p.name,
      host: p.host,
      connected: !!p.connected
    })),
    hands,
    board: room.board,
    scores: room.scores,
    turn: room.turn,
    starterPlayer: room.starterPlayer,
    starterPlayers: room.starterCandidates,
    capicua: room.capicua,
    capicuaBonus: CAPICUA_BONUS,
    deadline: room.turnDeadline,
    serverNow: Date.now(),
    turnSeconds: TURN_SECONDS,
    starterChoice: room.starterChoice,
    lastResult: room.lastResult,
    handNumber: room.handNumber,
    winner: room.winner,
    maxScore: MAX_SCORE
  };
}

module.exports = {
  MAX_SCORE,
  CAPICUA_BONUS,
  TURN_SECONDS,
  emitEvent,
  drainEvents,
  MAX_PLAYERS,
  MIN_PLAYERS,
  uid,
  shuffle,
  createTiles,
  tileValue,
  handValue,
  handSize,
  createRoom,
  createPlayer,
  cleanName,
  notice,
  drainNotices,
  touch,
  playerById,
  allMembers,
  memberById,
  isSpectator,
  playerByToken,
  joinRoom,
  moveMember,
  setTeam,
  toLobby,
  setScore,
  MAX_SPECTATORS,
  activePlayers,
  assignTeams,
  reseat,
  arrangeSeats,
  configure,
  resetScores,
  fitsSide,
  orient,
  canMove,
  startMatch,
  startHand,
  chooseStarter,
  playTile,
  advanceTurn,
  finishBlocked,
  finishHand,
  nextHand,
  newMatch,
  backToLobby,
  ensureHost,
  leavePlayer,
  actingPlayer,
  autoMove,
  publicState
};
