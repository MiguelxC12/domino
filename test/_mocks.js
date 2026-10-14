"use strict";
/* Simuladores de navegador (WebGL, canvas 2D, document…) para probar table3d.js desde Node. */
const fs = require("fs");
const path = require("path");

let draws = 0, nan = 0, badUniform = [];
const mockFn = () => new Proxy(function () {}, { get: () => mockFn(), apply: () => mockFn() });
function glMock() {
  const gl = new Proxy({}, {
    get(_, prop) {
      if (prop === "drawArrays") return () => { draws++; };
      if (prop === "uniformMatrix4fv") return (_l, _t, m) => { for (const v of m) if (!Number.isFinite(v)) { nan++; badUniform.push("mat"); break; } };
      if (prop === "uniform4f" || prop === "uniform3f" || prop === "uniform1f") return (_l, ...a) => { if (a.some(v => !Number.isFinite(v))) { nan++; badUniform.push(prop); } };
      if (prop === "getExtension") return () => null;
      if (prop === "getShaderParameter" || prop === "getProgramParameter") return () => true;
      if (prop === "bufferData") return (_t, d) => { if (d && d.some && d.some(v => !Number.isFinite(v))) { nan++; badUniform.push("buffer"); } };
      return typeof prop === "string" && /^[A-Z_0-9]+$/.test(prop) ? 1 : mockFn();
    }
  });
  return gl;
}
const ctx2d = () => new Proxy({}, { get: (_, p) => (p === "canvas" ? {} : mockFn()), set: () => true });
function makeCanvas(w = 800, h = 600) {
  const listeners = {};
  return {
    width: w, height: h,
    getContext: t => (t === "2d" ? ctx2d() : glMock()),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h }),
    addEventListener: (n, f) => { listeners[n] = f; },
    removeEventListener() {}
  };
}
global.window = global;
global.document = { createElement: () => makeCanvas(64, 64), addEventListener() {}, removeEventListener() {}, activeElement: null };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};
global.devicePixelRatio = 1;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.Image = function () {};



function load() {
  eval(fs.readFileSync(path.join(__dirname, "..", "public", "table3d.js"), "utf8"));
  return window.Table3D;
}
const stats = () => ({ draws, nan, badUniform });
module.exports = { makeCanvas, load, stats };
