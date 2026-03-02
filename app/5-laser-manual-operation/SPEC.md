 - 5. ガルバノ／レーザー 手動操作
  - TypeScript + Web Serial API + WebGL2（undist のみ適用）。
  - パス：/5-laser-manual-operation

 - 入力の選択：
   - ホモグラフィ：`4-galvo-calibration/<ts>-homography.json` を一覧から単一選択（`homography-json`）。
     - JSON は `{ H:number[9] }` または `{ homography3x3:number[9] }` のいずれも受理。
     - 読み込み後に逆行列 `Hinv` を内部計算（camera→galvo）。
  - undist マップ：選択中カメラのラベルに一致する最新の `2-calibrate-scenes/<runTs>/cam-<cam>_remapXY.xy` を自動適用（見つからない場合は raw 表示）。
    - undist マップが未検出でも、ビデオのメタデータ読込後に identity マップを自動適用し、常にプレビューが表示される（空白キャンバス回避）。

 - UI（実装準拠）：
   - ヘッダー：Source Camera セレクト、Microcontroller 接続／切断。
   - Homography セクション：`4-galvo-calibration/` 直下の H ファイルを列挙し、クリックで選択。
   - Preview & Control：FPS 表示、`Galvo Sync` トグル、`Laser(%)` 数値入力。
     - Canvas は undist 適用済みのライブ映像。クリックすると直近のクリック位置と変換先（galvo）をオーバーレイ表示。
     - `Galvo Sync` 有効かつ Serial 接続済みかつ `Hinv` がロード済みの場合、クリック座標を `Hinv` で galvo 座標へ変換して `setGalvoPos` を即時送信。
     - `Laser(%)` は変更時に即座に `A<percent>` を送信（接続時のみ）。

 - 変換と制約：
   - `Hinv` により（camera px → galvo）を算出。送信前に `crampGalvoCoordinate` で 0..65534 にクランプ。
   - オーバーレイには `cam=(x,y) → galvo=(gx,gy)` を表示。最後のクリックのみ保持。

 - 注意：
   - 自動接続や自動駆動は行いません。必ずユーザ操作で接続・有効化してください。
   - inter‑camera の H（ページ6）ではなく、ページ4で得た galvo↔camera の H を使用してください。
