"use strict";

/* =========================================================
   MESA 3D — motor propio en WebGL (sin librerías externas).
   Solo se descarga cuando alguien activa la vista 3D.

   · Las fichas quedan un poco corridas y torcidas (no perfectas).
   · Se ven los brazos de cada jugador colocando las fichas.
   · Tu ficha se arrastra con tu propio brazo hasta la mesa.
========================================================= */
(function () {
  const TILE_W = 1.94;      // ancho de la ficha (la celda del tablero es 2)
  const TILE_L = 3.9;       // largo (la celda es 4): deja una holgura natural
  const TILE_T = 0.6;       // grosor
  const EL = (60 * Math.PI) / 180;   // elevación de la cámara sobre la mesa
  const FOV = (36 * Math.PI) / 180;
  const TABLE_W = 96, TABLE_D = 76;   // paño de la mesa en unidades del tablero
  const SEAT = {                       // asientos alrededor de la mesa (f = hacia dónde mira el jugador)
    bottom: { x: 0, z: 46, f: [0, -1] },
    top:    { x: 0, z: -(TABLE_D / 2 + 8), f: [0, 1] },
    left:   { x: -(TABLE_W / 2 + 8), z: 0, f: [1, 0] },
    right:  { x: TABLE_W / 2 + 8, z: 0, f: [-1, 0] }
  };
  const RACK_ZONE = 0.22;              // parte baja de la pantalla donde está tu mano
  const HUD_FOV = (46 * Math.PI) / 180;
  const HUD_D = 34;
  const DRAG_Y = 3.4;       // altura a la que se lleva la ficha en la mano

  /* ---------------- matemática ---------------- */
  const ident = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  }

  function persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    const o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  }

  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
  const scl = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp3 = (a, b, t) => [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function lookAt(eye, center, up) {
    const z = norm(sub(eye, center));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ]);
  }

  function invert(m) {
    const o = new Float32Array(16);
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3],a10=m[4],a11=m[5],a12=m[6],a13=m[7],
          a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,
          b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,
          b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
    let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return ident();
    det = 1 / det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det; o[1]=(a02*b10-a01*b11-a03*b09)*det; o[2]=(a31*b05-a32*b04+a33*b03)*det; o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det; o[5]=(a00*b11-a02*b08+a03*b07)*det; o[6]=(a32*b02-a30*b05-a33*b01)*det; o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det; o[9]=(a01*b08-a00*b10-a03*b06)*det; o[10]=(a30*b04-a31*b02+a33*b00)*det; o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det; o[13]=(a00*b09-a01*b07+a02*b06)*det; o[14]=(a31*b01-a30*b03-a32*b00)*det; o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  }

  function project(m, p) {
    const x = m[0]*p[0] + m[4]*p[1] + m[8]*p[2] + m[12];
    const y = m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13];
    const w = m[3]*p[0] + m[7]*p[1] + m[11]*p[2] + m[15];
    return [x / w, y / w, w];
  }

  // matriz a partir de tres ejes (ya escalados) y una posición
  function basis(pos, ax, ay, az) {
    return new Float32Array([
      ax[0], ax[1], ax[2], 0,
      ay[0], ay[1], ay[2], 0,
      az[0], az[1], az[2], 0,
      pos[0], pos[1], pos[2], 1
    ]);
  }

  // ficha / objeto con giro (yaw), cabeceo y alabeo leves y escala
  function model(px, py, pz, yaw, sx, sy, sz, pitch = 0, roll = 0) {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const cx = Math.cos(pitch), sx_ = Math.sin(pitch);
    const cz = Math.cos(roll), sz_ = Math.sin(roll);
    // R = Ry * Rx * Rz
    const Ry = [[cy,0,sy_],[0,1,0],[-sy_,0,cy]];
    const Rx = [[1,0,0],[0,cx,-sx_],[0,sx_,cx]];
    const Rz = [[cz,-sz_,0],[sz_,cz,0],[0,0,1]];
    const mm = (A, B) => A.map((r, i) => [0,1,2].map(j => r[0]*B[0][j] + r[1]*B[1][j] + r[2]*B[2][j]));
    const R = mm(mm(Ry, Rx), Rz);
    return basis([px, py, pz],
      [R[0][0]*sx, R[1][0]*sx, R[2][0]*sx],
      [R[0][1]*sy, R[1][1]*sy, R[2][1]*sy],
      [R[0][2]*sz, R[1][2]*sz, R[2][2]*sz]);
  }

  // cilindro (Y de 0 a 1) desde p0 hasta p1 con radio r
  function segment(p0, p1, r) {
    const d = sub(p1, p0);
    const l = len(d) || 0.0001;
    const y = scl(d, 1 / l);
    const h = Math.abs(y[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    const x = norm(cross(h, y));
    const z = cross(y, x);
    return basis(p0, scl(x, r), scl(y, l), scl(z, r));
  }

  // elipsoide centrado en pos con ejes (dirección del largo = fwd)
  function ellipsoid(pos, fwd, rx, ry, rz) {
    const y = norm(fwd);
    const h = Math.abs(y[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    const x = norm(cross(h, y));
    const z = cross(y, x);
    return basis(pos, scl(x, rx), scl(y, ry), scl(z, rz));
  }

  /* ---------------- geometría ---------------- */
  function buildBox() {
    const v = [];
    const faces = [
      [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[-1,0,0],[0,1,0]],
      [[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]],
      [[0,1,0],[1,0,0],[0,0,-1]], [[0,-1,0],[1,0,0],[0,0,1]]
    ];
    faces.forEach(([n, u, w]) => {
      const c = (a, b) => [
        n[0]*0.5 + u[0]*a*0.5 + w[0]*b*0.5,
        n[1]*0.5 + u[1]*a*0.5 + w[1]*b*0.5,
        n[2]*0.5 + u[2]*a*0.5 + w[2]*b*0.5
      ];
      const q = [[-1,-1,0,1],[1,-1,1,1],[1,1,1,0],[-1,1,0,0]].map(([a, b, tu, tv]) => [...c(a, b), ...n, tu, tv]);
      [0, 1, 2, 0, 2, 3].forEach(i => v.push(...q[i]));
    });
    return v;
  }

  function buildCylinder(seg = 16) {
    const v = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const P = (c, s, y, nx, ny, nz) => [c, y, s, nx, ny, nz, 0, 0];
      const A = P(c0, s0, 0, c0, 0, s0), B = P(c1, s1, 0, c1, 0, s1);
      const C = P(c1, s1, 1, c1, 0, s1), D = P(c0, s0, 1, c0, 0, s0);
      [A, B, C, A, C, D].forEach(p => v.push(...p));
      v.push(0, 1, 0, 0, 1, 0, 0, 0, c0, 1, s0, 0, 1, 0, 0, 0, c1, 1, s1, 0, 1, 0, 0, 0);
      v.push(0, 0, 0, 0, -1, 0, 0, 0, c1, 0, s1, 0, -1, 0, 0, 0, c0, 0, s0, 0, -1, 0, 0, 0);
    }
    return v;
  }

  function buildSphere(lat = 10, lon = 14) {
    const v = [];
    const P = (i, j) => {
      const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      return [x, y, z, x, y, z, j / lon, i / lat];
    };
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        [a, b, c, a, c, d].forEach(p => v.push(...p));
      }
    }
    return v;
  }

  function buildQuad() {
    const p = [[-.5,0,-.5,0,0],[.5,0,-.5,1,0],[.5,0,.5,1,1],[-.5,0,.5,0,1]];
    const v = [];
    [0, 1, 2, 0, 2, 3].forEach(i => v.push(p[i][0], p[i][1], p[i][2], 0, 1, 0, p[i][3], p[i][4]));
    return v;
  }

  /* ---------------- shaders ---------------- */
  const VS = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
    uniform mat4 uVP; uniform mat4 uModel; uniform vec4 uUVRect;
    varying vec3 vN; varying vec2 vUV;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      gl_Position = uVP * w;
      vN = (uModel * vec4(aNrm, 0.0)).xyz;
      vUV = uUVRect.xy + aUV * uUVRect.zw;
    }`;
  const FS = `
    precision mediump float;
    uniform sampler2D uTex; uniform vec4 uColor; uniform float uTexOn; uniform float uLit;
    varying vec3 vN; varying vec2 vUV;
    void main() {
      vec4 base = uTexOn > 0.5 ? texture2D(uTex, vUV) * uColor : uColor;
      float light = 1.0;
      if (uLit > 0.5) {
        vec3 L = normalize(vec3(-0.35, 0.95, 0.45));
        float d = max(dot(normalize(vN), L), 0.0);
        light = 0.5 + 0.6 * d;
      }
      gl_FragColor = vec4(base.rgb * light, base.a);
    }`;

  /* ---------------- utilidades ---------------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }

  const HEAD = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
  const YAW = { E: 90, W: -90, S: 0, N: 180 }; // grados: el extremo "cercano" apunta hacia la ficha anterior

  function shortAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return from + d;
  }

  const PIPS = {
    0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9], 7: [1, 2, 3, 5, 7, 8, 9], 8: [1, 2, 3, 4, 6, 7, 8, 9],
    9: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  };

  const CELL_W = 96, CELL_H = 192, ATLAS_W = 1024, ATLAS_H = 2048;

  function makeAtlas(colors) {
    const c = document.createElement("canvas");
    c.width = ATLAS_W; c.height = ATLAS_H;
    const g = c.getContext("2d");
    for (let near = 0; near <= 9; near++) {
      for (let far = 0; far <= 9; far++) {
        const x = near * CELL_W, y = far * CELL_H;
        const grad = g.createLinearGradient(x, y, x + CELL_W, y + CELL_H);
        grad.addColorStop(0, "#fffdf6"); grad.addColorStop(1, "#efe7cf");
        g.fillStyle = grad;
        g.fillRect(x, y, CELL_W, CELL_H);
        // borde marfil más oscuro
        g.strokeStyle = "rgba(150,135,95,.55)"; g.lineWidth = 3;
        g.strokeRect(x + 1.5, y + 1.5, CELL_W - 3, CELL_H - 3);
        // divisoria
        g.fillStyle = "#8f845f";
        g.fillRect(x + 10, y + CELL_H / 2 - 2, CELL_W - 20, 4);
        const half = (n, oy) => {
          (PIPS[n] || []).forEach(k => {
            const col = (k - 1) % 3, row = Math.floor((k - 1) / 3);
            const cx = x + 20 + col * ((CELL_W - 40) / 2);
            const cy = y + oy + 20 + row * ((CELL_H / 2 - 40) / 2);
            g.beginPath(); g.arc(cx, cy, 11.5, 0, Math.PI * 2);
            g.fillStyle = colors[n] || "#475569"; g.fill();
            g.lineWidth = 1.5; g.strokeStyle = "rgba(0,0,0,.45)"; g.stroke();
            g.beginPath(); g.arc(cx - 3.5, cy - 4, 3.6, 0, Math.PI * 2);
            g.fillStyle = "rgba(255,255,255,.4)"; g.fill();
          });
        };
        half(near, 0);
        half(far, CELL_H / 2);
      }
    }
    return c;
  }

  function atlasRect(near, far) {
    return [
      (near * CELL_W + 1.5) / ATLAS_W, (far * CELL_H + 1.5) / ATLAS_H,
      (CELL_W - 3) / ATLAS_W, (CELL_H - 3) / ATLAS_H
    ];
  }

  function makeShadowTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    for (let i = 0; i < 28; i++) {
      g.fillStyle = `rgba(0,0,0,${0.012 + i * 0.0018})`;
      const inset = 6 + i * 1.7;
      const r = Math.max(4, 28 - i);
      g.beginPath();
      g.roundRect ? g.roundRect(inset, inset, 128 - inset * 2, 128 - inset * 2, r) : g.rect(inset, inset, 128 - inset * 2, 128 - inset * 2);
      g.fill();
    }
    return c;
  }

  function makeMarkerTex() {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 256;
    const g = c.getContext("2d");
    g.lineJoin = "round";
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(245,197,66,${0.12 + i * 0.1})`;
      g.lineWidth = 14 - i * 2;
      g.strokeRect(18, 18, 92, 220);
    }
    g.fillStyle = "rgba(245,197,66,.14)";
    g.fillRect(24, 24, 80, 208);
    return c;
  }

  function makeRingTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 20, 128, 128, 126);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.55, "rgba(255,255,255,0)");
    grad.addColorStop(0.78, "rgba(255,230,160,0.95)");
    grad.addColorStop(0.9, "rgba(255,200,90,0.35)");
    grad.addColorStop(1, "rgba(255,200,90,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    return c;
  }

  /* =========================================================
     CLASE PRINCIPAL
  ========================================================= */
  class Table3D {
    static supported() {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
      } catch { return false; }
    }

    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = opts;
      const attrs = { antialias: true, alpha: false, powerPreference: "default" };
      this.gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
      if (!this.gl) throw new Error("WebGL no disponible");
      this.dead = false;
      this.lost = false;
      canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); if (this.dead) return; this.lost = true; opts.onLost && opts.onLost(); });

      this.mode = opts.mode === "top" ? "top" : "fp";
      this.board = [];
      this.order = [];
      this.poses = {};
      this.prevIds = new Set();
      this.anims = [];
      this.landed = new Set();
      this.localDrops = {};
      this.slots = {};
      this.drag = null;
      this.cam = { d: 80, cx: 0, cz: 0, goalD: 80, goalCx: 0, goalCz: 0, ax: 0, ay: 0, goalAx: 0, goalAy: 0 };
      this.look = { yaw: 0, pitch: 0 };
      this.zoom = 1;            // zoom elegido por el jugador
      this.autoZoom = 1;        // zoom según el tamaño del tablero
      this.zoomNow = 1;
      this.bc = [0, 0, 0];      // centro del tablero
      this.bcNow = [0, 0, 0];
      this.shake = 0;
      this.fx = [];
      this.scatter = null;
      this.scatterFinal = {};
      this.slamIds = new Set();
      this.seatInfo = {};
      this.rack = { tiles: [], organizing: false, myTurn: false };
      this._ptrs = new Map();
      this.numberColors = opts.numberColors || [];
      this.theme = { bg: null, dim: 0.35 };
      this.dpr = 1;
      this.rafId = 0;

      this._initGL();
      this.setTheme(null, 0.35);
      canvas.addEventListener("wheel", e => {
        if (this.mode !== "fp") return;
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0012));
      }, { passive: false });
      this._onKey = e => {
        if (this.mode !== "fp" || this.dead) return;
        const tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (e.key === "ArrowLeft") { this.look.yaw = clamp(this.look.yaw - 0.16, -1.5, 1.5); this.requestRender(); }
        else if (e.key === "ArrowRight") { this.look.yaw = clamp(this.look.yaw + 0.16, -1.5, 1.5); this.requestRender(); }
      };
      document.addEventListener("keydown", this._onKey);
      this.resize();
    }

    /* ---------- inicialización ---------- */
    _initGL() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      this.prog = prog;
      this.loc = {};
      ["uVP", "uModel", "uUVRect", "uTex", "uColor", "uTexOn", "uLit"].forEach(n => { this.loc[n] = gl.getUniformLocation(prog, n); });
      this.attr = { pos: gl.getAttribLocation(prog, "aPos"), nrm: gl.getAttribLocation(prog, "aNrm"), uv: gl.getAttribLocation(prog, "aUV") };
      gl.enableVertexAttribArray(this.attr.pos);
      gl.enableVertexAttribArray(this.attr.nrm);
      gl.enableVertexAttribArray(this.attr.uv);

      const geo = data => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return { buf, n: data.length / 8 };
      };
      this.geo = { box: geo(buildBox()), cyl: geo(buildCylinder()), sph: geo(buildSphere()), quad: geo(buildQuad()) };

      const tex = (canvas, mip) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
        else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        return t;
      };
      this._mkTex = tex;
      this.tex = {
        atlas: tex(makeAtlas(this.numberColors), true),
        shadow: tex(makeShadowTex(), false),
        marker: tex(makeMarkerTex(), false),
        ring: tex(makeRingTex(), false),
        table: null
      };

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.025, 0.05, 0.1, 1);
    }

    _bindGeo(g) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
      gl.vertexAttribPointer(this.attr.pos, 3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(this.attr.nrm, 3, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(this.attr.uv, 2, gl.FLOAT, false, 32, 24);
    }

    _draw(geoName, m, o = {}) {
      const gl = this.gl;
      this._bindGeo(this.geo[geoName]);
      gl.uniformMatrix4fv(this.loc.uModel, false, m);
      const col = o.color || [1, 1, 1, 1];
      gl.uniform4f(this.loc.uColor, col[0], col[1], col[2], col[3] === undefined ? 1 : col[3]);
      const uv = o.uv || [0, 0, 1, 1];
      gl.uniform4f(this.loc.uUVRect, uv[0], uv[1], uv[2], uv[3]);
      gl.uniform1f(this.loc.uLit, o.lit === false ? 0 : 1);
      if (o.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, o.tex);
        gl.uniform1i(this.loc.uTex, 0);
        gl.uniform1f(this.loc.uTexOn, 1);
      } else gl.uniform1f(this.loc.uTexOn, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.geo[geoName].n);
    }

    /* ---------- tema (foto de la mesa) ---------- */
    setTheme(bgUrl, dim) {
      this.theme = { bg: bgUrl, dim };
      const build = img => {
        const c = document.createElement("canvas");
        c.width = 1500; c.height = 1200;
        const g = c.getContext("2d");
        if (img) {
          const k = Math.max(c.width / img.width, c.height / img.height);
          const w = img.width * k, h = img.height * k;
          g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
          g.fillStyle = `rgba(5,12,24,${dim})`;
          g.fillRect(0, 0, c.width, c.height);
        } else {
          const grad = g.createRadialGradient(c.width / 2, c.height * 0.45, 40, c.width / 2, c.height / 2, c.width * 0.62);
          grad.addColorStop(0, "#1d4d7e"); grad.addColorStop(0.55, "#0f2c4c"); grad.addColorStop(1, "#091a30");
          g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
          g.globalAlpha = 0.05;
          for (let i = 0; i < 2600; i++) {
            g.fillStyle = Math.random() < 0.5 ? "#fff" : "#000";
            g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
          }
          g.globalAlpha = 1;
        }
        const v = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.45, c.width / 2, c.height / 2, c.width * 0.75);
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.5)");
        g.fillStyle = v; g.fillRect(0, 0, c.width, c.height);
        const gl = this.gl;
        if (this.tex.table) gl.deleteTexture(this.tex.table);
        this.tex.table = this._mkTex(c, false);
        this.requestRender();
      };
      if (!bgUrl) { build(null); return; }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { if (!this.dead && this.theme.bg === bgUrl) build(img); };
      img.onerror = () => { if (!this.dead) build(null); };
      img.src = bgUrl;
    }

    /* ---------- modo de cámara y tamaño ---------- */
    setMode(mode) {
      mode = mode === "top" ? "top" : "fp";
      if (this.mode === mode) return;
      this.mode = mode;
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(rect.width * this.dpr));
      const h = Math.max(2, Math.round(rect.height * this.dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      this.cssW = rect.width; this.cssH = rect.height;
      this._computeGoal();
      this.cam.d = this.cam.goalD; this.cam.cx = this.cam.goalCx; this.cam.cz = this.cam.goalCz;
      this.cam.ax = this.cam.goalAx; this.cam.ay = this.cam.goalAy;
      this.zoomNow = this.zoom * this.autoZoom;
      this.bcNow = [...this.bc];
      this._updateMatrices();
      this.requestRender();
    }

    /* ---------- cámaras ---------- */
    _vpTop(d, cx, cz, ax, ay) {
      const eye = [cx, Math.sin(EL) * d, cz + Math.cos(EL) * d];
      const V = lookAt(eye, [cx, 0, cz], [0, 1, 0]);
      const P = persp(FOV, this.canvas.width / this.canvas.height, 4, 700);
      const S = ident(); S[12] = ax; S[13] = ay;
      return mul(S, mul(P, V));
    }

    // primera persona: ojos sobre tu asiento, mirando al tablero; puedes girar la vista
    _fpCam(now) {
      const asp = this.canvas.width / this.canvas.height;
      const zoom = clamp(this.zoomNow * (asp > 1.3 ? 1.3 : 1), 0.7, 3.2);
      const T = [this.bcNow[0], 0, this.bcNow[2]];
      const E0 = [0, 21, 43];
      let E = add(T, scl(sub(E0, T), 1 / zoom));
      E[1] = Math.max(E[1], 9);
      const d = sub(T, E);
      const yaw = Math.atan2(d[0], -d[2]) + this.look.yaw;
      const pitch = clamp(Math.atan2(d[1], Math.hypot(d[0], d[2])) + 0.08 + this.look.pitch, -1.3, -0.06);
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      if (this.shake > 0.01 && now !== undefined) {
        E = [E[0] + Math.sin(now * 0.09) * this.shake * 1.3, E[1] + Math.cos(now * 0.11) * this.shake, E[2]];
      }
      const fovy = asp < 0.8 ? (62 * Math.PI) / 180 : (asp > 1.3 ? 54 : 50) * Math.PI / 180;
      const V = lookAt(E, add(E, dir), [0, 1, 0]);
      const P = persp(fovy, asp, 1, 700);
      return { VP: mul(P, V), eye: E, fovy };
    }

    _hudVP() {
      return persp(HUD_FOV, this.canvas.width / this.canvas.height, 1, 200);
    }

    _computeGoal() {
      const W = this.cssW || 1, H = this.cssH || 1;
      const area = (this.opts.getArea && this.opts.getArea()) || { x: 0, y: 0, w: W, h: H };
      let minx = -4, maxx = 4, minz = -4, maxz = 4;
      const ids = Object.keys(this.poses);
      if (ids.length) {
        minx = minz = 1e9; maxx = maxz = -1e9;
        ids.forEach(id => {
          const p = this.poses[id];
          const horiz = Math.abs(Math.sin(p.yaw)) > 0.7;
          const hx = (horiz ? TILE_L : TILE_W) / 2 + 0.2;
          const hz = (horiz ? TILE_W : TILE_L) / 2 + 0.2;
          minx = Math.min(minx, p.x - hx); maxx = Math.max(maxx, p.x + hx);
          minz = Math.min(minz, p.z - hz); maxz = Math.max(maxz, p.z + hz);
        });
      }
      const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
      // primera persona: centro del tablero y zoom según su tamaño
      this.bc = [cx, 0, cz];
      const span = Math.max((maxx - minx) / 2, ((maxz - minz) / 2) * 1.5) + 7;
      this.autoZoom = clamp(30 / span, 1, 1.9);

      // vista de mesa: encuadra todo el tablero
      const hw = area.w / W, hh = (area.h / H) * 1.05;
      const ax = ((area.x + area.w / 2) / W) * 2 - 1;
      const ay = 1 - ((area.y + area.h / 2) / H) * 2;
      const corners = [];
      [minx, maxx].forEach(x => [minz, maxz].forEach(z => [0, TILE_T].forEach(y => corners.push([x, y, z]))));
      const fits = d => {
        const m = this._vpTop(d, cx, cz, 0, 0);
        let xs = [1e9, -1e9], ys = [1e9, -1e9];
        corners.forEach(c => {
          const p = project(m, c);
          xs = [Math.min(xs[0], p[0]), Math.max(xs[1], p[0])];
          ys = [Math.min(ys[0], p[1]), Math.max(ys[1], p[1])];
        });
        return (xs[1] - xs[0]) / 2 <= hw && (ys[1] - ys[0]) / 2 <= hh;
      };
      let lo = 12, hi = 420;
      for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      const maxU = Math.max(10, Math.min(22, Math.min(area.w, area.h) / 9));
      const dMin = H / (2 * Math.tan(FOV / 2) * maxU);
      this.cam.goalD = Math.max(hi, dMin);
      this.cam.goalCx = cx; this.cam.goalCz = cz;
      this.cam.goalAx = ax; this.cam.goalAy = ay;
    }

    _updateMatrices(now) {
      if (this.mode === "fp") {
        const c = this._fpCam(now);
        this.VP = c.VP; this.eye = c.eye;
      } else {
        const c = this.cam;
        this.VP = this._vpTop(c.d, c.cx, c.cz, c.ax, c.ay);
      }
      this.IVP = invert(this.VP);
    }

    // punto de la mesa (a altura y) bajo una posición de pantalla en NDC
    _ground(ndcX, ndcY, y = 0, IVP) {
      const m = IVP || this.IVP;
      const un = z => {
        const x = m[0]*ndcX + m[4]*ndcY + m[8]*z + m[12];
        const yy = m[1]*ndcX + m[5]*ndcY + m[9]*z + m[13];
        const zz = m[2]*ndcX + m[6]*ndcY + m[10]*z + m[14];
        const w = m[3]*ndcX + m[7]*ndcY + m[11]*z + m[15];
        return [x / w, yy / w, zz / w];
      };
      const a = un(-1), b = un(1);
      const dir = sub(b, a);
      if (Math.abs(dir[1]) < 1e-6) return null;
      const t = (y - a[1]) / dir[1];
      if (t < 0) return null;
      return add(a, scl(dir, t));
    }

    _toNDC(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      return [((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2];
    }

    toScreen(p) {
      const q = project(this.VP, p);
      const r = this.canvas.getBoundingClientRect();
      return [r.left + ((q[0] + 1) / 2) * r.width, r.top + ((1 - q[1]) / 2) * r.height];
    }

    // posición (px dentro del lienzo) donde colocar la etiqueta de un jugador
    seatBadge(seat) {
      const S = SEAT[seat];
      if (!S || this.mode !== "fp" || !this.VP) return null;
      const q = project(this.VP, [S.x + S.f[0] * 15, 0.5, S.z + S.f[1] * 15]);   // delante de sus fichas
      const r = this.canvas.getBoundingClientRect();
      const vis = q[2] > 0 && Math.abs(q[0]) < 1.12 && q[1] > -1.1 && q[1] < 1.1;
      return { vis, x: ((q[0] + 1) / 2) * r.width, y: ((1 - q[1]) / 2) * r.height };
    }

    /* ---------- jugadores y mano ---------- */
    setSeats(info) { this.seatInfo = info || {}; this.requestRender(); }

    setRack(rack) {
      this.rack = rack || { tiles: [], organizing: false, myTurn: false };
      this.requestRender();
    }

    /* ---------- tablero ---------- */
    setBoard(o) {
      const { board, items, starterIdx, slots, seatOf, styleOf } = o;
      this.styleOf = styleOf || (() => ({ skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] }));
      this.seatOf = seatOf || (() => "bottom");
      const now = this._now();
      const ids = new Set(board.map(p => p.id));
      const first = this.prevIds.size === 0 && board.length > 1 && !this.initialized;

      const poses = {};
      board.forEach((p, i) => {
        const it = items[i];
        const rnd = hash(p.id + ":" + (board[starterIdx] ? board[starterIdx].id : ""));
        const jl = (rnd() - 0.5) * 0.34;
        const ja = (rnd() - 0.5) * 0.1;
        const jy = (rnd() - 0.5) * 0.13;
        const h = HEAD[it.heading];
        const lat = [-h[1], h[0]];
        const yaw = (it.dbl ? (it.heading === "E" || it.heading === "W" ? 0 : -90) : YAW[it.heading]) * Math.PI / 180;
        poses[p.id] = {
          x: it.cx + lat[0] * jl + h[0] * ja,
          z: it.cy + lat[1] * jl + h[1] * ja,
          yaw: yaw + jy,
          near: it.near, far: it.far, dbl: it.dbl, starter: !!p.starter,
          owner: p.owner
        };
        const sf = this.scatterFinal[p.id];
        if (sf) { poses[p.id].x = sf.x; poses[p.id].z = sf.z; poses[p.id].yaw = sf.yaw; poses[p.id].yOff = sf.yOff; }
      });

      if (this.initialized) {
        board.forEach(p => {
          if (!this.prevIds.has(p.id) && !this.landed.has(p.id)) this._startAnim(p, poses[p.id], now);
        });
      } else if (first) {
        board.forEach(p => this.landed.add(p.id));
      }
      if (!board.length) { this.anims = []; this.landed = new Set(); this.scatter = null; this.scatterFinal = {}; this.slamIds = new Set(); this.fx = []; }
      this.initialized = true;
      this.board = board;
      this.poses = poses;
      this.order = board.map(p => p.id);
      this.prevIds = ids;
      this.slots = {};
      ["left", "right"].forEach(side => {
        const s = slots && slots[side];
        if (!s) return;
        const yaw = (s.dbl ? 0 : YAW[s.heading]) * Math.PI / 180;
        this.slots[side] = { x: s.cx, z: s.cy, yaw };
      });
      this._computeGoal();
      this.requestRender();
    }

    _anchors() {
      if (this.mode === "fp") {
        const out = {};
        Object.keys(SEAT).forEach(k => {
          const S = SEAT[k];
          const r = [-S.f[1], 0, S.f[0]];
          out[k] = {
            shoulder: [S.x + r[0] * (k === "bottom" ? 5.8 : 3.5), k === "bottom" ? 13.5 : 8, S.z + r[2] * (k === "bottom" ? 5.8 : 3.5)],
            rest: [S.x + S.f[0] * 10 + r[0] * 3.4, 4.2, S.z + S.f[1] * 10 + r[2] * 3.4]
          };
        });
        return out;
      }
      const g = (nx, ny, y) => this._ground(nx, ny, y) || [0, y, 0];
      return {
        bottom: { shoulder: g(0.8, -1.5, 5), rest: g(0.8, -1.07, 4) },
        top:    { shoulder: g(-0.7, 1.5, 6), rest: g(-0.7, 1.07, 4.5) },
        left:   { shoulder: g(-1.5, 0.4, 6), rest: g(-1.07, 0.4, 4.5) },
        right:  { shoulder: g(1.5, 0.4, 6),  rest: g(1.07, 0.4, 4.5) }
      };
    }

    _startAnim(p, pose, now) {
      const seat = this.seatOf(p.owner) || "bottom";
      const local = this.localDrops[p.id];
      const style = this.styleOf(p.owner);
      const slam = this.slamIds.has(p.id);
      const dur = slam ? 2100 : local ? 950 : 1500;
      this.anims.push({ id: p.id, seat, style, start: now, dur, local: local || null, pose, landedFired: false, slam, impacted: false });
      this.landed.add(p.id);
      delete this.localDrops[p.id];
    }

    /* ---------- AZOTE: la ficha golpea la mesa y las demás saltan ---------- */
    slam(tileId) {
      this.slamIds.add(tileId);
      const a = this.anims.find(x => x.id === tileId);
      if (a && !a.slam) { a.slam = true; a.dur = 2100; a.start = this._now(); a.landedFired = false; }
      this.requestRender();
    }

    _impact(a, now) {
      a.impacted = true;
      const imp = this.poses[a.id] || { x: 0, z: 0 };
      this.shake = 1;
      this.fx.push({ x: imp.x, z: imp.z, t0: now });
      this.opts.onSlam && this.opts.onSlam(a.id);
      this._simulateScatter(a.id, imp, now);
    }

    _simulateScatter(slamId, imp, now) {
      const ids = this.order.filter(id => id !== slamId && this.poses[id]);
      const N = 150, dt = 1 / 60, G = 52;
      const tracks = {};
      const finalPos = [];
      ids.forEach((id, k) => {
        const p = this.poses[id];
        const rnd = hash("sc" + id + slamId);
        let dx = p.x - imp.x, dz = p.z - imp.z;
        const dist = Math.hypot(dx, dz) || 1;
        dx /= dist; dz /= dist;
        const power = 17 / (1 + dist * 0.05) * (0.65 + rnd() * 0.7);
        let x = p.x, y = TILE_T / 2, z = p.z;
        let vx = dx * power + (rnd() - 0.5) * 7, vz = dz * power + (rnd() - 0.5) * 7;
        let vy = (10 + rnd() * 9) / (1 + dist * 0.025);
        let yaw = p.yaw, pitch = 0, roll = 0;
        let wy = (rnd() - 0.5) * 15, wp = (rnd() - 0.5) * 11, wr = (rnd() - 0.5) * 11;
        const frames = new Float32Array(N * 6);
        const limX = TABLE_W / 2 - 2.5, limZ = TABLE_D / 2 - 2.5;
        for (let f = 0; f < N; f++) {
          vy -= G * dt;
          x += vx * dt; y += vy * dt; z += vz * dt;
          yaw += wy * dt; pitch += wp * dt; roll += wr * dt;
          if (Math.abs(x) > limX) { x = Math.sign(x) * limX; vx = -vx * 0.4; }
          if (Math.abs(z) > limZ) { z = Math.sign(z) * limZ; vz = -vz * 0.4; }
          if (y <= TILE_T / 2) {
            y = TILE_T / 2;
            if (Math.abs(vy) > 1.4) vy = -vy * 0.34; else vy = 0;
            vx *= 0.6; vz *= 0.6; wy *= 0.62;
            pitch *= 0.5; roll *= 0.5; wp *= 0.4; wr *= 0.4;
          } else {
            vx *= 0.995; vz *= 0.995;
          }
          frames.set([x, y, z, yaw, pitch, roll], f * 6);
        }
        tracks[id] = frames;
        finalPos.push({ id, x, z, yaw });
      });
      // que no queden unas encima de otras
      const fixed = [{ x: imp.x, z: imp.z }];
      for (let it = 0; it < 18; it++) {
        for (let i = 0; i < finalPos.length; i++) {
          const a = finalPos[i];
          const others = finalPos.filter((_, j) => j !== i).concat(fixed.map(f => ({ x: f.x, z: f.z })));
          others.forEach(b => {
            const dx = a.x - b.x, dz = a.z - b.z;
            const d = Math.hypot(dx, dz) || 0.001;
            const min = 3.5;
            if (d < min) {
              const push = (min - d) / 2;
              a.x += (dx / d) * push; a.z += (dz / d) * push;
            }
          });
          a.x = clamp(a.x, -(TABLE_W / 2 - 2.5), TABLE_W / 2 - 2.5);
          a.z = clamp(a.z, -(TABLE_D / 2 - 2.5), TABLE_D / 2 - 2.5);
        }
      }
      const final = {};
      finalPos.forEach((f, i) => {
        final[f.id] = { x: f.x, z: f.z, yaw: f.yaw, yOff: (i % 7) * 0.012 };
        // los últimos fotogramas se acercan a la posición definitiva
        const fr = tracks[f.id];
        for (let k = N - 24; k < N; k++) {
          const t = (k - (N - 24)) / 24;
          fr[k * 6] = lerp(fr[k * 6], f.x, t);
          fr[k * 6 + 2] = lerp(fr[k * 6 + 2], f.z, t);
        }
      });
      this.scatterFinal = Object.assign(this.scatterFinal, final);
      // las posiciones definitivas quedan ya en el tablero (no vuelven al orden anterior)
      Object.keys(final).forEach(id => { if (this.poses[id]) Object.assign(this.poses[id], final[id]); });
      this.scatter = { t0: now, N, dt, tracks };
      this.requestRender();
    }

    /* ---------- arrastre de la ficha del jugador ---------- */
    _inRackZone(cy) {
      const r = this.canvas.getBoundingClientRect();
      return this.mode === "fp" && cy > r.top + r.height * (1 - RACK_ZONE);
    }

    dragBegin(tile, mode, validSides) {
      this.drag = { tile, mode, validSides, over: false, pos: null, side: null, yaw: 0, near: tile.a, far: tile.b, hud: null };
      this.requestRender();
    }

    dragMove(cx, cy, pointerType) {
      const d = this.drag;
      if (!d) return { over: false, side: null };
      const r = this.canvas.getBoundingClientRect();
      const inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      const over = inside && !this._inRackZone(cy);
      d.over = over;
      d.side = null;
      d.hud = null;
      if (inside && !over) d.hud = this._toNDC(cx, cy);   // la ficha va en tu mano, sobre el atril
      if (over) {
        const lift = pointerType === "touch" || pointerType === "pen" ? 52 : 0;
        const [nx, ny] = this._toNDC(cx, cy - lift);
        const g = this._ground(nx, ny, DRAG_Y);
        if (g) d.pos = g;
        if (d.mode === "starter") d.side = "center";
        else {
          let best = null, bestDist = 1e9;
          d.validSides.forEach(side => {
            const s = this.slots[side];
            if (!s) return;
            const sp = this.toScreen([s.x, 0.3, s.z]);
            const dist = Math.hypot(sp[0] - cx, sp[1] - cy);
            if (dist < bestDist) { bestDist = dist; best = side; }
          });
          d.side = best;
        }
      }
      this.requestRender();
      return { over, side: d.side };
    }

    dragEnd(commit) {
      const d = this.drag;
      this.drag = null;
      if (d && commit && d.pos) {
        this.localDrops[d.tile.id] = { x: d.pos[0], y: DRAG_Y, z: d.pos[2], yaw: 0 };
        setTimeout(() => { delete this.localDrops[d.tile.id]; }, 6000);
      }
      this.requestRender();
    }

    /* ---------- mirar alrededor y zoom (primera persona) ---------- */
    zoomBy(f) {
      this.zoom = clamp(this.zoom * f, 0.6, 2.6);
      this.requestRender();
    }

    recenter() {
      this.look = { yaw: 0, pitch: 0 };
      this.zoom = 1;
      this.requestRender();
    }

    isOffCenter() {
      return Math.abs(this.look.yaw) > 0.05 || Math.abs(this.look.pitch) > 0.05 || Math.abs(this.zoom - 1) > 0.05;
    }

    pointerDown(e) {
      if (this.mode !== "fp") return;
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 1) this._lk = { x: e.clientX, y: e.clientY, yaw: this.look.yaw, pitch: this.look.pitch };
      if (this._ptrs.size === 2) {
        const [a, b] = [...this._ptrs.values()];
        this._pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom };
      }
      if (!this._lkListeners) {
        this._lkListeners = true;
        this._mv = ev => {
          if (!this._ptrs.has(ev.pointerId)) return;
          this._ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          if (this._ptrs.size >= 2 && this._pinch) {
            const [a, b] = [...this._ptrs.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            this.zoom = clamp(this._pinch.zoom * (d / this._pinch.d), 0.6, 2.6);
          } else if (this._lk) {
            this.look.yaw = clamp(this._lk.yaw - (ev.clientX - this._lk.x) * 0.0042, -1.5, 1.5);
            this.look.pitch = clamp(this._lk.pitch + (ev.clientY - this._lk.y) * 0.003, -0.6, 0.6);
          }
          this.requestRender();
        };
        this._up = ev => {
          this._ptrs.delete(ev.pointerId);
          this._pinch = null;
          if (this._ptrs.size === 1) {
            const p = [...this._ptrs.values()][0];
            this._lk = { x: p.x, y: p.y, yaw: this.look.yaw, pitch: this.look.pitch };
          } else if (this._ptrs.size === 0) {
            this._lk = null;
            document.removeEventListener("pointermove", this._mv);
            document.removeEventListener("pointerup", this._up);
            document.removeEventListener("pointercancel", this._up);
            this._lkListeners = false;
            this.opts.onLookEnd && this.opts.onLookEnd();
          }
        };
        document.addEventListener("pointermove", this._mv);
        document.addEventListener("pointerup", this._up);
        document.addEventListener("pointercancel", this._up);
      }
    }

    /* ---------- tu mano de fichas (en 3D, fija delante de ti) ---------- */
    _rackSlots() {
      const tiles = this.rack.tiles;
      const n = tiles.length;
      if (!n) return [];
      const asp = this.canvas.width / this.canvas.height;
      const tanH = Math.tan(HUD_FOV / 2);
      const visW = 2 * HUD_D * tanH * asp;
      const usable = visW * 0.95;
      const sc = clamp(Math.min(1.25, usable / (n * TILE_W * 1.04)), 0.6, 1.4);
      const w = TILE_W * sc;
      const sp = n > 1 ? Math.min(w * 1.14, (usable - w) / (n - 1)) : 0;
      const baseY = -0.7 * HUD_D * tanH;
      return tiles.map((t, i) => {
        const lift = (this.rack.myTurn && t.state === "playable") ? 0.9 * sc : 0;
        return {
          id: t.id, a: t.a, b: t.b, state: t.state, sc,
          x: (i - (n - 1) / 2) * sp, y: baseY + lift, z: -HUD_D - i * 0.01
        };
      });
    }

    _rackModel(s, extra = {}) {
      const pitch = (78 * Math.PI) / 180;
      return model(s.x + (extra.dx || 0), s.y + (extra.dy || 0), s.z, 0, TILE_W * s.sc, TILE_T * s.sc, TILE_L * s.sc, pitch, extra.roll || 0);
    }

    // ¿qué ficha de tu mano hay bajo el dedo?
    pickRack(clientX, clientY) {
      if (this.mode !== "fp") return null;
      const slots = this._rackSlots();
      const VP = this._hudVP();
      const r = this.canvas.getBoundingClientRect();
      const px = clientX - r.left, py = clientY - r.top;
      for (let i = slots.length - 1; i >= 0; i--) {
        const s = slots[i];
        if (this.drag && this.drag.tile.id === s.id) continue;
        const M = this._rackModel(s);
        const pts = [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]].map(c => {
          const wx = M[0]*c[0] + M[4]*c[1] + M[8]*c[2] + M[12];
          const wy = M[1]*c[0] + M[5]*c[1] + M[9]*c[2] + M[13];
          const wz = M[2]*c[0] + M[6]*c[1] + M[10]*c[2] + M[14];
          const q = project(VP, [wx, wy, wz]);
          return [((q[0] + 1) / 2) * r.width, ((1 - q[1]) / 2) * r.height];
        });
        let inside = false;
        for (let a = 0, b = 3; a < 4; b = a++) {
          const [xi, yi] = pts[a], [xj, yj] = pts[b];
          if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
        }
        if (inside) return { id: s.id, index: i };
      }
      return null;
    }

    // posición (índice) de la mano donde está el dedo (para reordenar)
    rackIndexAt(clientX) {
      const slots = this._rackSlots();
      if (!slots.length) return 0;
      const VP = this._hudVP();
      const r = this.canvas.getBoundingClientRect();
      const px = clientX - r.left;
      let best = 0, bd = 1e9;
      slots.forEach((s, i) => {
        const q = project(VP, [s.x, s.y, s.z]);
        const sx = ((q[0] + 1) / 2) * r.width;
        const d = Math.abs(sx - px);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }

    /* ---------- dibujo ---------- */
    _now() { return this.opts.clock ? this.opts.clock() : performance.now(); }

    requestRender() {
      if (this.dead || this.rafId || this.lost) return;
      this.rafId = requestAnimationFrame(() => { this.rafId = 0; this._frame(); });
    }

    _animPose(a, now) {
      const u = clamp((now - a.start) / a.dur, 0, 1);
      const fin = a.pose;
      const anch = this._anchors()[a.seat] || this._anchors().bottom;
      const hoverY = a.slam ? 13 : 3.4;
      const hover = [fin.x, hoverY, fin.z];
      let start;
      if (a.local) start = [a.local.x, a.local.y, a.local.z];
      else start = [anch.rest[0], 4.2, anch.rest[2]];
      const startYaw = a.local ? a.local.yaw : (a.seat === "left" || a.seat === "right" ? Math.PI / 2 : 0);
      const finYaw = shortAngle(startYaw, fin.yaw);
      let tp, yaw, held = true;
      const U1 = a.slam ? 0.3 : a.local ? 0.22 : 0.3;
      const U2 = a.slam ? 0.5 : 0.52;
      const U3 = a.slam ? 0.58 : 0.66;
      const U4 = a.slam ? 0.8 : 0.68;
      if (u < U1) { const t = smooth(u / U1); tp = lerp3(start, hover, t); yaw = lerp(startYaw, finYaw, t * 0.6); }
      else if (u < U2) {
        let t = (u - U1) / (U2 - U1);
        t = a.slam ? t * t * t : smooth(t);
        tp = lerp3(hover, [fin.x, TILE_T / 2, fin.z], t);
        yaw = lerp(lerp(startYaw, finYaw, 0.6), finYaw, smooth((u - U1) / (U2 - U1)));
      } else {
        const bounce = a.slam ? Math.max(0, 1 - (u - U2) / (U3 - U2)) * 0.55 * Math.abs(Math.sin((u - U2) * 40)) : (u < U3 ? Math.sin((u - U2) / (U3 - U2) * Math.PI) * 0.12 : 0);
        tp = [fin.x, TILE_T / 2 + bounce, fin.z];
        yaw = finYaw; held = u < U3;
      }
      if (u >= U2 && !a.landedFired) { a.landedFired = true; this.opts.onLand && this.opts.onLand(a.id, a.slam); }
      if (a.slam && u >= U2 && !a.impacted) this._impact(a, now);
      const toSh = norm([anch.shoulder[0] - tp[0], 0, anch.shoulder[2] - tp[2]]);
      const wristHold = [tp[0] + toSh[0] * 2.4, tp[1] + 1.5, tp[2] + toSh[2] * 2.4];
      let wrist;
      if (u < U4) wrist = wristHold;
      else wrist = lerp3(wristHold, anch.rest, smooth((u - U4) / (1 - U4)));
      return { u, tp, yaw, held, wrist, shoulder: anch.shoulder, toSh };
    }

    _drawArm(shoulder, wrist, style, bend = 1, k = 1) {
      const D = sub(wrist, shoulder);
      const dist = len(D);
      const L = Math.max(11 * k, dist * 0.62);
      const dn = scl(D, 1 / (dist || 1));
      const reach = Math.min(dist, 2 * L - 0.05);
      const a = reach / 2;
      const h = Math.sqrt(Math.max(L * L - a * a, 0));
      const lat = scl(norm([-dn[2], 0, dn[0]]), bend);
      const pole = norm(add([0, 0.45, 0], scl(lat, 1)));
      const pp = norm(sub(pole, scl(dn, dot(pole, dn))));
      const elbow = add(add(shoulder, scl(dn, a)), scl(pp, h));
      const sleeve = [...style.sleeve, 1];
      const skin = [...style.skin, 1];
      this._draw("cyl", segment(shoulder, elbow, 0.62 * k), { color: sleeve });
      this._draw("sph", ellipsoid(elbow, [0, 1, 0], 0.62 * k, 0.62 * k, 0.62 * k), { color: sleeve });
      const fw = sub(wrist, elbow);
      const cuff = add(elbow, scl(fw, 0.4));
      this._draw("cyl", segment(elbow, cuff, 0.55 * k), { color: sleeve });
      this._draw("cyl", segment(cuff, wrist, 0.44 * k), { color: skin });
      const fwd = norm(sub(wrist, elbow));
      const palm = add(wrist, scl(fwd, 0.9 * k));
      this._draw("sph", ellipsoid(palm, fwd, 0.7 * k, 0.95 * k, 0.38 * k), { color: skin });
      const side = norm(cross(fwd, [0, 1, 0]));
      [-0.42, 0, 0.42].forEach(o => {
        const f = add(add(palm, scl(fwd, 1.1 * k)), scl(side, o * k));
        this._draw("sph", ellipsoid(f, fwd, 0.22 * k, 0.36 * k, 0.22 * k), { color: skin });
      });
    }

    _tileDraw(near, far, x, y, z, yaw, pitch = 0, roll = 0, tint = null, sc = 1) {
      const gl = this.gl;
      const tn = tint || [1, 1, 1];
      const W = TILE_W * sc, T = TILE_T * sc, L = TILE_L * sc;
      this._draw("box", model(x, y, z, yaw, W, T, L, pitch, roll), { color: [0.95 * tn[0], 0.91 * tn[1], 0.8 * tn[2], 1] });
      // normal de la cara superior (para despegar el dibujo de los puntos)
      const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const n1 = [-sr, cr, 0];
      const n2 = [n1[0], n1[1] * cp - 0 * sp, n1[1] * sp + 0 * cp];
      const n3 = [n2[0] * cy + n2[2] * sy, n2[1], -n2[0] * sy + n2[2] * cy];
      const off = T / 2 + 0.006 * sc;
      const top = model(x + n3[0] * off, y + n3[1] * off, z + n3[2] * off, yaw, W, 1, L, pitch, roll);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1.5, -1.5);
      this._draw("quad", top, { tex: this.tex.atlas, uv: atlasRect(near, far), color: [tn[0], tn[1], tn[2], 1] });
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // ficha de pie con la espalda hacia mí (mano de un rival)
    _backTile(x, z, yaw) {
      const th = (80 * Math.PI) / 180, s = 0.78;
      const y = 1.95 * s * Math.sin(th) + 0.3 * s * Math.cos(th);
      this._draw("box", model(x, y, z, yaw, TILE_W * s, TILE_T * s, TILE_L * s, th, 0), { color: [0.93, 0.89, 0.78, 1] });
      this._draw("box", model(x, y, z, yaw, (TILE_W - 0.34) * s, (TILE_T + 0.04) * s, (TILE_L - 0.34) * s, th, 0), { color: [0.09, 0.1, 0.17, 1] });
    }

    _drawSeat(seat, info, now, skipRight) {
      const S = SEAT[seat];
      const f = S.f, r = [-f[1], 0, f[0]];
      const K = 0.6;   // escala de las personas respecto a las fichas
      const st = info.style || { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] };
      const glow = info.turn ? 1.3 : 1;
      const shirt = [Math.min(1, st.sleeve[0] * glow), Math.min(1, st.sleeve[1] * glow), Math.min(1, st.sleeve[2] * glow), 1];
      const skin = [...st.skin, 1];
      const horiz = Math.abs(f[0]) > 0.5;
      const wx = (horiz ? 3.3 : 6.2) * K, wz = (horiz ? 6.2 : 3.3) * K;
      this._draw("sph", basis([S.x, 8.4 * K, S.z], [wx, 0, 0], [0, 8.4 * K, 0], [0, 0, wz]), { color: shirt });
      const head = [S.x - f[0] * 0.3, 19.2 * K, S.z - f[1] * 0.3];
      this._draw("sph", basis(head, [3.4 * K, 0, 0], [0, 3.6 * K, 0], [0, 0, 3.4 * K]), { color: skin });
      this._draw("sph", basis([head[0] - f[0] * 0.55, head[1] + 0.5, head[2] - f[1] * 0.55], [3.55 * K, 0, 0], [0, 3.5 * K, 0], [0, 0, 3.55 * K]), { color: [0.11, 0.08, 0.07, 1] });
      [-1, 1].forEach(k => {
        const e = [head[0] + f[0] * 3.05 * K + r[0] * k * 1.15 * K, head[1] + 0.2, head[2] + f[1] * 3.05 * K + r[2] * k * 1.15 * K];
        this._draw("sph", basis(e, [0.42 * K, 0, 0], [0, 0.42 * K, 0], [0, 0, 0.42 * K]), { color: [0.05, 0.05, 0.07, 1] });
      });
      // brazos apoyados en la mesa
      [1, -1].forEach(k => {
        if (k === 1 && skipRight) return;
        const sh = [S.x + r[0] * 5.8 * K * k, 13.2 * K, S.z + r[2] * 5.8 * K * k];
        const wr = [S.x + f[0] * 9 + r[0] * 3.4 * k, 2.6, S.z + f[1] * 9 + r[2] * 3.4 * k];
        this._drawArm(sh, wr, st, k, K);
      });
      // fichas del jugador (de espaldas)
      const n = Math.min(info.count || 0, 14);
      const yaw = Math.atan2(-f[0], -f[1]);
      const sp = n > 10 ? 1.28 : 1.5;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * sp;
        this._backTile(S.x + f[0] * 12.5 + r[0] * off, S.z + f[1] * 12.5 + r[2] * off, yaw);
      }
      // aro dorado en el turno
      if (info.turn) {
        const gl = this.gl;
        gl.depthMask(false);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-3, -3);
        const pulse = 0.65 + 0.3 * Math.sin(now / 200);
        this._draw("quad", model(S.x + f[0] * 12, 0.04, S.z + f[1] * 12, horiz ? Math.PI / 2 : 0, 16, 1, 9), { tex: this.tex.ring, lit: false, color: [1, 0.85, 0.3, pulse] });
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthMask(true);
      }
    }

    _tilePose(id, now) {
      const p = this.poses[id];
      const sc = this.scatter;
      if (sc && sc.tracks[id]) {
        const k = (now - sc.t0) / 1000 / sc.dt;
        if (k < sc.N - 1) {
          const f0 = Math.max(0, Math.floor(k)), t = k - f0;
          const a = sc.tracks[id], o0 = f0 * 6, o1 = Math.min(f0 + 1, sc.N - 1) * 6;
          return { x: lerp(a[o0], a[o1], t), y: lerp(a[o0 + 1], a[o1 + 1], t), z: lerp(a[o0 + 2], a[o1 + 2], t), yaw: lerp(a[o0 + 3], a[o1 + 3], t), pitch: lerp(a[o0 + 4], a[o1 + 4], t), roll: lerp(a[o0 + 5], a[o1 + 5], t), flying: true };
        }
      }
      return { x: p.x, y: TILE_T / 2 + (p.yOff || 0), z: p.z, yaw: p.yaw, pitch: 0, roll: 0, flying: false };
    }

    _drawRack(now) {
      const gl = this.gl;
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.loc.uVP, false, this._hudVP());
      const slots = this._rackSlots();
      const draggedId = this.drag ? this.drag.tile.id : null;
      slots.forEach((s, i) => {
        if (s.id === draggedId) return;
        const dim = this.rack.myTurn && s.state === "dim";
        const tint = dim ? [0.55, 0.55, 0.62] : null;
        let roll = 0, dy = 0;
        if (this.rack.organizing) { roll = Math.sin(now / 130 + i) * 0.05; }
        if (s.state === "playable" && this.rack.myTurn) {
          gl.depthMask(false);
          const g = model(s.x, s.y, s.z - 0.15, 0, (TILE_W + 0.7) * s.sc, 1, (TILE_L + 0.7) * s.sc, (78 * Math.PI) / 180, 0);
          this._draw("quad", g, { tex: this.tex.marker, lit: false, color: [1, 1, 1, 0.9] });
          gl.depthMask(true);
        }
        const M = this._rackModel(s, { dy, roll });
        void M;
        this._tileDraw(s.a, s.b, s.x, s.y + dy, s.z, 0, (78 * Math.PI) / 180, roll, tint, s.sc);
      });
      // la ficha que llevas en la mano sobre el atril
      if (this.drag && this.drag.hud) {
        const tanH = Math.tan(HUD_FOV / 2), asp = this.canvas.width / this.canvas.height;
        const x = this.drag.hud[0] * HUD_D * tanH * asp, y = this.drag.hud[1] * HUD_D * tanH;
        const sc = (slots[0] ? slots[0].sc : 1) * 1.12;
        this._tileDraw(this.drag.near, this.drag.far, x, y, -HUD_D + 0.5, 0, (74 * Math.PI) / 180, Math.sin(now / 200) * 0.05, null, sc);
      }
    }

    _frame() {
      if (this.dead || this.lost) return;
      const gl = this.gl;
      const now = this._now();

      // suavizado de cámara
      const c = this.cam;
      const k = 0.16;
      c.d += (c.goalD - c.d) * k; c.cx += (c.goalCx - c.cx) * k; c.cz += (c.goalCz - c.cz) * k;
      c.ax += (c.goalAx - c.ax) * k; c.ay += (c.goalAy - c.ay) * k;
      let camMoving = Math.abs(c.goalD - c.d) > 0.05 || Math.abs(c.goalCx - c.cx) > 0.02 || Math.abs(c.goalCz - c.cz) > 0.02 ||
                      Math.abs(c.goalAx - c.ax) > 0.0005 || Math.abs(c.goalAy - c.ay) > 0.0005;
      const zg = this.zoom * this.autoZoom;
      this.zoomNow += (zg - this.zoomNow) * 0.15;
      this.bcNow = this.bcNow.map((v, i) => v + (this.bc[i] - v) * 0.15);
      if (Math.abs(zg - this.zoomNow) > 0.003 || Math.abs(this.bc[0] - this.bcNow[0]) > 0.03 || Math.abs(this.bc[2] - this.bcNow[2]) > 0.03) camMoving = true;
      if (this.shake > 0.01) { this.shake *= 0.93; camMoving = true; } else this.shake = 0;
      this._updateMatrices(now);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.loc.uVP, false, this.VP);

      // mesa: tablero de madera y paño
      gl.depthMask(true);
      this._draw("box", model(0, -1.7, 0, 0, TABLE_W + 7, 3.2, TABLE_D + 7), { color: [0.34, 0.19, 0.1, 1] });
      if (this.tex.table) {
        this._draw("quad", model(0, 0.002, 0, 0, TABLE_W, 1, TABLE_D), { tex: this.tex.table, lit: false });
      }

      const animating = new Map();
      this.anims = this.anims.filter(a => now - a.start < a.dur + 30);
      this.anims.forEach(a => animating.set(a.id, this._animPose(a, now)));

      const poses = {};
      this.order.forEach(id => { if (this.poses[id]) poses[id] = this._tilePose(id, now); });
      if (this.scatter && now - this.scatter.t0 > this.scatter.N * this.scatter.dt * 1000) this.scatter = null;

      // sombras
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      const shadowTile = (x, z, yaw, h) => {
        const grow = 1 + h * 0.07;
        this._draw("quad", model(x + 0.22 + h * 0.25, 0.01, z + 0.34 + h * 0.4, yaw, (TILE_W + 0.9) * grow, 1, (TILE_L + 0.9) * grow),
          { tex: this.tex.shadow, lit: false, color: [0, 0, 0, clamp(0.62 - h * 0.1, 0.22, 0.62)] });
      };
      this.order.forEach(id => {
        const p = poses[id];
        if (!p) return;
        const an = animating.get(id);
        if (an && an.held) shadowTile(an.tp[0], an.tp[2], an.yaw, an.tp[1]);
        else shadowTile(p.x, p.z, p.yaw, Math.max(0, p.y - TILE_T / 2));
      });
      if (this.drag && this.drag.over && this.drag.pos) shadowTile(this.drag.pos[0], this.drag.pos[2], this.drag.yaw, DRAG_Y);
      animating.forEach(an => {
        this._draw("quad", model(an.wrist[0] + 0.4, 0.012, an.wrist[2] + 0.5, 0, 3.4, 1, 3.8), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.2] });
      });
      if (this.drag && this.drag.over && this.drag.pos) {
        const p = this.drag.pos;
        this._draw("quad", model(p[0] + 0.4, 0.012, p[2] + 2.5, 0, 3.4, 1, 3.8), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.2] });
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);

      // fichas del tablero
      this.order.forEach(id => {
        const p = this.poses[id];
        const q = poses[id];
        if (!p || !q) return;
        const an = animating.get(id);
        if (an) {
          this._tileDraw(p.near, p.far, an.tp[0], an.tp[1], an.tp[2], an.yaw, an.held ? Math.sin(an.u * 9) * 0.05 : 0, an.held ? Math.cos(an.u * 7) * 0.05 : 0);
        } else {
          this._tileDraw(p.near, p.far, q.x, q.y, q.z, q.yaw, q.pitch, q.roll);
        }
        if (p.starter && !q.flying) {
          gl.depthMask(false);
          gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
          const base = an ? [an.tp[0], an.tp[1] - TILE_T / 2, an.tp[2]] : [q.x, 0, q.z];
          this._draw("quad", model(base[0], base[1] + 0.02, base[2], an ? an.yaw : q.yaw, TILE_W + 1.1, 1, TILE_L + 1.1),
            { tex: this.tex.marker, lit: false, color: [1, 1, 1, 0.95] });
          gl.disable(gl.POLYGON_OFFSET_FILL);
          gl.depthMask(true);
        }
      });

      // onda de choque del azote
      this.fx = this.fx.filter(f => now - f.t0 < 700);
      if (this.fx.length) {
        gl.depthMask(false);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-3, -3);
        this.fx.forEach(f => {
          const t = (now - f.t0) / 700;
          const s = 6 + t * 34;
          this._draw("quad", model(f.x, 0.05, f.z, 0, s, 1, s), { tex: this.tex.ring, lit: false, color: [1, 1, 1, (1 - t) * 0.85] });
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthMask(true);
      }

      // marcadores donde puedes soltar la ficha
      if (this.drag) {
        gl.depthMask(false);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-3, -3);
        const pulse = 0.55 + 0.35 * Math.sin(now / 160);
        const sides = this.drag.mode === "starter" ? [] : this.drag.validSides;
        sides.forEach(side => {
          const s = this.slots[side];
          if (!s) return;
          const hot = this.drag.side === side;
          this._draw("quad", model(s.x, 0.03, s.z, s.yaw, TILE_W + 0.9, 1, TILE_L + 0.9),
            { tex: this.tex.marker, lit: false, color: [1, 1, 1, hot ? 1 : pulse * 0.8] });
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthMask(true);
      }

      // primera persona: los demás jugadores alrededor de la mesa
      if (this.mode === "fp") {
        ["top", "left", "right"].forEach(seat => {
          const info = this.seatInfo[seat];
          if (!info || !info.present) return;
          const busy = [...animating.values()].length && this.anims.some(a => a.seat === seat);
          this._drawSeat(seat, info, now, busy);
        });
      }

      // brazos de las jugadas en curso
      animating.forEach((an, id) => {
        const a = this.anims.find(x => x.id === id);
        if (!a) return;
        this._drawArm(an.shoulder, an.wrist, a.style, 1, a.seat === "bottom" && this.mode === "fp" ? 0.78 : 1);
      });

      // mi brazo con la ficha que arrastro
      if (this.drag && this.drag.over && this.drag.pos) {
        const d = this.drag;
        const anch = this._anchors().bottom;
        const tp = [d.pos[0], DRAG_Y, d.pos[2]];
        const toSh = norm([anch.shoulder[0] - tp[0], 0, anch.shoulder[2] - tp[2]]);
        const wrist = [tp[0] + toSh[0] * 2.4, tp[1] + 1.5, tp[2] + toSh[2] * 2.4];
        this._tileDraw(d.near, d.far, tp[0], tp[1], tp[2], 0, Math.sin(now / 240) * 0.04, Math.cos(now / 300) * 0.04);
        this._drawArm(anch.shoulder, wrist, this.opts.myStyle ? this.opts.myStyle() : { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] }, 1, this.mode === "fp" ? 0.78 : 1);
      }

      // tu mano de fichas, fija delante de ti
      if (this.mode === "fp" && (this.rack.tiles.length || (this.drag && this.drag.hud))) this._drawRack(now);

      this.opts.onFrame && this.opts.onFrame(this);
      if (animating.size || this.drag || camMoving || this.scatter || this.fx.length || this.rack.organizing || (this.mode === "fp" && Object.values(this.seatInfo).some(s => s && s.turn))) this.requestRender();
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.rafId);
      document.removeEventListener("keydown", this._onKey);
      try {
        const ext = this.gl.getExtension("WEBGL_lose_context");
        ext && ext.loseContext();
      } catch {}
    }
  }

  window.Table3D = Table3D;
})();
