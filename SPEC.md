# Project Overview

これは C++ wasm（emscripten)と Next.js(TypeScript, Tailwind CSS)with SQLite Wasm(OPFS) and WebGL で書かれたカメラおよびレーザー光のリアルタイム投影・制御システムです。Web カメラとサーモグラフィカメラを一台づつ、そして一つのマイコンを通してガルバノスキャナとレーザー出力を調整します。

機能要件は具体的に以下です。

# 基本機能（全ページに実装されるべき機能）

## 1. 各デバイスの設定機能（右サイドバーに常設）

- TypeScript Only
- 画面右側のサイドバーに常設（全ページ共通）
- 各ページに必要な、マイコンと Web カメラ、サーモグラフィカメラ等のデバイスを一覧から選択します
- 選択した Web カメラ・サーモグラフィカメラの映像は video stream 経由で HTML Canvas にリアルタイムに投影されます。カメラに関してはセレクトボックスと Canvas がセットです。
- マイコンは Web Serial API 経由で一覧取得・選択されます。
- 選択中のカメラの情報は SQLite Wasm でも保存され、リロードしても自動で設定は保持されます。マイコンの方は API の関係でユーザが手動で設定します

## 2. ファイルシステム機能（左サイドバーに常設）

- TypeScript Only
- 画面左側のサイドバーに常設（全ページ共通）
- SQLite Wasm + OPFS（Origin Private File System）で実装されます。
- ディレクトリ構造を持ちますが、基本的には S3 のようなパス名=ファイル名形式です。
- 実態は一つのテーブルです。カラムは以下
  - パス付きファイル名
  - ファイルタイプ：RGB 画像 / Grayscale 画像 / Optical Flow / Remap など
  - データ：JavaScript の型付き配列がよく入ります。
- VSCode のようなトグル付きのファイルシステム UI は左サイドバーに常設します。

## 3. サイドバーのリサイズとユーザープリファレンス（2026-02-25 追記）

- 左右サイドバー（Left: File System / Right: Device Settings）はドラッグで幅を変更できます。
- 幅は名前空間付きローカルストレージに保存され、ページをまたいでも保持されます。
  - ストレージキー: `sidebarLeftWidth`, `sidebarRightWidth`（単位: px, 数値）
- デフォルト幅は左右ともに 320px。最小 200px、最大 640px。
- 「ファイルを押した時の挙動」はページごとに異なります。
  - Home: 選択したファイルを 2D Canvas にプレビュー表示（タイプに応じて描画）。
  - その他のページ: プレビューは不要。選択イベントは各ページの機能（例: 入力の切替、参照パスの設定など）に用います。
- ファイル名の編集は不可で OK ですが、削除機能は実装してください。
- SQLite Wasm (OPFS) なので、保存・削除したファイルは全ページで共通です。これが基軸となりユーザは各ページの機能を協調的に使用してその目的を達成します。

## 4. ログフッター（共有・リサイズ可、2026-02-25 追加）

- WASM を使うページでは、メイン領域の最下部にログ専用のフッターを表示します（左右サイドバーの間に収まる）。
- フッターの高さはドラッグで変更でき、対象ページ間で共有されます。
  - ストレージキー: `logFooterHeight`（単位: px, 数値）
  - CSS 変数: `--log-footer-height`
  - 既定値 160px、最小 80px、最大はビューポート高さの 60%（動的上限）。
- ページ遷移しても高さは保持されます（名前空間付きローカルストレージ）。
- 各ページの従来の「Log セクション」は撤去し、共通フッターに統合します。

# 各ページに実装される機能

各ページの SPEC.md に記載

# 非機能要件

- 各ページは Next.js の SSG により静的 Web サイトとして出力される。SSR は特に行わない
- ファイルシステムや共通コンポーネントなどは src/shared/ ディレクトリに定義して使用する
- PC の Chrome で動けば OK。レスポンシブデザインは考慮しなくて良い
- Wasm 処理は web worker で走らせる。postMessage を wrap して各関数の呼び出しを行う class を書いてそこに wasm と連携する全処理を集約する。
  - メモリ管理には既存の WM 系クラスを使う
