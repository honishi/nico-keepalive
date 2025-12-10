# ニコ生リロード拡張 実装方針 (決定版)

## ゴール

- `https://live.nicovideo.jp/watch/*` で配信停止を検知し、自動リロードする Chrome MV3 拡張を作成する。
- popup で拡張全体の ON/OFF を切り替えられ、動作ログを表示できる。
- 初期状態は ON。設定・ログは `chrome.storage.local` に保存する。

## ベース構成

- 参考実装: `references/chrome-nico-alert`
- 技術スタック: TypeScript + React + Webpack (Manifest V3)
- モジュール構成 (想定):
  - `manifest.json` (MV3)
  - `src/content` ... 配信ページ常駐の監視ロジックとトースト表示
  - `src/background` ... 共有状態/メッセージハブ (service worker)
  - `src/popup` ... ON/OFF トグルとログ表示 UI
  - `src/shared` ... 型定義・メッセージ/ストレージユーティリティ・ログ管理
  - `public/` ... アイコン類 (当面は参考実装を流用)

## 対象ページ・権限

- ホスト権限: `https://live.nicovideo.jp/*` のみ
- 必要権限: `storage`, `scripting`, `tabs` (最低限)

## 機能仕様

### 監視・停止判定

- content script が video 要素を監視。
- `video.currentTime` が 10 秒以上進まない状態を「停止」と暫定判定（後で調整可）。
- 監視間隔は実装時に検討（例: 1 秒ごとに差分をチェック）。
- 対象ページが複数タブでも、各タブで独立して監視する。

### リロードポリシー（承認済み）

1. 停止判定後、ページ上に 5 秒カウントダウンのトーストを表示。
2. カウントダウン完了で自動リロード。
3. 連続リロード上限: 5 回。
4. 再試行間隔: 15 秒固定。
5. 上限到達後は 5 分クールダウンし、その後監視を再開。
6. タブがバックグラウンドでも監視・リロードを継続。

### ON/OFF 制御

- 拡張全体スイッチ（popup で切替）。初期 ON。
- OFF 時は監視・リロード・トーストを停止。状態は `chrome.storage.local` に保持。

### ログ

- 種別例: `INFO`/`WARN`/`ERROR`。
- 記録対象: 停止検知、カウントダウン開始、リロード実行、上限到達/クールダウン入り、手動操作（ON/OFF）。
- 保持件数: 最新 100 件（超過時は古い順に削除）。
- 保存先: `chrome.storage.local`。popup で時刻付きで表示。

### トースト表示

- content script が DOM に挿入。
- 5 秒カウントダウンを視覚的に表示し、リロード理由を明示。
- ページの既存 UI を極力壊さない簡易レイアウト（CSS はスコープされたクラス名で衝突回避）。

### popup UI

- 要素: ON/OFF トグル、ログ一覧（最新 100 件、スクロール表示）。
- 追加要素は現時点なし（将来拡張余地を残す）。

## 状態とデータモデル

- `storage.local` キー案:
  - `settings`: `{ enabled: boolean }`
  - `logs`: `LogEntry[]` (`{ id, level, message, timestamp, context? }`) 最大 100 件
  - `reloadPolicy`: 固定値をコード内で持つ（初期は上記ポリシー）。将来の UI 設定拡張に備え型を分離。
- メッセージ種別案 (content ↔ background ↔ popup):
  - `GET_SETTINGS`, `SET_SETTINGS`
  - `GET_LOGS`, `PUSH_LOG`
  - `NOTIFY_STATE`（content から背景へ: 停止検知/リロード開始/上限到達 など）

## テスト方針 (Jest)

- 単体テスト優先対象:
  - 停止判定ロジック（currentTime 差分判定）
  - リロードポリシーの状態遷移（カウント、間隔、クールダウン）
  - ログ管理（100 件ローテーション）
- DOM 依存部分は軽量なモック or JSDOM でカバー。E2E は当面スコープ外。

## 実装ステップ案

1. 参考実装を `references/chrome-nico-alert` からワークスペースへコピーし、最小構成に整理。
2. Manifest を MV3 用に調整し、ホスト権限・パーミッションを最小化。
3. `shared` モジュール: 型定義、メッセージ定義、ストレージ/ログユーティリティを整備。
4. リロードポリシーの状態マシンを実装（単体テスト作成）。
5. content script:
   - video 検出と currentTime 監視
   - 停止判定 → トースト表示 → カウントダウン → リロード
   - メッセージ送信/ログ追加
6. background service worker:
   - 設定・ログの集中管理（`storage.local` 連携）
   - popup/content とのメッセージ仲介
7. popup:
   - ON/OFF トグル
   - ログ表示（最新 100 件）
8. ビルド/パッケージング設定調整（Webpack, tsconfig, scripts）とアイコン仮置き。
9. 動作確認: 手動でターゲットページを開き、停止シミュレーションでリロードとトーストを確認。
10. README/使用方法の更新。

## 残課題/留意点

- 停止判定の精度は実ページで検証し、閾値や監視間隔を後で調整する。
- ニコ生側 DOM 変更への耐性を確保する（video 要素の取得失敗時リトライなど）。
- 連続リロードがサーバ側レートリミットに与える影響は要観察。
- 将来要望: コメント入力検知によるリロード抑止、ポリシー設定 UI、ホットキー対応など。
