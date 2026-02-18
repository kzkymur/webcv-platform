# GalvoWeb 3.0 — Setup & Basic Usage

This app uses Next.js (App Router, SSG), TypeScript, IndexedDB-backed storage (SQLite Wasm pluggable later), Web Serial, and Web APIs for cameras.

## Prerequisites

- Node.js 23.10.0 and pnpm 10.12.3 (see `.tool-versions`).
- Chrome on desktop (Web Serial + camera).
- Optional: Emscripten + OpenCV build (only needed when wiring computer vision).

## Install & Run (Next.js)

```bash
pnpm i
pnpm dev
# open http://localhost:8080
```

## What’s Implemented (Basic)

- Device settings (top-left):
  - Enumerate/select two cameras (web + thermal placeholder).
  - Web Serial connect/disconnect; send laser output (Mode A) with safety checkbox.
- File system (bottom-left):
  - IndexedDB store for files: path, type, binary data.
  - Import images (PNG/JPEG), auto-decode to RGBA or grayscale.
  - Tree view with selection and delete; preview on canvas.

## Notes

- SQLite Wasm: `sql.js` ベースのドライバを同梱。`VITE_USE_SQLITE_WASM=1` で有効化。DBファイルは IndexedDB に保存/復元（オフライン持続）。
- WASM worker: `src/shared/wasm/worker.ts` を使用（`@wasm` エイリアス + `new URL(... .wasm)`でアセット解決）。
- Safety: no auto-connect, no implicit galvo motions. Serial actions require explicit user clicks.

## Computer Vision

- Chessboard detection is wired on `/calibration`. It sends a single RGBA frame to the worker and draws detected corners on a canvas.

## Routes

- `/` Home: device + file system + camera previews
- `/calibration`: chessboard detection (WASM)
- `/homography`: stub for later homography ops
- `/galvo`: serial XY sender and simple queue scheduler (with safety guard)

## Build (Static)

- `pnpm build` → Next build（`.next/`）
- `pnpm export` → 静的サイトを `dist/` に出力（複数のHTMLファイル）
