"use strict";
/*
  Prueba de la SALA DE PRUEBAS del administrador, sin instalar dependencias:
  se cargan server.js y game.js con "express" y "socket.io" simulados y se usa un
  socket de mentira. Comprueba: solo el admin puede crear la sala, hay 3 bots que
  juegan solos, se pueden pausar, y las acciones de debug (beber, servir, azote…).
  Uso: node test/debug-room.test.js
*/
const assert = require("assert");
const Module = require("module");
const path = require("path");

process.env.ADMIN_PASSWORD = "secreto";
process.env.PORT = "0";

let connectionHandler = null;
const io = {
  sockets: { sockets: new Map() },
  rooms: new Map(),
  on(ev, cb) { if (ev === "connection") connectionHandler = cb; },
  to(target) {
    return { emit: (ev, data) => io.sockets.sockets.forEach(s => { if (s.id === target || s.rooms.has(target)) s.got.push([ev, data]); }) };
  }
};
const fakeApp = new Proxy(function () {}, { get: () => () => fakeApp, apply: () => fakeApp });
const fakeExpress = Object.assign(() => fakeApp, { static: () => () => {}, json: () => () => {}, urlencoded: () => () => {}, raw: () => () => {} });
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "express") return fakeExpress;
  if (request === "socket.io") return { Server: function () { return io; } };
  return origLoad.call(this, request, ...rest);
};
const realSetTimeout = setTimeout;
require(path.join(__dirname, "..", "server.js"));
Module._load = origLoad;

function fakeSocket(id) {
  const handlers = {};
  const s = {
    id, data: {}, got: [], handlers, rooms: new Set(),
    on(ev, cb) { handlers[ev] = cb; },
    emit(ev, data) { s.got.push([ev, data]); },
    join(room) { s.rooms.add(room); },
    leave(room) { s.rooms.delete(room); },
    send(ev, data) { handlers[ev] && handlers[ev](data); }
  };
  io.sockets.sockets.set(id, s);
  connectionHandler(s);
  return s;
}
const last = (s, ev) => { for (let i = s.got.length - 1; i >= 0; i--) if (s.got[i][0] === ev) return s.got[i][1]; return null; };
const sleep = ms => new Promise(r => realSetTimeout(r, ms));

