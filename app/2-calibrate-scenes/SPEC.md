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
       - Pre‑Detect の設定を反映して `cvFindChessboardCorners` を実行。検出器は classic（`findChessboardCorners`）を先に使い、失敗時のみ `findChessboardCornersSB` へフォールバックする。
       - 小画像対策（WASM/C++側）: 入力画像の長辺が 640px 未満の場合は、検出専用に長辺 640px へアップスケール（`INTER_CUBIC`）してから角検出を行う。得られたコーナー座標は元画像ピクセル座標へ逆スケールして返す。
       - サブピクセル化: classic 成功時は cornerSubPix（11x11/30iter/1e-3）を適用。SB フォールバック成功時は SB の出力点をそのまま使用。
       - 実装メモ: 角検出は RGBA→GRAY 変換後のグレースケール画像に対して行い、`CALIB_CB_FAST_CHECK` は使用しない（ADAPTIVE_THRESH + NORMALIZE_IMAGE + FILTER_QUADS）。
    2) 内部・外部パラメータ推定（単一カメラ）
       - `normal` は `cvCalcInnerParamsExt`、`fisheye` は `cvCalcInnerParamsFisheyeExt` を使用。
       - 出力を `2-calibrate-scenes/<runTs>/cam-<name>_calibration.json`（FileEntry.type=`undist-json`）に保存。
         - JSON 例：`{ width, height, model, intrinsics3x3:number[9], distCoeffs:number[N], frames?: [{ ts, rvec:number[3], tvec:number[3] }] }`
    3) 歪み補正マップの生成（単一カメラ）
       - `cvCalcUndistMap`（fisheye は `cvCalcUndistMapFisheye`）で X/Y を生成し、`2-calibrate-scenes/<runTs>/cam-<name>_remapXY.xy` に保存。
         - 形式：`Float32Array` 長さ `width * height * 2`、交互格納 `[sx, sy]`（px 単位）
  - カメラ間ホモグラフィ（A↔B）の計算は本ページから分離し、/6-cameras-homography で実行します（本ページは H の生成を行いません）。
