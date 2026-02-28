 - 2. カメラ校正ページ（単体）
  - TypeScript の UI と C++ WASM（OpenCV）で実装。
  - パス：/2-calibrate-scenes
  - 各カメラを「一つずつ」校正します（ペア選択は不要）。
  - UI（実装準拠）：
    - 対象カメラとモデル（`normal` / `fisheye`）を選択。
    - Select Frames セクションで対象カメラのフレーム（`1-syncro-checkerboard_shots`）を複数選択（チェックボックス）。Select All / Clear All を提供。
    - Pre‑Detect Preview：
      - コントラスト（0–3、既定=1.0）スライダと Invert トグル、Show corners トグル。
      - 構成は namespaced localStorage に永続化（`calibPostOpsByCam[cam]`）。正規化により `contrast` は `invert` より先に適用、重複を排除。
      - プレビュー表示は（必要に応じて）undist なしの画像に対して適用。角検出は UI トグルでオンオフ。
  - 処理：
    1) 角検出（単一カメラ）
       - Pre‑Detect の設定を反映して `cvFindChessboardCorners` を実行。
    2) 内部・外部パラメータ推定（単一カメラ）
       - `normal` は `cvCalcInnerParamsExt`、`fisheye` は `cvCalcInnerParamsFisheyeExt` を使用。
       - 出力を `2-calibrate-scenes/<runTs>/cam-<name>_calibration.json`（FileEntry.type=`undist-json`）に保存。
         - JSON 例：`{ width, height, model, intrinsics3x3:number[9], distCoeffs:number[N], frames?: [{ ts, rvec:number[3], tvec:number[3] }] }`
    3) 歪み補正マップの生成（単一カメラ）
       - `cvCalcUndistMap`（fisheye は `cvCalcUndistMapFisheye`）で X/Y を生成し、`2-calibrate-scenes/<runTs>/cam-<name>_remapXY.xy` に保存。
         - 形式：`Float32Array` 長さ `width * height * 2`、交互格納 `[sx, sy]`（px 単位）
  - カメラ間ホモグラフィ（A↔B）の計算は本ページから分離し、/6-cameras-homography で実行します（本ページは H の生成を行いません）。
