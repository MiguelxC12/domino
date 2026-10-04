const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.status(200).json({
    ok: true,
    rooms: rooms.size,
    uptime: Math.round(process.uptime())
  });
});

const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.warn("ADVERTENCIA: ADMIN_PASSWORD no está configurada. El panel de administrador permanecerá deshabilitado.");
}

const rooms = new Map();
const admins = new Set();

const MAX_SCORE = 100;


/* =========================================================
   UTILIDADES
========================================================= */

function id() {
  return crypto.randomBytes(8).toString("hex");
}

function roomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function shuffle(array) {
  const a = [...array];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function createTiles(max) {
  const result = [];

  for (let a = 0; a <= max; a++) {
    for (let b = a; b <= max; b++) {
      result.push({
        id: id(),
        a,
        b
      });
    }
  }

  return result;
}

function playerById(room, playerId) {
  return room.players.find(p => p.id === playerId);
}

function socketPlayer(room, socket) {
  return room.players.find(p => p.socketId === socket.id);
}

function getPlayerTiles(room, playerId) {
  return room.hands[playerId] || [];
}

function tileValue(tile) {
  return tile.a + tile.b;
}


/* =========================================================
   EQUIPOS
========================================================= */

function assignTeams(room) {
  room.players.forEach((player, index) => {
    if (room.mode === "individual") {
      player.team = index;
    } else {
      player.team = index % 2;
    }
  });
}

function teamPlayers(room, team) {
  return room.players.filter(p => p.team === team);
}

function teamScore(room, team) {
  return room.scores[team] || 0;
}


/* =========================================================
   CREAR SALA
========================================================= */

function createRoom() {
  const code = roomCode();

  const room = {
    code,

    variant: 9,

    mode: "team",

    phase: "lobby",

    players: [],

    hands: {},

    board: [],

    scores: [0, 0],

    turn: null,

    starterTeam: null,

    starterPlayer: null,

    starterChoice: null,

    lastResult: null,

    handNumber: 0,

    winner: null,

    consecutivePasses: 0,
    lastPass: null
  };

  rooms.set(code, room);

  return room;
}


/* =========================================================
   ESTADO PÚBLICO
========================================================= */

function publicState(room, viewerId) {

  const hands = {};

  room.players.forEach(player => {

    const hand =
      room.hands[player.id] || [];

    hands[player.id] = {
      count: hand.length
    };

    if (player.id === viewerId) {
      hands[player.id] = hand;
    }
  });

  return {
    code: room.code,

    variant: room.variant,

    mode: room.mode,

    phase: room.phase,

    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      seat: p.seat,
      host: p.host,
      connected: !!p.connected
    })),

    hands,

    board: room.board,

    scores: room.scores,

    turn: room.turn,

    starterTeam: room.starterTeam,

    starterPlayer: room.starterPlayer,

    starterChoice: room.starterChoice,

    lastResult: room.lastResult,

    handNumber: room.handNumber,

    winner: room.winner,

    lastPass: room.lastPass,

    isStarterChoice:
      room.phase === "starter-choice" &&
      room.starterPlayer === viewerId
  };
}

function sendState(room) {

  room.players.forEach(player => {

    if (!player.socketId) {
      return;
    }

    io.to(player.socketId).emit(
      "state",
      publicState(room, player.id)
    );
  });
}


/* =========================================================
   INICIAR MANO
========================================================= */

