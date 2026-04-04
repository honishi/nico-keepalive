# プロジェクト運用メモ（AGENTS）

## 基本ルール
- 対話は必ず日本語で行う。
- 権限: `storage` のみ。`host_permissions` なし。
- content script の注入先: `https://live.nicovideo.jp/watch/*`。

## 技術スタック
- Chrome MV3 / TypeScript / React / Webpack
- バックグラウンド SW は現状なし（content + popup のみ）

## 機能概要（content）
- `video.currentTime` を 5 秒間隔で監視し、約 20 秒間変化しない場合を停止扱い（微小揺れはノイズとして無視）。
- `v0.7.0` 以降は任意機能として「高度な停止チェック」を追加。映像フレーム比較 + 音声解析により、「映像変化なし かつ 無音」が一定時間続く場合も停止扱いにできる（デフォルト OFF）。
- 高度な停止チェックの判定時間は popup から変更可能。範囲は 20 秒から 5 分、既定値は 1 分。既存の `currentTime` 判定は従来どおり約 20 秒固定。
- 監視開始から 60 秒はウォームアップとして判定をスキップ（再生開始直後の誤検知を抑止）。
- 停止判定後は 5 秒カウントダウン（トースト表示）し、`window.location.reload()` を実行。
- 自動リロード回数を記録して popup の「動作状況」に表示。
- `paused` / `ended` 時は監視基準をリセットしてスキップ（再開直後の誤検知を防ぐ）。
- 番組メタ（放送者名 / ON_AIR）を `#embedded-data` の `data-props` から取得し、Offline の場合は監視しない。
- 放送停止検出時に通知音を再生（デフォルト音 / カスタム音・音量を設定可能）。
- 番組 ID（`lv...` / `ch...`）と放送者名を付けてログ保存（レベル付き）。
- リロード前にフルスクリーン状態を保存し、リロード後に復元を試みる（最大 5 回リトライ）。
- monitor debug overlay を popup から表示可能。通常判定 / 高度な停止判定 / warmup / paused / ended の状態をページ上に表示する。最小化ボタンあり。

## リロード挙動
- 停止検知中は二重にカウントダウンしない（カウントダウン中の再トリガーを抑止）。
- リロード回数上限・間隔制御・クールダウン等のレート制限は現状未実装。
- フルスクリーン復元用の状態は 24 時間で破棄される。

## ログ / 設定
- 保存先: `chrome.storage.local`
- キー: `settings`（`enabled` 初期 ON、通知音: `soundEnabled` / `soundVolume` / `customSound`、高度な停止チェック: `deepCheckModeEnabled` / `deepCheckThresholdSec`、overlay: `monitorDebugOverlayEnabled`）、`logs`（最新 1000 件）、`programStateMap`（フルスクリーン復元用）、`reloadCount`（`{ count, lastReloadAt? }`）
- `customSound` は `dataUrl` 保存（最大 1MB、ファイル名も保持）
- popup で設定変更・表示・クリア可能（無効化時はバッジに `Zz` を表示）。動作状況のクリアで自動リロード回数をリセット。
- deep check の定期メトリクスは console にのみ出力し、popup のアプリ内ログには保存しない。

## テスト / ビルド
- テスト: `npm test`（Jest）。`test/program-meta.test.ts` あり。
- ビルド: 開発 `npm run build-dev`（watch）、`npm run build-dev-once`、本番 `npm run build-prod`。出力先 `dist`。

## 重要ファイル
- `src/entry/content.tsx`, `src/entry/popup.tsx`, `src/shared/*`, `public/manifest.json`

## 開発用ショートカット（__DEV__ のみ）
- `Ctrl+T` トースト表示のテスト
- `Ctrl+D` フルスクリーン状態のログ出力 / `Ctrl+F` フルスクリーン切替
- `Ctrl+R` 停止検知のシミュレート（入力中は無効）

## コミット運用
- commit は指示があるまで勝手にしないこと。
- commit message は `docs/commit-message.md` の内容に従うこと。
- commit 実行前に `npm run prettier` を実施すること。
- バージョンを上げるときは、基本的に `public/manifest.json` の `version` のみ更新すればよい。
