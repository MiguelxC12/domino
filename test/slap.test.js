// Galletaso (1 por minuto), registro de tragos y estado público.
const assert = require("assert");
const G = require("../game.js");

const room = G.createRoom("SLAP");
const ps = ["Ana", "Beto", "Carla", "Dani"].map(n => G.joinRoom(room, n).person);
G.startMatch(room);
const [a, b] = ps;

// no a uno mismo, ni a alguien que no existe
assert.strictEqual(G.slap(room, a.id, a.id).ok, false);
assert.strictEqual(G.slap(room, a.id, "nadie").ok, false);

// el primero sale; el segundo seguido, no (espera de 1 minuto)
room.events = [];
const r1 = G.slap(room, a.id, b.id);
assert.strictEqual(r1.ok, true);
const ev = room.events.find(e => e.type === "slap");
assert.ok(ev && ev.from === a.id && ev.to === b.id, "evento slap con quién da y quién recibe");
const r2 = G.slap(room, a.id, ps[2].id);
assert.strictEqual(r2.ok, false);
assert.ok(/Espera \d+ s/.test(r2.message), "mensaje con los segundos que faltan");
const st = G.publicState(room, a.id);
const mine = st.players.find(p => p.id === a.id);
assert.ok(mine.slapIn > 59000 && mine.slapIn <= G.SLAP_COOLDOWN_MS, "slapIn en el estado");

// otro jugador sí puede dar el suyo
assert.strictEqual(G.slap(room, b.id, a.id).ok, true);

// pasado el minuto, vuelve a estar listo
room.lastSlap[a.id] = Date.now() - 61000;
assert.strictEqual(G.slap(room, a.id, ps[3].id).ok, true);

// tragos: se guardan y salen como "hace cuántos ms" en el estado público
const c = ps[2];
room.lastDrink[c.id] = 0;
assert.strictEqual(G.drink(room, c.id).ok, true);
const ago = G.publicState(room, c.id).players.find(p => p.id === c.id).drinkAgo;
assert.strictEqual(ago.length, 1);
assert.ok(ago[0] >= 0 && ago[0] < 2000);
// los tragos viejos (más de 10 min) no cuentan
room.drinkLog[c.id] = [Date.now() - 11 * 60000, Date.now() - 1000];
assert.strictEqual(G.publicState(room, c.id).players.find(p => p.id === c.id).drinkAgo.length, 1);
// el registro no crece sin límite
for (let i = 0; i < 40; i++) { room.lastDrink[c.id] = 0; room.cups[c.id] = 1; G.drink(room, c.id); }
assert.ok(room.drinkLog[c.id].length <= 14);

console.log("OK · galletaso con espera de 1 min, tragos registrados, estado público");
