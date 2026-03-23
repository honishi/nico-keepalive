import { createMonitorRunner } from "../content/monitor-runner";
import type { MonitorRuntimeSettings, StallReason } from "../content/types";
import { isFullscreen, toggleFullscreen } from "../shared/fullscreen";
import { parseProgramMetaFromDocument } from "../shared/program-meta";
import { DEEP_CHECK_THRESHOLD_DEFAULT_SEC, normalizeSettings } from "../shared/settings";
import { playNotificationSound } from "../shared/sound";
import {
  getSettings,
  incrementReloadCount,
  pushLog,
  updateProgramStateMap,
} from "../shared/storage";
import { type LogLevel, type ProgramStateMap, type Settings } from "../shared/types";

declare const __DEV__: boolean;

const COUNTDOWN_MS = 5_000;
const TOAST_ID = "nico-keepalive-toast";
const PROGRAM_STATE_TTL_MS = 24 * 60 * 60 * 1000;

let currentSettings: Settings = normalizeSettings();
let countdownTimer: number | undefined;
let providerName: string | undefined;
let isOnAir = false;

function currentProgramId(): string | undefined {
  const match = window.location.pathname.match(/^\/watch\/((?:lv|ch)\d+)/);
  return match ? match[1] : undefined;
}

function log(level: LogLevel, message: string) {
  const context = currentProgramId();
  const contextPart = context ? `[${context}] ` : "";
  const providerPart = providerName ? `[${providerName}] ` : "";
  const text = `${contextPart}${providerPart}${message}`;
  pushLog({ level, message, context, providerName });
  // eslint-disable-next-line no-console
  console.log(`[nico-keepalive/content] ${text}`);
}

function logInfo(message: string) {
  log("INFO", message);
}

function logDebug(message: string) {
  log("DEBUG", message);
}

function logWarn(message: string) {
  log("WARN", message);
}

function logTrace(message: string) {
  // eslint-disable-next-line no-console
  console.log(`[nico-keepalive/content] ${message}`);
}

const monitorRunner = createMonitorRunner({
  initialSettings: toMonitorRuntimeSettings(currentSettings),
  onStall: (reason, nowMs) => handleStall(nowMs, reason),
  logger: {
    debug: logDebug,
    warn: logWarn,
    trace: logTrace,
  },
  getProgramContext: () => ({
    programId: currentProgramId(),
    providerName,
  }),
});

async function init() {
  await restoreFullscreenAfterReload();
  const settings = await getSettings();
  applySettings(settings);
  refreshProgramMeta();
  if (!isOnAir) {
    logInfo("モニターをスキップします (Off-air)");
    return;
  }
  if (!currentSettings.enabled) {
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
    isOnAir = false;
    // eslint-disable-next-line no-console
    console.warn("放送者情報の取得に失敗しました", err);
  }
}

function applySettings(settings: Settings) {
  currentSettings = normalizeSettings(settings);
  monitorRunner.updateSettings(toMonitorRuntimeSettings(currentSettings));
}

function toMonitorRuntimeSettings(settings: Settings): MonitorRuntimeSettings {
  return {
    enabled: settings.enabled,
    deepCheckModeEnabled: settings.deepCheckModeEnabled ?? false,
    deepCheckThresholdMs:
      (settings.deepCheckThresholdSec ?? DEEP_CHECK_THRESHOLD_DEFAULT_SEC) * 1000,
    monitorOverlayEnabled: settings.monitorOverlayEnabled ?? false,
    debugWarmupEnabled: settings.debugWarmupEnabled ?? true,
    debugCurrentTimeCheckEnabled: settings.debugCurrentTimeCheckEnabled ?? true,
    debugDeepCheckEnabled: settings.debugDeepCheckEnabled ?? true,
  };
}

function startMonitor() {
  monitorRunner.start();
  logInfo("モニターを開始しました");
}

function stopMonitor() {
  monitorRunner.stop();
  clearCountdown();
  hideToast();
  logInfo("モニターを停止しました");
}