- Web Serial API を通じた処理は `app/shared/module/serialInterface.ts` の `SerialCommunicator` を使用する（旧ロジック準拠: ガルバ座標は送信前に中心シフト＋wrap を適用）
- 各機能は適度に分割されて実装されること。TypeScript 側、C++側ともにステートレスな実装を行う。状態を持つ class は基本使用してはならず、SQLite 中心の状態管理を心がける。ただし、値オブジェクトとして振る舞うイミュータブルな class は積極的に使用して良い。

## UI 言語・ナビゲーション方針（2026-02-20 追記）

- UI は英語のみ対応とする。特にサイドバーのラベルは英語表記に統一する（例: 「デバイス設定」→「Device Settings」, 「ファイルシステム」→「File System」）。
- 各ページは「ワークフロー」ではなく独立した機能として設計する。メインコンテンツ上部にページ横断リンク列（1→2→3）は表示しない。ナビゲーションは Top Nav と共通サイドバーに任せる。
- ホームページには「Feature Index（英語）」を掲載し、1〜3 ページの機能と入出力の場所を説明する。詳細は app/page.spec.md を参照。

## WASM メモリ/Worker 方針（2026-02-24 追記：WMコア導入）

- 目的
  - Worker 側でも安全に Emscripten ヒープを扱えるよう、WM 系（WASM Memory）を React 非依存のコアへ分離しました。
  - Classic Worker（importScripts 版）を廃止し、ESM Worker に一本化しました。

- 変更点（ファイル）
  - 新規: `app/shared/wasm/memory-core.ts`
    - `WMU8A / WMU32A / WMF32A / WMF64A` を提供。`clear()` で RAII 的に解放。
  - 更新: `app/shared/wasm/memory.ts`
    - React フック（`useF32ArrayPointer`）のみ保持。`memory-core` から WM を再エクスポート。
  - 更新: `app/shared/wasm/worker.ts`
    - すべてのメッセージハンドラを WM ベースに置換（alloc/転送/解放の重複削減）。
  - 削除: `app/shared/wasm/worker.classic.ts`
    - Classic 版 Worker を撤去（参照なし）。
  - 更新: `app/shared/wasm/wrapper.ts`
    - C++ 側エクスポート名に合わせ `transform` → `Transform` 呼び出しへ統一（API 仕様は据え置き）。

- 実装ルール
  - 直接 `get*Buffer`/`clearBuffer` を呼ばず、基本は WM クラスを使用する。
  - 生成した WM は必ず `clear()` で解放する（例: 処理後/例外時）。
  - 例外的に「ポインタ配列」を組む必要がある場合のみ `HEAPU32[index] = wm.pointer` の直接代入を許可。
  - Worker からメインスレッドに返す配列は `postMessage(..., [buffer])` の transfer list を付ける。
  - 型は C++ 側の期待に合わせる（float 系は `WMF32A`、画像は `WMU8A`）。

- Worker での WM 使用例（抜粋）
  ```ts
  // cv/calcUndistMap
  const intrPtr = new WMF32A(Module as any, 9); intrPtr.data = intr;
  const distPtr = new WMF32A(Module as any, 8); distPtr.data = dist;
  const mapLen = width * height;
  const mapX = new WMF32A(Module as any, mapLen);
  const mapY = new WMF32A(Module as any, mapLen);
  (Module as any).ccall("calcUndistMap", null,
    ["number","number","number","number","number","number"],
    [intrPtr.pointer, distPtr.pointer, width, height, mapX.pointer, mapY.pointer]
  );
  const x = mapX.data, y = mapY.data;
  intrPtr.clear(); distPtr.clear(); mapX.clear(); mapY.clear();
  self.postMessage({ id, ok: true, mapX: x.buffer, mapY: y.buffer }, [x.buffer, y.buffer]);
  ```