function startHand(room) {

  const previousResult = room.lastResult;

  if (room.players.length < 2) {
    return false;
  }

  room.handNumber++;

  room.board = [];

  room.hands = {};

  room.turn = null;

  room.starterPlayer = null;

  room.starterChoice = null;

  room.lastResult = null;

  room.winner = null;

  room.consecutivePasses = 0;
  room.lastPass = null;


  const tiles =
    shuffle(
      createTiles(room.variant)
    );


  const amount =
    room.variant === 6
      ? 7
      : 10;


  room.players.forEach(player => {

    room.hands[player.id] =
      tiles.splice(0, amount);

  });


  /*
     Primera mano:
     equipo elegido al azar.

     En las siguientes:
     comienza el equipo ganador
     de la mano anterior.
  */

  let candidates;

  if (room.handNumber === 1) {
    if (room.mode === "team") {
      room.starterTeam = Math.floor(Math.random() * 2);
      candidates = teamPlayers(room, room.starterTeam);
    } else {
      room.starterTeam = null;
      candidates = room.players;
    }
  } else if (room.mode === "team") {
    room.starterTeam = previousResult?.winningTeam ?? room.starterTeam;
    candidates = teamPlayers(room, room.starterTeam);
  } else {
    room.starterTeam = null;
    const previousWinner = previousResult?.winningPlayer;
    candidates = previousWinner
      ? room.players.filter(p => p.id === previousWinner)
      : room.players;
  }

  if (!candidates.length) return false;

  const starter = candidates[Math.floor(Math.random() * candidates.length)];


  room.starterPlayer =
    starter.id;


  room.phase =
    "starter-choice";


  sendState(room);

  return true;
}


/* =========================================================
   COLOCAR PRIMERA FICHA
========================================================= */

function chooseStarter(
  room,
  player,
  tileId
) {

  if (room.phase !== "starter-choice") {
    return {
      ok: false,
      message: "Ya no se está eligiendo la salida."
    };
  }


  if (player.id !== room.starterPlayer) {

    return {
      ok: false,
      message: "No eres el jugador que debe salir."
    };
  }


  const hand =
    room.hands[player.id] || [];


  const index =
    hand.findIndex(
      tile => tile.id === tileId
    );


  if (index < 0) {

    return {
      ok: false,
      message: "Esa ficha no está en tu mano."
    };
  }


  const tile =
    hand.splice(index, 1)[0];


  /*
     La primera ficha siempre queda
     exactamente en el centro del tablero.

     La mantenemos en orientación vertical
     salvo que sea doble.
  */

  room.board = [{
    id: tile.id,
    left: tile.a,
    right: tile.b,
    owner: player.id
  }];


  room.starterChoice = {
    tileId: tile.id,
    playerId: player.id
  };


  /*
     Después de salir, continúa el jugador siguiente
     en sentido antihorario según los asientos.
  */

  const ordered =
    [...room.players]
      .sort((a, b) => a.seat - b.seat);


  const indexPlayer =
    ordered.findIndex(
      p => p.id === player.id
    );


  const next =
    ordered[
      (indexPlayer + 1) %
      ordered.length
    ];


  room.turn = next.id;

  room.phase = "playing";
  advanceThroughPasses(room);

  sendState(room);

  return { ok: true };
}


/* =========================================================
   VALIDAR FICHA
========================================================= */

function canPlayTile(tile, room, side) {

  if (!room.board.length) {
    return true;
  }

  if (side === "left") {

    const value =
      room.board[0].left;

    return (
      tile.a === value ||
      tile.b === value
    );
  }


  if (side === "right") {

    const value =
      room.board[
        room.board.length - 1
      ].right;

    return (
      tile.a === value ||
      tile.b === value
    );
  }


  return false;
}


/* =========================================================
   ORIENTAR FICHA
========================================================= */

function orientedTile(tile, side) {

  if (side === "left") {

    /*
       El número que toca al tablero
       debe quedar a la DERECHA de la ficha.
    */

    if (tile.b !== undefined) {

      return {
        left: tile.b,
        right: tile.a
      };

    }

  }


  if (side === "right") {

    /*
       El número que toca al tablero
       debe quedar a la IZQUIERDA.
    */

    return {
      left: tile.a,
      right: tile.b
    };
  }


  return {
    left: tile.a,
    right: tile.b
  };
}


/* =========================================================
   JUGAR FICHA
========================================================= */

