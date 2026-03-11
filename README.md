# webcv-platform

WebCV-Platform is a serverless software for operating Galvo Scanner with XY protocol.

## Install Dependencies

```sh
pnpm i
```

## Build WASM

```sh
cd src-wasm && emcmake cmake && emmake make
```

## Run

```sh
pnpm run dev
```
