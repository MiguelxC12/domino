/* Espectador en 3D: sitios alrededor de la mesa, caminar, y volver a la sala al terminar. */
const assert = require("assert");
const G = require("../game.js");

const room = G.createRoom("SPEC1");
const ps = ["Ana", "Beto", "Carla", "Dani"].map(n => G.joinRoom(room, n, {}).person);
G.startMatch(room);
const sp = ["E1", "E2", "E3"].map(n => G.joinRoom(room, n, {}).person);
assert.ok(room.spectators.length >= 3, "deben entrar como espectadores");

// cada espectador recibe un sitio distinto y válido
const st = G.publicState(room, sp[0].id);
const spots = st.spectators.map(x => x.spot);
assert.ok(spots.every(k => Number.isInteger(k) && k >= 0 && k < G.SPEC_SPOTS), "sitios válidos");
assert.strictEqual(new Set(spots).size, spots.length, "sitios distintos");

// caminar a un sitio libre
const free = [...Array(G.SPEC_SPOTS).keys()].find(k => !spots.includes(k));
assert.ok(G.setSpot(room, sp[0].id, free).ok, "mover a sitio libre");
assert.strictEqual(G.publicState(room, sp[0].id).spectators.find(x => x.id === sp[0].id).spot, free);

// sitio ocupado, inválido, o un jugador (no espectador) → rechazado
assert.ok(!G.setSpot(room, sp[1].id, free).ok, "sitio ocupado");
assert.ok(!G.setSpot(room, sp[1].id, 99).ok, "sitio fuera de rango");
assert.ok(!G.setSpot(room, sp[1].id, "x").ok, "sitio inválido");
assert.ok(!G.setSpot(room, ps[0].id, 0).ok, "un jugador no camina");

// al terminar, cualquiera puede volver a la sala
room.phase = "finished";
G.toLobby(room);
assert.strictEqual(room.phase, "lobby");
console.log("OK · espectador: sitios, caminar y volver a la sala");