- 新しい WASM 関数を追加する手順（更新版）
  1. C++: `src-wasm/index.cpp` に `EMSCRIPTEN_KEEPALIVE` でエクスポート。
  2. TS: `app/shared/wasm/wrapper.ts` に型付きメソッドを追加（名前は C++ と厳密一致）。
  3. Worker: `app/shared/wasm/worker.ts` にハンドラを追加し、WM を用いて入出力バッファを管理。
  4. UI/呼び出し側: `WasmWorkerClient` からメッセージを送る（transfer list を忘れない）。

- 移行ノート
  - 既存の呼び出し API は互換です（`Transform` 呼び出し名のみ内部修正）。
  - Classic Worker を前提とした記述は削除してください。ESM Worker（`type: "module"`）のみ使用します。

## Calibration Notes（2026-02-24 追記）

- Fisheye 対応の歪み補正マップを追加しました。
  - C++: `calcUndistMapFisheye`（`cv::fisheye::initUndistortRectifyMap` を使用）
  - Worker: `cv/calcUndistMapFisheye`、Client: `cvCalcUndistMapFisheye(width,height,intr,dist)`
  - ページ2はカメラのモデルが `fisheye` のとき自動で fisheye 版を呼びます。
- ページ2のキャリブレーションでは、カメラごとの事前処理（コントラスト/反転）が適用されます。
  - A/B で事前処理が異なると同じ画像群でもコーナー検出結果→内部パラメータ→remap が変動します。
  - ログに `Preprocess A=..., B=...` を出力するようにし、差異を可視化しました。
- Normal モデルの歪み係数は安定化のため 8 要素固定で保存し、`k1,k2,p1,p2,k3` の5要素のみを保持、`k4..k6` は 0 に正規化します（`calcInnerParams`/`calcInnerParamsExt`）。

## Undistortion Auto‑Select（2026-02-25 追記）

 - ページ4（Galvo Calibration）とページ5（Laser Manual Operation）では、undistortion map の手動選択 UI を廃止し、自動適用に変更しました。
 - 選択中のカメラ（Device Settings のデバイス）のラベルを `sanitize()` した cam 名から、`2-calibrate-scenes/<runTs>/cam-<CamName>_remapXY.xy` の最新（最大 `runTs`）を自動適用します。
 - 対応する undistortion map が見つからない場合でも動作は継続します。自動で「恒等（identity）マップ」を適用し、警告表示のみ行います（生のカメラ映像）。

## WebGL Capture Notes（2026-02-24 追記）

- 画像保存（ページ3/4のプレビュー保存・キャリブレーション基準/差分の保存）は、`RemapRenderer.readPixels()` で WebGL のデフォルトフレームバッファから取得します。
- これを安定させるため `app/shared/gl/remap.ts` の WebGL2 コンテキスト生成時に `preserveDrawingBuffer: true` を指定しました。これにより rAF の描画完了後もバッファ内容が保持され、UI ハンドラなど別タイミングでの `readPixels()` が黒（全0）になりません。
- パフォーマンス影響が問題になる場合は、将来的に「最終出力もオフスクリーンFBOに描画→そこから `readPixels()`」へ切り替えると `preserveDrawingBuffer` を外せます。

## Camera Y16 Pipeline（2026-02-25 追記）

- 右サイドバー「Web Cameras」の各行にある `Y16` チェックで、該当カメラを 16bit グレースケール入力として扱います。
- 実装: `useCameraStreams.ts` 内で `MediaStreamTrackProcessor` を用いて各フレームを読み取り、`format` が `Y16/GRAY16` の場合は 16bit → 8bit の疑似グレイへ線形正規化し `canvas.putImageData()` で描画、`canvas.captureStream()` を UI 側へ供給します。
- フォールバック: `MediaStreamTrackProcessor` が存在しない環境ではパススルー（Y16 変換は行わない）。
- ライフサイクル: 停止処理はソース `track.stop()` を優先し、リーダーのロック状態に応じて `reader.cancel()` または `readable.cancel()` を呼び分けます（どちらも失敗は握りつぶし）。これにより「ReadableStreamDefaultReader が release 済み」エラーを回避します。停止は冪等です。
- 設定の保存場所: `cameraOptions: Record<string, { y16?: boolean }>`（名前空間付きローカルストレージ）
