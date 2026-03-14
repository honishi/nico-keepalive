import {
  createDeepCheckState,
  DEEP_CHECK_FRAME_HEIGHT,
  DEEP_CHECK_FRAME_WIDTH,
  getFrameAverageDiff,
  getTimeDomainRms,
  hasFrameMeaningfulChange,
  isSilentFromTimeDomainData,
  reduceDeepCheckState,
} from "../shared/deep-check";
import { playNotificationSound } from "../shared/sound";
import { normalizeSettings } from "../shared/settings";
import { parseProgramMetaFromDocument } from "../shared/program-meta";
import { CustomSound, LogLevel, ProgramStateMap, Settings } from "../shared/types";
import {
  getSettings,
  incrementReloadCount,
  pushLog,
  updateProgramStateMap,
} from "../shared/storage";
import { isFullscreen, toggleFullscreen } from "../shared/fullscreen";

declare const __DEV__: boolean;

const TICK_INTERVAL_MS = 5_000;
const WARMUP_SKIP_MS = 60_000; // tick 初回開始からこの時間は監視処理をスキップする
const NO_TIME_CHANGE_THRESHOLD_MS = 20_000; // currentTime が変化しない状態がこの時間続くと停止扱い
const TIME_CHANGE_EPSILON_SEC = 0.01; // currentTime の微小揺れ（±）をノイズとして無視するための閾値
const COUNTDOWN_MS = 5_000;
const TOAST_ID = "nico-keepalive-toast";
const MONITOR_DEBUG_PANEL_ID = "nico-keepalive-monitor-debug";
const PROGRAM_STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

let enabled = true;
let deepCheckModeEnabled = false;
let deepCheckThresholdMs = 2 * 60 * 1000;
let monitorDebugOverlayEnabled = false;
let debugWarmupEnabled = true;
let debugCurrentTimeCheckEnabled = true;
let debugDeepCheckEnabled = true;
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
let deepCheckState = createDeepCheckState();
let deepCheckCanvas: HTMLCanvasElement | null = null;
let deepCheckCanvasContext: CanvasRenderingContext2D | null = null;
let deepCheckLastFrame: Uint8ClampedArray | null = null;
let deepCheckAudioContext: AudioContext | null = null;
let deepCheckAnalyser: AnalyserNode | null = null;
let deepCheckAudioData: Uint8Array | null = null;
let deepCheckAudioSource: MediaStreamAudioSourceNode | null = null;
let deepCheckAudioStream: MediaStream | null = null;
let deepCheckSourceVideo: HTMLVideoElement | null = null;
let deepCheckAvailable = true;
let deepCheckFallbackLogged = false;

type DeepCheckSample = {
  visualEligible: boolean;
  frameChanged: boolean;
  audioEligible: boolean;
  audioSilent: boolean;
  frameAverageDiff?: number;
  audioRms?: number;
  previousFrame?: Uint8ClampedArray | null;
  nextFrame?: Uint8ClampedArray | null;
};

type DeepCheckEvaluation = {
  stalled: boolean;
  visual: Pick<
    DeepCheckSample,
    "visualEligible" | "frameChanged" | "frameAverageDiff" | "previousFrame" | "nextFrame"
  >;
  audio: Pick<DeepCheckSample, "audioEligible" | "audioSilent" | "audioRms">;
};

type NormalCheckDebugSnapshot = {
  currentTimeSec: number;
  lastObservedCurrentTimeSec: number;
  deltaSec: number;
  timeMoved: boolean;
  idleSec: number;
  thresholdSec: number;
  epsilonSec: number;
  enabled: boolean;
  stalled: boolean;
  paused: boolean;
  ended: boolean;
};

type AudioContextWithWebkit = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type HTMLVideoElementWithCapture = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

