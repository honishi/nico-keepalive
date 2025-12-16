import { playNotificationSound } from "../shared/sound";
import { parseProgramMetaFromDocument } from "../shared/program-meta";
import { CustomSound, ProgramStateMap, Settings } from "../shared/types";
import { getSettings, pushLog, updateProgramStateMap } from "../shared/storage";
import { isFullscreen, toggleFullscreen } from "../shared/fullscreen";

declare const __DEV__: boolean;

const TICK_INTERVAL_MS = 5_000;
const WARMUP_SKIP_MS = 60_000; // tick 初回開始からこの時間は監視処理をスキップする
const NO_TIME_CHANGE_THRESHOLD_MS = 20_000; // currentTime が変化しない状態がこの時間続くと停止扱い
const TIME_CHANGE_EPSILON_SEC = 0.01; // currentTime の微小揺れ（±）をノイズとして無視するための閾値
const COUNTDOWN_MS = 5_000;
const TOAST_ID = "nico-keepalive-toast";
const PROGRAM_STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

let enabled = true;
let soundEnabled = true;
let soundVolume = 100;
let customSound: CustomSound | null | undefined = null;
let monitorTimer: number | undefined;
let countdownTimer: number | undefined;
let lastTimeChangeAtMs = Date.now(); // 壁時計ベースで最後に currentTime の変化を確認した時刻
let lastObservedCurrentTimeSec = 0; // video.currentTime の最後の観測値（秒）
let tickCount = 0;
let firstTickAtMs: number | undefined;
let providerName: string | undefined;
let isOnAir = false; // メタ情報取得失敗時は監視を開始しない

async function init() {
  await restoreFullscreenAfterReload();
  const settings = await getSettings();
  applySettings(settings);
  refreshProgramMeta();
  if (!isOnAir) {
    logInfo("モニターをスキップします (Offline)");
    return;
  }
  if (!enabled) {
    return;
  }
  startMonitor();
}

function refreshProgramMeta() {
  try {
    const meta = parseProgramMetaFromDocument(document);
    providerName = meta.providerName;
    if (typeof meta.isOnAir === "boolean") {
      isOnAir = meta.isOnAir;
    }
  } catch (err) {
    isOnAir = false; // 取得失敗時は安全側で停止扱い
    // eslint-disable-next-line no-console
    console.warn("放送者情報の取得に失敗しました", err);
  }
}

function applySettings(settings: Settings) {
  enabled = settings.enabled ?? true;
  soundEnabled = settings.soundEnabled ?? true;
  soundVolume = settings.soundVolume ?? 100;
  customSound = settings.customSound ?? null;
}

function startMonitor() {
  if (monitorTimer) return;
  monitorTimer = window.setInterval(tick, TICK_INTERVAL_MS);
  logInfo("モニターを開始しました");
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = undefined;
  }
  clearCountdown();
  hideToast();
  logInfo("モニターを停止しました");
}

function findVideo(): HTMLVideoElement | null {
  const video = document.querySelector("video");
  return video instanceof HTMLVideoElement ? video : null;
}

