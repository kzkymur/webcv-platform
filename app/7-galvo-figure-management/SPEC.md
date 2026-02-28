 - 7. レーザー照射平面上の照射対象管理機能
   - Typescript Only
   - Path: `/7-galvo-figure-management`
   - 5 と同様に、remap + homography を用いて Web カメラ画像上の任意点をガルバノ座標へ変換し、クリックで多角形（照射対象）を作成する。
   - 作成したポリゴンはファイルシステムに保存・ロード・削除が可能。

## UI

- Source: `Live Camera` / `Still Image`（英語）。
  - Live: カメラ選択あり。デバイスラベルを sanitize した cam 名に一致する最新の undistortion map（`remapXY.xy`）を自動適用。
  - Still: 画像ファイル（`rgb-image`/`grayscale-image`）を選択。プレビューは undist 前提で描画（簡潔化のため undist map は適用しない）。
- Homography: `FileEntry.type === "homography-json"` の全ファイルから選択（デフォルトは最新）。
- Create Start / Create End / Clear（英語）。
  - Create Start で作成モードに入り、キャンバスクリックで点を追加。
  - 3 点以上で自動的にクローズドポリゴンとして塗りつぶし＋輪郭描画。
  - Create End で保存。

## ファイル入出力

- 保存先: `7-galvo-figure-management/<YYYY-MM-DD_HH-mm-ss>.fig`
- FileEntry.type: `figure`
- フォーマット（最小）:

```
{ "pointsGalvo": number[] } // [x1, y1, x2, y2, ...]
```

  - homography とは独立。図形の表現はガルバ平面座標のみを保持する。
  - ロード時の描画は、選択中の homography（galvo→camera）で再投影し、キャンバス上に重畳する。

## クリック座標の変換

- キャンバス座標（camera/undist）→ ガルバ: `Hinv`（`invertHomography(H)`）を使用。
- ガルバ → キャンバス: `H` を使用（ロード時の重畳）。

## 備考

- 画像プレビューは WebGL2 `RemapRenderer` を使用。still 画像にも対応するため `setSourceImage()` を追加（内部的に RGBA テクスチャにアップロード）。
- Live かつ undistortion map が未検出の場合は identity マップでフォールバック。