function handleStall(nowMs: number, reason: StallReason): boolean {
  if (countdownTimer) return false;

  void saveFullscreenStateBeforeReload();
  logInfo(
    reason === "deepCheck"
      ? `高度な停止チェックにより配信停止を検知しました（映像変化なし・無音）、${Math.ceil(
          COUNTDOWN_MS / 1000,
        )}秒後にリロードします`
      : `映像停止を検知、${Math.ceil(COUNTDOWN_MS / 1000)}秒後にリロードします`,
  );
  playReloadSound();
  showCountdown(COUNTDOWN_MS, reason);
  countdownTimer = window.setTimeout(() => {
    void (async () => {
      logInfo("リロードを実行します");
      try {
        await incrementReloadCount();
      } catch (err) {
        logWarn(`自動リロード回数の更新に失敗しました: ${String(err)}`);
      }
      window.location.reload();
    })();
  }, COUNTDOWN_MS);

  return true;
}

function clearCountdown() {
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = undefined;
  }
}

function playReloadSound() {
  playNotificationSound(currentSettings, {
    onError: (err) => logWarn(`通知音の再生に失敗しました: ${String(err)}`),
  });
}

function showCountdown(durationMs: number, reason: StallReason) {
  const toast = ensureToast();
  const start = Date.now();

  const update = () => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, durationMs - elapsed);
    toast.textContent =
      reason === "deepCheck"
        ? `映像・音声の停止を検知: ${Math.ceil(remaining / 1000)} 秒後にリロードします`
        : `再生の停止を検知: ${Math.ceil(remaining / 1000)} 秒後にリロードします`;
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
  div.style.left = "50%";
  div.style.top = "50%";
  div.style.transform = "translate(-50%, -50%)";
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

function cleanupProgramStates(map: ProgramStateMap, nowMs: number): ProgramStateMap {
  const cleaned: ProgramStateMap = {};
  Object.entries(map).forEach(([programId, state]) => {
    const updatedAt = typeof state?.updatedAt === "number" ? state.updatedAt : 0;
    if (updatedAt === 0) return;
    if (nowMs - updatedAt <= PROGRAM_STATE_TTL_MS) {
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
    const nowMs = Date.now();
    await updateProgramStateMap((map) => {
      const cleaned = cleanupProgramStates(map, nowMs);
      cleaned[programId] = {
        ...(cleaned[programId] ?? {}),
        fullscreen: isFullscreen(),
        updatedAt: nowMs,
      };
      return { map: cleaned };
    });
    logTrace(`saved fullscreen state for ${programId}`);
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
    const nowMs = Date.now();
    const fullscreenNeeded = await updateProgramStateMap((map) => {
      const cleaned = cleanupProgramStates(map, nowMs);
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
        simulateMouseEnterLeave();
      }
    } else {
      succeeded = true;
    }

    logTrace(
      `restore fullscreen for ${programId}: requested=${fullscreenNeeded} toggled=${toggled} succeeded=${succeeded}`,
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const next = changes.settings.newValue as Settings | undefined;
  if (!next) return;

  const wasEnabled = currentSettings.enabled;
  applySettings(next);
  refreshProgramMeta();

  if (wasEnabled !== currentSettings.enabled) {
    if (currentSettings.enabled) {
      if (!isOnAir) {
        logInfo("モニターをスキップします (Off-air)");
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
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "t") {
      const toast = ensureToast();
      toast.textContent = "デバッグ: トースト表示の確認";
      setTimeout(hideToast, 3000);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "d") {
      // eslint-disable-next-line no-console
      console.log(`[nico-keepalive/dev] fullscreen=${isFullscreen()}`);
    } else if (key === "f") {
      const toggled = toggleFullscreen();
      // eslint-disable-next-line no-console
      console.log(`[nico-keepalive/dev] fullscreen toggled=${toggled} now=${isFullscreen()}`);
    }
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isInputting =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.getAttribute("contenteditable") === "true");

    if (
      !isInputting &&
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key.toLowerCase() === "r"
    ) {
      if (!currentSettings.enabled) return;
      logInfo("Ctrl+R 入力による停止シミュレーションを実行します");
      handleStall(Date.now(), "currentTime");
    }
  });
}

void init();
