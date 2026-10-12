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
  const EL = (60 * Math.PI) / 180;   // elevación de la cámara en la vista de mesa (aérea)
  const FOV = (36 * Math.PI) / 180;

  /* ESCALA REAL: la ficha mide 3,9 unidades ≈ 5 cm  →  1 unidad ≈ 1,3 cm.
     Mesa ≈ 1 m de lado y ≈ 80 cm de alto; las personas se dibujan a su tamaño real. */
  const TABLE_W = 64, TABLE_D = 64;   // tablero de la mesa (≈ 82 cm de lado), como la de la foto
  const FRAME_IN = 21;                 // el marco de madera deja una zona de juego de 42 × 42 (≈ 54 cm)
  const HOLE = 26.5, HOLE_R = 3.5;     // huecos redondos de las esquinas, donde van los vasos
  const BOTTLE_SLOTS = [[18.7, -27.8], [27.8, -18.7]];  // esquina lejana derecha: botella actual y la vacía al lado
  const POT_POS = [-18.7, -27.8];      // plato redondo de la colecta (esquina lejana izquierda)
  const SEAT_GAP = 15;                 // del borde del paño al centro del cuerpo sentado
  const SEAT = {                       // asientos alrededor de la mesa (f = hacia dónde mira el jugador)
    bottom: { x: 0, z: TABLE_D / 2 + SEAT_GAP, f: [0, -1] },
    top:    { x: 0, z: -(TABLE_D / 2 + SEAT_GAP), f: [0, 1] },
    left:   { x: -(TABLE_W / 2 + SEAT_GAP), z: 0, f: [1, 0] },
    right:  { x: TABLE_W / 2 + SEAT_GAP, z: 0, f: [-1, 0] }
  };
  const FLOOR = -63;                   // el suelo está 63 unidades (≈ 80 cm) bajo el paño
  const KS = 2.4;                      // escala de las personas (tamaño real)
  const ARM_TH = 1.3;                  // grosor extra de los brazos
  const WFLOOR = -26;                  // el barrio se diseñó con el suelo aquí...
  const WS = KS / 0.95;                // ...y se agranda para mantener la proporción con las personas
  const RC = 19.2;                     // línea del atril: distancia desde el centro del asiento hacia la mesa
  const REST_F = 21.5, REST_S = 17;    // dónde descansan las manos (en el borde, junto a tu atril)
  const RACK_SC = 1.1;                 // tamaño de tus fichas en el atril
  const DRAG_Y = 4.4;                  // altura a la que se lleva la ficha en la mano
  const TUNE_DEFAULT = {               // ajustes de cámara y atril (modo debug)
    eyeY: 40,      // altura de los ojos sobre el paño
    eyeZ: 11,      // distancia de los ojos más allá del borde de la mesa
    pitch: 46,     // inclinación de la mirada hacia abajo (grados)
    fovP: 72,      // campo de visión vertical en pantalla vertical
    fovL: 62,      // campo de visión vertical en pantalla horizontal
    rackAng: 72    // inclinación de las fichas del atril (90 = de pie)
  };

  // punto relativo a un asiento: a = lateral (derecha), b = altura del modelo, c = adelante (todo ×KS)
  function SP(S, a, b, c) {
    const f = S.f, r = [-f[1], 0, f[0]];
    return [S.x + r[0] * a * KS + f[0] * c * KS, b * KS, S.z + r[2] * a * KS + f[1] * c * KS];
  }
  // muñeca en reposo sobre la mesa (k = +1 derecha, -1 izquierda)
  function restHand(S, k) {
    const f = S.f, r = [-f[1], 0, f[0]];
    return [S.x + f[0] * REST_F + r[0] * REST_S * k, 3.4, S.z + f[1] * REST_F + r[2] * REST_S * k];
  }

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


  // caja con aristas redondeadas, con medidas reales (hx, hy, hz = medias)
  function buildRoundedBox(hx, hy, hz, r) {
    const h = [hx, hy, hz];
    const inner = [hx - r, hy - r, hz - r];
    const brk = hAxis => {
      const v = [-hAxis, -hAxis + 0.3 * r, -hAxis + 0.65 * r, -hAxis + r, hAxis - r, hAxis - 0.65 * r, hAxis - 0.3 * r, hAxis];
      return v;
    };
    const out = [];
    for (let a = 0; a < 3; a++) {
      for (const s of [-1, 1]) {
        const u = (a + 1) % 3, v = (a + 2) % 3;
        const us = brk(h[u]), vs = brk(h[v]);
        const pt = (iu, iv) => {
          const p = [0, 0, 0];
          p[a] = s * h[a]; p[u] = us[iu]; p[v] = vs[iv];
          const q = p.map((c, k) => Math.max(-inner[k], Math.min(inner[k], c)));
          const n = norm([p[0] - q[0], p[1] - q[1], p[2] - q[2]]);
          return [q[0] + n[0] * r, q[1] + n[1] * r, q[2] + n[2] * r, n[0], n[1], n[2], (p[u] + h[u]) / (2 * h[u]), (p[v] + h[v]) / (2 * h[v])];
        };
        for (let i = 0; i < us.length - 1; i++) {
          for (let j = 0; j < vs.length - 1; j++) {
            const A = pt(i, j), B = pt(i + 1, j), C = pt(i + 1, j + 1), D = pt(i, j + 1);
            [A, B, C, A, C, D].forEach(p => out.push(...p));
          }
        }
      }
    }
    return out;
  }

  // vaso de plástico HUECO: pared exterior, pared interior, borde y fondo (alto 1, radio arriba 1)
  const CUP_RB = 0.68, CUP_WALL = 0.045;
  function buildCup(seg = 22) {
    const v = [];
    const rb = CUP_RB, slope = 1 - CUP_RB, w = CUP_WALL;
    const R = y => rb + slope * y;
    const P = (c, s, y, rad, n) => [c * rad, y, s * rad, n[0], n[1], n[2], 0, 0];
    const quad = (A, B, C, D) => [A, B, C, A, C, D].forEach(p => v.push(...p));
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = norm([c0, -slope, s0]), n1 = norm([c1, -slope, s1]);
      const m0 = [-n0[0], -n0[1], -n0[2]], m1 = [-n1[0], -n1[1], -n1[2]];
      quad(P(c0, s0, 0, R(0), n0), P(c1, s1, 0, R(0), n1), P(c1, s1, 1, R(1), n1), P(c0, s0, 1, R(1), n0));                 // exterior
      quad(P(c0, s0, 0.05, R(0.05) - w, m0), P(c1, s1, 0.05, R(0.05) - w, m1), P(c1, s1, 1, R(1) - w, m1), P(c0, s0, 1, R(1) - w, m0)); // interior
      quad(P(c0, s0, 1, R(1) - w, [0, 1, 0]), P(c1, s1, 1, R(1) - w, [0, 1, 0]), P(c1, s1, 1, R(1), [0, 1, 0]), P(c0, s0, 1, R(1), [0, 1, 0])); // borde (abierto)
      v.push(0, 0, 0, 0, -1, 0, 0, 0, c1 * R(0), 0, s1 * R(0), 0, -1, 0, 0, 0, c0 * R(0), 0, s0 * R(0), 0, -1, 0, 0, 0);       // fondo exterior
      v.push(0, 0.05, 0, 0, 1, 0, 0, 0, c0 * (R(0.05) - w), 0.05, s0 * (R(0.05) - w), 0, 1, 0, 0, 0, c1 * (R(0.05) - w), 0.05, s1 * (R(0.05) - w), 0, 1, 0, 0, 0); // fondo interior
    }
    return v;
  }

  // ron dentro del vaso: sigue la forma cónica y llega hasta el nivel lv (0..1)
  function buildLiquid(lv, seg = 22) {
    const v = [];
    const slope = 1 - CUP_RB;
    const top = 0.06 + 0.88 * lv;
    const rad = y => CUP_RB + slope * y - CUP_WALL - 0.012;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = norm([c0, -slope, s0]), n1 = norm([c1, -slope, s1]);
      const A = [c0 * rad(0.05), 0.05, s0 * rad(0.05), n0[0], n0[1], n0[2], 0, 0];
      const B = [c1 * rad(0.05), 0.05, s1 * rad(0.05), n1[0], n1[1], n1[2], 0, 0];
      const C = [c1 * rad(top), top, s1 * rad(top), n1[0], n1[1], n1[2], 0, 0];
      const D = [c0 * rad(top), top, s0 * rad(top), n0[0], n0[1], n0[2], 0, 0];
      [A, B, C, A, C, D].forEach(p => v.push(...p));
      v.push(0, top, 0, 0, 1, 0, 0, 0, c0 * rad(top), top, s0 * rad(top), 0, 1, 0, 0, 0, c1 * rad(top), top, s1 * rad(top), 0, 1, 0, 0, 0); // superficie
    }
    return v;
  }

  /* ---------------- shaders ---------------- */
  const VS = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
    uniform mat4 uVP; uniform mat4 uModel; uniform vec4 uUVRect;
    varying vec3 vN; varying vec2 vUV; varying vec3 vW;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      gl_Position = uVP * w;
      vW = w.xyz;
      vN = (uModel * vec4(aNrm, 0.0)).xyz;
      vUV = uUVRect.xy + aUV * uUVRect.zw;
    }`;
  const FS = `
    precision mediump float;
    uniform sampler2D uTex; uniform vec4 uColor; uniform float uTexOn; uniform float uLit;
    uniform vec3 uEye; uniform float uSpec; uniform float uShin; uniform float uFogK;
    varying vec3 vN; varying vec2 vUV; varying vec3 vW;
    void main() {
      vec4 base = uTexOn > 0.5 ? texture2D(uTex, vUV) * uColor : uColor;
      vec3 rgb = base.rgb;
      if (uLit > 0.5) {
        vec3 N = normalize(vN);
        vec3 L = normalize(vec3(-0.35, 0.95, 0.45));
        vec3 V = normalize(uEye - vW);
        float d = max(dot(N, L), 0.0);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 amb = mix(vec3(0.30, 0.27, 0.27), vec3(0.48, 0.53, 0.64), hemi);
        rgb *= amb + vec3(1.0, 0.93, 0.82) * 0.6 * d;
        if (uSpec > 0.0) {
          vec3 H = normalize(L + V);
          rgb += vec3(1.0, 0.96, 0.88) * pow(max(dot(N, H), 0.0), uShin) * uSpec;
        }
      }
      if (uFogK > 0.0) {
        float f = clamp((length(vW - uEye) - 90.0) / 330.0, 0.0, 1.0) * 0.6 * uFogK;
        rgb = mix(rgb, vec3(0.95, 0.68, 0.46), f);
      }
      gl_FragColor = vec4(rgb, base.a);
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
     ENTORNO: un barrio de La Habana al atardecer
  ========================================================= */
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // baldosas hidráulicas del suelo del portal
  function makeFloorTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d");
    const R = rng(7);
    const cream = "#efe4cf", teal = "#2f8f8b", terra = "#c55a3e", navy = "#27497a", gold = "#e6b84a";
    const T = 128;
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const x = tx * T, y = ty * T, v = (tx * 3 + ty * 5 + ((tx ^ ty) & 3)) % 4;
        g.fillStyle = cream; g.fillRect(x, y, T, T);
        g.save(); g.translate(x, y);
        if (v === 0) {
          g.fillStyle = teal;
          [[0, 0], [T, 0], [0, T], [T, T]].forEach(([cx, cy]) => { g.beginPath(); g.arc(cx, cy, 52, 0, Math.PI * 2); g.fill(); });
          g.fillStyle = terra; g.beginPath(); g.moveTo(T / 2, 34); g.lineTo(T - 34, T / 2); g.lineTo(T / 2, T - 34); g.lineTo(34, T / 2); g.fill();
        } else if (v === 1) {
          g.fillStyle = navy; g.beginPath(); g.moveTo(T / 2, 8); g.lineTo(T - 8, T / 2); g.lineTo(T / 2, T - 8); g.lineTo(8, T / 2); g.fill();
          g.fillStyle = cream; g.beginPath(); g.moveTo(T / 2, 34); g.lineTo(T - 34, T / 2); g.lineTo(T / 2, T - 34); g.lineTo(34, T / 2); g.fill();
          g.fillStyle = gold; [[0, 0], [T, 0], [0, T], [T, T]].forEach(([cx, cy]) => { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (cx ? -30 : 30), cy); g.lineTo(cx, cy + (cy ? -30 : 30)); g.fill(); });
        } else if (v === 2) {
          g.fillStyle = terra;
          [[T / 2, 28, 0], [T - 28, T / 2, 1], [T / 2, T - 28, 0], [28, T / 2, 1]].forEach(([cx, cy, h]) => { g.beginPath(); g.ellipse(cx, cy, h ? 20 : 30, h ? 30 : 20, 0, 0, Math.PI * 2); g.fill(); });
          g.fillStyle = teal; g.beginPath(); g.arc(T / 2, T / 2, 24, 0, Math.PI * 2); g.fill();
          g.fillStyle = gold; g.beginPath(); g.arc(T / 2, T / 2, 9, 0, Math.PI * 2); g.fill();
        } else {
          [[0, teal], [14, cream], [28, terra], [42, cream], [54, navy]].forEach(([m, col]) => { g.fillStyle = col; g.fillRect(m, m, T - 2 * m, T - 2 * m); });
        }
        g.restore();
        g.strokeStyle = "rgba(110,98,80,.55)"; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
      }
    }
    g.globalAlpha = 0.07;
    for (let i = 0; i < 5000; i++) { g.fillStyle = R() < 0.5 ? "#000" : "#fff"; g.fillRect(R() * 1024, R() * 1024, 2 + R() * 3, 2 + R() * 3); }
    return c;
  }

  const FACADE_WALLS = ["#58b9b0", "#e99aa7", "#e8bd55", "#7ca6d8", "#e48866", "#98d19f", "#f2ddb0", "#d98c9d"];
  const FACADE_SIGNS = ["CAFÉ", "BODEGA", "BARBERÍA", "FARMACIA", "TABACOS", "PIZZA"];

  // fachada colonial con balcones, persianas y portal (una distinta por número)
  function makeFacade(i) {
    const W = 384, H = 576;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const R = rng(100 + i * 31);
    const wall = FACADE_WALLS[i % FACADE_WALLS.length];
    const trim = ["#f6f1e6", "#fff3d6", "#2d6f6a", "#314e7e"][(i + 1) % 4];
    const shutter = ["#2e7a5a", "#7a3b2a", "#2d4f86", "#b8862e", "#f4efe2"][i % 5];
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    const shade = g.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,.18)"); shade.addColorStop(0.35, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.28)");
    g.fillStyle = shade; g.fillRect(0, 0, W, H);
    // aplanado desgastado
    for (let k = 0; k < 2200; k++) { g.fillStyle = R() < 0.5 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.05)"; g.fillRect(R() * W, R() * H, 2 + R() * 6, 2 + R() * 6); }
    for (let k = 0; k < 4; k++) {
      const px = R() * (W - 80), py = 40 + R() * (H - 160), pw = 30 + R() * 60, ph = 20 + R() * 50;
      g.fillStyle = "rgba(168,85,63,.55)"; g.fillRect(px, py, pw, ph);
      g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(px + 3, py + 3, pw - 6, 3);
    }
    // cornisa
    g.fillStyle = trim; g.fillRect(0, 0, W, 26);
    g.fillStyle = "rgba(0,0,0,.25)"; for (let x = 4; x < W; x += 14) g.fillRect(x, 26, 8, 8);
    const win = (x, y, w, h, lit) => {
      g.fillStyle = trim; g.fillRect(x - 5, y - 5, w + 10, h + 10);
      const gl = g.createLinearGradient(0, y, 0, y + h);
      if (lit) { gl.addColorStop(0, "#ffd88f"); gl.addColorStop(1, "#f0a243"); } else { gl.addColorStop(0, "#27374f"); gl.addColorStop(1, "#141d2e"); }
      g.fillStyle = gl; g.fillRect(x, y, w, h);
      // persianas
      g.fillStyle = shutter;
      g.fillRect(x - 2, y, w * 0.3, h); g.fillRect(x + w * 0.7 + 2, y, w * 0.3, h);
      g.fillStyle = "rgba(0,0,0,.3)";
      for (let yy = y + 5; yy < y + h; yy += 7) { g.fillRect(x - 2, yy, w * 0.3, 2); g.fillRect(x + w * 0.7 + 2, yy, w * 0.3, 2); }
      if (lit) { g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(x + w * 0.35, y + 8, w * 0.3, h - 16); }
    };
    const balcony = (y) => {
      g.fillStyle = "#3a3a3e"; g.fillRect(8, y, W - 16, 8);
      g.fillRect(8, y - 34, W - 16, 4);
      for (let x = 12; x < W - 8; x += 9) g.fillRect(x, y - 34, 2.5, 34);
      [40, 150, 270].forEach(px => { g.fillStyle = "#a4552f"; g.fillRect(px, y - 20, 16, 12); g.fillStyle = "#3f9d4a"; g.beginPath(); g.arc(px + 8, y - 26, 11, 0, Math.PI * 2); g.fill(); });
    };
    [[40, 56], [170, 56]].forEach(([_, __]) => {});
    const rows = [58, 214];
    rows.forEach((ry, ri) => {
      [38, 154, 270].forEach((wx, wi) => win(wx, ry, 76, 98, R() < 0.45));
      if (ri === 1) balcony(ry + 118);
    });
    // ropa tendida
    if (i % 3 === 0) {
      g.strokeStyle = "#444"; g.lineWidth = 2; g.beginPath(); g.moveTo(10, 190); g.quadraticCurveTo(W / 2, 215, W - 10, 188); g.stroke();
      ["#e04b4b", "#f5f5f0", "#3b82c4", "#f2c744", "#8f5fb8"].forEach((col, k) => { g.fillStyle = col; g.fillRect(40 + k * 62, 196 + Math.sin(k) * 4, 20, 26); });
    }
    // planta baja: portal con arco, columnas y letrero
    const gy = 372;
    g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, gy - 10, W, H - gy + 10);
    g.fillStyle = trim; [30, 332].forEach(cx => g.fillRect(cx, gy - 6, 22, H - gy + 6));
    const dx = 92, dw = 200;
    g.fillStyle = "#2a1c14"; g.beginPath(); g.moveTo(dx, H); g.lineTo(dx, gy + 70); g.arc(dx + dw / 2, gy + 70, dw / 2, Math.PI, 0); g.lineTo(dx + dw, H); g.fill();
    const lg = g.createRadialGradient(dx + dw / 2, gy + 120, 10, dx + dw / 2, gy + 120, 120);
    lg.addColorStop(0, "rgba(255,196,110,.85)"); lg.addColorStop(1, "rgba(255,196,110,0)");
    g.fillStyle = lg; g.fillRect(dx, gy, dw, H - gy);
    g.strokeStyle = trim; g.lineWidth = 8; g.beginPath(); g.arc(dx + dw / 2, gy + 70, dw / 2 + 4, Math.PI, 0); g.stroke();
    g.fillStyle = "#1f1712"; g.fillRect(dx + dw / 2 - 3, gy + 70, 6, H - gy - 70);
    // letrero
    g.fillStyle = ["#7b2d26", "#1d4e5f", "#3b2f63", "#26543a"][i % 4]; g.fillRect(dx - 6, gy - 46, dw + 12, 30);
    g.fillStyle = "#f8e7b9"; g.font = "bold 22px Georgia, serif"; g.textAlign = "center";
    g.fillText(FACADE_SIGNS[i % FACADE_SIGNS.length], dx + dw / 2, gy - 24);
    // rejas en la ventana de planta baja
    [[40, gy + 40], [292, gy + 40]].forEach(([wx, wy]) => {
      g.fillStyle = "#18222f"; g.fillRect(wx, wy, 52, 90);
      g.fillStyle = "#222"; for (let x = wx + 6; x < wx + 52; x += 10) g.fillRect(x, wy, 2.5, 90);
    });
    return c;
  }

  function makeSkyTex() {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 256;
    const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#22406f"); gr.addColorStop(0.45, "#6f93c4"); gr.addColorStop(0.72, "#f0b077"); gr.addColorStop(1, "#f7c58a");
    g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
    return c;
  }

  function makeWoodTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const R = rng(21);
    g.fillStyle = "#6a3c1d"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${R() < 0.5 ? "30,14,4" : "150,90,45"},${0.08 + R() * 0.16})`;
      g.lineWidth = 1 + R() * 2.5;
      const y = R() * 256;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + (R() - 0.5) * 14, 170, y + (R() - 0.5) * 14, 256, y + (R() - 0.5) * 10); g.stroke();
    }
    return c;
  }

  function makeFlagTex() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const g = c.getContext("2d");
    for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? "#ffffff" : "#002a8f"; g.fillRect(0, (i * 128) / 5, 256, 128 / 5 + 1); }
    g.fillStyle = "#cf142b"; g.beginPath(); g.moveTo(0, 0); g.lineTo(115, 64); g.lineTo(0, 128); g.fill();
    g.fillStyle = "#ffffff"; g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 9 : 22; g.lineTo(38 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.fill();
    return c;
  }

  function makeLabelTex() {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 192;
    const g = c.getContext("2d");
    g.fillStyle = "#f3e6c6"; g.fillRect(0, 0, 128, 192);
    g.fillStyle = "#9d1f1f"; g.fillRect(0, 0, 128, 34); g.fillRect(0, 158, 128, 34);
    g.fillStyle = "#d8aa3a"; g.fillRect(0, 34, 128, 4); g.fillRect(0, 154, 128, 4);
    g.fillStyle = "#7a1414"; g.textAlign = "center";
    g.font = "bold 25px Georgia, serif"; g.fillText("HAVANA", 64, 78);
    g.font = "bold 25px Georgia, serif"; g.fillText("CLUB", 64, 106);
    g.fillStyle = "#b8862e"; g.font = "italic 15px Georgia, serif"; g.fillText("Añejo", 64, 130);
    g.fillStyle = "#f3e6c6"; g.font = "bold 18px Georgia, serif"; g.fillText("7 AÑOS", 64, 183);
    return c;
  }

  // rota v con R = Ry * Rx * Rz (igual que model())
  function rotYXZ(yaw, pitch, roll, v) {
    const cz = Math.cos(roll), sz = Math.sin(roll), cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x = v[0] * cz - v[1] * sz, y = v[0] * sz + v[1] * cz, z = v[2];
    const y2 = y * cx - z * sx, z2 = y * sx + z * cx;
    return [x * cy + z2 * sy, y2, -x * sy + z2 * cy];
  }

  const CUP_H = 8, CUP_R = 2.8;   // vaso de plástico ≈ 10 cm de alto
  const BS = 2.1;                 // escala de la botella (≈ 30 cm)
  const CUP_REST_Y = CUP_H / 2 - 2.5;   // el vaso queda hundido en su hueco

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
      this.acts = [];
      this.cupShown = {};
      this.bottleShown = 1;
      this.bottleTarget = 1;
      this.bottleNo = 0;          // botella nº (la anterior queda vacía al lado)
      this.bottleNoShown = 0;
      this.bottleSwap = null;     // cambio de botella pendiente
      this.bottleDrop = -1e9;     // cuándo cayó la botella nueva
      this._bottlesInit = false;
      this.potCount = 0; this.potTotal = 4; this.potHold = 0; this.potHoldUntil = 0; this._potInit = false;
      this.coins = [];            // monedas en vuelo
      this.bottlePos = [-40, 0, -30];
      this.auto = null;
      this.numberColors = opts.numberColors || [];
      this.theme = { bg: null, dim: 0.35 };
      this.dpr = 1;
      this.rafId = 0;
      this._fogScale = 0.3;
      this.tune = Object.assign({}, TUNE_DEFAULT);
      try { Object.assign(this.tune, JSON.parse(localStorage.getItem("dominoTune3") || "{}")); } catch {}

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
      ["uVP", "uModel", "uUVRect", "uTex", "uColor", "uTexOn", "uLit", "uEye", "uSpec", "uShin", "uFogK"].forEach(n => { this.loc[n] = gl.getUniformLocation(prog, n); });
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
      this.geo = {
        box: geo(buildBox()), cyl: geo(buildCylinder()), sph: geo(buildSphere()), quad: geo(buildQuad()),
        tile: geo(buildRoundedBox(TILE_W / 2, TILE_T / 2, TILE_L / 2, 0.13)), cup: geo(buildCup()),
        dyn: { buf: gl.createBuffer(), n: 0 }   // geometría que cambia cada cuadro (nivel del ron)
      };

      const tex = (canvas, mip, repeat) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
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
        floor: tex(makeFloorTex(), true, true),
        sky: tex(makeSkyTex(), false),
        wood: tex(makeWoodTex(), true, true),
        flag: tex(makeFlagTex(), false),
        label: tex(makeLabelTex(), false),
        facades: Array.from({ length: 6 }, (_, k) => tex(makeFacade(k), false)),
        table: null
      };

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.025, 0.05, 0.1, 1);
    }

    _setDyn(data) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.geo.dyn.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      this.geo.dyn.n = data.length / 8;
    }

    // ajustes de cámara / atril (los usa el panel de debug)
    setTune(k, v) {
      if (!(k in this.tune) || !Number.isFinite(Number(v))) return;
      this.tune[k] = Number(v);
      try { localStorage.setItem("dominoTune3", JSON.stringify(this.tune)); } catch {}
      this.requestRender();
    }

    resetTune() {
      this.tune = Object.assign({}, TUNE_DEFAULT);
      try { localStorage.removeItem("dominoTune3"); } catch {}
      this.requestRender();
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
      gl.uniform1f(this.loc.uSpec, o.spec || 0);
      gl.uniform1f(this.loc.uShin, o.shin || 24);
      gl.uniform1f(this.loc.uFogK, (this._fogOn === false || o.fog === false) ? 0 : (this._fogScale || 1));
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
      const P = persp(FOV, this.canvas.width / this.canvas.height, 4, 3600);
      const S = ident(); S[12] = ax; S[13] = ay;
      return mul(S, mul(P, V));
    }

    // primera persona: ojos a la altura de tu cabeza, sentado a la mesa; puedes girar la vista
    _fpCam(now) {
      const asp = this.canvas.width / this.canvas.height;
      const tn = this.tune;
      const zoom = clamp(this.zoomNow, 0.6, 3);
      let E = [0, tn.eyeY, TABLE_D / 2 + tn.eyeZ];
      const T = this.bcNow;
      let yaw = Math.atan2(T[0] - E[0], E[2] - T[2]) * 0.5 + this.look.yaw;
      let pitch = clamp(-(tn.pitch * Math.PI) / 180 + this.look.pitch, -1.45, 0.5);
      if (this.auto && this.auto.w > 0.001) {
        const tg = this.auto.target;
        const ty = Math.atan2(tg[0] - E[0], -(tg[2] - E[2]));
        const tp = Math.atan2(tg[1] - E[1], Math.hypot(tg[0] - E[0], tg[2] - E[2])) - 0.18;
        yaw = lerp(yaw, shortAngle(yaw, ty), this.auto.w);
        pitch = lerp(pitch, tp, this.auto.w);
      }
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      if (this.shake > 0.01 && now !== undefined) {
        E = [E[0] + Math.sin(now * 0.09) * this.shake * 1.3, E[1] + Math.cos(now * 0.11) * this.shake, E[2]];
      }
      const base = ((asp < 0.8 ? tn.fovP : tn.fovL) * Math.PI) / 180;
      const fovy = 2 * Math.atan(Math.tan(base / 2) / zoom);
      const V = lookAt(E, add(E, dir), [0, 1, 0]);
      const P = persp(fovy, asp, 1.5, 3600);
      return { VP: mul(P, V), eye: E, fovy };
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
      this.autoZoom = 1; void span;

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
        this.eye = [c.cx, Math.sin(EL) * c.d, c.cz + Math.cos(EL) * c.d];
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

    // posición (px dentro del lienzo) donde colocar la etiqueta de un jugador:
    // sobre su cabeza; si queda fuera de la pantalla se pega al borde más cercano
    seatBadge(seat) {
      const S = SEAT[seat];
      if (!S || this.mode !== "fp" || !this.VP) return null;
      const q = project(this.VP, [S.x, 21 * KS + 4, S.z]);
      const r = this.canvas.getBoundingClientRect();
      const front = q[2] > 0;
      let nx = q[0], ny = q[1];
      if (!front) { nx = S.x < 0 ? -1 : S.x > 0 ? 1 : 0; ny = 0.2; }
      const vis = front && Math.abs(nx) < 0.92 && ny > -0.9 && ny < 0.85;
      const cx = clamp(nx, -0.84, 0.84), cy = clamp(ny, -0.88, 0.8);
      return { vis, x: ((cx + 1) / 2) * r.width, y: ((1 - cy) / 2) * r.height };
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
          out[k] = { shoulder: SP(S, 5.3, 9.2, 0.1), rest: restHand(S, 1) };
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
    dragBegin(tile, mode, validSides) {
      this.drag = { tile, mode, validSides, over: false, pos: null, side: null, yaw: 0, near: tile.a, far: tile.b };
      this.requestRender();
    }

    dragMove(cx, cy, pointerType) {
      const d = this.drag;
      if (!d) return { over: false, side: null };
      const r = this.canvas.getBoundingClientRect();
      const inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      d.over = false;
      d.side = null;
      if (inside) {
        const lift = pointerType === "touch" || pointerType === "pen" ? 52 : 0;
        const [nx, ny] = this._toNDC(cx, cy - lift);
        const g = this._ground(nx, ny, DRAG_Y);
        if (g) {
          d.pos = g;
          if (this.mode === "fp") {
            // la ficha solo se juega si la sueltas más allá de tu atril, sobre el paño
            const line = SEAT.bottom.z - RC - 4;
            d.over = g[2] < line && Math.abs(g[0]) < FRAME_IN + 3;
          } else d.over = true;
        }
      }
      if (d.over) {
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
      return { over: d.over, side: d.side };
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
            this.look.pitch = clamp(this._lk.pitch + (ev.clientY - this._lk.y) * 0.003, -0.5, 1.0);
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

    /* ---------- tu mano de fichas: en la mesa, recostada en una tablilla de madera ---------- */
    // pose de la ficha i de un atril: la base apoya en la línea RC y el extremo de arriba se inclina hacia la mesa
    // (la cara con los puntos mira hacia arriba y hacia el dueño). lift = cuánto sobresale (fichas jugables).
    _rackTile(seat, i, n, sc, pitch, lift = 0) {
      const S = SEAT[seat], f = S.f, r = [-f[1], 0, f[0]];
      const pw = TILE_W * sc * 1.16;
      const a = (i - (n - 1) / 2) * pw;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const c = RC + (TILE_L / 2) * sc * cp + lift * cp;
      const y = sc * ((TILE_L / 2) * sp + (TILE_T / 2) * cp) + lift * sp;
      return { x: S.x + r[0] * a + f[0] * c, y, z: S.z + r[2] * a + f[1] * c, yaw: Math.atan2(-f[0], -f[1]), pitch };
    }

    _rackSlots() {
      const tiles = this.rack.tiles, n = tiles.length;
      const ang = (this.tune.rackAng * Math.PI) / 180;
      return tiles.map((t, i) => {
        const lift = (this.rack.myTurn && t.state === "playable") ? 0.9 : 0;
        const P = this._rackTile("bottom", i, n, RACK_SC, ang, lift);
        return { id: t.id, a: t.a, b: t.b, state: t.state, sc: RACK_SC, x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: ang };
      });
    }

    _rackModel(s, extra = {}) {
      return model(s.x, s.y, s.z, s.yaw, TILE_W * s.sc, TILE_T * s.sc, TILE_L * s.sc, s.pitch, extra.roll || 0);
    }

    // ¿qué ficha de tu atril hay bajo el dedo? (se proyecta la cara de cada ficha con la cámara actual)
    pickRack(clientX, clientY) {
      if (this.mode !== "fp" || !this.VP) return null;
      const slots = this._rackSlots();
      const r = this.canvas.getBoundingClientRect();
      const px = clientX - r.left, py = clientY - r.top;
      for (let i = slots.length - 1; i >= 0; i--) {
        const s = slots[i];
        if (this.drag && this.drag.tile.id === s.id) continue;
        const M = this._rackModel(s);
        let ok = true;
        let pts = [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]].map(c => {
          const wx = M[0]*c[0] + M[4]*c[1] + M[8]*c[2] + M[12];
          const wy = M[1]*c[0] + M[5]*c[1] + M[9]*c[2] + M[13];
          const wz = M[2]*c[0] + M[6]*c[1] + M[10]*c[2] + M[14];
          const q = project(this.VP, [wx, wy, wz]);
          if (q[2] <= 0) ok = false;
          return [((q[0] + 1) / 2) * r.width, ((1 - q[1]) / 2) * r.height];
        });
        if (!ok) continue;
        // un poco de margen para que sea fácil agarrarla con el dedo
        const mx = pts.reduce((a, p) => a + p[0], 0) / 4, my = pts.reduce((a, p) => a + p[1], 0) / 4;
        pts = pts.map(([x, y]) => { const dx = x - mx, dy = y - my, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * 7, y + (dy / l) * 7]; });
        let inside = false;
        for (let a = 0, b = 3; a < 4; b = a++) {
          const [xi, yi] = pts[a], [xj, yj] = pts[b];
          if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
        }
        if (inside) return { id: s.id, index: i };
      }
      return null;
    }

    // posición (índice) del atril donde está el dedo (para reordenar)
    rackIndexAt(clientX) {
      const slots = this._rackSlots();
      if (!slots.length || !this.VP) return 0;
      const r = this.canvas.getBoundingClientRect();
      const px = clientX - r.left;
      let best = 0, bd = 1e9;
      slots.forEach((s, i) => {
        const q = project(this.VP, [s.x, s.y, s.z]);
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
      const hd = this.mode === "fp" ? [5.4, 2.8] : [2.4, 1.5];
      const wristHold = [tp[0] + toSh[0] * hd[0], tp[1] + hd[1], tp[2] + toSh[2] * hd[0]];
      let wrist;
      if (u < U4) wrist = wristHold;
      else wrist = lerp3(wristHold, anch.rest, smooth((u - U4) / (1 - U4)));
      return { u, tp, yaw, held, wrist, shoulder: anch.shoulder, toSh };
    }

    _drawArm(shoulder, wrist, style, bend = 1, k = 1, short = false, back = null, th = 1) {
      const q = k * th;   // grosor (k también fija el largo)
      const D = sub(wrist, shoulder);
      const dist = len(D);
      const L = Math.max(11 * k, dist * 0.62);
      const dn = scl(D, 1 / (dist || 1));
      const reach = Math.min(dist, 2 * L - 0.05);
      const a = reach / 2;
      const h = Math.sqrt(Math.max(L * L - a * a, 0));
      const lat = scl(norm([-dn[2], 0, dn[0]]), bend);
      const pole = back ? norm(add(add([0, -0.15, 0], scl(lat, 0.45)), scl(back, 0.75))) : norm(add([0, 0.45, 0], scl(lat, 1)));
      const pp = norm(sub(pole, scl(dn, dot(pole, dn))));
      const elbow = add(add(shoulder, scl(dn, a)), scl(pp, h));
      const sleeve = [...style.sleeve, 1];
      const skin = [...style.skin, 1];
      const sk = { color: skin, spec: 0.12, shin: 14 };
      if (short) {
        const mid = add(shoulder, scl(sub(elbow, shoulder), 0.5));
        this._draw("cyl", segment(shoulder, mid, 0.7 * q), { color: sleeve });
        this._draw("sph", ellipsoid(mid, sub(elbow, shoulder), 0.7 * q, 0.5 * q, 0.7 * q), { color: sleeve });
        this._draw("cyl", segment(mid, elbow, 0.52 * q), sk);
        this._draw("sph", ellipsoid(elbow, [0, 1, 0], 0.5 * q, 0.5 * q, 0.5 * q), sk);
        this._draw("cyl", segment(elbow, wrist, 0.44 * q), sk);
      } else {
        this._draw("cyl", segment(shoulder, elbow, 0.62 * q), { color: sleeve });
        this._draw("sph", ellipsoid(elbow, [0, 1, 0], 0.62 * q, 0.62 * q, 0.62 * q), { color: sleeve });
        const fw = sub(wrist, elbow);
        const cuff = add(elbow, scl(fw, 0.4));
        this._draw("cyl", segment(elbow, cuff, 0.55 * q), { color: sleeve });
        this._draw("cyl", segment(cuff, wrist, 0.44 * q), sk);
      }
      const fwd = norm(sub(wrist, elbow));
      const palm = add(wrist, scl(fwd, 0.9 * q));
      this._draw("sph", ellipsoid(palm, fwd, 0.7 * q, 0.95 * q, 0.38 * q), sk);
      const side = norm(cross(fwd, [0, 1, 0]));
      [-0.42, 0, 0.42].forEach(o => {
        const f = add(add(palm, scl(fwd, 1.1 * q)), scl(side, o * q));
        this._draw("sph", ellipsoid(f, fwd, 0.22 * q, 0.36 * q, 0.22 * q), sk);
      });
      const thumb = add(add(palm, scl(fwd, 0.4 * q)), scl(side, 0.75 * q));
      this._draw("sph", ellipsoid(thumb, fwd, 0.2 * q, 0.4 * q, 0.2 * q), sk);
    }

    _tileDraw(near, far, x, y, z, yaw, pitch = 0, roll = 0, tint = null, sc = 1) {
      const gl = this.gl;
      const tn = tint || [1, 1, 1];
      const W = TILE_W * sc, T = TILE_T * sc, L = TILE_L * sc;
      this._draw("tile", model(x, y, z, yaw, sc, sc, sc, pitch, roll), { color: [0.95 * tn[0], 0.91 * tn[1], 0.8 * tn[2], 1], spec: 0.45, shin: 55 });
      // normal de la cara superior (para despegar el dibujo de los puntos)
      const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const n1 = [-sr, cr, 0];
      const n2 = [n1[0], n1[1] * cp, n1[1] * sp];
      const n3 = [n2[0] * cy + n2[2] * sy, n2[1], -n2[0] * sy + n2[2] * cy];
      const off = T / 2 + 0.005 * sc;
      const top = model(x + n3[0] * off, y + n3[1] * off, z + n3[2] * off, yaw, W - 0.16 * sc, 1, L - 0.16 * sc, pitch, roll);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1.5, -1.5);
      this._draw("quad", top, { tex: this.tex.atlas, uv: atlasRect(near, far), color: [tn[0], tn[1], tn[2], 1], spec: 0.3, shin: 60 });
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // ficha de un rival: recostada en su atril, con la espalda (blanca) hacia mí
    _tileBack(x, y, z, yaw, pitch, sc) {
      this._draw("tile", model(x, y, z, yaw, sc, sc, sc, pitch, 0), { color: [0.98, 0.97, 0.93, 1], spec: 0.35, shin: 45 });
    }

    _drawSeat(seat, info, now, skipRight) {
      const gl = this.gl;
      const S = SEAT[seat];
      const f = S.f, r = [-f[1], 0, f[0]], f3 = [f[0], 0, f[1]];
      const st = info.style || { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] };
      const glow = info.turn ? 1.22 : 1;
      const shirt = [Math.min(1, st.sleeve[0] * glow), Math.min(1, st.sleeve[1] * glow), Math.min(1, st.sleeve[2] * glow), 1];
      const collar = [Math.min(1, shirt[0] * 0.55 + 0.45), Math.min(1, shirt[1] * 0.55 + 0.45), Math.min(1, shirt[2] * 0.55 + 0.45), 1];
      const skin = [...st.skin, 1];
      const skinD = [st.skin[0] * 0.82, st.skin[1] * 0.7, st.skin[2] * 0.68, 1];
      const PANTS = [[0.17, 0.21, 0.33, 1], [0.36, 0.31, 0.22, 1], [0.2, 0.2, 0.22, 1], [0.24, 0.3, 0.24, 1]];
      const HAIRS = [[0.07, 0.05, 0.04, 1], [0.24, 0.14, 0.07, 1], [0.44, 0.3, 0.14, 1], [0.62, 0.62, 0.62, 1], [0.84, 0.7, 0.38, 1]];
      const pants = PANTS[(st.pants || 0) % 4];
      const hairC = HAIRS[(st.hair || 0) % 5];
      const P = (a, b, c) => [S.x + r[0] * a * KS + f[0] * c * KS, b * KS, S.z + r[2] * a * KS + f[1] * c * KS];
      const ell = (c, rl, ru, rd, col, o) => this._draw("sph", basis(c, scl(r, rl * KS), [0, ru * KS, 0], scl(f3, rd * KS)), Object.assign({ color: col }, o || {}));
      const bx = (c, lat, up, dep, col, o) => this._draw("box", basis(c, scl(r, lat * KS), [0, up * KS, 0], scl(f3, dep * KS)), Object.assign({ color: col }, o || {}));
      const cyl = (p0, p1, rad, col, o) => this._draw("cyl", segment(p0, p1, rad * KS), Object.assign({ color: col }, o || {}));
      const SK = { spec: 0.14, shin: 16 };
      const wood = [0.42, 0.25, 0.13, 1];

      // sombra en el suelo
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
      this._draw("quad", model(S.x + f[0] * 7, FLOOR + 0.04, S.z + f[1] * 7, 0, 56, 1, 56), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.5] });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);

      // silla de madera
      bx(P(0, -8.4, -1.0), 8.2, 0.9, 7.8, wood, { spec: 0.15, shin: 20 });
      bx(P(0, -2.6, -5.4), 8.2, 11, 0.9, wood, { spec: 0.15, shin: 20 });
      [[-3.5, -4.2], [3.5, -4.2], [-3.5, 2.4], [3.5, 2.4]].forEach(([a, c]) => bx(P(a, -17.2, c), 0.9, 17.6, 0.9, wood));
      // piernas, pantalón y zapatos
      [-1, 1].forEach(k => {
        const hip = P(2.1 * k, -7.2, -0.6), knee = P(2.2 * k, -7.2, 8.0), ankle = P(2.2 * k, -24.4, 8.6);
        cyl(hip, knee, 1.55, pants); cyl(knee, ankle, 1.2, pants);
        ell(knee, 1.5, 1.5, 1.5, pants);
        ell(P(2.2 * k, -25.4, 9.9), 1.25, 0.9, 2.3, [0.12, 0.08, 0.06, 1], { spec: 0.4, shin: 30 });
      });
      // torso, hombros y cuello
      ell(P(0, -1.0, -0.1), 4.4, 6.4, 3.4, shirt);
      ell(P(0, 5.6, 0), 5.3, 5.2, 3.5, shirt);
      [-1, 1].forEach(k => ell(P(5.3 * k, 9.4, 0.1), 2.1, 2.1, 2.1, shirt));
      cyl(P(0, 10.2, 0.1), P(0, 12.7, 0.3), 1.0, skin, SK);
      ell(P(0, 10.5, 0.2), 2.5, 0.7, 2.3, collar);
      // cabeza y cara
      const head = P(0, 15.7, 0.4);
      ell(head, 3.0, 3.6, 3.2, skin, SK);
      [-1, 1].forEach(k => {
        ell(P(3.0 * k, 15.7, 0.2), 0.5, 0.95, 0.6, skin, SK);
        ell(P(1.25 * k, 16.2, 2.9), 0.58, 0.46, 0.35, [0.97, 0.97, 0.95, 1]);
        ell(P(1.25 * k, 16.2, 3.15), 0.3, 0.3, 0.2, [0.1, 0.07, 0.05, 1]);
        ell(P(1.3 * k, 17.15, 3.0), 0.95, 0.16, 0.25, hairC);
      });
      ell(P(0, 15.1, 3.5), 0.55, 0.85, 0.85, skinD, SK);
      ell(P(0, 13.5, 3.05), 1.0, 0.22, 0.25, [0.55, 0.22, 0.2, 1]);
      // pelo, barba, sombrero o gorra
      const hs = (st.hairStyle || 0) % 5;
      if (hs === 0 || hs === 2) ell(P(0, 16.8, -0.6), 3.12, 3.1, 3.2, hairC, { spec: 0.1, shin: 12 });
      if (hs === 2) ell(P(0, 13.1, 2.3), 2.1, 1.5, 1.4, hairC);
      if (hs === 3) {
        const straw = [0.86, 0.74, 0.45, 1];
        cyl(P(0, 18.2, 0.4), P(0, 18.6, 0.4), 6.3, straw);
        ell(P(0, 19.3, 0.4), 3.3, 1.8, 3.3, straw);
        if (st.band) cyl(P(0, 18.5, 0.4), P(0, 19.3, 0.4), 3.4, [...st.band, 1]);
      } else if (hs === 4) {
        const capC = st.band ? [...st.band, 1] : hairC;
        ell(P(0, 17.5, -0.1), 3.28, 1.9, 3.4, capC);
        bx(P(0, 17.0, 3.6), 4.6, 0.35, 2.4, capC);
      } else if (st.band) {
        cyl(P(0, 17.0, 0.4), P(0, 17.7, 0.4), 3.35, [...st.band, 1]);
      }
      // brazos apoyados en la mesa (mangas cortas)
      [1, -1].forEach(k => {
        if (k === 1 && skipRight) return;
        const sh = P(5.3 * k, 9.2, 0.1);
        const wr = restHand(S, k);
        this._drawArm(sh, wr, st, k, KS, true, [-f3[0], 0, -f3[2]], ARM_TH);
      });
      // aro dorado en el turno
      if (info.turn) {
        gl.depthMask(false);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-3, -3);
        const pulse = 0.65 + 0.3 * Math.sin(now / 200);
        this._draw("quad", model(S.x + f[0] * (RC + 2), 0.04, S.z + f[1] * (RC + 2), Math.abs(f[0]) > 0.5 ? Math.PI / 2 : 0, 36, 1, 13), { tex: this.tex.ring, lit: false, color: [1, 0.85, 0.3, pulse] });
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthMask(true);
      }
    }


    /* ---------- barrio: calle, edificios, coches, palmeras, luces ---------- */
    _drawCar(px, pz, yaw, col) {
      const y0 = WFLOOR, c = Math.cos(yaw), s = Math.sin(yaw);
      const R = (lx, ly, lz) => [px + lx * c + lz * s, y0 + ly, pz - lx * s + lz * c];
      const m = (p, sx, sy, sz) => model(p[0], p[1], p[2], yaw, sx, sy, sz);
      const body = { color: col, spec: 0.7, shin: 60 };
      this._draw("box", m(R(0, 4.4, 0), 27, 3.4, 10.6), body);
      this._draw("box", m(R(9, 6.4, 0), 9.5, 0.9, 10), body);
      this._draw("box", m(R(-9.5, 6.4, 0), 8, 0.9, 10), body);
      this._draw("box", m(R(-1.5, 7.9, 0), 12.5, 2.8, 8.8), body);
      this._draw("box", m(R(-1.5, 8.1, 0), 12.7, 1.8, 9), { color: [0.12, 0.17, 0.27, 1], spec: 0.9, shin: 80 });
      this._draw("box", m(R(-1.5, 9.5, 0), 13, 0.5, 9.2), body);
      [[-8.5, 4.9], [8.5, 4.9], [-8.5, -4.9], [8.5, -4.9]].forEach(([wx, wz]) => {
        this._draw("cyl", segment(R(wx, 2.3, wz - 0.7), R(wx, 2.3, wz + 0.7), 2.4), { color: [0.07, 0.07, 0.08, 1] });
        this._draw("cyl", segment(R(wx, 2.3, wz + (wz > 0 ? 0.6 : -0.9)), R(wx, 2.3, wz + (wz > 0 ? 0.9 : -0.6)), 1.3), { color: [0.85, 0.86, 0.9, 1], spec: 0.9, shin: 70 });
      });
      const chrome = { color: [0.86, 0.87, 0.92, 1], spec: 0.9, shin: 70 };
      this._draw("box", m(R(13.8, 3.2, 0), 1.1, 1.0, 11), chrome);
      this._draw("box", m(R(-13.8, 3.2, 0), 1.1, 1.0, 11), chrome);
      [-1, 1].forEach(k => {
        this._draw("sph", basis(R(13.3, 5.2, 3.7 * k), [1, 0, 0], [0, 1, 0], [0, 0, 1]), { color: [1, 0.95, 0.75, 1], lit: false });
        this._draw("box", m(R(-13.4, 5.6, 3.9 * k), 0.8, 0.8, 1.6), { color: [0.85, 0.1, 0.1, 1], lit: false });
        this._draw("box", m(R(-12, 7.1, 4.6 * k), 3.2, 1.6, 0.6), body);
      });
    }

    _drawPalm(x, z, h, seed) {
      const rnd = hash("palm" + seed);
      const bend = (rnd() - 0.5) * 6;
      const pts = [0, 1, 2, 3, 4].map(k => [x + bend * (k / 4) * (k / 4), WFLOOR + (h * k) / 4, z]);
      for (let k = 0; k < 4; k++) this._draw("cyl", segment(pts[k], pts[k + 1], 1.7 - k * 0.2), { color: [0.45, 0.37, 0.29, 1] });
      const top = pts[4];
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2 + rnd() * 0.3;
        const lift = 2 - (a % 3) * 2.6;
        const tip = [top[0] + Math.cos(ang) * 12, top[1] + lift - 3, top[2] + Math.sin(ang) * 12];
        const mid = lerp3(top, tip, 0.5);
        mid[1] += 1.5;
        this._draw("sph", ellipsoid(mid, sub(tip, top), 1.4, 6.6, 0.28), { color: [0.17 + rnd() * 0.08, 0.5 + rnd() * 0.1, 0.18, 1] });
      }
      [-0.8, 0.8].forEach(o => this._draw("sph", basis([top[0] + o, top[1] - 1.4, top[2]], [0.9, 0, 0], [0, 0.9, 0], [0, 0, 0.9]), { color: [0.4, 0.28, 0.12, 1] }));
    }

    // el barrio se diseñó a otra escala: se agranda para que guarde proporción con las personas
    _worldPass(now) {
      const gl = this.gl;
      const WM = new Float32Array([WS, 0, 0, 0, 0, WS, 0, 0, 0, 0, WS, 0, 0, FLOOR - WS * WFLOOR, 0, 1]);
      gl.uniformMatrix4fv(this.loc.uVP, false, mul(this.VP, WM));
      const e = this.eye || [0, 20, 40];
      gl.uniform3f(this.loc.uEye, e[0] / WS, (e[1] - FLOOR) / WS + WFLOOR, e[2] / WS);
      this._fogScale = 1;
      this._drawWorld(now);
      gl.uniformMatrix4fv(this.loc.uVP, false, this.VP);
      gl.uniform3f(this.loc.uEye, e[0], e[1], e[2]);
      this._fogScale = 0.3;
    }

    _drawWorld(now) {
      const gl = this.gl;
      // cielo de atardecer
      [[0, -440, 0], [0, 440, Math.PI], [-440, 0, Math.PI / 2], [440, 0, -Math.PI / 2]].forEach(([x, z, yaw]) =>
        this._draw("quad", model(x, 150, z, yaw, 1000, 1, 700, Math.PI / 2, 0), { tex: this.tex.sky, lit: false, fog: false }));
      // suelo de baldosas hidráulicas
      this._draw("quad", model(0, WFLOOR, 0, 0, 900, 1, 900), { tex: this.tex.floor, uv: [0, 0, 9, 9], lit: false, color: [0.93, 0.9, 0.86, 1] });
      // edificios coloniales alrededor
      const D = 192, heights = [86, 98, 80, 92, 102, 84];
      const walls = [{ x: 0, z: -D, yaw: 0, ax: "x" }, { x: 0, z: D, yaw: Math.PI, ax: "x" }, { x: -D, z: 0, yaw: Math.PI / 2, ax: "z" }, { x: D, z: 0, yaw: -Math.PI / 2, ax: "z" }];
      walls.forEach((w, wi) => {
        for (let k = 0; k < 7; k++) {
          const tt = -186 + k * 62;
          const h = heights[(k + wi * 2) % 6];
          const px = w.ax === "x" ? tt : w.x, pz = w.ax === "z" ? tt : w.z;
          this._draw("quad", model(px, WFLOOR + h / 2, pz, w.yaw, 63, 1, h, Math.PI / 2, 0), { tex: this.tex.facades[(k * 5 + wi * 2) % 6], lit: false });
        }
      });
      // banderas colgando de los balcones
      this._draw("quad", model(-52, WFLOOR + 46, -190.5, 0, 17, 1, 10.6, Math.PI / 2, 0), { tex: this.tex.flag, lit: false });
      this._draw("quad", model(-190.5, WFLOOR + 40, 38, Math.PI / 2, 17, 1, 10.6, Math.PI / 2, 0), { tex: this.tex.flag, lit: false });
      // coches clásicos
      this._drawCar(-78, -150, 0, [0.35, 0.72, 0.7, 1]);
      this._drawCar(96, -148, 0, [0.95, 0.88, 0.7, 1]);
      this._drawCar(-150, 70, Math.PI / 2, [0.78, 0.2, 0.2, 1]);
      this._drawCar(150, -40, -Math.PI / 2, [0.35, 0.55, 0.82, 1]);
      // palmeras
      [[-125, -118, 52], [128, -110, 60], [-135, 100, 56], [135, 96, 50], [40, -165, 58], [-20, 168, 54]].forEach(([x, z, h], i) => this._drawPalm(x, z, h, i));
      // guirnalda de luces
      for (let i = 0; i < 26; i++) {
        const x = -200 + i * 16.4, y = WFLOOR + 56 + Math.sin(i * 0.55) * 3;
        this._draw("sph", basis([x, y, -184], [1, 0, 0], [0, 1, 0], [0, 0, 1]), { color: [1, 0.86, 0.5, 1], lit: false });
      }
    }

    /* ---------- bebidas: vaso de plástico transparente y botella de ron ---------- */
    setEnv() { this.requestRender(); }

    setBottle(level) {
      if (this.bottleSwap) return;   // mientras llega la botella nueva, la de ahora sigue vacía
      this.bottleTarget = clamp(level, 0, 1);
      this.requestRender();
    }

    // nº de botella: al subir, la que estaba se queda vacía y cae una nueva al lado
    setBottles(no) {
      no = Math.max(0, no | 0);
      this.bottleNo = no;
      if (!this._bottlesInit || no < this.bottleNoShown) {
        this._bottlesInit = true;
        this.bottleNoShown = no;
      } else if (no > this.bottleNoShown) {
        const base = this._now();
        this.bottleSwap = { no, start: Math.max(base + 600, this.potHoldUntil) };
      }
      this.requestRender();
    }

    // colecta: cuántos han puesto su CUC y cuántos faltan en total
    setPot(count, total) {
      count = Math.max(0, count | 0);
      if (this._potInit && count === 0 && this.potCount > 0) {
        this.potHold = this.potCount + 1;
        this.potHoldUntil = this._now() + 1700;
      }
      this.potCount = count;
      this.potTotal = Math.max(1, total | 0);
      this._potInit = true;
      this.requestRender();
    }

    // una moneda sale volando de la mano del jugador hasta el plato
    startCoin(seat) {
      this.coins.push({ seat, start: this._now(), dur: 950 });
      this.requestRender();
    }

    _bottleSlot(no) {
      const b = BOTTLE_SLOTS[no % 2];
      return [b[0], 0, b[1]];
    }

    _updateBottles(now) {
      const sw = this.bottleSwap;
      if (sw && now >= sw.start) {
        this.bottleNoShown = sw.no;
        this.bottleShown = 1; this.bottleTarget = 1;
        this.bottleDrop = now;
        this.bottleSwap = null;
      }
      this.bottlePos = this._bottleSlot(this.bottleNoShown);
    }

    // plato redondo de latón con las monedas de la colecta
    _drawPot(now) {
      this.coins = this.coins.filter(c => now - c.start < c.dur);
      const [px, pz] = POT_POS;
      const brass = { color: [0.78, 0.58, 0.2, 1], spec: 0.8, shin: 50 };
      this._draw("cyl", model(px, 0, pz, 0, 3.7, 0.5, 3.7), brass);
      this._draw("cyl", model(px, 0.05, pz, 0, 3.15, 0.52, 3.15), { color: [0.42, 0.3, 0.1, 1], spec: 0.3, shin: 20 });
      const held = now < this.potHoldUntil ? this.potHold : this.potCount;
      const n = Math.max(0, Math.min(held - this.coins.length, 12));
      const coin = (x, y, z, pitch) => {
        this._draw("cyl", model(x, y, z, 0, 0.95, 0.14, 0.95, pitch, 0), { color: [0.86, 0.88, 0.92, 1], spec: 0.9, shin: 70 });
        this._draw("cyl", model(x, y + (pitch ? 0 : 0.02), z, 0, 0.55, 0.16, 0.55, pitch, 0), { color: [0.9, 0.7, 0.2, 1], spec: 0.9, shin: 70 });
      };
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(i / 4), a = (i % 4) * 1.5708 + layer * 0.8;
        const r = 1.7 - layer * 0.6;
        coin(px + Math.cos(a) * r, 0.52 + layer * 0.15, pz + Math.sin(a) * r, 0);
      }
      this.coins.forEach(c => {
        const u = smooth(clamp((now - c.start) / c.dur, 0, 1));
        const S = SEAT[c.seat];
        const a = restHand(S, 1);
        const A = [a[0], 9, a[2]], B = [px, 1.2, pz];
        const q = lerp3(A, B, u);
        q[1] += Math.sin(u * Math.PI) * 14;
        coin(q[0], q[1], q[2], now * 0.012);
      });
    }

    // cada jugador tiene su vaso en el hueco de la esquina de su derecha
    _cupPos(seat) {
      const S = SEAT[seat], f = S.f, r = [-f[1], 0, f[0]];
      const c = TABLE_D / 2 + SEAT_GAP - HOLE;
      return [S.x + f[0] * c + r[0] * HOLE, 0, S.z + f[1] * c + r[2] * HOLE];
    }

    _cupLevelShown(seat) {
      if (this.cupShown[seat] === undefined) {
        const i = this.seatInfo[seat];
        this.cupShown[seat] = i && i.cup !== undefined ? i.cup : 0.7;
      }
      return this.cupShown[seat];
    }

    startAct(kind, seat) {
      const now = this._now();
      const info = this.seatInfo[seat] || {};
      const from = this._cupLevelShown(seat);
      const to = info.cup !== undefined ? info.cup : from;
      this.acts = this.acts.filter(a => a.seat !== seat);
      this.acts.push({ kind, seat, start: now, dur: kind === "drink" ? 3400 : 3200, from, to, bFrom: this.bottleShown, bTo: this.bottleTarget, fired: {} });
      if (seat === "bottom") {
        const c = this._cupPos("bottom");
        this.auto = { target: [c[0], 3, c[2]], w: this.auto ? this.auto.w : 0, goal: 1 };
      }
      this.requestRender();
    }

    // pose de la acción de beber o servir (brazo derecho de la persona)
    _actPose(a, now) {
      const S = SEAT[a.seat], f = S.f, r = [-f[1], 0, f[0]], f3 = [f[0], 0, f[1]];
      const u = clamp((now - a.start) / a.dur, 0, 1);
      const P = (x, y, c) => [S.x + r[0] * x * KS + f[0] * c * KS, y * KS, S.z + r[2] * x * KS + f[1] * c * KS];
      const cup0 = this._cupPos(a.seat);
      const cupRest = [cup0[0], CUP_REST_Y, cup0[2]];
      const restWrist = restHand(S, 1);
      const shoulder = P(5.3, 9.2, 0.1);
      const yawCup = Math.atan2(-f[0], -f[1]);
      const out = { u, shoulder, kind: a.kind, cup: { center: cupRest, yaw: yawCup, pitch: 0, level: a.from }, bottle: null, stream: null, wrist: restWrist, showArm: true };

      if (a.kind === "drink") {
        const mouth = a.seat === "bottom" ? P(0, 12.5, 7.5) : P(0, 13.2, 5.6);   // yo lo veo desde fuera para que se vea el vaso
        const lift = [cupRest[0], cupRest[1] + 9, cupRest[2]];
        let center, pitch = 0;
        if (u < 0.2) center = cupRest;
        else if (u < 0.38) { const k = smooth((u - 0.2) / 0.18); center = lerp3(cupRest, lift, k); }
        else if (u < 0.58) { const k = smooth((u - 0.38) / 0.2); center = lerp3(lift, mouth, k); pitch = lerp(0, 1.0, k); }
        else if (u < 0.8) { const k = (u - 0.58) / 0.22; center = [mouth[0], mouth[1] + Math.sin(k * 6) * 0.15, mouth[2]]; pitch = lerp(1.0, 1.22, smooth(k)); }
        else if (u < 0.92) { const k = smooth((u - 0.8) / 0.12); center = lerp3(mouth, cupRest, k); pitch = lerp(1.22, 0, k); }
        else center = cupRest;
        out.cup = { center, yaw: yawCup, pitch, level: a.from };
        const grip = add(center, add(scl(r, CUP_R + 1.6), [0, 1.0, 0]));
        out.wrist = u < 0.2 ? lerp3(restWrist, grip, smooth(u / 0.2)) : u < 0.92 ? grip : lerp3(grip, restWrist, smooth((u - 0.92) / 0.08));
        out.cup.level = lerp(a.from, a.to, smooth((u - 0.6) / 0.2));
        out.sound = u >= 0.6;
      } else {
        // servir: la botella se desliza hasta el vaso, se inclina y vuelve a su esquina
        const B0 = this.bottlePos;
        const yawB0 = Math.atan2(-B0[0], -B0[2]);
        const yawP = Math.atan2(f[0], f[1]);
        const rho = -1.9;
        const tip = [cup0[0], CUP_H + 3.2, cup0[2]];
        const down = rotYXZ(yawP, 0, rho, [0, 11.8 * BS, 0]);
        const Hb = sub(tip, down);
        Hb[0] += r[0] * 0.2; Hb[2] += r[2] * 0.2;
        let pos, roll = 0, yaw;
        if (u < 0.28) { const k = smooth(u / 0.28); pos = lerp3(B0, Hb, k); yaw = lerp(yawB0, shortAngle(yawB0, yawP), k); }
        else if (u < 0.45) { pos = Hb; yaw = yawP; roll = lerp(0, rho, smooth((u - 0.28) / 0.17)); }
        else if (u < 0.78) { pos = Hb; yaw = yawP; roll = rho + Math.sin((u - 0.45) * 20) * 0.03; }
        else if (u < 0.9) { pos = Hb; yaw = yawP; roll = lerp(rho, 0, smooth((u - 0.78) / 0.12)); }
        else { const k = smooth((u - 0.9) / 0.1); pos = lerp3(Hb, B0, k); yaw = lerp(yawP, shortAngle(yawP, yawB0), k); }
        const bl = lerp(a.bFrom, a.bTo, smooth((u - 0.5) / 0.25));
        out.bottle = { pos, yaw, roll, level: bl };
        const cl = lerp(a.from, a.to, smooth((u - 0.5) / 0.25));
        out.cup = { center: cupRest, yaw: yawCup, pitch: 0, level: cl };
        if (u >= 0.5 && u < 0.78) out.stream = { from: add(pos, rotYXZ(yaw, 0, roll, [0, 11.8 * BS, 0])), to: [cup0[0], CUP_H * 0.95 * cl, cup0[2]] };
        const body = add(pos, rotYXZ(yaw, 0, roll, [0, 3.8 * BS, 0]));
        const grip = add(body, add(scl(f3, -(1.46 * BS + 2.2)), [0, 0.8, 0]));
        const far = len(sub(grip, shoulder)) > 50;
        out.showArm = !far && u > 0.12 && u < 0.92;
        out.wrist = grip;
        out.sound = u >= 0.5;
      }
      return out;
    }

    // vaso de plástico (transparente, ABIERTO por arriba) con ron; centro y orientación
    _drawCup(center, yaw, pitch, level) {
      const up = rotYXZ(yaw, pitch, 0, [0, 1, 0]);
      const base = sub(center, scl(up, CUP_H / 2));
      const lv = clamp(level, 0, 1);
      const M = model(base[0], base[1], base[2], yaw, CUP_R, CUP_H, CUP_R, pitch, 0);
      if (lv > 0.02) {
        this._setDyn(buildLiquid(lv));
        this._draw("dyn", M, { color: [0.86, 0.5, 0.14, 0.92], spec: 0.7, shin: 40 });
      }
      this._draw("cup", M, { color: [0.92, 0.96, 1, 0.24], spec: 0.9, shin: 70 });
    }

    // botella de ron: pasada opaca (etiqueta y tapón) o de cristal
    _drawBottle(pos, yaw, roll, level, glassPass) {
      const at = v => add(pos, rotYXZ(yaw, 0, roll, scl(v, BS)));
      const M = (v, sx, sy, sz) => { const p = at(v); return model(p[0], p[1], p[2], yaw, sx * BS, sy * BS, sz * BS, 0, roll); };
      if (!glassPass) {
        this._draw("cyl", M([0, 11.0, 0], 0.72, 0.95, 0.72), { color: [0.82, 0.64, 0.2, 1], spec: 0.8, shin: 50 });
        this._draw("box", M([0, 3.4, 1.38], 2.7, 4.4, 0.12), { tex: this.tex.label, spec: 0.15, shin: 10 });
        this._draw("box", M([0, 3.4, -1.38], 2.7, 4.4, 0.12), { color: [0.95, 0.9, 0.78, 1] });
        return;
      }
      const lv = clamp(level, 0, 1);
      if (lv > 0.02) this._draw("cyl", M([0, 0.2, 0], 1.3, 6.7 * lv, 1.3), { color: [0.86, 0.52, 0.14, 0.9], spec: 0.7, shin: 40 });
      this._draw("cyl", M([0, 0, 0], 1.46, 7.0, 1.46), { color: [0.78, 0.95, 0.85, 0.22], spec: 0.9, shin: 70 });
      this._draw("sph", M([0, 7.0, 0], 1.46, 1.3, 1.46), { color: [0.78, 0.95, 0.85, 0.22], spec: 0.9, shin: 70 });
      this._draw("cyl", M([0, 8.1, 0], 0.62, 2.9, 0.62), { color: [0.78, 0.95, 0.85, 0.25], spec: 0.9, shin: 70 });
    }

    _drawDrinks(now, poses) {
      const gl = this.gl;
      const actBySeat = poses || {};
      if (!poses) this.acts.forEach(a => { actBySeat[a.seat] = this._actPose(a, now); });
      if (actBySeat.bottom && this.auto) this.auto.target = [actBySeat.bottom.cup.center[0], actBySeat.bottom.cup.center[1], actBySeat.bottom.cup.center[2]];
      // botellas en la esquina: la actual (o en movimiento) y la anterior, vacía, a su lado
      const pourAct = this.acts.find(a => a.kind === "pour");
      const yawB0 = Math.atan2(-this.bottlePos[0], -this.bottlePos[2]);
      let bottle = { pos: this.bottlePos, yaw: yawB0, roll: 0, level: this.bottleShown };
      if (pourAct) { const p = actBySeat[pourAct.seat]; if (p && p.bottle) bottle = p.bottle; }
      else {
        const k = clamp((now - this.bottleDrop) / 900, 0, 1);   // la botella nueva cae sobre la mesa
        if (k < 1) bottle = { pos: [bottle.pos[0], (1 - smooth(k)) * 38, bottle.pos[2]], yaw: yawB0, roll: 0, level: this.bottleShown };
      }
      const bottles = [bottle];
      if (this.bottleNoShown > 0) {
        const pos = this._bottleSlot(this.bottleNoShown - 1);
        bottles.push({ pos, yaw: Math.atan2(-pos[0], -pos[2]) + 0.6, roll: 0, level: 0 });
      }
      bottles.forEach(b => this._drawBottle(b.pos, b.yaw, b.roll, b.level, false));

      gl.depthMask(false);
      bottles.forEach(b => this._drawBottle(b.pos, b.yaw, b.roll, b.level, true));
      Object.keys(this.seatInfo).forEach(seat => {
        const info = this.seatInfo[seat];
        if (!info || !info.present) return;
        const p = actBySeat[seat];
        if (p) this._drawCup(p.cup.center, p.cup.yaw, p.cup.pitch, p.cup.level);
        else {
          const c = this._cupPos(seat);
          const S = SEAT[seat];
          this._drawCup([c[0], CUP_REST_Y, c[2]], Math.atan2(-S.f[0], -S.f[1]), 0, this._cupLevelShown(seat));
        }
      });
      Object.values(actBySeat).forEach(p => {
        if (p.stream) {
          const a = p.stream.from, b = p.stream.to;
          this._draw("cyl", segment(b, a, 0.5), { color: [0.86, 0.52, 0.14, 0.85], spec: 0.6, shin: 30 });
        }
      });
      gl.depthMask(true);
      return actBySeat;
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

    // los cuatro atriles: tablilla de madera + fichas recostadas (las tuyas con puntos, las de los rivales de espaldas)
    _drawRacks(now) {
      const gl = this.gl;
      const draggedId = this.drag ? this.drag.tile.id : null;
      const ang = (this.tune.rackAng * Math.PI) / 180;
      const wood = { tex: this.tex.wood, uv: [0, 0, 2, 0.3], spec: 0.2, shin: 24 };
      ["bottom", "top", "left", "right"].forEach(seat => {
        const info = this.seatInfo[seat];
        const mine = seat === "bottom";
        const show = mine ? !!((info && info.present) || this.rack.tiles.length) : !!(info && info.present);
        const S = SEAT[seat], f = S.f, r = [-f[1], 0, f[0]];
        const yaw = Math.atan2(-f[0], -f[1]);
        const n = !show ? 0 : mine ? this.rack.tiles.length : Math.min((info && info.count) || 0, 14);
        const sc = mine ? RACK_SC : 1;
        const len = Math.max(10, n) * TILE_W * sc * 1.16 + 4;
        const at = (lat, c, y) => [S.x + r[0] * lat + f[0] * c, y, S.z + r[2] * lat + f[1] * c];

        // sombra suave sobre el paño
        gl.depthMask(false);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
        const sh = at(0, RC + 1.4, 0.02);
        this._draw("quad", model(sh[0], sh[1], sh[2], yaw, len + 3, 1, 7), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.45] });
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthMask(true);

        // la tablilla de madera: respaldo donde se apoyan las fichas y un pequeño tope delante
        const hb = 2.3 * sc;
        const cf = RC + sc * (2.3 / Math.tan(ang) + (TILE_T / 2) * Math.sin(ang)) + 0.05;
        const bar = at(0, cf + 0.85, hb / 2);
        this._draw("box", model(bar[0], bar[1], bar[2], yaw, len, hb, 1.7), wood);
        const lip = at(0, RC - 0.6, 0.35);
        this._draw("box", model(lip[0], lip[1], lip[2], yaw, len, 0.7, 0.5), wood);

        if (!show) return;
        if (mine) {
          this.rack.tiles.forEach((t, i) => {
            if (t.id === draggedId) return;
            const play = this.rack.myTurn && t.state === "playable";
            const dim = this.rack.myTurn && t.state === "dim";
            const roll = this.rack.organizing ? Math.sin(now / 130 + i) * 0.05 : 0;
            const P = this._rackTile("bottom", i, n, sc, ang, play ? 0.9 : 0);
            if (play) {
              gl.depthMask(false);
              gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-3, -3);
              const g = at((i - (n - 1) / 2) * TILE_W * sc * 1.16, RC + 1.2 * sc, 0.03);
              this._draw("quad", model(g[0], g[1], g[2], yaw, (TILE_W + 0.9) * sc, 1, (TILE_L * Math.cos(ang) + 2.2) * sc), { tex: this.tex.marker, lit: false, color: [1, 1, 1, 0.9] });
              gl.disable(gl.POLYGON_OFFSET_FILL);
              gl.depthMask(true);
            }
            this._tileDraw(t.a, t.b, P.x, P.y, P.z, P.yaw, ang, roll, dim ? [0.55, 0.55, 0.62] : null, sc);
          });
        } else {
          for (let i = 0; i < n; i++) {
            const P = this._rackTile(seat, i, n, 1, ang, 0);
            this._tileBack(P.x, P.y, P.z, P.yaw, ang, 1);
          }
        }
      });
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
      // niveles de vasos y botella (suben o bajan poco a poco) y cámara automática
      let drinksMoving = false;
      Object.keys(this.seatInfo).forEach(seat => {
        const inf = this.seatInfo[seat];
        if (!inf || inf.cup === undefined || this.acts.some(a => a.seat === seat)) return;
        const cur = this._cupLevelShown(seat);
        if (Math.abs(inf.cup - cur) > 0.004) { this.cupShown[seat] = cur + (inf.cup - cur) * 0.12; drinksMoving = true; }
        else this.cupShown[seat] = inf.cup;
      });
      if (!this.acts.some(a => a.kind === "pour")) {
        if (Math.abs(this.bottleTarget - this.bottleShown) > 0.004) { this.bottleShown += (this.bottleTarget - this.bottleShown) * 0.12; drinksMoving = true; }
        else this.bottleShown = this.bottleTarget;
      }
      if (this.auto) {
        this.auto.w += (this.auto.goal - this.auto.w) * 0.07;
        if (this.auto.goal === 0 && this.auto.w < 0.003) this.auto = null; else camMoving = true;
      }
      if (drinksMoving) camMoving = true;
      if (this.acts.length) camMoving = true;
      this._updateMatrices(now);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.loc.uVP, false, this.VP);
      this._fogOn = true;
      const eye = this.eye || [0, 20, 40];
      gl.uniform3f(this.loc.uEye, eye[0], eye[1], eye[2]);

      gl.depthMask(true);
      this._worldPass(now);

      // sombra suave bajo la mesa y las sillas
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
      this._draw("quad", model(0, FLOOR + 0.03, 0, 0, 230, 1, 230), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.5] });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);

      // mesa de madera como la de la foto: tablero, faldón, patas, marco de juego y huecos para los vasos
      const wood = { tex: this.tex.wood, uv: [0, 0, 3, 2], spec: 0.2, shin: 24 };
      const strip = { tex: this.tex.wood, uv: [0, 0, 2, 0.2], spec: 0.2, shin: 24 };
      this._draw("box", model(0, -1.7, 0, 0, TABLE_W + 7, 3.2, TABLE_D + 7), wood);
      this._draw("box", model(0, -6.6, 0, 0, TABLE_W + 1, 6.2, TABLE_D + 1), wood);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        this._draw("box", model(sx * (TABLE_W / 2 - 2.2), (FLOOR - 3.3) / 2 - 0.4, sz * (TABLE_D / 2 - 2.2), 0, 5.2, -FLOOR - 3.3 + 0.5, 5.2), wood));
      // la zona de juego (con la foto de fondo, si la hay) y su marco de madera
      if (this.tex.table) {
        this._draw("quad", model(0, 0.002, 0, 0, FRAME_IN * 2, 1, FRAME_IN * 2), { tex: this.tex.table, lit: false });
      }
      const fw = 1.6, fh = 1.8, fo = FRAME_IN + fw / 2;
      [-1, 1].forEach(sg => {
        this._draw("box", model(0, fh / 2, sg * fo, 0, FRAME_IN * 2 + fw * 2, fh, fw), strip);
        this._draw("box", model(sg * fo, fh / 2, 0, 0, fw, fh, FRAME_IN * 2), strip);
      });
      // huecos redondos de las cuatro esquinas
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        this._draw("quad", model(sx * HOLE, 0.03, sz * HOLE, 0, HOLE_R * 2.15, 1, HOLE_R * 2.15), { tex: this.tex.shadow, lit: false, color: [0.03, 0.02, 0.01, 0.97] }));
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
      if (this.mode === "fp") this._drawPot(now);

      this._updateBottles(now);

      // poses de beber / servir (una sola vez por cuadro: el brazo en reposo se oculta mientras dura la acción)
      const actPoses = {};
      if (this.mode === "fp") this.acts.forEach(a => { actPoses[a.seat] = this._actPose(a, now); });

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
      if (this.drag && this.drag.pos) shadowTile(this.drag.pos[0], this.drag.pos[2], this.drag.yaw, DRAG_Y);
      animating.forEach(an => {
        this._draw("quad", model(an.wrist[0] + 0.4, 0.012, an.wrist[2] + 0.5, 0, 3.4, 1, 3.8), { tex: this.tex.shadow, lit: false, color: [0, 0, 0, 0.2] });
      });
      if (this.drag && this.drag.pos) {
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
          const ap = actPoses[seat];
          this._drawSeat(seat, info, now, busy || !!(ap && ap.showArm));
        });
      }

      // atriles de madera con las fichas de cada jugador
      if (this.mode === "fp") this._drawRacks(now);

      // brazos de las jugadas en curso
      animating.forEach((an, id) => {
        const a = this.anims.find(x => x.id === id);
        if (!a) return;
        const fpA = this.mode === "fp";
        const SF = SEAT[a.seat].f;
        this._drawArm(an.shoulder, an.wrist, a.style, 1, fpA ? KS : 1, fpA, fpA ? [-SF[0], 0, -SF[1]] : null, fpA ? ARM_TH : 1);
      });

      // bebidas (solo en primera persona): vasos y botella; y el brazo de quien bebe o sirve
      if (this.mode === "fp") {
        const poses = this._drawDrinks(now, actPoses);
        this.acts.forEach(a => {
          const p = poses[a.seat];
          if (!p || !p.showArm) return;
          const info = this.seatInfo[a.seat] || {};
          const st = info.style || this.opts.myStyle && this.opts.myStyle() || { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] };
          const SF = SEAT[a.seat].f;
          this._drawArm(p.shoulder, p.wrist, st, 1, KS, true, [-SF[0], 0, -SF[1]], ARM_TH);
        });
        // sonidos y fin de las acciones
        this.acts = this.acts.filter(a => {
          const p = poses[a.seat];
          if (p && p.sound && !a.fired.snd) { a.fired.snd = true; this.opts.onAct && this.opts.onAct(a.kind, a.seat); }
          if (now - a.start >= a.dur) {
            if (a.seat === "bottom" && this.auto) this.auto.goal = 0;
            this.cupShown[a.seat] = a.to;
            this.bottleShown = a.bTo;
            return false;
          }
          return true;
        });
      }

      // mi brazo con la ficha que arrastro
      if (this.drag && this.drag.pos) {
        const d = this.drag;
        const anch = this._anchors().bottom;
        const tp = [d.pos[0], DRAG_Y, d.pos[2]];
        const toSh = norm([anch.shoulder[0] - tp[0], 0, anch.shoulder[2] - tp[2]]);
        const hd = this.mode === "fp" ? [5.4, 2.8] : [2.4, 1.5];
        const wrist = [tp[0] + toSh[0] * hd[0], tp[1] + hd[1], tp[2] + toSh[2] * hd[0]];
        this._tileDraw(d.near, d.far, tp[0], tp[1], tp[2], 0, Math.sin(now / 240) * 0.04, Math.cos(now / 300) * 0.04);
        const myS = this.opts.myStyle ? this.opts.myStyle() : { skin: [0.9, 0.7, 0.55], sleeve: [0.3, 0.6, 0.9] };
        const fpD = this.mode === "fp";
        this._drawArm(anch.shoulder, wrist, myS, 1, fpD ? KS : 1, fpD, fpD ? [0, 0, 1] : null, fpD ? ARM_TH : 1);
      }

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
