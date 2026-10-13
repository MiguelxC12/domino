"use strict";
/*
  Arrastre de fichas en 3D (sin botón de organizar): se extrae startRackDrag de public/app.js
  y se ejecuta con el motor real y eventos de puntero simulados.
  · arrastrar por el atril = reordenar   · tocar = girar   · llevarla a la mesa = jugar
  Uso: node test/rack-drag.test.js
*/
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makeCanvas, load } = require("./_mocks");
const T = load();

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const i = app.indexOf("function startRackDrag(e, tile) {");
const j = app.indexOf("// la mesa 3D debe tener el tamaño del contenedor");
assert(i > 0 && j > i, "no se encontró startRackDrag en app.js");
const startRackDrag = new Function("t3d", "state", "handPrefs", "socket", "toast", "fits", "renderHand", "saveHandPrefs", "playPayload", "setDragging", "setSlam", "document",
  app.slice(i, j).replace(/dragging = /g, "setDragging(").replace(/slamNext = false;/g, "setSlam(false);").replace(/setDragging\((true|false);/g, "setDragging($1);") + "\nreturn startRackDrag;");

const listeners = {};
const doc = {
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); }
};
const fire = (t, e) => (listeners[t] || []).slice().forEach(f => f(e));

const w = 390, h = 700;
const t3d = new T(makeCanvas(w, h), { mode: "fp", clock: () => 0, getArea: () => ({ x: 0, y: 0, w, h }) });
t3d.setSeats({ bottom: { present: true, cup: 0.7 } });
const ids = Array.from({ length: 10 }, (_, k) => "m" + k);
t3d.setRack({ organizing: false, myTurn: true, tiles: ids.map((id, k) => ({ id, a: k % 7, b: (k + 3) % 7, state: "playable" })) });
t3d._frame();

const state = { phase: "playing", turn: "me", me: "me", starterPlayers: [] };
const handPrefs = { order: ids.slice(), flips: {} };
const emitted = [], toasts = [];
const run = startRackDrag(t3d, state, handPrefs, { emit: (...a) => emitted.push(a) }, m => toasts.push(m), () => true, () => {}, () => {}, (t, s) => ({ tileId: t.id, side: s }), () => {}, () => {}, doc);
const find = id => { for (let y = 380; y < h; y++) for (let x = 0; x < w; x++) { const r = t3d.pickRack(x, y); if (r && r.id === id) return [x, y]; } };

// 1) arrastrar m1 por el atril hasta donde está m6: se reordena, no se juega
{
  const [x1, y1] = find("m1"), [x6] = find("m6");
  run({ clientX: x1, clientY: y1 }, { id: "m1", a: 1, b: 4 });
  fire("pointermove", { clientX: x1 + 12, clientY: y1, pointerType: "touch" });
  fire("pointermove", { clientX: x6, clientY: y1 - 20, pointerType: "touch" });   // un pequeño desvío hacia arriba no juega
  assert(!t3d.drag, "desviarse un poco del atril no empieza a jugar");
  fire("pointerup", { clientX: x6, clientY: y1 - 20, pointerType: "touch" });
  assert.strictEqual(handPrefs.order.indexOf("m1"), 6, "m1 quedó en la posición 6: " + handPrefs.order);
  assert.strictEqual(emitted.length, 0, "ordenar no juega nada");
}
// 2) tocar sin mover = girar
{
  const [x, y] = find("m3");
  run({ clientX: x, clientY: y }, { id: "m3", a: 3, b: 6 });
  fire("pointerup", { clientX: x, clientY: y, pointerType: "mouse" });
  assert.strictEqual(handPrefs.flips.m3, true, "un toque gira la ficha");
}
// 3) llevarla a la mesa y soltar = jugar
{
  const [x, y] = find("m3");
  run({ clientX: x, clientY: y }, { id: "m3", a: 3, b: 6 });
  fire("pointermove", { clientX: x, clientY: y - 30, pointerType: "mouse" });
  assert(!t3d.drag, "30 px arriba todavía es el atril");
  fire("pointermove", { clientX: w / 2, clientY: h * 0.4, pointerType: "mouse" });
  assert(t3d.drag, "al llegar a la mesa empieza a jugarse");
  t3d.slots = { left: { x: -8, z: 0, yaw: 0 }, right: { x: 8, z: 0, yaw: 0 } };
  fire("pointerup", { clientX: w / 2, clientY: h * 0.4, pointerType: "mouse" });
  assert.strictEqual(emitted.length, 1, "se emitió la jugada");
  assert.strictEqual(emitted[0][0], "play-tile");
  assert.strictEqual(emitted[0][1].tileId, "m3");
}
// 4) fuera de turno: llevarla a la mesa avisa y no juega
{
  state.turn = "otro";
  emitted.length = 0;
  const [x, y] = find("m5");
  run({ clientX: x, clientY: y }, { id: "m5", a: 5, b: 1 });
  fire("pointermove", { clientX: w / 2, clientY: h * 0.4, pointerType: "mouse" });
  fire("pointerup", { clientX: w / 2, clientY: h * 0.4, pointerType: "mouse" });
  assert(toasts.some(t => /turno/.test(t)), "avisa que no es su turno: " + toasts);
  assert.strictEqual(emitted.length, 0);
}
console.log("OK · ordenar arrastrando, girar al tocar, jugar al llevarla a la mesa");
