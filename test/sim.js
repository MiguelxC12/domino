"use strict";
const assert = require("assert");
const G = require("../game");

function newRoom(n, mode, variant) {
  const room = G.createRoom("TEST1");
  room.mode = mode;
  room.variant = variant;
  for (let i = 0; i < n; i++) {
    const p = G.createPlayer("J" + i, i === 0);
    room.players.push(p);
    room.hands[p.id] = [];
  }
  G.assignTeams(room);
  G.reseat(room);
  G.resetScores(room);
  return room;
}

function checkInvariants(room, deckSize) {
  // cadena consistente
  for (let i = 0; i < room.board.length - 1; i++) {
    assert.strictEqual(room.board[i].right, room.board[i + 1].left, "cadena rota");
  }
  // conservación de fichas
  const ids = new Set();
  room.board.forEach(p => ids.add(p.id));
  room.players.forEach(p => (room.hands[p.id] || []).forEach(t => {
    assert(!ids.has(t.id), "ficha duplicada " + t.id);
    ids.add(t.id);
  }));
  const dealt = room.players.length * G.handSize(room.variant);
  assert.strictEqual(ids.size, dealt, "fichas perdidas");
  assert(dealt <= deckSize);
}

let games = 0, hands = 0, blocked = 0, ties = 0, outs = 0, passes = 0;
for (const mode of ["team", "individual"]) {
  for (const variant of [6, 9]) {
    for (const n of [2, 3, 4]) {
      for (let rep = 0; rep < 150; rep++) {
        const room = newRoom(n, mode, variant);
        const r = G.startMatch(room);
        if (!r.ok) { assert(mode === "team" && false, "startMatch falló: " + r.message); }
        const deck = variant === 6 ? 28 : 55;
        // equipos enfrentados
        if (mode === "team" && n === 4) {
          assert.strictEqual(room.players[0].team, room.players[2].team);
          assert.strictEqual(room.players[1].team, room.players[3].team);
          assert.notStrictEqual(room.players[0].team, room.players[1].team);
        }
        let guard = 0;
        while (room.phase !== "finished") {
          assert(guard++ < 5000, "partida infinita");
          if (room.phase === "hand-result") {
            hands++;
            const lr = room.lastResult;
            if (lr.reason === "trancada") blocked++;
            if (lr.reason === "empate-tranca") ties++;
            if (lr.reason === "sin-fichas") outs++;
            if (lr.reason === "empate-tranca") assert.strictEqual(lr.awarded, 0);
            assert(G.nextHand(room));
            continue;
          }
          const before = JSON.stringify(room.scores);
          assert(G.autoMove(room), "autoMove falló en fase " + room.phase);
          passes += G.drainNotices(room).filter(m => m.includes("pasó")).length;
          if (room.phase === "playing") {
            checkInvariants(room, deck);
            assert(G.canMove(room, room.turn), "el turno cayó en alguien sin jugada");
          }
        }
        // fin correcto
        const max = Math.max(...room.scores);
        assert(max >= 100, "terminó sin llegar a 100");
        const others = room.scores.filter((s, i) => s !== max);
        games++;
      }
    }
  }
}
console.log({ games, hands, outs, blocked, ties, passes });