function playTile(
  room,
  player,
  tileId,
  side
) {

  if (room.phase !== "playing") {

    return {
      ok: false,
      message: "La partida no está en juego."
    };
  }


  if (room.turn !== player.id) {

    return {
      ok: false,
      message: "No es tu turno."
    };
  }


  if (
    side !== "left" &&
    side !== "right"
  ) {

    return {
      ok: false,
      message: "Extremo inválido."
    };
  }


  const hand =
    room.hands[player.id] || [];


  const index =
    hand.findIndex(
      tile => tile.id === tileId
    );


  if (index < 0) {

    return {
      ok: false,
      message: "La ficha no está en tu mano."
    };
  }


  const tile = hand[index];


  /*
     VALIDACIÓN REAL EN SERVIDOR.
  */

  if (!canPlayTile(tile, room, side)) {

    return {
      ok: false,
      message:
        "Esa ficha no coincide con ese extremo."
    };
  }


  const oriented =
    orientedTile(tile, side);


  hand.splice(index, 1);


  const placed = {
    id: tile.id,
    left: oriented.left,
    right: oriented.right,
    owner: player.id
  };


  if (side === "left") {
    room.board.unshift(placed);
  } else {
    room.board.push(placed);
  }

  room.consecutivePasses = 0;
  room.lastPass = null;

  /*
     Si se quedó sin fichas,
     gana la mano.
  */

  if (hand.length === 0) {

    finishHand(
      room,
      player
    );

    return { ok: true };
  }


  nextTurn(room, player.id);
  advanceThroughPasses(room);

  if (room.phase === "playing") {
    sendState(room);
  }

  return { ok: true };
}


/* =========================================================
   SIGUIENTE TURNO
========================================================= */

function activePlayers(room) {
  return room.players.filter(
    p => p.connected !== false && (room.hands[p.id] || []).length > 0
  );
}

function nextConnectedPlayer(room, playerId) {
  const ordered = [...room.players].sort((a, b) => a.seat - b.seat);
  const index = ordered.findIndex(p => p.id === playerId);
  if (index < 0) return null;

  for (let i = 1; i <= ordered.length; i++) {
    const next = ordered[(index + i) % ordered.length];
    if (next.connected !== false) return next;
  }
  return null;
}

function nextTurn(room, playerId) {
  const next = nextConnectedPlayer(room, playerId);
  room.turn = next ? next.id : null;
}

function playerCanMove(room, player) {
  const hand = room.hands[player.id] || [];
  return hand.some(tile =>
    canPlayTile(tile, room, "left") ||
    canPlayTile(tile, room, "right")
  );
}

/*
   Si el jugador actual no tiene ninguna jugada legal, pasa automáticamente.
   Cuando todos los jugadores activos pasan, la mano termina en trancada.
*/
function advanceThroughPasses(room) {
  if (room.phase !== "playing" || !room.turn) return;

  const active = activePlayers(room);
  if (!active.length) {
    room.turn = null;
    return;
  }

  for (let i = 0; i < active.length; i++) {
    const current = playerById(room, room.turn);

    if (!current || current.connected === false) {
      if (current) nextTurn(room, current.id);
      else room.turn = active[0].id;
      continue;
    }

    if (playerCanMove(room, current)) return;

    room.consecutivePasses += 1;
    room.lastPass = {
      playerId: current.id,
      playerName: current.name
    };

    if (room.consecutivePasses >= active.length) {
      finishBlocked(room);
      return;
    }

    nextTurn(room, current.id);
  }
}

/* =========================================================
   TRANCADA
========================================================= */