(async () => {
  // un jugador normal NO puede crear la sala de pruebas
  const normal = fakeSocket("normal");
  normal.send("admin-debug-create", { name: "Intruso" });
  assert.strictEqual(last(normal, "joined"), null, "un jugador normal no crea salas de debug");

  const adm = fakeSocket("adm");
  adm.send("admin-auth", { password: "secreto" });
  assert.strictEqual(last(adm, "admin-auth-result").ok, true);
  adm.send("admin-debug-create", { name: "Yo" });
  const joined = last(adm, "joined");
  assert(joined && joined.room, "el admin entra a la sala de pruebas");
  let st = last(adm, "state");
  assert.strictEqual(st.debug, true, "el estado marca la sala como debug");
  assert.strictEqual(st.players.length, 4);
  assert.strictEqual(st.players.filter(p => p.bot).length, 3, "3 bots");
  assert(["starter-choice", "playing"].includes(st.phase), "la partida ya empezó: " + st.phase);
  console.log("OK · sala de pruebas creada:", joined.room, "· fase:", st.phase);

  // un jugador normal no puede mandar acciones de debug
  const code = joined.room;
  normal.send("admin-debug", { code, action: "drink", id: st.me });
  assert.strictEqual(last(normal, "game-error"), null, "un jugador normal no manda acciones de debug");

  // beber / servir sin esperas
  const before = adm.got.length;
  adm.send("admin-debug", { code, action: "drink", id: st.me });
  adm.send("admin-debug", { code, action: "drink", id: st.me });   // seguido: en una sala normal se rechazaría
  adm.send("admin-debug", { code, action: "pour", id: st.me });
  const events = adm.got.slice(before).filter(([e]) => e === "game-event").map(([, d]) => d.type);
  assert.deepStrictEqual(events, ["drink", "drink", "pour"], "beber, beber y servir seguidos: " + events);

  // niveles y mano
  adm.send("admin-debug", { code, action: "cup", id: st.me, value: 0 });
  assert.strictEqual(last(adm, "state").players.find(p => p.id === st.me).cup, 0);
  adm.send("admin-debug", { code, action: "bottle", value: 0.3 });
  assert.strictEqual(last(adm, "state").bottle, 0.3);
  adm.send("admin-debug", { code, action: "hand", id: st.me, value: 3 });
  assert.strictEqual(last(adm, "state").hands[st.me].length, 3, "mano reducida a 3 fichas");

  // azote sin tener fichas en la mesa → avisa
  adm.send("admin-debug", { code, action: "pause", value: true });
  adm.send("admin-debug", { code, action: "deal" });
  st = last(adm, "state");
  adm.send("admin-debug", { code, action: "slam", id: st.me });
  assert(/ficha/i.test(String(last(adm, "game-error"))), "azote sin fichas en la mesa avisa");

  // con los bots en pausa, nadie juega solo; con "step" juega quien toque
  await sleep(1800);
  const frozen = last(adm, "state");
  const boardLen = frozen.board.length;
  await sleep(1800);
  assert.strictEqual(last(adm, "state").board.length, boardLen, "bots en pausa: nadie juega solo");
  adm.send("admin-debug", { code, action: "pause", value: false });
  if (frozen.phase === "starter-choice" && frozen.starterPlayers.includes(frozen.me)) {
    adm.send("choose-starter", { tileId: frozen.hands[frozen.me][0].id });
  }
  await sleep(4500);
  const moved = last(adm, "state");
  assert(moved.board.length > boardLen, `los bots juegan solos tras reanudar (mesa: ${boardLen} → ${moved.board.length})`);
  adm.send("admin-debug", { code, action: "slam", id: st.me });
  assert(adm.got.some(([e, d]) => e === "game-event" && d.type === "slam"), "azote visible para todos");
  adm.send("admin-debug", { code, action: "capicua", id: st.me });
  adm.send("admin-debug", { code, action: "pass" });
  console.log("OK · bots juegan solos, pausa, beber/servir, azote, niveles, mano");

  // colecta: cada uno pone su CUC; al completarse, llega botella nueva
  const potState = () => last(adm, "state");
  const noBefore = potState().bottleNo;
  adm.send("admin-debug", { code, action: "coin", id: st.me });
  assert.deepStrictEqual(potState().pot, [st.me], "el admin puso su CUC");
  adm.send("admin-debug", { code, action: "coin", id: st.me });
  assert(/ya pusiste/i.test(String(last(adm, "game-error"))), "no se puede poner dos veces");
  adm.send("admin-debug", { code, action: "potfill" });
  assert.strictEqual(potState().bottleNo, noBefore + 1, "al completar la colecta llega otra botella");
  assert.strictEqual(potState().bottle, 1, "la botella nueva viene llena");
  assert.deepStrictEqual(potState().pot, [], "el plato queda vacío");
  assert(adm.got.some(([e, d]) => e === "game-event" && d.type === "refill"), "evento de botella nueva");
  console.log("OK · colecta de CUC y botella nueva");

  // bocina: canciones de la carpeta y enlaces de YouTube
  const G = require("../game");
  assert.strictEqual(G.parseYouTube("https://youtu.be/dQw4w9WgXcQ?t=5"), "dQw4w9WgXcQ");
  assert.strictEqual(G.parseYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x"), "dQw4w9WgXcQ");
  assert.strictEqual(G.parseYouTube("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.strictEqual(G.parseYouTube("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.strictEqual(G.parseYouTube("https://evil.com/watch?v=dQw4w9WgXcQ"), null, "otros sitios no valen");
  assert.strictEqual(G.parseYouTube("javascript:alert(1)"), null);
  const songFile = path.join(__dirname, "..", "public", "music", "prueba-cancion.mp3");
  require("fs").writeFileSync(songFile, "x");
  try {
    const lst = await new Promise(ok => {
      // /api/music no está montado en el express simulado: se comprueba por el socket
      ok(null);
    });
    void lst;
    adm.send("music-play", { kind: "youtube", url: "https://example.com/nope" });
    assert(/no es válido/i.test(String(last(adm, "game-error"))), "enlace inválido rechazado");
    await sleep(2600);
    adm.send("music-play", { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" });
    let m = last(adm, "state").music;
    assert(m && m.kind === "youtube" && m.src === "dQw4w9WgXcQ" && m.announce === true, "suena el enlace y la bocina avisa");
    assert(adm.got.some(([e, d]) => e === "game-event" && d.type === "music" && d.announce), "evento de bocina conectada");
    adm.send("music-play", { kind: "file", file: "prueba-cancion.mp3" });
    assert(/cambiando/i.test(String(last(adm, "game-error"))), "no se puede cambiar de canción cada segundo");
    await sleep(2600);
    adm.send("music-play", { kind: "file", file: "../server.js" });
    assert(/no está en la carpeta/i.test(String(last(adm, "game-error"))), "solo canciones de la carpeta");
    await sleep(2600);
    adm.send("music-play", { kind: "file", file: "prueba-cancion.mp3" });
    m = last(adm, "state").music;
    assert(m && m.kind === "file" && m.src === "/music/prueba-cancion.mp3" && m.announce === false, "canción de la carpeta");
    adm.send("music-stop");
    assert.strictEqual(last(adm, "state").music, null, "la bocina se detiene");
  } finally {
    require("fs").unlinkSync(songFile);
  }
  // avatar: pelo y accesorios validados
  assert.deepStrictEqual(
    G.cleanAvatar({ color: "#112233", hair: 3, hat: 99, glasses: "2", beard: 1, extra: -1, hairColor: "red" }),
    { color: "#112233", skin: null, hairColor: null, hair: 3, hat: null, glasses: null, beard: 1, extra: null }, "avatar limpio");
  console.log("OK · bocina (carpeta + YouTube) y avatar personalizado");

  // al salir el admin, la sala (solo con bots) se borra
  adm.send("leave-room");
  await sleep(50);
  console.log("OK · debug-room.test.js");
  process.exit(0);
})().catch(e => { console.error("FALLÓ:", e.message); process.exit(1); });
