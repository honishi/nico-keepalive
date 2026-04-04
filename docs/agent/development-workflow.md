# 開発運用メモ

## 技術スタック
- Chrome MV3 / TypeScript / React / Webpack
- テストは Jest、整形は Prettier、lint 修正は ESLint を使用
- バックグラウンド SW は現状なし（content + popup のみ）

## テスト / ビルド
- テスト: `npm test`
- ビルド
  - 開発: `npm run build-dev`（watch）
  - 開発単発: `npm run build-dev-once`
  - 本番: `npm run build-prod`
- 出力先は `dist`

## 重要ファイル
- `src/entry/content.tsx`
- `src/content/monitor-runner.ts`
- `src/content/checks/*`
- `src/view/monitor-overlay.ts`
- `src/entry/popup.tsx`
- `src/shared/*`
- `public/manifest.json`

## テストファイル
- `test/program-meta.test.ts`
- `test/settings.test.ts`
- `test/normal-check.test.ts`
- `test/deep-check.test.ts`
- `test/monitor-runner.test.ts`
- `test/monitor-overlay.test.ts`
- `test/popup.test.ts`

## バージョン更新
- バージョンを上げるときは、基本的に `public/manifest.json` の `version` のみ更新すればよい。