async function init() {
  await restoreFullscreenAfterReload();
  const settings = await getSettings();
  applySettings(settings);
  refreshProgramMeta();
  if (!isOnAir) {
    logInfo("モニターをスキップします (Off-air)");
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
  const normalized = normalizeSettings(settings);
  const wasDeepCheckEnabled = deepCheckModeEnabled;

  enabled = normalized.enabled;
  deepCheckModeEnabled = normalized.deepCheckModeEnabled ?? false;
  deepCheckThresholdMs = (normalized.deepCheckThresholdSec ?? 120) * 1000;
  monitorDebugOverlayEnabled = normalized.monitorDebugOverlayEnabled ?? false;
  debugWarmupEnabled = normalized.debugWarmupEnabled ?? true;
  debugCurrentTimeCheckEnabled = normalized.debugCurrentTimeCheckEnabled ?? true;
  debugDeepCheckEnabled = normalized.debugDeepCheckEnabled ?? true;
  soundEnabled = normalized.soundEnabled ?? true;
  soundVolume = normalized.soundVolume ?? 100;
  customSound = normalized.customSound ?? null;

  if (wasDeepCheckEnabled && !deepCheckModeEnabled) {
    cleanupDeepCheckResources();
    resetDeepCheckMonitoringState();
    hideMonitorDebugOverlay();
    return;
  }

  if (!wasDeepCheckEnabled && deepCheckModeEnabled) {
    cleanupDeepCheckResources();
    resetDeepCheckModeAvailability();
  }

  if (!monitorDebugOverlayEnabled) {
    hideMonitorDebugOverlay();
  }
}

function startMonitor() {
  if (monitorTimer) return;
  if (deepCheckModeEnabled) {
    resetDeepCheckModeAvailability();
  }
  monitorTimer = window.setInterval(tick, TICK_INTERVAL_MS);
  logInfo("モニターを開始しました");
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = undefined;
  }
  cleanupDeepCheckResources();
  resetDeepCheckMonitoringState();
  hideMonitorDebugOverlay();
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
  const previousObservedCurrentTimeSec = lastObservedCurrentTimeSec;
  const previousTimeChangeAtMs = lastTimeChangeAtMs;

  // 3) tick カウンタを単調増加させる（ログ出力の間引き判定にも使う）
  tickCount += 1;

  // 4) tick 初回開始から 60 秒はウォームアップとして監視処理をスキップする（ログを出して early return）
  if (firstTickAtMs === undefined) {
    firstTickAtMs = nowMs;
  }
  if (debugWarmupEnabled && nowMs - firstTickAtMs < WARMUP_SKIP_MS) {
    const normalCheck = createNormalCheckDebugSnapshot({
      currentTimeSec,
      lastObservedCurrentTimeSec: previousObservedCurrentTimeSec,
      nowMs,
      lastTimeChangeAtMs: previousTimeChangeAtMs,
      enabled: debugCurrentTimeCheckEnabled,
      paused,
      ended,
      stalled: false,
    });

    // スキップ期間中も基準は更新しておく（スキップ明けに誤検知しないため）
    lastObservedCurrentTimeSec = currentTimeSec;
    lastTimeChangeAtMs = nowMs;
    const remainingMs = Math.max(0, WARMUP_SKIP_MS - (nowMs - firstTickAtMs));

    const deepCheck =
      deepCheckModeEnabled && debugDeepCheckEnabled
        ? evaluateDeepCheck(video, nowMs, {
            inWarmup: true,
            warmupRemainingMs: remainingMs,
          })
        : null;
    updateMonitorDebugOverlay(video, nowMs, {
      inWarmup: true,
      warmupRemainingMs: remainingMs,
      normalCheck,
      deepCheck,
    });

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
    logDebug("モニターしています...");
  }

  // 6) 一時停止/終了中は「停止」と誤検知しないよう、
  //    監視基準（currentTime / 最終変化時刻）をリセットして終了する
  if (paused || ended) {
    lastObservedCurrentTimeSec = currentTimeSec;
    lastTimeChangeAtMs = nowMs;
    resetDeepCheckMonitoringState();
    updateMonitorDebugOverlay(video, nowMs, {
      normalCheck: createNormalCheckDebugSnapshot({
        currentTimeSec,
        lastObservedCurrentTimeSec: previousObservedCurrentTimeSec,
        nowMs,
        lastTimeChangeAtMs: nowMs,
        enabled: debugCurrentTimeCheckEnabled,
        paused,
        ended,
        stalled: false,
      }),
      deepCheck: null,
    });
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
  }

  // 8) 一定時間 currentTime が変わらなければ「停止」とみなす（閾値内なら何もしない）
  const isCurrentTimeStalled =
    debugCurrentTimeCheckEnabled &&
    !hasTimeMoved &&
    nowMs - lastTimeChangeAtMs >= NO_TIME_CHANGE_THRESHOLD_MS;
  const normalCheck = createNormalCheckDebugSnapshot({
    currentTimeSec,
    lastObservedCurrentTimeSec: previousObservedCurrentTimeSec,
    nowMs,
    lastTimeChangeAtMs: hasTimeMoved ? nowMs : previousTimeChangeAtMs,
    enabled: debugCurrentTimeCheckEnabled,
    paused,
    ended,
    stalled: isCurrentTimeStalled,
  });
  if (isCurrentTimeStalled) {
    handleStall(nowMs, "currentTime");
    return;
  }

  // 9) 追加判定: deep check mode が有効なときだけ、映像変化なし + 無音を確認する
  const deepCheck =
    deepCheckModeEnabled && debugDeepCheckEnabled ? evaluateDeepCheck(video, nowMs) : null;

  if (deepCheck?.stalled) {
    handleStall(nowMs, "deepCheck");
  }

  updateMonitorDebugOverlay(video, nowMs, { normalCheck, deepCheck });
}

