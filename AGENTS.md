# プロジェクト運用メモ（AGENTS）

## 基本ルール
- 対話は必ず日本語で行う。
- 権限: `storage` のみ。`host_permissions` なし。
- content script の注入先: `https://live.nicovideo.jp/watch/*`。

## 技術スタック
- Chrome MV3 / TypeScript / React / Webpack
- バックグラウンド SW は現状なし（content + popup のみ）

## 機能概要（content）
- `video.currentTime` を監視し、10 秒停滞で停止判定。
- 停止判定後は 5 秒カウントダウンし、リロードを実行。
- `paused` / `ended` 時は監視をスキップ。
- 番組 ID を付けてログ保存・通知（Notification API、サイト許可依存）。

## リロードポリシー
- リロード上限 5 回、間隔 15 秒。
- 上限到達後は 5 分クールダウン。
- カウントダウン 5 秒。

## ログ / 設定
- 保存先: `chrome.storage.local`
- キー: `settings`（enabled 初期 ON）、`logs`（最新 100 件）
- popup で表示・クリア可能

## テスト / ビルド
- テスト: `npm test -- --runInBand`（Jest）。`test/reload-policy.test.ts` あり。
- ビルド: 開発 `npm run build-dev-once`、本番 `npm run build-prod`。出力先 `dist`。

## 重要ファイル
- `src/entry/content.tsx`, `src/entry/popup.tsx`, `src/shared/*`, `public/manifest.json`

## コミット運用
- commit は指示があるまで勝手にしないこと。
- commit message は `docs/commit-message.md` の内容に従うこと。
- commit 実行前に `npm run prettier` を実施すること。
