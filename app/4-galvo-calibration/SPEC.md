 - 4. ガルバノスキャナのキャリブレーション
  - TypeScript + C++ WASM（OpenCV）+ Web Serial API。
  - パス：/4-galvo-calibration
  - プレビューはページ3同様の 2 パス構成（undist → identity inter）。右上ヘッダーで Source Camera を選択し、マイコンに接続します。

 - 入力（undist の自動選択）：
   - 選択中カメラのラベルを sanitize した `<cam>` に対して、`2-calibrate-scenes/<runTs>/cam-<cam>_remapXY.xy` のうち最新を自動選択して適用（見つからない場合は raw 表示）。

 - UI 要素：
   - ヘッダー：`Connect Microcontroller` / `Connected`、FPS 表示、期待カメララベル（`Expecting: <cam>`）。
   - Preview：オーバーレイの表示/クリア、任意で「Save Frame」（`4-galvo-calibration/<ts>/manual-preview.rgb`）。
   - Run パネル：
     - Grid X/Y（既定 8×8）、X/Y min/max（0–65535 の範囲で編集）、Laser(%)、Laser ON(ms)、After OFF wait(ms)。
     - settle は固定 10ms（UI では編集不可、params に保存）。

 - 実行フロー（実装準拠）：
   1) ベースフレーム保存：`4-galvo-calibration/<ts>/screen.rgb`（undist 適用済み）。
   2) グリッド走査：各格子点で
      - `setGalvoPos(x,y)` → settle(10ms) → `setLaserOutput(%)` → onMs 待機 → フレーム取得 → `setLaserOutput(0)` → offMs 待機。
      - 取得フレームを `4-galvo-calibration/<ts>/x-<x>_y-<y>.rgb` に保存。
      - `screen` との差分からスポットを推定し（3×3 重心で微修正）、対応点（galvo ↔ camera）を蓄積。
   3) 最低 4 点で `cvCalcHomography(galvoPts, cameraPts)` を実行し、H（galvo→camera）を求める。
   4) 出力 JSON：`4-galvo-calibration/<ts>-homography.json`（`homography-json`）
      - 例：`{ H:number[9], points:{ galvo:number[], camera:number[] }, params:{ grid, xRange, yRange, laserPct, timing:{ settleMs, onMs, offMs }, undistMap, cam, runTs } }`

 - 安全とプロトコル：
   - Firmware（Teensy）
     - `A<percent>`：レーザー出力（0–100）。
     - `B<x>,<y>`：ガルバノ XY 位置（16bit 整数）。実装は中心シフト＋ラップ後にクランプ（`crampGalvoCoordinate`）。
   - ページは自動接続や自動動作を行いません。必ずユーザ操作で接続・実行してください。