// Pruebas puntuales
{
  // orientación correcta por ambos extremos
  const room = newRoom(2, "individual", 6);
  G.startMatch(room);
  const p = room.players.find(x => x.id === room.starterPlayer);
  room.hands[p.id] = [{ id: "x1", a: 1, b: 5 }, { id: "x2", a: 3, b: 5 }, { id: "x3", a: 0, b: 0 }];
  const q = room.players.find(x => x.id !== p.id);
  room.hands[q.id] = [{ id: "y1", a: 5, b: 6 }, { id: "y2", a: 3, b: 4 }, { id: "y3", a: 2, b: 2 }];
  assert(G.chooseStarter(room, p.id, "x1").ok);        // 1|5
  assert.strictEqual(room.turn, q.id);
  // tile jugada con 5-6 por la derecha: 5 toca -> queda 5|6
  assert(G.playTile(room, q.id, "y1", "right").ok);
  assert.deepStrictEqual([room.board[1].left, room.board[1].right], [5, 6]);
  // jugador p: 3-5 no encaja con 6 ni con 1 ... 
  assert.strictEqual(G.fitsSide(room, { a: 3, b: 5 }, "right"), false);
  assert.strictEqual(G.fitsSide(room, { a: 3, b: 5 }, "left"), false);
  // extremos 1 y 6: nadie puede jugar -> tranca
  assert.strictEqual(room.phase, "hand-result");
  assert.strictEqual(room.lastResult.reason, "trancada");
}
{
  // la jugada inválida se rechaza en servidor
  const room = newRoom(2, "individual", 6);
  G.startMatch(room);
  const p = room.players.find(x => x.id === room.starterPlayer);
  const q = room.players.find(x => x.id !== p.id);
  room.hands[p.id] = [{ id: "a1", a: 6, b: 6 }, { id: "a2", a: 0, b: 1 }];
  room.hands[q.id] = [{ id: "b1", a: 5, b: 2 }, { id: "b2", a: 6, b: 3 }];
  G.chooseStarter(room, p.id, "a1");
  assert.strictEqual(G.playTile(room, q.id, "b1", "left").ok, false);
  assert.strictEqual(G.playTile(room, p.id, "a2", "left").ok, false); // no es su turno
  assert.strictEqual(G.playTile(room, q.id, "zzz", "left").ok, false);
  assert(G.playTile(room, q.id, "b2", "left").ok);
  assert.deepStrictEqual([room.board[0].left, room.board[0].right], [3, 6]);
}
{
  // tranca con menor suma individual y empate
  const room = newRoom(4, "team", 6);
  G.startMatch(room);
  const [p0, p1, p2, p3] = room.players;
  room.phase = "playing";
  room.board = [{ id: "s", left: 0, right: 0, owner: p0.id, starter: true }];
  room.starterPlayer = p0.id;
  room.hands[p0.id] = [{ id: "1", a: 2, b: 1 }, { id: "2", a: 5, b: 2 }, { id: "3", a: 3, b: 3 }]; // 14
  room.hands[p1.id] = [{ id: "4", a: 6, b: 4 }, { id: "5", a: 1, b: 1 }];                          // 12
  room.hands[p2.id] = [{ id: "6", a: 6, b: 6 }];                                                    // 12
  room.hands[p3.id] = [{ id: "7", a: 4, b: 5 }];                                                    // 9
  G.advanceTurn(room, p0.id);
  assert.strictEqual(room.lastResult.reason, "trancada");
  assert.strictEqual(room.lastResult.winnerName, p3.name);
  assert.strictEqual(room.lastResult.winningTeam, p3.team);
  // equipo ganador = p1+p3 ; contrario = p0 + p2 = 16 + 12 = 28
  assert.strictEqual(room.lastResult.awarded, 28);
  assert.strictEqual(room.scores[p3.team], 28);

  // empate
  const room2 = newRoom(4, "team", 6);
  G.startMatch(room2);
  const [a, b, c, d] = room2.players;
  room2.phase = "playing";
  room2.board = [{ id: "s", left: 0, right: 0, owner: a.id, starter: true }];
  room2.hands[a.id] = [{ id: "1", a: 5, b: 5 }];
  room2.hands[b.id] = [{ id: "2", a: 6, b: 4 }];
  room2.hands[c.id] = [{ id: "3", a: 6, b: 6 }];
  room2.hands[d.id] = [{ id: "4", a: 2, b: 2 }, { id: "5", a: 4, b: 4 }]; // 12
  G.advanceTurn(room2, a.id);
  // valores 10,10,12,12 -> empate entre a y b
  assert.strictEqual(room2.lastResult.reason, "empate-tranca");
  assert.strictEqual(room2.lastResult.awarded, 0);
  assert.deepStrictEqual(room2.scores, [0, 0]);
}
{
  // el ganador sale en la mano siguiente
  const room = newRoom(4, "team", 6);
  G.startMatch(room);
  const [p0, p1] = room.players;
  room.phase = "playing";
  room.turn = p1.id;
  room.board = [{ id: "s", left: 3, right: 3, owner: p0.id, starter: true }];
  room.hands[p1.id] = [{ id: "w", a: 3, b: 2 }];
  G.playTile(room, p1.id, "w", "right");
  assert.strictEqual(room.phase, "hand-result");
  G.nextHand(room);
  assert.strictEqual(room.starterPlayer, p1.id);
}
{
  // salir en mitad de partida deja un bot jugando; la partida no se cuelga
  const room = newRoom(3, "individual", 6);
  G.startMatch(room);
  G.leavePlayer(room, room.players[1].id);
  assert(room.players[1].left);
  assert.notStrictEqual(room.phase, "lobby");
  G.leavePlayer(room, room.players[2].id);
  assert.strictEqual(room.phase, "lobby");
  assert.strictEqual(room.players.length, 1);
}
console.log("OK: todas las pruebas pasaron");
