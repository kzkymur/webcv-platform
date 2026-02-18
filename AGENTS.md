# GalvoWeb 3.0 — AGENTS.md

This file is for automation agents (and helpful humans). It explains how this repository is organized, how to build and run it locally, and what conventions to follow when making changes. Instructions here apply to the entire repo unless a deeper directory contains its own AGENTS.md with more specific rules.

---

## Project Overview

- Purpose: Serverless web app to operate an XY galvo scanner from a browser via the Web Serial API. Supports camera calibration, undistortion, and homography to map camera coordinates to galvo space.

---

Node, package manager, and versions are pinned by `.tool-versions`:

- Node.js `23.10.0`
- pnpm `10.12.3`

Use pnpm for all JS package operations.

---

## Build & Run (Next.js SSG)

Prerequisites

- Emscripten SDK installed and activated (`emsdk`).
- Python 3, CMake, a working compiler toolchain for Emscripten.
- Node + pnpm versions from `.tool-versions` (use `asdf` or your preferred manager).

One-time setup

1. Fetch submodules and build OpenCV for JS/WASM (Emscripten):

```
# At repo root
git submodule update --init
python opencv/platforms/js/build_js.py opencv-build --build_wasm --emscripten_dir ~/emsdk/upstream/emscripten
```

- If the Python build fails due to `--memory-init-file 0`, remove it from `opencv/modules/js/CMakeLists.txt` and ensure memory flags include something like:

```
set(EMSCRIPTEN_LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS} -s TOTAL_MEMORY=128MB -s WASM_MEM_MAX=1GB -s ALLOW_MEMORY_GROWTH=1")
```

2. Build this repo’s WASM module:

```
cd src-wasm
emcmake cmake
emmake make
cd -
```

3. Install JS deps and start the dev server (Next.js):

```
pnpm i
pnpm run dev
# Visit http://localhost:8080
```

Scripts

- `pnpm run dev` — Next dev server (port 8080)
- `pnpm run build` — Next build (App Router)
- `pnpm run export` — Static export to `dist/` (multiple HTML files)

---

## WASM Interop Model

- The Emscripten module is loaded via alias `@wasm` (see `tsconfig.json`).
- TS interop lives in `src/wasm/`:
  - `wrapper.ts` exposes strongly-typed calls into `index.cpp` via `ccall`.
  - `memory.ts` contains `WM*` classes that map Emscripten heaps (`HEAPU8`, etc.) to typed arrays with RAII-style `clear()`.
  - `index.ts` shows how to instantiate and use the module inside React effects.
- Key exported functions (C++ in `src-wasm/index.cpp`):
  - Buffers: `getU8Buffer`, `getU32Buffer`, `getI32Buffer`, `getFloatBuffer`, `getDoubleBuffer`, `getImgBuffer`, `clearBuffer`
  - CV ops: `findChessboardCorners`, `calcInnerParams`, `calcUndistMap`, `undistort`, `undistortPoint`, `calcHomography`

Important

- Always free buffers with `clearBuffer` (or `WM*.clear()`) to avoid leaking WASM memory.
- Keep TS wrapper names and C++ export names in sync. If you add a new C++ function, add a corresponding method in `wrapper.ts` and adjust types.
- Known mismatch to fix if used: C++ function is `Transform` (capital T) while the wrapper calls `transform`. Align names before use.

---

## Serial + Hardware

- Teensy firmware (`teensy/src/main.cpp`):
  - Mode `A` sets laser PWM/DAC duty (expects a percentage 0–100).
  - Mode `B` sets galvo XY positions via XY2-100 (`setPos(x, y)`).
- Safety: Agents must avoid auto-connecting or sending movement commands without explicit user action. Document any firmware-side protocol changes in this file and in `teensy/`.

---

## Conventions & Style

- TypeScript strict mode is on; keep types precise. Prefer explicit return types for public functions.
- Follow existing export patterns (default vs named) consistently with nearby files.
- Use the path aliases (`@/...`, `@wasm`) instead of long relative imports.
- Avoid introducing barrel files that bloat bundles.
- Linting uses ESLint with `@typescript-eslint`. Run a local lint pass before large refactors.
- Keep rendering performant: memoize where helpful, avoid unnecessary effects, and reference the rules under `.agents/skills/vercel-react-best-practices/`.

Do not

- Rename `loaclStorage.ts` or change public function names in the WASM wrapper without updating all references.
- Commit large generated OpenCV artifacts outside the documented build locations.
- Add heavy dependencies without discussing bundle impact in PR descriptions.

---

## Common Tasks

Add a new WASM function

1. Implement and `EMSCRIPTEN_KEEPALIVE`-export it in `src-wasm/index.cpp`.
2. Rebuild WASM (`cd src-wasm && emmake make`).
3. Add a typed method in `src/wasm/wrapper.ts`.
4. Use memory helpers from `src/wasm/memory.ts` to pass data buffers.

Add a new Node UI block

1. Create a component in `src/node/` and wire it in `NodeList` within `src/node/Nodes.tsx`.
2. If it needs a canvas, reuse `component/Canvas.tsx` and `store/ctx` selectors for contexts.
3. If it talks to hardware, obtain the writer via `useWriteSerial()` from `store/ctx/hooks`.

Persist structured UI state

- Use the namespaced helpers in `src/module/loaclStorage.ts` (`updateNamespacedStore`, `getCurrentNamespace`, etc.).

---

## Known Pitfalls

- OpenCV JS build: If `build_js.py` fails due to linking flags, adjust as shown in README and try again.
- WASM memory: Always free buffers you allocate; leaks won’t crash immediately but will degrade performance quickly.
- Web Serial permissions: Users must grant access each session; handle `requestPort()` failures gracefully and do not retry in a loop.

---

## Dev Tips

- Debug draw pipelines by layering renders: original frame → operations → transient creation tools.
- Use `useFpsOptimization` around render loops to keep UI responsive when canvases are busy.
- Prefer `Float32Array`/`Uint8Array` views from the `WM*` helpers over manual `HEAP*` offsets.

---

## Validation

- Manual validation only (no test suite in repo):
  - WASM functions: log small buffer inputs/outputs to ensure correctness.
  - Camera calibration: verify chessboard detection and RMS output in console.
  - Galvo control: test with power-limited settings and safe positions first.

---

## Contact & License

- Author: @kzkymur
- License: MIT (see `LICENSE` or repository metadata)

If you change public protocols (serial message formats, WASM APIs), document them here so downstream agents stay in sync.

---

## Routing / SSG (Next.js)

- Next.js App Router is under `app/` with routes: `/`, `/calibration`, `/homography`, `/galvo`.
- `next.config.mjs` sets `output: "export"`; run `pnpm run export` to generate a static site with multiple HTML files in `dist/`.
- Client-only features (cameras, Web Serial) live in client components under `src/` and are safe for static export.
