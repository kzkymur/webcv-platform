- 9. レーザー操作 + 温度計測（自動シーケンス）
  - TypeScript + Web Serial API + WebSocket Y16 + @kzkymur/sequencer
  - パス：`/9-measure-thermo`
  - ベース構成はページ8（`/8-laser-automatic-operation`）を踏襲する。
  - ページ8と異なり `Add Fragment` UI は持たず、保存済みシーケンスを選択して実行する。

## 入力選択 UI

- 下記6項目を必須選択にする（未選択時は `Start` disabled）。
  - Web Camera
  - Galvo Homography（galvo→web camera）
  - Serial Device（Web Serial）
  - Sequence File（`FileEntry.type === "sequence"`。ページ8等で作成した `.seq`。`mode` は `outline` / `raster-loop-edges` / `outline-inward-8` / `raster-loop-edges-inward-8` / `outline-inward-4` / `raster-loop-edges-inward-4` / `raster` / `grid-raster-inward` を受理）
  - Thermal Camera（WebSocket Y16: `ws://` / `wss://`）
  - Web↔Thermal Homography（web camera と thermal camera の対応）
- シーケンスタイムラインはページ8同様に表示する（既定 `720x50` CSS px）。

## プレビューと重畳表示

- プレビューは Web カメラ（左）とサーモカメラ（右）を横並びで表示する。
- レーザー照射位置ドットとフラグメント図形は、ページ8同様に Web カメラへ重畳しつつ、同一情報をサーモカメラにも同時重畳する。
  - 変換: `galvo -> web` は galvo homography、`web -> thermal` は選択 homography を使用。
- `Start` 前にユーザがどちらかのプレビューをクリックすると温度観測点を設定する。
  - 設定点は両プレビューへ同時描画する（片側クリックで他方へ変換）。
  - 変換先が画角外の場合は画角内クランプせず、そのフレームの観測点温度は欠損扱いにする。

## 実行フロー

- `Start` 押下で以下を同時開始する。
  - ページ8相当のシーケンス再生（ガルバ/レーザー制御）
  - サーモカメラ温度計測（30Hz）
- 温度計測値は次の2系列を記録する。
  - 観測点温度（observation point）
  - フレーム内最高温度（frame max）
- タイムライン下に温度推移グラフを表示する。
  - 横軸はタイムライン時間に同期。
  - 縦軸は表示中データの `min..max` に合わせて動的更新。
- 温度計測の換算:
  - サーモフレーム raw 値を `scale` で割って Kelvin に換算し、`tempC = tempK - 273.15` を記録する。
  - `scale <= 0` の場合は `tempK = raw` をフォールバックとして扱う。

## 停止・終了

- `Stop` 押下、または非ループ再生の自然終了時に以下を同時停止する。
  - シーケンス再生（ガルバ/レーザー）
  - 温度計測
- 停止時はページ8と同様に `A0` を送信してレーザー出力を 0% に戻す。
  - 2026-03-12 更新: Stop/自然終了の共通終了処理で `A0` の送信完了を待機し、シーケンス終了時に必ずレーザー 0% を反映する。
  - 2026-03-13 更新: 高レート時のパケット詰まりを避けるため、再生中のガルバ座標 `B{x,y}` は最新値のみ送信。停止時は保留 `B` を破棄して `A0` を優先送信する。
- 取得した温度ログを CSV で保存する。
  - 保存先: `/9-measure-thermo/{ts}.csv`
  - `{ts}` は `Start` 実行時刻（推奨: `YYYY-MM-DD_HH-mm-ss`）。
  - `FileEntry.type` は `other` を使用する。

## CSV 仕様（v1）

- 1サンプル=1行（目標30Hz）。
- 文字コードは UTF-8、改行は LF。
- ヘッダ:

```csv
elapsedMs,elapsedSec,pointTempC,maxTempC
```

- 列定義:
  - `elapsedMs`: シーケンス開始からの経過ミリ秒。
  - `elapsedSec`: `elapsedMs / 1000`。
  - `pointTempC`: 観測点温度（℃）。
  - `maxTempC`: フレーム内最大温度（℃）。

## ループ再生

- ページ8と同様に loop に対応する。
- loop 有効時は、`Stop` が押されるまでシーケンス再生と温度計測を継続する。
- loop 中の CSV は単一ファイルに連続追記し、`Stop` 時点で保存する。
- 2026-03-13 更新: page8 と同じく、loop 周回ごとに各フラグメントの `laserPct` を再適用する。
