"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const G = require("./game");

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

/* =========================================================
   CONTRASEÑA DE ADMINISTRADOR
   Se lee de la variable de entorno ADMIN_PASSWORD.
   Si no existe, se genera una al arrancar y se imprime en los
   logs del servidor (nunca va escrita en el código).
========================================================= */
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomInt(10000000, 99999999).toString();
  console.log(
    `[admin] No hay ADMIN_PASSWORD configurada. Contraseña temporal: ${ADMIN_PASSWORD}`
  );
}

function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* =========================================================
   APP HTTP
========================================================= */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.use(express.static(PUBLIC_DIR));

// Cualquier otra ruta devuelve la app (sirve para /?room=ABCDE).
app.use((req, res) => {
  res.sendFile("index.html", { root: PUBLIC_DIR });
});

/* =========================================================
   SALAS EN MEMORIA
========================================================= */
const rooms = new Map();
const admins = new Set();
const autoTimers = new Map(); // code -> timeout
const hostTimers = new Map(); // code -> timeout
const specTimers = new Map(); // id de espectador -> timeout

const MAX_ROOMS = 300;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  let code;
  do {
    code = Array.from(
      { length: 5 },
      () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function roomOf(socket) {
  const code = socket.data.code;
  return code ? rooms.get(code) : undefined;
}

function playerOf(room, socket) {
  return room.players.find(p => p.socketId === socket.id && !p.left);
}

// jugador O espectador asociado a este socket
function memberOf(room, socket) {
  return G.allMembers(room).find(p => p.socketId === socket.id && !p.left);
}

/* =========================================================
   ENVÍO DE ESTADO
========================================================= */
function broadcast(room) {
  G.allMembers(room).forEach(p => {
    if (p.socketId) {
      io.to(p.socketId).emit("state", G.publicState(room, p.id));
    }
  });
  io.to(`watch:${room.code}`).emit(
    "watch-state",
    G.publicState(room, null, { god: true })
  );
  const notices = G.drainNotices(room);
  notices.forEach(msg => io.to(room.code).emit("notice", msg));
  emitAdminRooms();
}

function afterAction(room) {
  broadcast(room);
  scheduleAuto(room);
}

/*
  Si a quien se espera salió de la partida, el servidor juega por él
  enseguida. Si solo está desconectado (F5, mala señal), se le da un
  margen antes de jugar por él.
*/
const AUTO_DELAY_LEFT = 1500;
const AUTO_DELAY_DISCONNECTED = 25000;

function scheduleAuto(room) {
  clearTimeout(autoTimers.get(room.code));
  autoTimers.delete(room.code);

  const actor = G.actingPlayer(room);
  if (!actor || (!actor.left && actor.connected)) return;

  const delay = actor.left ? AUTO_DELAY_LEFT : AUTO_DELAY_DISCONNECTED;
  const key = `${room.handNumber}:${room.phase}:${room.turn}:${room.board.length}`;

  const timer = setTimeout(() => {
    autoTimers.delete(room.code);
    if (!rooms.has(room.code)) return;
    const again = G.actingPlayer(room);
    const nowKey = `${room.handNumber}:${room.phase}:${room.turn}:${room.board.length}`;
    if (!again || nowKey !== key) return;
    if (!again.left && again.connected) return;
    G.autoMove(room);
    afterAction(room);
  }, delay);
  autoTimers.set(room.code, timer);
}

/* =========================================================
   ADMIN
========================================================= */
function adminRooms() {
  const view = p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    host: p.host,
    connected: !!p.connected,
    left: !!p.left
  });
  return [...rooms.values()].map(room => ({
    code: room.code,
    variant: room.variant,
    mode: room.mode,
    phase: room.phase,
    scores: room.scores,
    handNumber: room.handNumber,
    players: room.players.map(view),
    spectators: room.spectators.map(view)
  }));
}

function emitAdminRooms() {
  admins.forEach(id => io.to(id).emit("admin-rooms", adminRooms()));
}

function deleteRoom(room) {
  io.to(`watch:${room.code}`).emit("watch-ended");
  G.allMembers(room).forEach(p => clearTimeout(specTimers.get(p.id)));
  clearTimeout(autoTimers.get(room.code));
  clearTimeout(hostTimers.get(room.code));
  autoTimers.delete(room.code);
  hostTimers.delete(room.code);
  rooms.delete(room.code);
  emitAdminRooms();
}

