const FULLSCREEN_BUTTON_SELECTOR = "button[class^='___fullscreen-button___']";
const DATA_TOGGLE_TRUE = "true";

/**
 * プレイヤーのフルスクリーンボタン要素を取得する
 */
function getFullscreenButton(): HTMLButtonElement | null {
  const button = document.querySelector(FULLSCREEN_BUTTON_SELECTOR);
  return button instanceof HTMLButtonElement ? button : null;
}

/**
 * プレイヤーがフルスクリーンかどうかを判定する
 *
 * - Nico Live のプレイヤーではフルスク時に data-toggle-state="true" が付与される。
 * - ボタンが取得できない場合は false を返す（安全側判定）。
 */
export function isFullscreen(): boolean {
  const button = getFullscreenButton();
  return (button?.getAttribute("data-toggle-state") ?? "") === DATA_TOGGLE_TRUE;
}

/**
 * フルスクリーンの ON/OFF をトグルする
 *
 * 注意: ブラウザの User Activation 制約により、クリックやキー押下イベントの
 * 同期ハンドラ内で呼ぶこと（setTimeout などの非同期経由だと拒否される）。
 *
 * @returns トグルを試行した場合は true、ボタン未取得などで何もしなかった場合は false
 */
export function toggleFullscreen(): boolean {
  const button = getFullscreenButton();
  if (!button) return false;
  button.click();
  return true;
}
