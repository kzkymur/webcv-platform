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

## Static Export

```sh
pnpm run export
# static files are generated into dist/
```

## Deploy to GitHub Pages

1. Push to the `main` branch.
2. In your repository settings, open `Settings > Pages` and set `Source` to `GitHub Actions`.
3. The workflow `.github/workflows/deploy-pages.yml` deploys `dist/` automatically.

Published URL:

`https://<github-user>.github.io/<repository-name>/`
