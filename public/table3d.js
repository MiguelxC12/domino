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
  const PLANE_W = 120, PLANE_D = 90; // tamaño de la mesa en unidades del tablero
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

      this.board = [];
      this.poses = {};       // id -> pose final de la ficha en la mesa
      this.prevIds = new Set();
      this.anims = [];       // jugadas en curso (brazos)
      this.landed = new Set();
      this.localDrops = {};  // id -> pose donde la soltó el jugador local
      this.slots = {};
      this.drag = null;
      this.cam = { d: 80, cx: 0, cz: 0, goalD: 80, goalCx: 0, goalCz: 0, ax: 0, ay: 0, settled: false };
      this.seats = {};
      this.numberColors = opts.numberColors || [];
      this.theme = { bg: null, dim: 0.35 };
      this.dpr = 1;
      this.rafId = 0;
      this.t0 = performance.now();

      this._initGL();
      this.setTheme(null, 0.35);
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
        table: null
      };

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.03, 0.07, 0.13, 1);
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
        c.width = 1536; c.height = 1152;
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
        // borde de mesa más oscuro
        const v = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.45, c.width / 2, c.height / 2, c.width * 0.75);
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.55)");
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

    /* ---------- tamaño ---------- */
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
      this._updateMatrices();
      this.requestRender();
    }

    /* ---------- cámara ---------- */
    _vp(d, cx, cz, ax, ay) {
      const eye = [cx, Math.sin(EL) * d, cz + Math.cos(EL) * d];
      const V = lookAt(eye, [cx, 0, cz], [0, 1, 0]);
      const P = persp(FOV, this.canvas.width / this.canvas.height, 4, 700);
      const S = ident(); S[12] = ax; S[13] = ay;
      return mul(S, mul(P, V));
    }

    _computeGoal() {
      const W = this.cssW || 1, H = this.cssH || 1;
      const area = (this.opts.getArea && this.opts.getArea()) || { x: 0, y: 0, w: W, h: H };
      // caja que ocupan las fichas
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
      const hw = area.w / W, hh = (area.h / H) * 1.05;   // mitad de la caja en NDC
      const ax = ((area.x + area.w / 2) / W) * 2 - 1;     // centro de la caja en NDC
      const ay = 1 - ((area.y + area.h / 2) / H) * 2;
      const corners = [];
      [minx, maxx].forEach(x => [minz, maxz].forEach(z => [0, TILE_T].forEach(y => corners.push([x, y, z]))));
      const fits = d => {
        const m = this._vp(d, cx, cz, 0, 0);
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
      // sin acercarse más de la cuenta (igual que en 2D)
      const maxU = Math.max(10, Math.min(22, Math.min(area.w, area.h) / 9));
      const dMin = H / (2 * Math.tan(FOV / 2) * maxU);
      this.cam.goalD = Math.max(hi, dMin);
      this.cam.goalCx = cx; this.cam.goalCz = cz;
      this.cam.goalAx = ax; this.cam.goalAy = ay;
      if (this.cam.ax === undefined) { this.cam.ax = ax; this.cam.ay = ay; }
    }

    _updateMatrices() {
      const c = this.cam;
      this.VP = this._vp(c.d, c.cx, c.cz, c.ax, c.ay);
      this.IVP = invert(this.VP);
    }

    // punto de la mesa (a altura y) bajo una posición de pantalla en NDC
    _ground(ndcX, ndcY, y = 0) {
      const m = this.IVP;
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

    /* ---------- tablero ---------- */
    setSeats(seats) { this.seats = seats || {}; }

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
        const jl = (rnd() - 0.5) * 0.34;       // desplazamiento lateral
        const ja = (rnd() - 0.5) * 0.1;        // a lo largo
        const jy = (rnd() - 0.5) * 0.13;       // giro (±3,7°)
        const h = HEAD[it.heading];
        const lat = [-h[1], h[0]];
        let yaw = (it.dbl ? (it.heading === "E" || it.heading === "W" ? 0 : -90) : YAW[it.heading]) * Math.PI / 180;
        poses[p.id] = {
          x: it.cx + lat[0] * jl + h[0] * ja,
          z: it.cy + lat[1] * jl + h[1] * ja,
          yaw: yaw + jy,
          near: it.near, far: it.far, dbl: it.dbl, starter: !!p.starter,
          owner: p.owner
        };
      });

      // fichas nuevas -> animación con el brazo de quien las puso
      if (this.initialized) {
        board.forEach(p => {
          if (!this.prevIds.has(p.id) && !this.landed.has(p.id)) this._startAnim(p, poses[p.id], now);
        });
      } else if (first) {
        board.forEach(p => this.landed.add(p.id));
      }
      if (!board.length) { this.anims = []; this.landed = new Set(); }
      this.initialized = true;
      this.board = board;
      this.poses = poses;
      this.order = board.map(p => p.id);
      this.prevIds = ids;
      this.slots = {};
      ["left", "right"].forEach(side => {
        const s = slots && slots[side];
        if (!s) return;
        const h = HEAD[s.heading];
        const yaw = (s.dbl ? 0 : YAW[s.heading]) * Math.PI / 180;
        this.slots[side] = { x: s.cx, z: s.cy, yaw };
      });
      this._computeGoal();
      this.requestRender();
    }

    _anchors() {
      const g = (nx, ny, y) => this._ground(nx, ny, y) || [0, y, 0];
      return {
        // el hombro queda hacia un costado para que el brazo no tape la ficha
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
      const dur = local ? 950 : 1500;
      this.anims.push({ id: p.id, seat, style, start: now, dur, local: local || null, pose, landedFired: false });
      this.landed.add(p.id);
      delete this.localDrops[p.id];
    }

    /* ---------- arrastre de la ficha del jugador ---------- */
    dragBegin(tile, mode, validSides) {
      this.drag = { tile, mode, validSides, over: false, pos: null, side: null, yaw: 0, near: tile.a, far: tile.b };
      this.requestRender();
    }

    dragMove(cx, cy, pointerType) {
      const d = this.drag;
      if (!d) return { over: false, side: null };
      const r = this.canvas.getBoundingClientRect();
      const over = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      d.over = over;
      d.side = null;
      if (over) {
        const lift = pointerType === "touch" || pointerType === "pen" ? 52 : 0;
        const [nx, ny] = this._toNDC(cx, cy - lift);
        const g = this._ground(nx, ny, DRAG_Y);
        if (g) d.pos = g;
        // lado más cercano entre los válidos
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

    /* ---------- dibujo ---------- */
    _now() { return this.opts.clock ? this.opts.clock() : performance.now(); }

    requestRender() {
      if (this.dead || this.rafId || this.lost) return;
      this.rafId = requestAnimationFrame(t => { this.rafId = 0; this._frame(t); });
    }

    _animPose(a, now) {
      const u = clamp((now - a.start) / a.dur, 0, 1);
      const fin = a.pose;
      const anch = this._anchors()[a.seat] || this._anchors().bottom;
      const hover = [fin.x, 3.4, fin.z];
      let start;
      if (a.local) start = [a.local.x, a.local.y, a.local.z];
      else start = [anch.rest[0], 4.2, anch.rest[2]];
      const startYaw = a.local ? a.local.yaw : (a.seat === "left" || a.seat === "right" ? Math.PI / 2 : 0);
      const finYaw = shortAngle(startYaw, fin.yaw);
      let tp, yaw, held = true;
      const U1 = a.local ? 0.22 : 0.3, U2 = 0.52, U3 = 0.66;
      if (u < U1) { const t = smooth(u / U1); tp = lerp3(start, hover, t); yaw = lerp(startYaw, finYaw, t * 0.6); }
      else if (u < U2) { const t = smooth((u - U1) / (U2 - U1)); tp = lerp3(hover, [fin.x, TILE_T / 2, fin.z], t); yaw = lerp(lerp(startYaw, finYaw, 0.6), finYaw, t); }
      else { tp = [fin.x, TILE_T / 2 + (u < U3 ? Math.sin((u - U2) / (U3 - U2) * Math.PI) * 0.12 : 0), fin.z]; yaw = finYaw; held = u < U3; }
      if (u >= U2 && !a.landedFired) { a.landedFired = true; this.opts.onLand && this.opts.onLand(a.id); }
      // posición de la muñeca
      const toSh = norm([anch.shoulder[0] - tp[0], 0, anch.shoulder[2] - tp[2]]);
      const wristHold = [tp[0] + toSh[0] * 2.4, tp[1] + 1.5, tp[2] + toSh[2] * 2.4];
      let wrist;
      const U4 = 0.68;
      if (u < U4) wrist = wristHold;
      else wrist = lerp3(wristHold, anch.rest, smooth((u - U4) / (1 - U4)));
      return { u, tp, yaw, held, wrist, shoulder: anch.shoulder, toSh };
    }

    _drawArm(shoulder, wrist, toward, style) {
      // brazo de dos huesos con codo
      const D = sub(wrist, shoulder);
      const dist = len(D);
      const L = Math.max(11, dist * 0.62);
      const dn = scl(D, 1 / (dist || 1));
      const reach = Math.min(dist, 2 * L - 0.05);
      const a = (L * L - L * L + reach * reach) / (2 * reach);
      const h = Math.sqrt(Math.max(L * L - a * a, 0));
      const lat = norm([-dn[2], 0, dn[0]]);
      const pole = norm(add([0, 0.45, 0], scl(lat, 1)));
      // componente perpendicular a la dirección del brazo
      const pp = norm(sub(pole, scl(dn, dot(pole, dn))));
      const elbow = add(add(shoulder, scl(dn, a)), scl(pp, h));
      const sleeve = [...style.sleeve, 1];
      const skin = [...style.skin, 1];
      // manga (hombro -> codo) y antebrazo
      this._draw("cyl", segment(shoulder, elbow, 0.62), { color: sleeve });
      this._draw("sph", ellipsoid(elbow, [0, 1, 0], 0.62, 0.62, 0.62), { color: sleeve });
      const fw = sub(wrist, elbow);
      const cuff = add(elbow, scl(fw, 0.4));
      this._draw("cyl", segment(elbow, cuff, 0.55), { color: sleeve });
      this._draw("cyl", segment(cuff, wrist, 0.44), { color: skin });
      // mano
      const fwd = norm(sub(wrist, elbow));
      const palm = add(wrist, scl(fwd, 0.9));
      this._draw("sph", ellipsoid(palm, fwd, 0.7, 0.95, 0.38), { color: skin });
      const side = norm(cross(fwd, [0, 1, 0]));
      [-0.42, 0, 0.42].forEach(k => {
        const f = add(add(palm, scl(fwd, 1.1)), scl(side, k));
        this._draw("sph", ellipsoid(f, fwd, 0.22, 0.36, 0.22), { color: skin });
      });
    }

    _tileDraw(near, far, x, y, z, yaw, pitch = 0, roll = 0, shadow = true) {
      const gl = this.gl;
      const m = model(x, y, z, yaw, TILE_W, TILE_T, TILE_L, pitch, roll);
      this._draw("box", m, { color: [0.95, 0.91, 0.8, 1] });
      // cara superior con los puntos
      const top = model(x, y + TILE_T / 2 + 0.006, z, yaw, TILE_W, 1, TILE_L, pitch, roll);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1.5, -1.5);
      this._draw("quad", top, { tex: this.tex.atlas, uv: atlasRect(near, far), color: [1, 1, 1, 1] });
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    _frame(t) {
      if (this.dead || this.lost) return;
      const gl = this.gl;
      const now = this._now();

      // cámara suave hacia su destino
      const c = this.cam;
      const k = 0.16;
      c.d += (c.goalD - c.d) * k; c.cx += (c.goalCx - c.cx) * k; c.cz += (c.goalCz - c.cz) * k;
      c.ax += (c.goalAx - c.ax) * k; c.ay += (c.goalAy - c.ay) * k;
      const camMoving = Math.abs(c.goalD - c.d) > 0.05 || Math.abs(c.goalCx - c.cx) > 0.02 || Math.abs(c.goalCz - c.cz) > 0.02 ||
                        Math.abs(c.goalAx - c.ax) > 0.0005 || Math.abs(c.goalAy - c.ay) > 0.0005;
      this._updateMatrices();

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.loc.uVP, false, this.VP);

      // mesa
      if (this.tex.table) {
        gl.depthMask(true);
        this._draw("quad", model(0, 0, 0, 0, PLANE_W, 1, PLANE_D), { tex: this.tex.table, lit: false });
      }

      const animating = new Map();
      this.anims = this.anims.filter(a => now - a.start < a.dur + 30);
      this.anims.forEach(a => animating.set(a.id, this._animPose(a, now)));

      // sombras
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      const shadowTile = (x, z, yaw, h) => {
        const grow = 1 + h * 0.07;
        this._draw("quad", model(x + 0.22 + h * 0.25, 0.01, z + 0.34 + h * 0.4, yaw, (TILE_W + 0.9) * grow, 1, (TILE_L + 0.9) * grow),
          { tex: this.tex.shadow, lit: false, color: [0, 0, 0, clamp(0.62 - h * 0.1, 0.25, 0.62)] });
      };
      this.order && this.order.forEach(id => {
        const p = this.poses[id];
        if (!p) return;
        const an = animating.get(id);
        if (an && an.held) shadowTile(an.tp[0], an.tp[2], an.yaw, an.tp[1]);
        else shadowTile(p.x, p.z, p.yaw, 0);
      });
      if (this.drag && this.drag.over && this.drag.pos) shadowTile(this.drag.pos[0], this.drag.pos[2], this.drag.yaw, DRAG_Y);
      // sombras de las manos
      animating.forEach(an => {
        this._draw("quad", model(an.wrist[0] + 0.4, 0.012, an.wrist[2] + 0.5, 0, 3.4, 1, 3.8), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.2] });
      });
      if (this.drag && this.drag.over && this.drag.pos) {
        const p = this.drag.pos;
        this._draw("quad", model(p[0] + 0.4, 0.012, p[2] + 2.5, 0, 3.4, 1, 3.8), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.2] });
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);

      // fichas
      this.order && this.order.forEach(id => {
        const p = this.poses[id];
        if (!p) return;
        const an = animating.get(id);
        if (an) {
          this._tileDraw(p.near, p.far, an.tp[0], an.tp[1], an.tp[2], an.yaw, an.held ? Math.sin(an.u * 9) * 0.05 : 0, an.held ? Math.cos(an.u * 7) * 0.05 : 0);
        } else {
          this._tileDraw(p.near, p.far, p.x, TILE_T / 2, p.z, p.yaw);
        }
        if (p.starter) {
          // aro dorado de la ficha de salida
          gl.depthMask(false);
          gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
          const q = an ? an.tp : [p.x, 0, p.z];
          this._draw("quad", model(q[0], (an ? an.tp[1] - TILE_T / 2 : 0) + 0.02, q[2], an ? an.yaw : p.yaw, TILE_W + 1.1, 1, TILE_L + 1.1),
            { tex: this.tex.marker, lit: false, color: [1, 1, 1, 0.95] });
          gl.disable(gl.POLYGON_OFFSET_FILL);
          gl.depthMask(true);
        }
      });

      // marcadores donde se puede soltar la ficha
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

      // brazos (jugadas de todos)
      animating.forEach((an, id) => {
        const a = this.anims.find(x => x.id === id);
        if (!a) return;
        this._drawArm(an.shoulder, an.wrist, an.toSh, a.style);
      });

      // mi brazo con la ficha que arrastro
      if (this.drag && this.drag.over && this.drag.pos) {
        const d = this.drag;
        const anch = this._anchors().bottom;
        const tp = [d.pos[0], DRAG_Y, d.pos[2]];
        const toSh = norm([anch.shoulder[0] - tp[0], 0, anch.shoulder[2] - tp[2]]);
        const wrist = [tp[0] + toSh[0] * 2.4, tp[1] + 1.5, tp[2] + toSh[2] * 2.4];
        this._tileDraw(d.near, d.far, tp[0], tp[1], tp[2], 0, Math.sin(now / 240) * 0.04, Math.cos(now / 300) * 0.04);
        this._drawArm(anch.shoulder, wrist, toSh, this.opts.myStyle ? this.opts.myStyle() : { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] });
      }

      if (animating.size || this.drag || camMoving) this.requestRender();
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.rafId);
      try {
        const ext = this.gl.getExtension("WEBGL_lose_context");
        ext && ext.loseContext();
      } catch {}
    }
  }

  window.Table3D = Table3D;
})();
