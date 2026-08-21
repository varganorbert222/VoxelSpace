"use strict";

const fs = require("fs");
const path = require("path");

const wasmPath = process.argv[2];
const outPath = process.argv[3];
if (!wasmPath || !outPath) {
  console.error("usage: node emit-bytes.js <march.wasm> <march.bytes.js>");
  process.exit(1);
}

const bytes = fs.readFileSync(wasmPath);
const b64 = bytes.toString("base64");
const src =
  '"use strict";\n\n' +
  "export const MARCH_WASM_B64 = \"" +
  b64 +
  "\";\n\n" +
  "export function marchWasmBytes() {\n" +
  "  const bin = atob(MARCH_WASM_B64);\n" +
  "  const out = new Uint8Array(bin.length);\n" +
  "  for (let i = 0; i < bin.length; i++) {\n" +
  "    out[i] = bin.charCodeAt(i);\n" +
  "  }\n" +
  "  return out;\n" +
  "}\n";

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, src);
console.log("wrote", outPath, bytes.length, "bytes");
