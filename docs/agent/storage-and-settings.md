# 設定と保存先メモ

## 保存先
- 保存先は `chrome.storage.local`

## 保存キー
- `settings`
  - `enabled` 初期 ON
  - `soundEnabled`
  - `soundVolume`
  - `customSound`
  - `deepCheckModeEnabled` 初期 ON
  - `deepCheckThresholdSec`
  - `monitorOverlayEnabled` 初期 ON
  - `debugWarmupEnabled`
  - `debugCurrentTimeCheckEnabled`
  - `debugDeepCheckEnabled`
- `logs`
  - 最新 1000 件を保持
- `programStateMap`
  - フルスクリーン復元用
- `reloadCount`
  - `{ count, lastReloadAt? }`

## ログ
- 番組 ID（`lv...` / `ch...`）と放送者名を付けてログ保存する。
- ログはレベル付きで保持する。
- deep check の定期メトリクスは console にのみ出力し、popup のアプリ内ログには保存しない。

## 通知音
- `customSound` は `dataUrl` で保存する。
- カスタム音は最大 1MB。ファイル名も保持する。

## Popup 上の設定操作
- popup で設定変更・表示・クリアが可能。
- 無効化時はバッジに `Zz` を表示する。
- 動作状況のクリアで自動リロード回数をリセットする。