function tick() {
  // 1) 監視の前提チェック（拡張が無効 / video がまだ無い / currentTime が取れない等）
  if (!enabled) return;
  const video = findVideo();
  if (!video || isNaN(video.currentTime)) {
    return;
  }

  // 2) この tick で使うスナップショットを取得（以降はこれを基準に判定する）
  const nowMs = Date.now();
  const currentTimeSec = video.currentTime;
  const paused = video.paused;
  const ended = video.ended;

  // 3) tick カウンタを単調増加させる（ログ出力の間引き判定にも使う）
  tickCount += 1;

  // 4) tick 初回開始から 60 秒はウォームアップとして監視処理をスキップする（ログを出して early return）
  if (firstTickAtMs === undefined) {
    firstTickAtMs = nowMs;
  }
  if (nowMs - firstTickAtMs < WARMUP_SKIP_MS) {
    // スキップ期間中も基準は更新しておく（スキップ明けに誤検知しないため）
    lastObservedCurrentTimeSec = currentTimeSec;
    lastTimeChangeAtMs = nowMs;

    const remainingMs = Math.max(0, WARMUP_SKIP_MS - (nowMs - firstTickAtMs));
    // eslint-disable-next-line no-console
    console.log(
      `[nico-keepalive/content] warmup: モニターをスキップします (残り ${Math.ceil(
        remainingMs / 1000,
      )} 秒)`,
    );
    return;
  }

  // デバッグ: 毎 tick の状態を出力（currentTime / paused / ended）
  // eslint-disable-next-line no-console
  console.log(
    `[nico-keepalive/content] currentTime=${currentTimeSec.toFixed(
      2,
    )} paused=${paused} ended=${ended}`,
  );

  // 5) 一定間隔でログを出す（paused/ended 中は除外）
  if (!paused && !ended && tickCount % 20 === 0) {
    logInfo(`モニターしています...`);
  }

  // 6) 一時停止/終了中は「停止」と誤検知しないよう、
  //    監視基準（currentTime / 最終変化時刻）をリセットして終了する
  if (paused || ended) {
    lastObservedCurrentTimeSec = currentTimeSec;
    lastTimeChangeAtMs = nowMs;
    return;
  }

  // 7) currentTime の変化量を確認して「動いているか」を判定する
  //    - 通常再生（前進）/ シーク（前後ジャンプ）は区別せず、変化していれば "動いている" とみなす
  //    - `Math.abs(delta)` で前進/後退どちらの変化も対象にし、
  //      `TIME_CHANGE_EPSILON_SEC` 未満の微小揺れ（±）はノイズとして無視する
  const deltaSec = currentTimeSec - lastObservedCurrentTimeSec;
  const hasTimeMoved = Math.abs(deltaSec) > TIME_CHANGE_EPSILON_SEC;
  if (hasTimeMoved) {
    lastObservedCurrentTimeSec = currentTimeSec;
    lastTimeChangeAtMs = nowMs;
    return;
  }

  // 8) 一定時間 currentTime が変わらなければ「停止」とみなす（閾値内なら何もしない）
  const isWithinStallThreshold = nowMs - lastTimeChangeAtMs < NO_TIME_CHANGE_THRESHOLD_MS;
  if (isWithinStallThreshold) {
    return;
  }

  // 9) 停止確定: カウントダウン〜通知〜リロードは handleStall に委譲
  handleStall(nowMs);
}

function handleStall(now: number) {
  // Avoid re-triggering while countdown is active
  if (countdownTimer) return;

  // ページをリロードすると content script 自体が再インジェクトされるため、
  // ここでは単発リロードだけを実行する。

  void saveFullscreenStateBeforeReload();
  logInfo("映像停止を検知、5秒後にリロードします");
  playReloadSound();
  showCountdown(COUNTDOWN_MS);
  countdownTimer = window.setTimeout(() => {
    logInfo("リロードを実行します");
    window.location.reload();
  }, COUNTDOWN_MS);

  // リロード実行までの間に再検知しないよう、進行基準を現在時刻でリセット
  lastTimeChangeAtMs = now;
}

function clearCountdown() {
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = undefined;
  }
}

function getCurrentSettings(): Settings {
  return {
    enabled,
    soundEnabled,
    soundVolume,
    customSound,
  };
}

function playReloadSound() {
  const settings = getCurrentSettings();
  playNotificationSound(settings, {
    onError: (err) => logWarn(`通知音の再生に失敗しました: ${String(err)}`),
  });
}

function showCountdown(durationMs: number) {
  const toast = ensureToast();
  const start = Date.now();

  const update = () => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, durationMs - elapsed);
    toast.textContent = `配信停止を検知: ${Math.ceil(remaining / 1000)} 秒後にリロードします`;
    if (remaining > 0) {
      requestAnimationFrame(update);
    }
  };
  update();
}

