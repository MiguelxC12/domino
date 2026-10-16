"use strict";
/*
  Prueba de humo del motor 3D SIN navegador: se simula WebGL y se dibujan cuadros
  en todos los modos para detectar errores de ejecución, NaN en las matrices,
  y se comprueba que el atril, el arrastre y las bebidas funcionan.
  Uso: node test/render-smoke.js
*/
const assert = require("assert");
const { makeCanvas, load, stats } = require("./_mocks");

const T = load();


function mk(w, h, mode) {
  const canvas = makeCanvas(w, h);
  let t = 0;
  const landed = [];
  const tb = new T(canvas, { mode, clock: () => t, getArea: () => ({ x: 0, y: 0, w, h }), onLand: id => landed.push(id), myStyle: () => ({ skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] }) });
  const tick = (ms = 16) => { t += ms; tb._frame(); };
  return { tb, tick, advance: ms => { for (let k = 0; k < ms / 50; k++) tick(50); }, landed };
}

const style = { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9], band: [1, 0, 0], hairStyle: 3 };
const seats = {
  top: { present: true, count: 7, style, turn: false, cup: 0.7 },
  left: { present: true, count: 10, style, turn: true, cup: 0.4 },
  right: { present: true, count: 7, style, turn: false, cup: 1 },
  bottom: { present: true, cup: 0.7, mine: true }
};
const mkBoard = n => {
  const board = [], items = [];
  for (let i = 0; i < n; i++) {
    board.push({ id: "t" + i, left: i, right: i + 1, owner: "p1", starter: i === 0 });
    items.push({ cx: (i - n / 2) * 4, cy: 0, heading: "E", near: i, far: i + 1, dbl: false });
  }
  return { board, items };
};

