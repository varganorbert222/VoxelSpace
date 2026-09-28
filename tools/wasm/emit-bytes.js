"use strict";

const fs = require("fs");
const path = require("path");

const wasmPath = process.argv[2];
const outPath = process.argv[3];
const prefix = process.argv[4] || "MARCH";
if (!wasmPath || !outPath) {
  console.error("usage: node emit-bytes.js <wasm> <bytes.js> [PREFIX]");
  process.exit(1);
}

const bytes = fs.readFileSync(wasmPath);
const b64 = bytes.toString("base64");
const constName = prefix + "_WASM_B64";
const fnName = prefix === "MARCH" ? "marchWasmBytes" : prefix.toLowerCase() + "WasmBytes";
const src =
  '"use strict";\n\n' +
  "export const " + constName + " = \"" +
  b64 +
  "\";\n\n" +
  "export function " + fnName + "() {\n" +
  "  const bin = atob(" + constName + ");\n" +
  "  const out = new Uint8Array(bin.length);\n" +
  "  for (let i = 0; i < bin.length; i++) {\n" +
  "    out[i] = bin.charCodeAt(i);\n" +
  "  }\n" +
  "  return out;\n" +
  "}\n";

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, src);
console.log("wrote", outPath, bytes.length, "bytes");