function createNormalCheckDebugSnapshot(args: {
  currentTimeSec: number;
  lastObservedCurrentTimeSec: number;
  nowMs: number;
  lastTimeChangeAtMs: number;
  enabled: boolean;
  paused: boolean;
  ended: boolean;
  stalled: boolean;
}): NormalCheckDebugSnapshot {
  const deltaSec = args.currentTimeSec - args.lastObservedCurrentTimeSec;

  return {
    currentTimeSec: args.currentTimeSec,
    lastObservedCurrentTimeSec: args.lastObservedCurrentTimeSec,
    deltaSec,
    timeMoved: Math.abs(deltaSec) > TIME_CHANGE_EPSILON_SEC,
    idleSec: Math.max(0, (args.nowMs - args.lastTimeChangeAtMs) / 1000),
    thresholdSec: NO_TIME_CHANGE_THRESHOLD_MS / 1000,
    epsilonSec: TIME_CHANGE_EPSILON_SEC,
    enabled: args.enabled,
    stalled: args.stalled,
    paused: args.paused,
    ended: args.ended,
  };
}

function handleStall(now: number, reason: "currentTime" | "deepCheck") {
  // Avoid re-triggering while countdown is active
  if (countdownTimer) return;

  // ページをリロードすると content script 自体が再インジェクトされるため、
  // ここでは単発リロードだけを実行する。

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

  // リロード実行までの間に再検知しないよう、進行基準を現在時刻でリセット
  lastTimeChangeAtMs = now;
}

function resetDeepCheckMonitoringState() {
  deepCheckState = createDeepCheckState();
  deepCheckLastFrame = null;
}

function resetDeepCheckModeAvailability() {
  deepCheckAvailable = true;
  deepCheckFallbackLogged = false;
  resetDeepCheckMonitoringState();
}

function cleanupDeepCheckResources() {
  deepCheckCanvas = null;
  deepCheckCanvasContext = null;
  deepCheckLastFrame = null;
  deepCheckAudioData = null;
  deepCheckSourceVideo = null;
  deepCheckAudioStream = null;

  if (deepCheckAudioSource) {
    deepCheckAudioSource.disconnect();
    deepCheckAudioSource = null;
  }

  if (deepCheckAnalyser) {
    deepCheckAnalyser.disconnect();
    deepCheckAnalyser = null;
  }

  if (deepCheckAudioContext) {
    void deepCheckAudioContext.close().catch(() => undefined);
    deepCheckAudioContext = null;
  }
}

