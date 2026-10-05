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
  emit(ev, payload) {
    for (const s of this.sockets.sockets.values()) s.emit(ev, payload);
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
  app.post = (...a) => routes.push(["post", a]);
  return app;
}
fakeExpress.static = () => () => {};
fakeExpress.raw = () => () => {};
fakeExpress.json = () => () => {};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "express") return fakeExpress;
  if (request === "socket.io") return { Server: FakeServer };
  return origLoad.call(this, request, ...rest);
};
process.env.PORT = "0";
process.env.DATA_DIR = require("fs").mkdtempSync(require("os").tmpdir() + "/domino-test-");
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

// un 5.º entra como ESPECTADOR (no como jugador)
const extra = io.connect("sx");
extra.fire("join-room", { code, name: "Pepe" });
const exJoined = extra.last("joined");
assert(exJoined, "el 5.º debe poder entrar");
let exSt = extra.last("state");
assert.strictEqual(exSt.spectator, true);
assert.strictEqual(exSt.players.length, 4);
assert.strictEqual(exSt.spectators.length, 1);
assert.strictEqual(exSt.isHost, false);

// un espectador no puede cambiar roles ni iniciar
extra.fire("start-game");
assert.strictEqual(extra.last("game-error"), "Solo el anfitrión puede iniciar.");
extra.fire("move-member", { id: exJoined.playerId, to: "players" });
assert.strictEqual(extra.last("game-error"), "Solo el anfitrión puede cambiar los roles.");

// con 4 jugadores el anfitrión no puede subir a un 5.º
host.fire("move-member", { id: exJoined.playerId, to: "players" });
assert.strictEqual(host.last("game-error"), "Ya hay 4 jugadores. Pasa a alguien a espectador primero.");

// el anfitrión pasa a Pedro a espectador y sube a Pepe; luego los revierte
host.fire("move-member", { id: ids[3], to: "spectators" });
assert.strictEqual(host.last("state").players.length, 3);
assert.strictEqual(host.last("state").spectators.length, 2);
host.fire("move-member", { id: exJoined.playerId, to: "players" });
assert(host.last("state").players.some(p => p.id === exJoined.playerId));
host.fire("move-member", { id: exJoined.playerId, to: "spectators" });
host.fire("move-member", { id: ids[3], to: "players" });
st = host.last("state");
assert.deepStrictEqual(st.players.map(p => p.id).sort(), [...ids].sort());
assert.strictEqual(st.spectators.length, 1);

// el anfitrión puede cambiar el equipo de cualquiera; los demás solo el suyo
host.fire("set-team", { id: ids[1], team: 1 });
socks[2].fire("set-team", { id: ids[1], team: 0 }); // ignora el id ajeno
const teamOf = id => host.last("state").players.find(p => p.id === id).team;
assert.strictEqual(teamOf(ids[1]), 1);

// secuestro: un socket con el id público de otro NO entra a su asiento
const thief = io.connect("sthief");
thief.fire("join-room", { code, token: ids[1], name: "Ladrón" });
// con un id público (que no es token) solo se entra como persona NUEVA: espectador
const tj = thief.last("joined");
assert(tj && tj.playerId !== ids[1], "no se debe poder tomar el asiento de otro");
assert.strictEqual(thief.last("state").spectator, true);
assert(!ids.includes(tj.playerId));

// solo el anfitrión inicia
socks[1].fire("start-game");
assert.strictEqual(socks[1].last("game-error"), "Solo el anfitrión puede iniciar.");
host.fire("configure", { variant: 6, mode: "team" });
host.fire("start-game");
st = host.last("state");
assert.strictEqual(st.phase, "starter-choice");

// el espectador ve la mesa pero NO las manos
exSt = extra.last("state");
assert.strictEqual(exSt.phase, "starter-choice");
Object.values(exSt.hands).forEach(h => assert(!Array.isArray(h), "el espectador no debe ver manos"));
extra.fire("choose-starter", { tileId: "t00" });
extra.fire("play-tile", { tileId: "t00", side: "left" });
assert.strictEqual(host.last("state").phase, "starter-choice", "un espectador no puede jugar");

// alguien que entra con la partida empezada también es espectador
const late = io.connect("slate");
late.fire("join-room", { code, name: "Tarde" });
assert.strictEqual(late.last("state").spectator, true);
assert.strictEqual(late.last("state").spectators.length, 3);

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

// el admin ve TODAS las manos
const notAdmin = io.connect("snotadmin");
notAdmin.fire("admin-watch", { code });
assert(!notAdmin.last("watch-state"), "solo el admin puede espectar");
adm.fire("admin-watch", { code });
let w = adm.last("watch-state");
assert(w && w.god === true);
ids.slice(0, 3).forEach(id => assert(Array.isArray(w.hands[id]), "el admin debe ver las manos"));

