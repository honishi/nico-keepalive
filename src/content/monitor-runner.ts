import {
  hideMonitorOverlay,
  type DeepCheckOverlaySnapshot,
  type MonitorOverlayUpdateArgs,
  type NormalCheckSnapshot,
  updateMonitorOverlay,
} from "../view/monitor-overlay";
import {
  createDeepCheckMonitor,
  type DeepCheckEvaluation,
  type DeepCheckMonitor,
} from "./checks/deep-check-monitor";
import {
  createNormalCheckState,
  evaluateNormalCheck,
  isChasePlay,
  type NormalCheckSnapshotData,
} from "./checks/normal-check";
import type { MonitorLogger, MonitorRuntimeSettings, ProgramContext, StallReason } from "./types";

const TICK_INTERVAL_MS = 5_000;
const WARMUP_SKIP_MS = 60_000;

type MonitorRunnerDependencies = {
  initialSettings: MonitorRuntimeSettings;
  onStall: (reason: StallReason, nowMs: number) => boolean;
  logger: MonitorLogger;
  getProgramContext: () => ProgramContext;
};

type OverlayAdapter = {
  update: (args: MonitorOverlayUpdateArgs) => void;
  hide: () => void;
};

type MonitorRunnerOptions = {
  deepCheckMonitor?: DeepCheckMonitor;
  overlay?: OverlayAdapter;
  findVideo?: () => HTMLVideoElement | null;
  now?: () => number;
  setIntervalFn?: (handler: () => void, timeout: number) => number;
  clearIntervalFn?: (id: number) => void;
};

export type MonitorRunner = {
  updateSettings: (settings: MonitorRuntimeSettings) => void;
  start: () => void;
  stop: () => void;
  tick: () => void;
};