for (const [w, h] of [[390, 700], [1280, 720]]) {
  const { tb, tick, advance } = mk(w, h, "fp");
  const { board, items } = mkBoard(8);
  tb.setSeats(seats);
  tb.setBoard({ board, items, starterIdx: 0, slots: { left: { cx: -20, cy: 0, heading: "E", dbl: false }, right: { cx: 20, cy: 0, heading: "E", dbl: false } }, seatOf: () => "top", styleOf: () => style });
  tb.setRack({ organizing: false, myTurn: true, tiles: Array.from({ length: 10 }, (_, i) => ({ id: "m" + i, a: i % 7, b: (i + 3) % 7, state: i % 2 ? "playable" : "dim" })) });
  tick(); tick();
  assert(stats().draws > 100, "se dibujan objetos");

  // ¿se ve el atril en pantalla? (la cámara por defecto debe incluir tus fichas)
  const hit = [];
  for (let x = 0; x < w; x += 6) for (let y = 0; y < h; y += 6) { const r = tb.pickRack(x, y); if (r) hit.push(r.id); }
  assert(new Set(hit).size === 10, `[${w}x${h}] se pueden agarrar las 10 fichas (agarrables: ${new Set(hit).size})`);
  const ys = [];
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 6) if (tb.pickRack(x, y)) { ys.push(y); break; }
  console.log(`[${w}x${h}] atril visible entre y=${Math.min(...ys)} y y=${Math.max(...ys)} de ${h} · fichas agarrables: 10`);

  // el orden de izquierda a derecha se conserva
  const order = [];
  for (let x = 0; x < w; x += 2) { const r = tb.pickRack(x, (Math.min(...ys) + Math.max(...ys)) / 2); if (r && order[order.length - 1] !== r.id) order.push(r.id); }
  assert.deepStrictEqual(order.filter((v, i, a) => a.indexOf(v) === i).slice(0, 3), ["m0", "m1", "m2"], "orden del atril");

  // arrastre: de la mano a la mesa
  const first = tb.pickRack(...(() => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tb.pickRack(x, y) && tb.pickRack(x, y).id === "m1") return [x, y]; })());
  assert.strictEqual(first.id, "m1");
  tb.dragBegin({ id: "m1", a: 1, b: 4 }, "play", ["left", "right"]);
  const onRack = tb.dragMove(w / 2, h * 0.93, "mouse");
  assert.strictEqual(onRack.over, false, "sobre el atril no se juega");
  const onTable = tb.dragMove(w / 2, h * 0.45, "mouse");
  assert.strictEqual(onTable.over, true, "sobre el paño sí se puede soltar");
  assert(onTable.side === "left" || onTable.side === "right", "elige un extremo");
  tick(); tb.dragEnd(false);

  // beber y servir por todos los asientos, sin NaN
  for (const seat of ["top", "left", "right", "bottom"]) for (const kind of ["drink", "pour"]) {
    tb.startAct(kind, seat);
    for (let k = 0; k < 90; k++) tick(50);
  }
  // colecta de CUC y cambio de botella: las monedas vuelan al plato y cae una botella nueva
  tb.setBottles(0); tb.setPot(0, 4); tick();
  for (const seat of ["bottom", "top", "left"]) { tb.setPot(["bottom", "top", "left"].indexOf(seat) + 1, 4); tb.startCoin(seat); for (let k = 0; k < 24; k++) tick(50); }
  tb.setPot(0, 4); tb.setBottles(1); tb.setBottle(1);
  for (let k = 0; k < 90; k++) tick(50);
  assert.strictEqual(tb.bottleNoShown, 1, "la botella nueva llega tras la colecta");
  tb.startAct("pour", "right"); for (let k = 0; k < 80; k++) tick(50);
  // bocina y arrastre directo del atril
  tb.setSpeaker(true); tick(); tb.setSpeaker(false); tick();
  assert.strictEqual(tb.overTable(w / 2, h * 0.92), false, "el atril no es zona de juego");
  assert.strictEqual(tb.overTable(w / 2, h * 0.4), true, "la mesa sí");
  // todas las combinaciones de pelo y accesorios se dibujan sin errores
  for (let shape = 0; shape <= 5; shape++) for (let hat = 0; hat <= 4; hat++) {
    const glasses = (shape + hat) % 3, beard = (shape * 2 + hat) % 4, extra = (shape + hat * 2) % 4;
    const st2 = { skin: [0.8, 0.6, 0.45], sleeve: [0.3, 0.6, 0.9], hairRGB: [0.4, 0.25, 0.1], hairShape: shape, hat, glasses, beard, extra, band: hat === 1 ? [1, 0, 0] : null, pants: shape % 4 };
    tb.setSeats({ ...seats, top: { ...seats.top, style: st2 }, left: { ...seats.left, style: st2 }, right: { ...seats.right, style: st2 } });
    tick();
  }
  tb.setSeats(seats);
  // modo mesa (aérea)
  tb.setMode("top"); tick(); tick();
  tb.setMode("fp"); tick();
  // jugada animada de un rival y azote
  const b2 = mkBoard(9);
  tb.setBoard({ board: b2.board, items: b2.items, starterIdx: 0, slots: {}, seatOf: id => (id === "p1" ? "left" : "top"), styleOf: () => style });
  for (let k = 0; k < 60; k++) tick(50);
  tb.slam("t8"); for (let k = 0; k < 80; k++) tick(50);
  // ajustes de cámara
  tb.setTune("pitch", 55); tb.setTune("rackAng", 65); tick();
  tb.resetTune(); tick();
  for (const s of ["top", "left", "right"]) { const b = tb.seatBadge(s); assert(b && Number.isFinite(b.x) && Number.isFinite(b.y), "etiqueta " + s); }
}
{
  const { tb, tick } = mk(900, 600, "top");
  const { board, items } = mkBoard(6);
  tb.setBoard({ board, items, starterIdx: 0, slots: {}, seatOf: () => "top", styleOf: () => style });
  tick(); tick();
}
assert.strictEqual(stats().nan, 0, "valores NaN/Infinity enviados a la GPU: " + [...new Set(stats().badUniform)].join(","));
console.log("OK · cuadros dibujados sin errores · llamadas de dibujo:", stats().draws);