function finishBlocked(room) {

  const values =
    room.players.map(player => ({
      player,
      value:
        (room.hands[player.id] || [])
          .reduce(
            (sum, tile) =>
              sum + tileValue(tile),
            0
          )
    }));


  /*
     REGLA CUBANA SOLICITADA:

     En una tranca se compara el valor INDIVIDUAL
     de cada jugador.

     No se suma primero toda la pareja.
  */

  const lowest =
    Math.min(
      ...values.map(x => x.value)
    );


  const winners =
    values.filter(
      x => x.value === lowest
    );


  if (winners.length !== 1) {

    room.lastResult = {
      winningTeam: null,
      winningPlayer: null,
      awarded: 0,
      reason: "empate-tranca",
      detail:
        winners
          .map(x => x.player.name)
          .join(" / "),
      scores: [...room.scores]
    };

    room.phase = "hand-result";

    sendState(room);

    return;
  }


  const winner =
    winners[0].player;


  finishHand(
    room,
    winner,
    "trancada"
  );
}


/* =========================================================
   TERMINAR MANO
========================================================= */

function finishHand(
  room,
  winner,
  reason = "sin-fichas"
) {

  let winningTeam = null;
  let winningPlayer = null;


  if (room.mode === "team") {

    winningTeam =
      winner.team;

  } else {

    winningPlayer =
      winner.id;
  }


  let awarded = 0;


  /*
     El equipo/jugador ganador recibe
     la suma de los puntos restantes
     del contrario.

     En modo individual:
     recibe la suma de todos los demás.
  */

  if (room.mode === "team") {

    const losingTeam =
      winningTeam === 0
        ? 1
        : 0;


    awarded =
      teamPlayers(
        room,
        losingTeam
      ).reduce(
        (sum, player) =>
          sum +
          (room.hands[player.id] || [])
            .reduce(
              (a, tile) =>
                a + tileValue(tile),
              0
            ),
        0
      );


    room.scores[winningTeam] +=
      awarded;

  } else {

    awarded =
      room.players
        .filter(
          p => p.id !== winner.id
        )
        .reduce(
          (sum, player) =>
            sum +
            (room.hands[player.id] || [])
              .reduce(
                (a, tile) =>
                  a + tileValue(tile),
                0
              ),
          0
        );


    const index =
      room.players.findIndex(
        p => p.id === winner.id
      );


    if (index >= 0) {
      room.scores[index] += awarded;
    }
  }


  const finished =
    room.mode === "team"
      ? room.scores.some(
          score => score >= MAX_SCORE
        )
      : room.scores.some(
          score => score >= MAX_SCORE
        );


  room.lastResult = {
    winningTeam,
    winningPlayer,
    awarded,
    reason,
    detail:
      reason === "trancada"
        ? `${winner.name} (${tileValue(
            (room.hands[winner.id] || [])
              .reduce(
                (a,b) =>
                  tileValue(a) <= tileValue(b)
                    ? a
                    : b,
                {a:0,b:0}
              )
          )})`
        : winner.name,
    scores: [...room.scores]
  };


  if (finished) {

    room.phase = "finished";

    room.winner =
      room.mode === "team"
        ? winningTeam
        : winningPlayer;

  } else {

    room.phase = "hand-result";
  }


  sendState(room);
}


/* =========================================================
   NUEVA MANO
========================================================= */

function nextHand(room) {

  if (
    room.phase !== "hand-result"
  ) {
    return false;
  }


  startHand(room);

  return true;
}


/* =========================================================
   NUEVA PARTIDA
========================================================= */

function newMatch(room) {

  room.scores =
    room.mode === "team"
      ? [0, 0]
      : room.players.map(() => 0);

  room.handNumber = 0;

  room.winner = null;

  room.lastResult = null;

  startHand(room);
}


/* =========================================================
   CONFIGURACIÓN
========================================================= */

function configure(room, data) {

  if (room.phase !== "lobby") {
    return;
  }


  if (
    data.variant === 6 ||
    data.variant === 9
  ) {

    room.variant =
      Number(data.variant);

  }


  if (
    data.mode === "team" ||
    data.mode === "individual"
  ) {

    room.mode =
      data.mode;

  }


  assignTeams(room);

  room.scores =
    room.mode === "team"
      ? [0, 0]
      : room.players.map(() => 0);

  sendState(room);
}


