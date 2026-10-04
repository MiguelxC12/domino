"use strict";
/*
  Prueba de integración del servidor SIN red: se sustituyen express y
  socket.io por dobles mínimos y se simulan jugadores conectándose,
  jugando, recargando (F5) y saliendo.
*/
const Module = require("module");
const assert = require("assert");
const path = require("path");

/* ---------- dobles ---------- */
let ioInstance;
class FakeSocket {
  constructor(id) {
    this.id = id;
    this.data = {};
    this.handlers = {};
    this.rooms = new Set();
    this.received = [];
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, payload) { this.received.push([ev, payload]); }
  join(r) { this.rooms.add(r); }
  leave(r) { this.rooms.delete(r); }
  // simula un evento del cliente
  fire(ev, payload) { if (this.handlers[ev]) this.handlers[ev](payload); }
  last(ev) {
    for (let i = this.received.length - 1; i >= 0; i--) {
      if (this.received[i][0] === ev) return this.received[i][1];
    }
  }
}
class FakeServer {
  constructor() {
    this.handlers = {};
    this.sockets = { sockets: new Map() };
    ioInstance = this;
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  to(id) {
    return {
      emit: (ev, payload) => {
        for (const s of this.sockets.sockets.values()) {
          if (s.id === id || s.rooms.has(id)) s.emit(ev, payload);
        }
      }
    };
  }
  connect(id) {
    const s = new FakeSocket(id);
    this.sockets.sockets.set(id, s);
    this.handlers.connection(s);
    return s;
  }
  disconnect(s) {
    s.fire("disconnect");
    this.sockets.sockets.delete(s.id);
  }
}
const routes = [];
function fakeExpress() {
  const app = () => {};
  app.disable = () => {};
  app.use = (...a) => routes.push(["use", a]);
  app.get = (...a) => routes.push(["get", a]);
  return app;
}
fakeExpress.static = () => () => {};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "express") return fakeExpress;
  if (request === "socket.io") return { Server: FakeServer };
  return origLoad.call(this, request, ...rest);
};
process.env.PORT = "0";
process.env.ADMIN_PASSWORD = "secreta";

// evitar que el servidor abra un puerto real
const http = require("http");
const realCreate = http.createServer;
http.createServer = () => ({ listen: (p, h, cb) => cb && cb() });

require(path.join(__dirname, "..", "server.js"));
http.createServer = realCreate;

/* ---------- escenario ---------- */
const io = ioInstance;
const host = io.connect("s1");
host.fire("create-room", { name: "Miguel" });
const joined = host.last("joined");
assert(joined && joined.room && joined.token, "create-room debe devolver token");
const code = joined.room;

const names = ["Carlos", "Juan", "Pedro"];
const socks = [host];
const tokens = [joined.token];
const ids = [joined.playerId];
names.forEach((n, i) => {
  const s = io.connect("s" + (i + 2));
  s.fire("join-room", { code, name: n });
  const j = s.last("joined");
  assert(j, "join-room debe devolver joined");
  socks.push(s); tokens.push(j.token); ids.push(j.playerId);
});

// nadie puede ver las manos ajenas ni los tokens
let st = host.last("state");
assert.strictEqual(st.players.length, 4);
assert(!JSON.stringify(st).includes(tokens[1]), "el token de otro jugador se filtró");
assert(!JSON.stringify(st).includes("token"), "no debe enviarse ningún token en el estado");

// un 5.º jugador no entra
const extra = io.connect("sx");
extra.fire("join-room", { code, name: "Intruso" });
assert.strictEqual(extra.last("game-error"), "La sala está llena.");

// secuestro: un socket con el id público de otro NO entra a su asiento
const thief = io.connect("sthief");
thief.fire("join-room", { code, token: ids[1], name: "Ladrón" });
assert(!thief.last("joined"), "no se debe poder entrar con el id público");

// solo el anfitrión inicia
socks[1].fire("start-game");
assert.strictEqual(socks[1].last("game-error"), "Solo el anfitrión puede iniciar.");
host.fire("configure", { variant: 6, mode: "team" });
host.fire("start-game");
st = host.last("state");
assert.strictEqual(st.phase, "starter-choice");

// F5 del jugador 2 en pleno juego: mismo asiento, misma mano
const before = socks[1].last("state").hands[ids[1]];
io.disconnect(socks[1]);
const reload = io.connect("s2b");
reload.fire("join-room", { code, token: tokens[1], name: "Carlos" });
assert.strictEqual(reload.last("joined").playerId, ids[1], "F5 debe devolver el mismo jugador");
assert.deepStrictEqual(reload.last("state").hands[ids[1]], before, "F5 debe conservar la mano");
socks[1] = reload;

// jugar una mano completa con jugadas válidas elegidas por el cliente
function stateOf(i) { return socks[i].last("state"); }
function myIndex(playerId) { return ids.indexOf(playerId); }
let steps = 0;
while (stateOf(0).phase !== "finished" && steps++ < 3000) {
  const s = stateOf(0);
  if (s.phase === "hand-result") { socks[2].fire("next-hand"); continue; }
  if (s.phase === "starter-choice") {
    const i = myIndex(s.starterPlayer);
    const hand = stateOf(i).hands[ids[i]];
    // jugada inválida de otro jugador es rechazada
    const other = (i + 1) % 4;
    socks[other].fire("choose-starter", { tileId: hand[0].id });
    assert.strictEqual(socks[other].last("game-error"), "No eres el jugador que debe salir.");
    socks[i].fire("choose-starter", { tileId: hand[0].id });
    continue;
  }
  const i = myIndex(s.turn);
  const me = stateOf(i);
  const hand = me.hands[ids[i]];
  const L = me.board[0].left, R = me.board[me.board.length - 1].right;
  const t = hand.find(x => x.a === L || x.b === L || x.a === R || x.b === R);
  assert(t, "el turno cayó en alguien sin jugada");
  const side = (t.a === L || t.b === L) ? "left" : "right";
  // intento de jugar fuera de turno
  const wrong = (i + 1) % 4;
  socks[wrong].fire("play-tile", { tileId: stateOf(wrong).hands[ids[wrong]][0].id, side: "left" });
  assert.strictEqual(socks[wrong].last("game-error"), "No es tu turno.");
  socks[i].fire("play-tile", { tileId: t.id, side });
}
assert.strictEqual(stateOf(0).phase, "finished", "la partida debe terminar");
assert(Math.max(...stateOf(0).scores) >= 100);

// reinicio de partida por cualquier jugador
socks[3].fire("new-match");
assert.strictEqual(stateOf(0).phase, "starter-choice");
assert.deepStrictEqual(stateOf(0).scores, [0, 0]);

// SALIR en pleno juego: ya no puede volver con su token
socks[3].fire("leave-room");
const back = io.connect("s4b");
back.fire("join-room", { code, token: tokens[3], name: "Pedro" });
assert(back.last("session-invalid"), "tras SALIR no debe reconectar");
assert(!back.last("joined"));

// admin: contraseña incorrecta y correcta
const adm = io.connect("sadm");
adm.fire("admin-auth", { password: "mal" });
assert.strictEqual(adm.last("admin-auth-result").ok, false);
adm.fire("admin-auth", { password: "secreta" });
assert.strictEqual(adm.last("admin-auth-result").ok, true);
assert(adm.last("admin-rooms").some(r => r.code === code));

// el admin sin autenticar no puede cambiar nada
const nobody = io.connect("snobody");
nobody.fire("admin-change", { code, action: "close" });
assert(io.sockets.sockets.get("s1").last("session-invalid") === undefined);

console.log("OK: prueba de servidor superada");
process.exit(0);