function ensureToast(): HTMLDivElement {
  const existing = document.getElementById(TOAST_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const div = document.createElement("div");
  div.id = TOAST_ID;
  div.style.position = "fixed";
  div.style.left = "16px";
  div.style.top = "16px";
  div.style.transform = "none";
  div.style.padding = "10px 14px";
  div.style.background = "rgba(0, 0, 0, 0.8)";
  div.style.color = "#fff";
  div.style.fontSize = "14px";
  div.style.borderRadius = "8px";
  div.style.zIndex = "999999";
  div.style.boxShadow = "0 6px 16px rgba(0,0,0,0.35)";
  div.style.pointerEvents = "none";
  document.body.appendChild(div);
  return div;
}

function hideToast() {
  const existing = document.getElementById(TOAST_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
}

function cleanupProgramStates(map: ProgramStateMap, now: number): ProgramStateMap {
  const cleaned: ProgramStateMap = {};
  Object.entries(map).forEach(([programId, state]) => {
    const updatedAt = typeof state?.updatedAt === "number" ? state.updatedAt : 0;
    if (updatedAt === 0) return;
    if (now - updatedAt <= PROGRAM_STATE_TTL_MS) {
      cleaned[programId] = state;
    }
  });
  return cleaned;
}

function waitForLoadEvent(): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryRestoreFullscreenWithRetry(
  maxAttempts: number,
  intervalMs: number,
): Promise<{ toggled: boolean; succeeded: boolean }> {
  for (let i = 0; i < maxAttempts; i += 1) {
    // ボタンが生成されるまで一定回数待つ
    const clicked = toggleFullscreen();
    if (clicked) {
      return { toggled: true, succeeded: true };
    }

    if (i < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }

  return { toggled: false, succeeded: false };
}

async function saveFullscreenStateBeforeReload() {
  const programId = currentProgramId();
  if (!programId) return;
  try {
    const now = Date.now();
    await updateProgramStateMap((map) => {
      const cleaned = cleanupProgramStates(map, now);
      cleaned[programId] = {
        ...(cleaned[programId] ?? {}),
        fullscreen: isFullscreen(),
        updatedAt: now,
      };
      return { map: cleaned };
    });
    // eslint-disable-next-line no-console
    console.log(`[nico-keepalive/content] saved fullscreen state for ${programId}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[nico-keepalive/content] failed to save fullscreen state", err);
  }
}

async function restoreFullscreenAfterReload() {
  const programId = currentProgramId();
  if (!programId) return;
  try {
    await waitForLoadEvent();
    const now = Date.now();
    const fullscreenNeeded = await updateProgramStateMap((map) => {
      const cleaned = cleanupProgramStates(map, now);
      const state = cleaned[programId];
      delete cleaned[programId];
      return { map: cleaned, result: state?.fullscreen === true };
    });

    let toggled = false;
    let succeeded = false;
    if (fullscreenNeeded) {
      const result = await tryRestoreFullscreenWithRetry(5, 500);
      toggled = result.toggled;
      succeeded = result.succeeded;

      if (succeeded) {
        await sleep(500);
        document.body?.focus();
        simulateMouseEnterLeave();
      }
    } else {
      succeeded = true;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[nico-keepalive/content] restore fullscreen for ${programId}: requested=${fullscreenNeeded} toggled=${toggled} succeeded=${succeeded}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[nico-keepalive/content] failed to restore fullscreen state", err);
  }
}

function simulateMouseEnterLeave() {
  const centerX = Math.round(window.innerWidth / 2);
  const centerY = Math.round(window.innerHeight / 2);

  document.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, clientX: centerX, clientY: centerY }),
  );

  setTimeout(() => {
    document.dispatchEvent(
      new MouseEvent("mouseleave", { bubbles: false, clientX: -5, clientY: -5 }),
    );
  }, 100);
}

function currentProgramId(): string | undefined {
  // lv: 通常の番組 ID, ch: チャンネル配信などで現れる ID
  const m = window.location.pathname.match(/^\/watch\/((?:lv|ch)\d+)/);
  return m ? m[1] : undefined;
}

function log(level: "INFO" | "WARN" | "ERROR", message: string) {
  const context = currentProgramId();
  const contextPart = context ? `[${context}] ` : "";
  const providerPart = providerName ? `[${providerName}] ` : "";
  const text = `${contextPart}${providerPart}${message}`;
  pushLog({ level, message, context, providerName });
  // eslint-disable-next-line no-console
  console.log(`[nico-keepalive/content] ${text}`);
}

const logInfo = (m: string) => log("INFO", m);
const logWarn = (m: string) => log("WARN", m);

// Respond to popup toggling enabled flag
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const next = changes.settings.newValue as Settings | undefined;
  if (!next) return;

  const wasEnabled = enabled;
  applySettings(next);
  refreshProgramMeta();

  if (wasEnabled !== enabled) {
    if (enabled) {
      if (!isOnAir) {
        logInfo("モニターをスキップします (Offline)");
        return;
      }
      logInfo("拡張が有効化されました");
      startMonitor();
    } else {
      logInfo("拡張が無効化されました");
      stopMonitor();
    }
  }
});

if (__DEV__) {
  // Debug: Ctrl+T でテスト用トーストを出す
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "t") {
      const toast = ensureToast();
      toast.textContent = "デバッグ: トースト表示の確認";
      setTimeout(hideToast, 3000);
    }
  });

  // Debug: Ctrl+D でフルスク状態をログ出力、Ctrl+F でフルスクをトグル
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === "d") {
      console.log(`[nico-keepalive/dev] fullscreen=${isFullscreen()}`);
    } else if (key === "f") {
      const toggled = toggleFullscreen();
      console.log(`[nico-keepalive/dev] fullscreen toggled=${toggled} now=${isFullscreen()}`);
    }
  });

  // Ctrl+R で停止シミュレート（入力中は無効）
  window.addEventListener("keydown", (e) => {
    const target = e.target;
    const isInputting =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.getAttribute("contenteditable") === "true");

    if (!isInputting && e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "r") {
      // 拡張無効時はスキップ
      if (!enabled) return;
      logInfo("Ctrl+R 入力による停止シミュレーションを実行します");
      handleStall(Date.now());
    }
  });
}

init();