/* =========================================================
   ADMIN
========================================================= */

function adminRooms() {

  return [...rooms.values()]
    .map(room => ({
      code: room.code,
      variant: room.variant,
      mode: room.mode,
      phase: room.phase,
      scores: room.scores,
      players:
        room.players.map(p => ({
          id: p.id,
          name: p.name,
          team: p.team,
          host: p.host,
          connected: !!p.connected
        }))
    }));
}


function emitAdminRooms() {

  admins.forEach(socketId => {

    io.to(socketId).emit(
      "admin-rooms",
      adminRooms()
    );

  });
}


/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", socket => {

  /*
     CREAR SALA
  */

  socket.on(
    "create-room",
    data => {

      const room =
        createRoom();


      const playerId =
        data.playerId ||
        id();


      const player = {
        id: playerId,

        socketId: socket.id,

        name:
          String(
            data.name || "Jugador"
          ).substring(0, 30),

        team: 0,

        seat: 0,

        host: true,

        connected: true
      };


      room.players.push(player);

      room.hands[player.id] = [];


      socket.join(room.code);

      socket.emit(
        "joined",
        {
          room: room.code,
          playerId
        }
      );


      sendState(room);

      emitAdminRooms();
    }
  );


  /*
     ENTRAR / RECONEXIÓN
  */

  socket.on(
    "join-room",
    data => {

      const code =
        String(
          data.code || ""
        ).toUpperCase();


      const room =
        rooms.get(code);


      if (!room) {

        return socket.emit(
          "game-error",
          "La sala no existe."
        );
      }


      let player =
        playerById(
          room,
          data.playerId
        );


      /*
         CASO F5:

         El jugador ya existe.

         Simplemente le asignamos
         el nuevo socket.
      */

      if (player) {

        player.socketId =
          socket.id;

        player.connected =
          true;

        if (data.name) {
          player.name =
            String(data.name)
              .substring(0,30);
        }

      } else {

        if (room.phase !== "lobby") {
          return socket.emit(
            "game-error",
            "La partida ya comenzó. Solo puedes volver a entrar con tu sesión."
          );
        }

        if (room.players.length >= 4) {

          return socket.emit(
            "game-error",
            "La sala está llena."
          );
        }


        player = {
          id:
            data.playerId ||
            id(),

          socketId:
            socket.id,

          name:
            String(
              data.name ||
              "Jugador"
            ).substring(0,30),

          team:
            room.players.length % 2,

          seat:
            room.players.length,

          host:
            room.players.length === 0,

          connected:true
        };


        room.players.push(player);

        room.hands[player.id] = [];
      }


      /*
         Si el anfitrión desapareció,
         el primero conectado vuelve a ser host.
      */

      if (
        !room.players.some(p => p.host)
      ) {

        player.host = true;
      }


      socket.join(room.code);


      socket.emit(
        "joined",
        {
          room:room.code,
          playerId:player.id
        }
      );


      sendState(room);

      emitAdminRooms();
    }
  );


  /*
     CONFIGURACIÓN DEL ANFITRIÓN
  */

  socket.on(
    "configure",
    data => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) return;


      const player =
        socketPlayer(
          room,
          socket
        );


      if (!player?.host) {
        return;
      }


      configure(
        room,
        data
      );
    }
  );


  /*
     INICIAR
  */

  socket.on(
    "start-game",
    () => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) return;


      const player =
        socketPlayer(
          room,
          socket
        );


      if (!player?.host) {
        return socket.emit(
          "game-error",
          "Solo el anfitrión puede iniciar."
        );
      }


      if (room.players.length < 2) {

        return socket.emit(
          "game-error",
          "Se necesitan al menos 2 jugadores."
        );
      }


      if (room.mode === "team") {

        assignTeams(room);

      }


      room.scores =
        room.mode === "team"
          ? [0,0]
          : room.players.map(() => 0);


      startHand(room);

      emitAdminRooms();
    }
  );


  /*
     ELECCIÓN DE LA FICHA INICIAL
  */

  socket.on(
    "choose-starter",
    data => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) return;


      const player =
        socketPlayer(
          room,
          socket
        );


      if (!player) return;


      const result =
        chooseStarter(
          room,
          player,
          data.tileId
        );


      if (!result.ok) {

        socket.emit(
          "game-error",
          result.message
        );

      }
    }
  );


  /*
     JUGAR
  */

  socket.on(
    "play-tile",
    data => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) return;


      const player =
        socketPlayer(
          room,
          socket
        );


      if (!player) return;


      const result =
        playTile(
          room,
          player,
          data.tileId,
          data.side
        );


      if (!result.ok) {

        socket.emit(
          "game-error",
          result.message
        );

        sendState(room);

        return;
      }


    }
  );


  /*
     RESPALDO PARA PASAR TURNO
  */

  socket.on(
    "pass-turn",
    () => {
      const room = [...rooms.values()].find(r =>
        r.players.some(p => p.socketId === socket.id)
      );
      if (!room) return;

      const player = socketPlayer(room, socket);
      if (!player || room.phase !== "playing") return;

      if (room.turn !== player.id) {
        return socket.emit("game-error", "No es tu turno.");
      }

      if (playerCanMove(room, player)) {
        return socket.emit("game-error", "Tienes una ficha que puedes jugar.");
      }

      room.consecutivePasses += 1;
      room.lastPass = { playerId: player.id, playerName: player.name };

      if (room.consecutivePasses >= activePlayers(room).length) {
        finishBlocked(room);
        return;
      }

      nextTurn(room, player.id);
      advanceThroughPasses(room);
      if (room.phase === "playing") sendState(room);
    }
  );


  /*
     SIGUIENTE MANO
  */

  socket.on(
    "next-hand",
    () => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) return;


      const player =
        socketPlayer(
          room,
          socket
        );


      if (!player?.host) {
        return;
      }


      nextHand(room);
    }
  );


  /*
     NUEVA PARTIDA
  */

  socket.on(
    "new-match",
    () => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) return;


      const player =
        socketPlayer(
          room,
          socket
        );


      if (!player?.host) {
        return;
      }


      newMatch(room);
    }
  );


  /*
     SALIR REALMENTE DE LA SALA
  */

  socket.on(
    "leave-room",
    () => {

      const room =
        [...rooms.values()]
          .find(r =>
            r.players.some(
              p =>
                p.socketId ===
                socket.id
            )
          );


      if (!room) {
        return;
      }


      const index =
        room.players.findIndex(
          p =>
            p.socketId ===
            socket.id
        );


      if (index < 0) {
        return;
      }


      const player =
        room.players[index];


      const wasTurn = room.turn === player.id;
      const oldScoreIndex = index;

      delete room.hands[player.id];
      room.players.splice(index, 1);

      if (room.mode === "individual" && Array.isArray(room.scores)) {
        room.scores.splice(oldScoreIndex, 1);
      }

      if (wasTurn && room.phase === "playing" && room.players.length >= 2) {
        const replacement = room.players.find(p => p.connected !== false);
        room.turn = replacement ? replacement.id : null;
        if (room.turn) advanceThroughPasses(room);
      }


      socket.leave(
        room.code
      );


      /*
         Reasignar asientos.
      */

      room.players.forEach(
        (p,i) => {
          p.seat = i;
        }
      );


      /*
         Si salió el host,
         otro jugador pasa a ser host.
      */

      if (
        room.players.length &&
        !room.players.some(
          p => p.host
        )
      ) {

        room.players[0].host = true;
      }


      /*
         Si ya no hay suficientes jugadores
         para continuar, volvemos al lobby.
      */

      if (
        room.players.length < 2 &&
        room.phase !== "lobby"
      ) {

        room.phase = "lobby";

        room.board = [];

        room.turn = null;

      }


      if (room.players.length === 0) {

        rooms.delete(room.code);

      } else {

        sendState(room);
      }


      emitAdminRooms();
    }
  );


  /*
     ADMIN AUTH
  */

  socket.on(
    "admin-auth",
    data => {

      const password =
        String(
          data.password || ""
        );


      if (
        password !==
        ADMIN_PASSWORD
      ) {

        return socket.emit(
          "admin-auth-result",
          {ok:false}
        );
      }


      admins.add(socket.id);


      socket.emit(
        "admin-auth-result",
        {ok:true}
      );


      socket.emit(
        "admin-rooms",
        adminRooms()
      );
    }
  );


  /*
     ADMIN REFRESH
  */

  socket.on(
    "admin-refresh",
    () => {

      if (!admins.has(socket.id)) {
        return;
      }


      socket.emit(
        "admin-rooms",
        adminRooms()
      );
    }
  );


  /*
     ADMIN CAMBIOS
  */

  socket.on(
    "admin-change",
    data => {

      if (!admins.has(socket.id)) {
        return;
      }


      const room =
        rooms.get(
          String(
            data.code || ""
          ).toUpperCase()
        );


      if (!room) return;


      switch (data.action) {

        case "mode":

          if (
            room.phase === "lobby" &&
            (
              data.value === "team" ||
              data.value === "individual"
            )
          ) {

            room.mode =
              data.value;

            assignTeams(room);

            room.scores =
              room.mode === "team"
                ? [0,0]
                : room.players.map(() => 0);

          }

          break;


        case "variant":

          if (
            room.phase === "lobby" &&
            (
              Number(data.value) === 6 ||
              Number(data.value) === 9
            )
          ) {

            room.variant =
              Number(data.value);

          }

          break;


        case "rename": {

          const p =
            playerById(
              room,
              data.value?.id
            );


          if (p) {

            p.name =
              String(
                data.value.name ||
                p.name
              ).substring(0,30);

          }

          break;
        }


        case "team": {

          const p =
            playerById(
              room,
              data.value?.id
            );


          if (
            p &&
            room.mode === "team" &&
            room.phase === "lobby"
          ) {

            p.team =
              Number(data.value.team) === 1
                ? 1
                : 0;

          }

          break;
        }


        case "host": {

          room.players.forEach(
            p => {
              p.host =
                p.id ===
                data.value?.id;
            }
          );

          break;
        }


        case "start":

          if (
            room.players.length >= 2 &&
            room.phase === "lobby"
          ) {

            assignTeams(room);

            room.scores =
              room.mode === "team"
                ? [0,0]
                : room.players.map(() => 0);

            startHand(room);

          }

          break;
      }


      sendState(room);

      emitAdminRooms();
    }
  );


  /*
     DESCONEXIÓN.

     MUY IMPORTANTE:

     NO eliminamos al jugador.

     Esto permite F5/reconexión.
  */

  socket.on(
    "disconnect",
    () => {

      admins.delete(
        socket.id
      );


      for (const room of rooms.values()) {

        const player =
          room.players.find(
            p =>
              p.socketId ===
              socket.id
          );


        if (!player) {
          continue;
        }


        player.connected = false;
        player.socketId = null;

        if (player.host && room.phase === "lobby") {
          const replacement = room.players.find(
            p => p.id !== player.id && p.connected !== false
          );
          if (replacement) {
            player.host = false;
            replacement.host = true;
          }
        }

        sendState(room);

        emitAdminRooms();

        break;
      }
    }
  );
});


/* =========================================================
   HTTP
========================================================= */

app.get("/{*splat}", (req,res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Dominó Cubano escuchando en puerto ${PORT}`
    );

  }
);