function disableDeepCheck(reason: string) {
  cleanupDeepCheckResources();
  resetDeepCheckMonitoringState();
  deepCheckAvailable = false;

  if (!deepCheckFallbackLogged) {
    deepCheckFallbackLogged = true;
    logWarn(`deep check mode を無効化しました: ${reason}. 通常判定にフォールバックします`);
  }
}

function ensureDeepCheckCanvas(): boolean {
  if (deepCheckCanvas && deepCheckCanvasContext) {
    return true;
  }

  deepCheckCanvas = document.createElement("canvas");
  deepCheckCanvas.width = DEEP_CHECK_FRAME_WIDTH;
  deepCheckCanvas.height = DEEP_CHECK_FRAME_HEIGHT;
  deepCheckCanvasContext = deepCheckCanvas.getContext("2d", { willReadFrequently: true });

  if (!deepCheckCanvasContext) {
    disableDeepCheck("canvas 2d context を初期化できませんでした");
    return false;
  }

  return true;
}

function ensureDeepCheckAudio(video: HTMLVideoElement): boolean {
  if (deepCheckSourceVideo && deepCheckSourceVideo !== video) {
    cleanupDeepCheckResources();
    resetDeepCheckMonitoringState();
  }

  if (
    deepCheckAudioContext &&
    deepCheckAnalyser &&
    deepCheckAudioData &&
    deepCheckAudioSource &&
    deepCheckSourceVideo === video
  ) {
    return true;
  }

  const AudioContextCtor =
    window.AudioContext ?? (window as AudioContextWithWebkit).webkitAudioContext;
  const videoWithCapture = video as HTMLVideoElementWithCapture;
  const captureStream =
    videoWithCapture.captureStream?.bind(videoWithCapture) ??
    videoWithCapture.mozCaptureStream?.bind(videoWithCapture);

  if (!AudioContextCtor) {
    disableDeepCheck("AudioContext を利用できませんでした");
    return false;
  }

  if (!captureStream) {
    disableDeepCheck("captureStream を利用できませんでした");
    return false;
  }

  try {
    deepCheckAudioStream = captureStream();
    const hasAudioTrack = deepCheckAudioStream.getAudioTracks().length > 0;
    if (!hasAudioTrack) {
      disableDeepCheck("音声トラックを取得できませんでした");
      return false;
    }

    deepCheckAudioContext = new AudioContextCtor();
    deepCheckAnalyser = deepCheckAudioContext.createAnalyser();
    deepCheckAnalyser.fftSize = 2048;
    deepCheckAudioData = new Uint8Array(new ArrayBuffer(deepCheckAnalyser.fftSize));
    deepCheckAudioSource = deepCheckAudioContext.createMediaStreamSource(deepCheckAudioStream);
    deepCheckAudioSource.connect(deepCheckAnalyser);
    deepCheckSourceVideo = video;
    return true;
  } catch (err) {
    disableDeepCheck(`音声解析の初期化に失敗しました: ${String(err)}`);
    return false;
  }
}

function sampleDeepCheckFrame(
  video: HTMLVideoElement,
): Pick<
  DeepCheckSample,
  "visualEligible" | "frameChanged" | "frameAverageDiff" | "previousFrame" | "nextFrame"
