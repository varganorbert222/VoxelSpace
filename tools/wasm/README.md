# WASM march kernels

Rebuild the scalar `-O3` module after changing `tools/wasm/src/march.c`.

## Requirements

- clang targeting `wasm32` (LLVM, including `wasm-ld`)
- Node.js (to embed the `.wasm` as an ES module)

Windows (after LLVM is on PATH, or at `C:\Program Files\LLVM\bin`):

```
powershell -File tools/wasm/build.ps1
```

The committed runtime artifact is `scripts/wasm/march.bytes.js`. A clone does **not** need clang to play the demo.

Do not `fetch("*.wasm")`. Do not enable WASM SIMD as the product module.
