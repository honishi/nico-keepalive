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
- 停止判定後は 5 秒カウントダウン（トースト表示）し、`window.location.reload()` を実行。
- `paused` / `ended` 時は監視基準をリセットしてスキップ（再開直後の誤検知を防ぐ）。
- 番組メタ（放送者名 / ON_AIR）を `#embedded-data` の `data-props` から取得し、Offline の場合は監視しない。
- 番組 ID（`lv...` / `ch...`）と放送者名を付けてログ保存・通知（Web Notification。サイト側の通知許可に依存し、初回のみ許可をリクエスト）。

## リロード挙動
- 停止検知中は二重にカウントダウンしない（カウントダウン中の再トリガーを抑止）。
- リロード回数上限・間隔制御・クールダウン等のレート制限は現状未実装。

## ログ / 設定
- 保存先: `chrome.storage.local`
- キー: `settings`（`enabled` 初期 ON、通知音: `soundEnabled` / `soundVolume` / `customSound`）、`logs`（最新 1000 件）
- popup で設定変更・表示・クリア可能（無効化時はバッジに `Zz` を表示）

## テスト / ビルド
- テスト: `npm test -- --runInBand`（Jest）。`test/reload-policy.test.ts` あり。
- ビルド: 開発 `npm run build-dev-once`、本番 `npm run build-prod`。出力先 `dist`。

## 重要ファイル
- `src/entry/content.tsx`, `src/entry/popup.tsx`, `src/shared/*`, `public/manifest.json`

## コミット運用
- commit は指示があるまで勝手にしないこと。
- commit message は `docs/commit-message.md` の内容に従うこと。
- commit 実行前に `npm run prettier` を実施すること。