> {
  if (!ensureDeepCheckCanvas()) {
    return { visualEligible: false, frameChanged: false };
  }

  if (video.videoWidth === 0 || video.videoHeight === 0 || !deepCheckCanvasContext) {
    return { visualEligible: false, frameChanged: false };
  }

  try {
    deepCheckCanvasContext.drawImage(video, 0, 0, DEEP_CHECK_FRAME_WIDTH, DEEP_CHECK_FRAME_HEIGHT);
    const imageData = deepCheckCanvasContext.getImageData(
      0,
      0,
      DEEP_CHECK_FRAME_WIDTH,
      DEEP_CHECK_FRAME_HEIGHT,
    );
    const nextFrame = new Uint8ClampedArray(imageData.data);
    const previousFrame = deepCheckLastFrame ? new Uint8ClampedArray(deepCheckLastFrame) : null;
    const frameAverageDiff = previousFrame ? getFrameAverageDiff(previousFrame, nextFrame) : 0;
    const frameChanged = hasFrameMeaningfulChange(previousFrame, nextFrame);
    deepCheckLastFrame = nextFrame;
    return {
      visualEligible: true,
      frameChanged,
      frameAverageDiff,
      previousFrame,
      nextFrame,
    };
  } catch (err) {
    disableDeepCheck(`映像フレームを読み取れませんでした: ${String(err)}`);
    return { visualEligible: false, frameChanged: false };
  }
}

function sampleDeepCheckAudio(
  video: HTMLVideoElement,
): Pick<DeepCheckSample, "audioEligible" | "audioSilent" | "audioRms"> {
  if (video.muted || video.volume === 0) {
    return { audioEligible: false, audioSilent: false };
  }

  if (!ensureDeepCheckAudio(video)) {
    return { audioEligible: false, audioSilent: false };
  }

  if (!deepCheckAudioContext || !deepCheckAnalyser || !deepCheckAudioData) {
    return { audioEligible: false, audioSilent: false };
  }

  if (deepCheckAudioContext.state !== "running") {
    void deepCheckAudioContext.resume().catch(() => undefined);
    return { audioEligible: false, audioSilent: false };
  }

  try {
    const audioData = new Uint8Array(new ArrayBuffer(deepCheckAudioData.length));
    deepCheckAnalyser.getByteTimeDomainData(audioData);
    deepCheckAudioData = audioData;
    const audioRms = getTimeDomainRms(audioData);
    return {
      audioEligible: true,
      audioSilent: isSilentFromTimeDomainData(audioData),
      audioRms,
    };
  } catch (err) {
    disableDeepCheck(`音声レベルを読み取れませんでした: ${String(err)}`);
    return { audioEligible: false, audioSilent: false };
  }
}

function evaluateDeepCheck(
  video: HTMLVideoElement,
  nowMs: number,
  options?: {
    inWarmup?: boolean;
    warmupRemainingMs?: number;
  },
): DeepCheckEvaluation | null {
  if (!deepCheckModeEnabled || !deepCheckAvailable) {
    return null;
  }

  const visual = sampleDeepCheckFrame(video);
  const audio = sampleDeepCheckAudio(video);

  if (!deepCheckAvailable) {
    return null;
  }

  const result = reduceDeepCheckState(
    deepCheckState,
    {
      nowMs,
      inWarmup: options?.inWarmup === true,
      paused: false,
      ended: false,
      visualEligible: visual.visualEligible,
      frameChanged: visual.frameChanged,
      audioEligible: audio.audioEligible,
      audioSilent: audio.audioSilent,
    },
    deepCheckThresholdMs,
  );

  deepCheckState = result.state;
  logDeepCheckMetrics(video, visual, audio, result.stalled, nowMs);
  return {
    visual,
    audio,
    stalled: options?.inWarmup === true ? false : result.stalled,
  };
}

