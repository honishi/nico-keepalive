# プロジェクト運用メモ（AGENTS）

## 最初に確認するルール
- 権限: `storage` のみ。`host_permissions` なし。
- content script の注入先: `https://live.nicovideo.jp/watch/*`
- コードを更新したときは、セットで必ず `npm run build-dev-once` を実行すること。
- commit は指示があるまで勝手にしないこと。
- commit 実行前に `npm run prettier` を実施すること。
- commit message は `docs/commit-message.md` の内容に従うこと。

## 詳細ドキュメント
- 機能仕様を確認したい: `docs/agent/feature-overview.md`
- 設定値、保存先、ログ仕様を確認したい: `docs/agent/storage-and-settings.md`
- 技術スタック、テスト、ビルド、重要ファイル、バージョン更新ルールを確認したい: `docs/agent/development-workflow.md`
- commit message の書式を確認したい: `docs/commit-message.md`