// el admin ajusta el marcador y expulsa a un espectador
adm.fire("admin-change", { code, action: "score", value: { index: 0, value: 40 } });
assert.strictEqual(host.last("state").scores[0], 40);
adm.fire("admin-change", { code, action: "kick", value: { id: exJoined.playerId } });
assert(extra.last("session-invalid"), "el expulsado recibe session-invalid");
assert.strictEqual(host.last("state").spectators.length, 2);

// el admin vuelve a la sala y cambia roles en cualquier momento del lobby
adm.fire("admin-change", { code, action: "lobby" });
assert.strictEqual(host.last("state").phase, "lobby");
adm.fire("admin-change", { code, action: "move", value: { id: ids[2], to: "spectators" } });
assert.strictEqual(host.last("state").spectators.length, 3);
adm.fire("admin-unwatch");

// el admin sin autenticar no puede cambiar nada
const nobody = io.connect("snobody");
nobody.fire("admin-change", { code, action: "close" });
assert(io.sockets.sockets.get("s1").last("session-invalid") === undefined);

/* ---------- apariencia compartida: solo el admin, y la reciben todos ---------- */
function callRoute(method, pathPattern, req) {
  const r = routes.find(x => x[0] === method && x[1][0] === pathPattern);
  assert(r, "ruta no encontrada " + pathPattern);
  const handler = r[1][r[1].length - 1];
  const res = {
    code: 200, body: null, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(b) { this.body = b; return this; },
    end() { return this; }
  };
  handler(Object.assign({ ip: "1.1.1.1", headers: {}, params: {} }, req), res);
  return res;
}
const png = Buffer.from("89504e470d0a1a0a", "hex");
const watcher = io.connect("stheme");
const lastTheme = () => watcher.last("theme");
assert(lastTheme() && lastTheme().bg === null, "al conectar se recibe el tema");

// sin contraseña / contraseña mala: rechazado
let r1 = callRoute("post", "/api/admin/theme/:kind", { params: { kind: "bg" }, headers: { "content-type": "image/png" }, body: png });
assert.strictEqual(r1.code, 401);
r1 = callRoute("post", "/api/admin/theme/:kind", { params: { kind: "bg" }, headers: { "content-type": "image/png", "x-admin-password": "mal" }, body: png });
assert.strictEqual(r1.code, 401);
assert.strictEqual(lastTheme().bg, null, "nadie sin contraseña puede cambiar el fondo");

// tipo inválido
r1 = callRoute("post", "/api/admin/theme/:kind", { params: { kind: "bg" }, headers: { "content-type": "audio/wav", "x-admin-password": "secreta" }, body: png });
assert.strictEqual(r1.code, 415);
r1 = callRoute("post", "/api/admin/theme/:kind", { params: { kind: "hack" }, headers: { "content-type": "image/png", "x-admin-password": "secreta" }, body: png });
assert.strictEqual(r1.code, 400);

// el admin sube foto y sonido: TODOS los clientes reciben la URL nueva
r1 = callRoute("post", "/api/admin/theme/:kind", { params: { kind: "bg" }, headers: { "content-type": "image/png", "x-admin-password": "secreta", "x-file-name": encodeURIComponent("mi foto.png") }, body: png });
assert.strictEqual(r1.code, 200);
assert(/^\/uploads\/bg\?v=/.test(lastTheme().bg), "el tema debe llevar la URL del fondo");
assert(/^\/uploads\/bg\?v=/.test(host.last("theme").bg), "también los jugadores");
callRoute("post", "/api/admin/theme/:kind", { params: { kind: "win" }, headers: { "content-type": "audio/wav", "x-admin-password": "secreta" }, body: png });
assert(lastTheme().win && lastTheme().winSource === "panel");
const served = callRoute("get", "/uploads/:kind", { params: { kind: "bg" } });
assert(Buffer.isBuffer(served.body) && served.headers["Content-Type"] === "image/png");

// ajustes y quitar: solo por socket de admin
const nonAdmin = io.connect("snon");
nonAdmin.fire("admin-theme-set", { dim: 80, when: "match" });
nonAdmin.fire("admin-theme-clear", { kind: "bg" });
assert.strictEqual(lastTheme().dim, 35);
assert(lastTheme().bg, "un no-admin no puede quitar el fondo");
adm.fire("admin-theme-set", { dim: 55, when: "match" });
assert.strictEqual(lastTheme().dim, 55);
assert.strictEqual(lastTheme().when, "match");
adm.fire("admin-theme-clear", { kind: "bg" });
assert.strictEqual(lastTheme().bg, null);
assert.strictEqual(callRoute("get", "/uploads/:kind", { params: { kind: "bg" } }).code, 404);

console.log("OK: prueba de servidor superada");
process.exit(0);
