- パス：/1-syncro-checkerboard-shots
  - TypeScript Only
  - UI 構成：
    - 左サイドバー＝内蔵ファイルシステム（共通）。
    - 右サイドバー＝Device Settings（共通）。ここで選択したカメラ一覧（namespaced localStorage: `cameraIds`）をこのページが参照します。
    - メイン＝選択済みカメラごとのプレビューと撮影操作。
  - 「Capture All」クリックで、表示中の全カメラを同一タイムスタンプで同時撮影します。
  - 主用途：チェッカーボードやシーンの同期撮影（ページ2・6の入力）。
  - ファイル選択イベントは受け取りますが、このページではプレビュー表示しません（プレビューは Home）。

- 保存仕様（実装準拠）：
  - 保存先：`1-syncro-checkerboard_shots/<ts>/cam-<CamName>.(rgb|gray)`
    - 互換読み込み：`1-syncro-checkerboard_shots/<ts>_cam-<CamName>.(rgb|gray)` も解釈します（書き込みは新レイアウトのみ）。
  - 画素データ：常に RGBA レイアウト（channels=4）。
    - `rgba8` 選択時＝そのまま RGBA8。
    - `gray8` 選択時＝グレイスケール化して R=G=B、A=255 に詰め替えた RGBA8 として保存。
  - `FileEntry.type` は `rgb-image`（rgba8）または `grayscale-image`（gray8）。
  - 画像サイズはネイティブのフレームサイズ（videoWidth/Height）で保存。
  - カメラ名はデバイスラベル（または deviceId）を sanitize した値を使用。WebSocket カメラは `(WS) <url>` の表示になります。

- フォーマット選択（カメラ別）：
  - プレビュー上部の「Save Format」（`RGBA 8-bit` / `Grayscale 8-bit`）。
  - 永続化：namespaced localStorage `shotOptions: Record<deviceId, { fmt }>`。
  - 既定は `rgba8`。gray16 等は未対応（将来拡張）。

- その他メモ：
  - このページではファイルシステムのプレビューは表示しません（Home のみ）。
  - 撮影した画像はページ2（校正）・ページ6（カメラ間 H）の入力として列挙されます。