function logDeepCheckMetrics(
  video: HTMLVideoElement,
  visual: Pick<
    DeepCheckSample,
    "visualEligible" | "frameChanged" | "frameAverageDiff" | "previousFrame" | "nextFrame"
  >,
  audio: Pick<DeepCheckSample, "audioEligible" | "audioSilent" | "audioRms">,
  stalled: boolean,
  nowMs: number,
) {
  const visualIdleSec = ((nowMs - deepCheckState.lastVisualChangeAtMs) / 1000).toFixed(1);
  const audioIdleSec = ((nowMs - deepCheckState.lastAudioActiveAtMs) / 1000).toFixed(1);
  const frameDiffText =
    typeof visual.frameAverageDiff === "number" ? visual.frameAverageDiff.toFixed(2) : "n/a";
  const audioRmsText = typeof audio.audioRms === "number" ? audio.audioRms.toFixed(2) : "n/a";
  const context = currentProgramId();
  const contextPart = context ? `[${context}] ` : "";
  const providerPart = providerName ? `[${providerName}] ` : "";
  const message = [
    "deep check",
    `frameDiff=${frameDiffText}`,
    `frameChanged=${visual.frameChanged}`,
    `visualEligible=${visual.visualEligible}`,
    `visualIdleSec=${visualIdleSec}`,
    `audioRms=${audioRmsText}`,
    `audioSilent=${audio.audioSilent}`,
    `audioEligible=${audio.audioEligible}`,
    `audioIdleSec=${audioIdleSec}`,
    `thresholdSec=${Math.round(deepCheckThresholdMs / 1000)}`,
    `muted=${video.muted}`,
    `volume=${video.volume.toFixed(2)}`,
    `stalled=${stalled}`,
  ].join(" ");

  // eslint-disable-next-line no-console
  console.log(`[nico-keepalive/content] ${contextPart}${providerPart}${message}`);
}