/* =========================================================
   SOCKET.IO
========================================================= */
io.on("connection", socket => {
  socket.data.adminFails = 0;
  socket.data.adminBlockedUntil = 0;

  function attach(room, player) {
    clearTimeout(specTimers.get(player.id));
    specTimers.delete(player.id);
    player.socketId = socket.id;
    player.connected = true;
    socket.data.code = room.code;
    socket.join(room.code);
    G.touch(room);
    socket.emit("joined", {
      room: room.code,
      playerId: player.id,
      token: player.token
    });
  }

  /* ---------- crear sala ---------- */
  socket.on("create-room", (data = {}) => {
    if (rooms.size >= MAX_ROOMS) {
      return socket.emit("game-error", "El servidor está lleno. Inténtalo más tarde.");
    }
    leaveCurrent(socket);
    const room = G.createRoom(newCode());
    const player = G.createPlayer(data.name, true);
    room.players.push(player);
    room.hands[player.id] = [];
    G.assignTeams(room);
    G.reseat(room);
    G.resetScores(room);
    rooms.set(room.code, room);
    attach(room, player);
    afterAction(room);
  });

  /* ---------- entrar / reconectar (F5) ---------- */
  socket.on("join-room", (data = {}) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("session-invalid", "La sala no existe.");
      return;
    }

    let player = G.playerByToken(room, data.token);

    if (player && player.left) {
      socket.emit("session-invalid", "Ya saliste de esa partida.");
      return;
    }

    if (player) {
      // F5 / reconexión: vuelve a su asiento y a su mano.
      if (player.socketId && player.socketId !== socket.id) {
        // otra pestaña del mismo jugador: se queda con la nueva
        const old = io.sockets.sockets.get(player.socketId);
        if (old) old.data.code = undefined;
      }
      if (data.name) player.name = G.cleanName(data.name);
      attach(room, player);
      G.ensureHost(room);
      afterAction(room);
      return;
    }

    // persona nueva: jugador si hay sitio en el lobby; si no, espectador
    if (socket.data.code && socket.data.code !== code) leaveCurrent(socket);
    const joined = G.joinRoom(room, data.name);
    if (!joined.ok) return socket.emit("game-error", joined.message);
    attach(room, joined.person);
    if (joined.role === "spectator") {
      socket.emit("notice", "Entraste como espectador.");
    }
    afterAction(room);
  });

  /* ---------- lobby ---------- */
  socket.on("configure", (data = {}) => {
    const room = roomOf(socket);
    const member = room && memberOf(room, socket);
    if (!member || !member.host || room.phase !== "lobby") return;
    G.configure(room, data);
    afterAction(room);
  });

  // Cada jugador cambia su equipo; el anfitrión puede cambiar el de cualquiera.
  socket.on("set-team", (data = {}) => {
    const room = roomOf(socket);
    const member = room && memberOf(room, socket);
    if (!member) return;
    const targetId = member.host && data.id ? String(data.id) : member.id;
    if (G.setTeam(room, targetId, data.team)) afterAction(room);
  });

  // El anfitrión decide quién juega y quién mira.
  socket.on("move-member", (data = {}) => {
    const room = roomOf(socket);
    const member = room && memberOf(room, socket);
    if (!member) return;
    if (!member.host) {
      return socket.emit("game-error", "Solo el anfitrión puede cambiar los roles.");
    }
    const r = G.moveMember(room, String(data.id), data.to);
    if (!r.ok) return socket.emit("game-error", r.message);
    afterAction(room);
  });

  // El anfitrión vuelve a la sala de espera al terminar la partida.
  socket.on("to-lobby", () => {
    const room = roomOf(socket);
    const member = room && memberOf(room, socket);
    if (!member || !member.host) return;
    if (room.phase !== "finished") {
      return socket.emit("game-error", "Solo se puede volver a la sala al terminar la partida.");
    }
    G.toLobby(room);
    afterAction(room);
  });

  socket.on("start-game", () => {
    const room = roomOf(socket);
    const member = room && memberOf(room, socket);
    if (!member) return;
    if (!member.host) {
      return socket.emit("game-error", "Solo el anfitrión puede iniciar.");
    }
    if (room.phase !== "lobby") return;
    const result = G.startMatch(room);
    if (!result.ok) return socket.emit("game-error", result.message);
    afterAction(room);
  });

  /* ---------- partida ---------- */
  socket.on("choose-starter", (data = {}) => {
    const room = roomOf(socket);
    const player = room && playerOf(room, socket);
    if (!player) return;
    const result = G.chooseStarter(room, player.id, String(data.tileId));
    if (!result.ok) socket.emit("game-error", result.message);
    afterAction(room);
  });

  socket.on("play-tile", (data = {}) => {
    const room = roomOf(socket);
    const player = room && playerOf(room, socket);
    if (!player) return;
    const result = G.playTile(
      room,
      player.id,
      String(data.tileId),
      data.side
    );
    if (!result.ok) socket.emit("game-error", result.message);
    afterAction(room);
  });

  socket.on("next-hand", () => {
    const room = roomOf(socket);
    const player = room && playerOf(room, socket);
    if (!player) return;
    if (G.nextHand(room)) afterAction(room);
  });

  socket.on("new-match", () => {
    const room = roomOf(socket);
    const player = room && playerOf(room, socket);
    if (!player) return;
    if (G.newMatch(room)) afterAction(room);
    else if (room.phase === "finished") {
      socket.emit("game-error", "No se puede reiniciar con estos jugadores.");
    }
  });

  /* ---------- salir de verdad ---------- */
  socket.on("leave-room", () => leaveCurrent(socket));

  /* ---------- desconexión (NO elimina al jugador) ---------- */
  socket.on("disconnect", () => {
    admins.delete(socket.id);
    const room = roomOf(socket);
    if (!room) return;
    const member = G.allMembers(room).find(p => p.socketId === socket.id);
    if (!member) return;
    member.connected = false;
    member.socketId = null;
    G.touch(room);

    // Un espectador que desaparece se retira solo tras un par de minutos.
    if (G.isSpectator(room, member.id)) {
      specTimers.set(
        member.id,
        setTimeout(() => {
          specTimers.delete(member.id);
          if (!rooms.has(room.code)) return;
          const still = room.spectators.find(p => p.id === member.id);
          if (still && !still.connected) {
            G.leavePlayer(room, member.id);
            afterAction(room);
          }
        }, 120000)
      );
    }

    // Si el anfitrión desaparece del lobby, otro toma su lugar.
    if (room.phase === "lobby" && member.host) {
      clearTimeout(hostTimers.get(room.code));
      hostTimers.set(
        room.code,
        setTimeout(() => {
          hostTimers.delete(room.code);
          if (!rooms.has(room.code)) return;
          G.ensureHost(room, true);
          broadcast(room);
        }, 45000)
      );
    }
    afterAction(room);
  });

  /* ---------- administrador ---------- */
  socket.on("admin-auth", (data = {}) => {
    if (Date.now() < socket.data.adminBlockedUntil) {
      return socket.emit("admin-auth-result", {
        ok: false,
        message: "Demasiados intentos. Espera un minuto."
      });
    }
    if (!sameSecret(data.password || "", ADMIN_PASSWORD)) {
      socket.data.adminFails++;
      if (socket.data.adminFails >= 5) {
        socket.data.adminBlockedUntil = Date.now() + 60000;
        socket.data.adminFails = 0;
      }
      return socket.emit("admin-auth-result", { ok: false });
    }
    socket.data.adminFails = 0;
    admins.add(socket.id);
    socket.emit("admin-auth-result", { ok: true });
    socket.emit("admin-rooms", adminRooms());
  });

  socket.on("admin-refresh", () => {
    if (admins.has(socket.id)) socket.emit("admin-rooms", adminRooms());
  });

  /* ---- el admin mira una partida con TODAS las manos a la vista ---- */
  socket.on("admin-watch", (data = {}) => {
    if (!admins.has(socket.id)) return;
    const room = rooms.get(String(data.code || "").toUpperCase());
    if (!room) return socket.emit("game-error", "Esa sala ya no existe.");
    stopWatching(socket);
    socket.data.watch = room.code;
    socket.join(`watch:${room.code}`);
    socket.emit("watch-state", G.publicState(room, null, { god: true }));
  });

  socket.on("admin-unwatch", () => stopWatching(socket));

  socket.on("admin-change", (data = {}) => {
    if (!admins.has(socket.id)) return;
    const room = rooms.get(String(data.code || "").toUpperCase());
    if (!room) return;
    const lobby = room.phase === "lobby";
    const v = data.value || {};
    const fail = msg => socket.emit("game-error", msg);

    switch (data.action) {
      case "mode":
        if (!lobby) return fail("Primero usa «Volver a la sala».");
        G.configure(room, { mode: data.value });
        break;
      case "variant":
        if (!lobby) return fail("Primero usa «Volver a la sala».");
        G.configure(room, { variant: Number(data.value) });
        break;
      case "rename": {
        const p = G.memberById(room, v.id);
        if (p) p.name = G.cleanName(v.name);
        break;
      }
      case "team":
        if (!lobby) return fail("Los equipos solo se cambian en la sala de espera.");
        G.setTeam(room, v.id, v.team);
        break;
      case "host": {
        const target = G.memberById(room, v.id);
        if (!target || target.left) break;
        G.allMembers(room).forEach(p => {
          p.host = p === target;
        });
        break;
      }
      case "move": {
        const r = G.moveMember(room, v.id, v.to);
        if (!r.ok) return fail(r.message);
        break;
      }
      case "kick": {
        const target = G.memberById(room, v.id);
        if (!target) break;
        const sid = target.socketId;
        G.leavePlayer(room, target.id);
        if (sid) {
          const sock = io.sockets.sockets.get(sid);
          if (sock) {
            sock.leave(room.code);
            sock.data.code = undefined;
          }
          io.to(sid).emit("session-invalid", "El administrador te sacó de la sala.");
        }
        if (!G.allMembers(room).some(p => !p.left)) {
          deleteRoom(room);
          return;
        }
        break;
      }
      case "start":
        if (!lobby) return fail("La partida ya empezó.");
        {
          const r = G.startMatch(room);
          if (!r.ok) return fail(r.message);
        }
        break;
      case "restart": {
        if (room.phase === "lobby") return fail("Usa «Iniciar partida».");
        const actives = G.activePlayers(room);
        if (actives.length < G.MIN_PLAYERS) return fail("Faltan jugadores.");
        const r = G.startMatch(room);
        if (!r.ok) return fail(r.message);
        break;
      }
      case "lobby":
        G.toLobby(room);
        break;
      case "next-hand":
        if (!G.nextHand(room)) return fail("No hay una mano terminada que continuar.");
        break;
      case "auto":
        if (!G.autoMove(room)) return fail("Ahora no hay una jugada que forzar.");
        break;
      case "score":
        if (!G.setScore(room, Number(v.index), v.value)) return fail("Marcador inválido.");
        break;
      case "close":
        io.to(room.code).emit("session-invalid", "El administrador cerró la sala.");
        deleteRoom(room);
        return;
      default:
        return;
    }
    afterAction(room);
  });
});

function stopWatching(socket) {
  if (socket.data.watch) {
    socket.leave(`watch:${socket.data.watch}`);
    socket.data.watch = undefined;
  }
}

/* ---------- salir (compartido por leave-room y create/join) ---------- */
function leaveCurrent(socket) {
  const room = roomOf(socket);
  if (!room) return;
  const member = G.allMembers(room).find(p => p.socketId === socket.id);
  socket.leave(room.code);
  socket.data.code = undefined;
  if (!member) return;

  G.leavePlayer(room, member.id);

  const peopleLeft = G.allMembers(room).some(p => !p.left);
  if (!peopleLeft) {
    deleteRoom(room);
    return;
  }
  afterAction(room);
}

/* =========================================================
   LIMPIEZA DE SALAS ABANDONADAS
========================================================= */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyConnected = G.allMembers(room).some(p => p.connected);
    if (!anyConnected && now - room.lastActivity > 30 * 60 * 1000) {
      deleteRoom(room);
    }
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dominó Cubano escuchando en el puerto ${PORT}`);
});
