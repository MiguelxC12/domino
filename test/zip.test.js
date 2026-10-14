"use strict";
// Comprueba que el zip que se descarga desde el panel es válido (usa `unzip` si está instalado).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { buildZip, crc32 } = require("../zip");

assert.strictEqual(crc32(Buffer.from("123456789")), 0xcbf43926, "CRC32 estándar");
const files = [
  { name: "ganar.mp3", data: Buffer.from("sonido-de-prueba".repeat(500)) },
  { name: "azote.wav", data: Buffer.alloc(3000, 7) },
  { name: "LEEME.txt", data: Buffer.from("Cómo dejarlos fijos: ñandú") }
];
const file = path.join(os.tmpdir(), "domino-zip-test.zip");
fs.writeFileSync(file, buildZip(files));
try {
  execFileSync("unzip", ["-tq", file], { stdio: "pipe" });
  files.forEach(f => assert.deepStrictEqual(execFileSync("unzip", ["-p", file, f.name]), f.data, "contenido de " + f.name));
  console.log("OK · zip válido, contenido idéntico");
} catch (e) {
  if (e.code === "ENOENT") console.log("OK · zip generado (unzip no está instalado para verificarlo)");
  else throw e;
}
fs.unlinkSync(file);