export function createMonitorRunner(
  deps: MonitorRunnerDependencies,
  options: MonitorRunnerOptions = {},
): MonitorRunner {
  let settings = deps.initialSettings;
  let monitorTimer: number | undefined;
  let tickCount = 0;
  let firstTickAtMs: number | undefined;
  let normalCheckState = createNormalCheckState((options.now ?? Date.now)());

  const deepCheckMonitor =
    options.deepCheckMonitor ??
    createDeepCheckMonitor({
      logger: deps.logger,
      getProgramContext: deps.getProgramContext,
    });
  const overlay = options.overlay ?? {
    update: updateMonitorOverlay,
    hide: hideMonitorOverlay,
  };
  const findVideo =
    options.findVideo ??
    (() => {
      const video = document.querySelector("video");
      return video instanceof HTMLVideoElement ? video : null;
    });
  const now = options.now ?? Date.now;
  const setIntervalFn =
    options.setIntervalFn ?? ((handler, timeout) => window.setInterval(handler, timeout));
  const clearIntervalFn = options.clearIntervalFn ?? ((id) => window.clearInterval(id));

  function updateSettings(nextSettings: MonitorRuntimeSettings) {
    const previous = settings;
    settings = nextSettings;

    if (previous.deepCheckModeEnabled && !nextSettings.deepCheckModeEnabled) {
      deepCheckMonitor.cleanup();
      deepCheckMonitor.resetMonitoringState();
      overlay.hide();
      return;
    }

    if (!previous.deepCheckModeEnabled && nextSettings.deepCheckModeEnabled) {
      deepCheckMonitor.cleanup();
      deepCheckMonitor.resetAvailability();
    }

    if (!nextSettings.monitorOverlayEnabled) {
      overlay.hide();
    }
  }

  function start() {
    if (monitorTimer) return;
    if (settings.deepCheckModeEnabled) {
      deepCheckMonitor.resetAvailability();
    }
    monitorTimer = setIntervalFn(tick, TICK_INTERVAL_MS);
  }

  function stop() {
    if (monitorTimer) {
      clearIntervalFn(monitorTimer);
      monitorTimer = undefined;
    }
    deepCheckMonitor.cleanup();
    deepCheckMonitor.resetMonitoringState();
    overlay.hide();
  }

  function tick() {
    if (!settings.enabled) return;

    const video = findVideo();
    if (!video || Number.isNaN(video.currentTime)) {
      return;
    }

    const nowMs = now();
    const currentTimeSec = video.currentTime;
    const paused = video.paused;
    const ended = video.ended;
    const chasePlay = isChasePlay(video, currentTimeSec);

    tickCount += 1;

    if (firstTickAtMs === undefined) {
      firstTickAtMs = nowMs;
    }

    const warmupRemainingMs = Math.max(0, WARMUP_SKIP_MS - (nowMs - firstTickAtMs));
    const inWarmup = settings.debugWarmupEnabled && warmupRemainingMs > 0;
    const normalResult = evaluateNormalCheck(normalCheckState, {
      currentTimeSec,
      nowMs,
      enabled: settings.debugCurrentTimeCheckEnabled,
      paused,
      ended,
      inWarmup,
      resetBaseline: !inWarmup && (paused || ended || chasePlay),
    });
    normalCheckState = normalResult.state;

    if (inWarmup) {
      const deepCheck = shouldEvaluateDeepCheck()
        ? deepCheckMonitor.evaluate(video, {
            enabled: true,
            nowMs,
            thresholdMs: settings.deepCheckThresholdMs,
            inWarmup: true,
          })
        : null;
      overlay.update({
        enabled: settings.monitorOverlayEnabled,
        inWarmup: true,
        warmupRemainingMs,
        chasePlay,
        normalCheck: toOverlayNormalCheckSnapshot(normalResult.snapshot),
        deepCheck: createDeepCheckOverlaySnapshot(video, nowMs, deepCheck),
      });
      deps.logger.trace(
        `warmup: モニターをスキップします (残り ${Math.ceil(warmupRemainingMs / 1000)} 秒)`,
      );
      return;
    }

    deps.logger.trace(`currentTime=${currentTimeSec.toFixed(2)} paused=${paused} ended=${ended}`);

    if (!paused && !ended && tickCount % 20 === 0) {
      deps.logger.debug("モニターしています...");
    }

    if (paused || ended || chasePlay) {
      deepCheckMonitor.resetMonitoringState();
      overlay.update({
        enabled: settings.monitorOverlayEnabled,
        chasePlay,
        normalCheck: toOverlayNormalCheckSnapshot(normalResult.snapshot),
        deepCheck: createDeepCheckOverlaySnapshot(video, nowMs, null),
      });
      return;
    }

    if (normalResult.stalled) {
      overlay.update({
        enabled: settings.monitorOverlayEnabled,
        chasePlay,
        normalCheck: toOverlayNormalCheckSnapshot(normalResult.snapshot),
        deepCheck: createDeepCheckOverlaySnapshot(video, nowMs, null),
      });
      if (deps.onStall("currentTime", nowMs)) {
        normalCheckState = {
          ...normalCheckState,
          lastTimeChangeAtMs: nowMs,
        };
      }
      return;
    }

    const deepCheck = shouldEvaluateDeepCheck()
      ? deepCheckMonitor.evaluate(video, {
          enabled: true,
          nowMs,
          thresholdMs: settings.deepCheckThresholdMs,
        })
      : null;

    if (deepCheck?.stalled) {
      overlay.update({
        enabled: settings.monitorOverlayEnabled,
        chasePlay,
        normalCheck: toOverlayNormalCheckSnapshot(normalResult.snapshot),
        deepCheck: createDeepCheckOverlaySnapshot(video, nowMs, deepCheck),
      });
      if (deps.onStall("deepCheck", nowMs)) {
        normalCheckState = {
          ...normalCheckState,
          lastTimeChangeAtMs: nowMs,
        };
      }
      return;
    }

    overlay.update({
      enabled: settings.monitorOverlayEnabled,
      chasePlay,
      normalCheck: toOverlayNormalCheckSnapshot(normalResult.snapshot),
      deepCheck: createDeepCheckOverlaySnapshot(video, nowMs, deepCheck),
    });
  }

  function shouldEvaluateDeepCheck(): boolean {
    return settings.deepCheckModeEnabled && settings.debugDeepCheckEnabled;
  }

  function toOverlayNormalCheckSnapshot(snapshot: NormalCheckSnapshotData): NormalCheckSnapshot {
    return { ...snapshot };
  }

  function createDeepCheckOverlaySnapshot(
    video: HTMLVideoElement,
    nowMs: number,
    deepCheck: DeepCheckEvaluation | null,
  ): DeepCheckOverlaySnapshot {
    const deepCheckState = deepCheckMonitor.getState();

    return {
      enabled: shouldEvaluateDeepCheck(),
      available: deepCheckMonitor.getAvailability(),
      stalled: deepCheck?.stalled ?? false,
      visualEligible: deepCheck?.visual.visualEligible ?? false,
      frameChanged: deepCheck?.visual.frameChanged ?? false,
      frameAverageDiff: deepCheck?.visual.frameAverageDiff,
      previousFrame: deepCheck?.visual.previousFrame,
      nextFrame: deepCheck?.visual.nextFrame,
      audioEligible: deepCheck?.audio.audioEligible ?? false,
      audioSilent: deepCheck?.audio.audioSilent ?? false,
      audioRms: deepCheck?.audio.audioRms,
      visualIdleSec: deepCheck
        ? Math.max(0, (nowMs - deepCheckState.lastVisualChangeAtMs) / 1000)
        : undefined,
      audioIdleSec: deepCheck
        ? Math.max(0, (nowMs - deepCheckState.lastAudioActiveAtMs) / 1000)
        : undefined,
      thresholdSec: Math.round(settings.deepCheckThresholdMs / 1000),
      muted: video.muted,
      volume: video.volume,
    };
  }

  return {
    updateSettings,
    start,
    stop,
    tick,
  };
}