function hideMonitorDebugOverlay() {
  const existing = document.getElementById(MONITOR_DEBUG_PANEL_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
}

function ensureMonitorDebugOverlay(): {
  root: HTMLDivElement;
  previousCanvas: HTMLCanvasElement;
  currentCanvas: HTMLCanvasElement;
  headerStats: HTMLPreElement;
  normalStats: HTMLPreElement;
  deepStats: HTMLPreElement;
} | null {
  if (!monitorDebugOverlayEnabled) return null;

  const existing = document.getElementById(MONITOR_DEBUG_PANEL_ID);
  if (existing instanceof HTMLDivElement) {
    const previousCanvas = existing.querySelector(
      "[data-role='previous']",
    ) as HTMLCanvasElement | null;
    const currentCanvas = existing.querySelector(
      "[data-role='current']",
    ) as HTMLCanvasElement | null;
    const headerStats = existing.querySelector(
      "[data-role='header-stats']",
    ) as HTMLPreElement | null;
    const normalStats = existing.querySelector(
      "[data-role='normal-stats']",
    ) as HTMLPreElement | null;
    const deepStats = existing.querySelector("[data-role='deep-stats']") as HTMLPreElement | null;
    if (previousCanvas && currentCanvas && headerStats && normalStats && deepStats) {
      return { root: existing, previousCanvas, currentCanvas, headerStats, normalStats, deepStats };
    }
  }

  const root = document.createElement("div");
  root.id = MONITOR_DEBUG_PANEL_ID;
  root.style.position = "fixed";
  root.style.right = "16px";
  root.style.top = "16px";
  root.style.zIndex = "999999";
  root.style.padding = "10px";
  root.style.background = "rgba(0, 0, 0, 0.85)";
  root.style.color = "#fff";
  root.style.borderRadius = "8px";
  root.style.fontFamily = "ui-monospace, SFMono-Regular, monospace";
  root.style.fontSize = "11px";
  root.style.lineHeight = "1.4";
  root.style.pointerEvents = "none";
  root.style.maxWidth = "360px";

  const title = document.createElement("div");
  title.textContent = "⚪️ nico-keepalive debug overlay";
  title.style.marginBottom = "8px";
  title.style.fontWeight = "700";

  const headerStats = document.createElement("pre");
  headerStats.dataset.role = "header-stats";
  headerStats.style.margin = "0 0 10px";
  headerStats.style.whiteSpace = "pre-wrap";

  const normalTitle = document.createElement("div");
  normalTitle.textContent = "🔵 normal check";
  normalTitle.style.marginBottom = "4px";
  normalTitle.style.fontWeight = "700";

  const normalStats = document.createElement("pre");
  normalStats.dataset.role = "normal-stats";
  normalStats.style.margin = "0 0 10px";
  normalStats.style.whiteSpace = "pre-wrap";

  const deepTitle = document.createElement("div");
  deepTitle.textContent = "🔵 deep check";
  deepTitle.style.marginBottom = "4px";
  deepTitle.style.fontWeight = "700";

  const canvases = document.createElement("div");
  canvases.style.display = "flex";
  canvases.style.alignItems = "center";
  canvases.style.gap = "8px";
  canvases.style.marginBottom = "8px";

  const previousCanvas = document.createElement("canvas");
  previousCanvas.dataset.role = "previous";
  previousCanvas.width = DEEP_CHECK_FRAME_WIDTH;
  previousCanvas.height = DEEP_CHECK_FRAME_HEIGHT;
  previousCanvas.style.width = "128px";
  previousCanvas.style.height = "72px";
  previousCanvas.style.background = "#111";
  previousCanvas.style.border = "1px solid rgba(255,255,255,0.2)";

  const arrow = document.createElement("div");
  arrow.textContent = "➔";
  arrow.style.color = "rgba(255,255,255,0.7)";
  arrow.style.fontSize = "16px";
  arrow.style.lineHeight = "1";

  const currentCanvas = document.createElement("canvas");
  currentCanvas.dataset.role = "current";
  currentCanvas.width = DEEP_CHECK_FRAME_WIDTH;
  currentCanvas.height = DEEP_CHECK_FRAME_HEIGHT;
  currentCanvas.style.width = "128px";
  currentCanvas.style.height = "72px";
  currentCanvas.style.background = "#111";
  currentCanvas.style.border = "1px solid rgba(255,255,255,0.2)";

  canvases.appendChild(previousCanvas);
  canvases.appendChild(arrow);
  canvases.appendChild(currentCanvas);

  const deepStats = document.createElement("pre");
  deepStats.dataset.role = "deep-stats";
  deepStats.style.margin = "0";
  deepStats.style.whiteSpace = "pre-wrap";

  root.appendChild(title);
  root.appendChild(headerStats);
  root.appendChild(normalTitle);
  root.appendChild(normalStats);
  root.appendChild(deepTitle);
  root.appendChild(canvases);
  root.appendChild(deepStats);
  document.body.appendChild(root);

  return { root, previousCanvas, currentCanvas, headerStats, normalStats, deepStats };
}

function drawFrameThumbnail(
  targetCanvas: HTMLCanvasElement,
  frame: Uint8ClampedArray | null | undefined,
) {
  const context = targetCanvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  if (!frame) {
    context.fillStyle = "#111";
    context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    context.fillStyle = "#999";
    context.font = "6px sans-serif";
    context.fillText("n/a", 2, 8);
    return;
  }

  const imageData = new ImageData(
    new Uint8ClampedArray(frame),
    DEEP_CHECK_FRAME_WIDTH,
    DEEP_CHECK_FRAME_HEIGHT,
  );
  context.putImageData(imageData, 0, 0);
}

function updateMonitorDebugOverlay(
  video: HTMLVideoElement,
  nowMs: number,
  options?: {
    inWarmup?: boolean;
    warmupRemainingMs?: number;
    normalCheck?: NormalCheckDebugSnapshot;
    deepCheck?: DeepCheckEvaluation | null;
  },
) {
  const panel = ensureMonitorDebugOverlay();
  if (!panel) return;

  const deepCheck = options?.deepCheck;
  drawFrameThumbnail(panel.previousCanvas, deepCheck?.visual.previousFrame);
  drawFrameThumbnail(panel.currentCanvas, deepCheck?.visual.nextFrame);

  const visualIdleSec = ((nowMs - deepCheckState.lastVisualChangeAtMs) / 1000).toFixed(1);
  const audioIdleSec = ((nowMs - deepCheckState.lastAudioActiveAtMs) / 1000).toFixed(1);
  const normalCheck = options?.normalCheck;
  panel.headerStats.textContent = `warmup=${options?.inWarmup === true} remainingSec=${
    typeof options?.warmupRemainingMs === "number" ? Math.ceil(options.warmupRemainingMs / 1000) : 0
  }`;
  panel.normalStats.textContent = [
    `currentTime=${normalCheck?.currentTimeSec.toFixed(2) ?? "n/a"} lastObserved=${
      normalCheck?.lastObservedCurrentTimeSec.toFixed(2) ?? "n/a"
    } delta=${normalCheck?.deltaSec.toFixed(2) ?? "n/a"} moved=${normalCheck?.timeMoved ?? false}`,
    `idleSec=${normalCheck?.idleSec.toFixed(1) ?? "n/a"} thresholdSec=${
      normalCheck?.thresholdSec ?? NO_TIME_CHANGE_THRESHOLD_MS / 1000
    } epsilonSec=${normalCheck?.epsilonSec.toFixed(2) ?? TIME_CHANGE_EPSILON_SEC.toFixed(2)}`,
    `enabled=${normalCheck?.enabled ?? false} paused=${normalCheck?.paused ?? false} ended=${
      normalCheck?.ended ?? false
    } stalled=${normalCheck?.stalled ?? false}`,
  ].join("\n");
  panel.deepStats.textContent = [
    `frameDiff=${
      typeof deepCheck?.visual.frameAverageDiff === "number"
        ? deepCheck.visual.frameAverageDiff.toFixed(2)
        : "n/a"
    } changed=${deepCheck?.visual.frameChanged ?? false} eligible=${
      deepCheck?.visual.visualEligible ?? false
    }`,
    `audioRms=${
      typeof deepCheck?.audio.audioRms === "number" ? deepCheck.audio.audioRms.toFixed(2) : "n/a"
    } silent=${deepCheck?.audio.audioSilent ?? false} eligible=${
      deepCheck?.audio.audioEligible ?? false
    }`,
    `visualIdleSec=${deepCheck ? visualIdleSec : "n/a"} audioIdleSec=${
      deepCheck ? audioIdleSec : "n/a"
    } thresholdSec=${Math.round(deepCheckThresholdMs / 1000)}`,
    `enabled=${
      deepCheckModeEnabled && debugDeepCheckEnabled
    } available=${deepCheckAvailable} muted=${video.muted} volume=${video.volume.toFixed(
      2,
    )} stalled=${deepCheck?.stalled ?? false}`,
  ].join("\n");
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
    deepCheckModeEnabled,
    deepCheckThresholdSec: Math.round(deepCheckThresholdMs / 1000),
    monitorDebugOverlayEnabled,
    debugWarmupEnabled,
    debugCurrentTimeCheckEnabled,
    debugDeepCheckEnabled,
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

function showCountdown(durationMs: number, reason: "currentTime" | "deepCheck") {
  const toast = ensureToast();
  const start = Date.now();

  const update = () => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, durationMs - elapsed);
    toast.textContent =
      reason === "deepCheck"
        ? `高度な停止チェックにより配信停止を検知: ${Math.ceil(
            remaining / 1000,
          )} 秒後にリロードします`
        : `映像停止を検知: ${Math.ceil(remaining / 1000)} 秒後にリロードします`;
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
        // なにもしないとプレイヤーのコントローラ部分が表示されっぱなしになるので、それを消すためにマウスを動かす。
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

function log(level: LogLevel, message: string) {
  const context = currentProgramId();
  const contextPart = context ? `[${context}] ` : "";
  const providerPart = providerName ? `[${providerName}] ` : "";
  const text = `${contextPart}${providerPart}${message}`;
  pushLog({ level, message, context, providerName });
  // eslint-disable-next-line no-console
  console.log(`[nico-keepalive/content] ${text}`);
}

const logInfo = (m: string) => log("INFO", m);
const logDebug = (m: string) => log("DEBUG", m);
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
      handleStall(Date.now(), "currentTime");
    }
  });
}

init();
