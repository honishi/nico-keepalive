import { createDeepCheckState } from "../src/content/checks/deep-check-core";
import type {
  DeepCheckEvaluation,
  EvaluateDeepCheckArgs,
  DeepCheckMonitor,
} from "../src/content/checks/deep-check-monitor";
import { createMonitorRunner } from "../src/content/monitor-runner";
import type { MonitorRuntimeSettings } from "../src/content/types";

function createSettings(overrides: Partial<MonitorRuntimeSettings> = {}): MonitorRuntimeSettings {
  return {
    enabled: true,
    deepCheckModeEnabled: false,
    deepCheckThresholdMs: 60_000,
    monitorOverlayEnabled: true,
    debugWarmupEnabled: true,
    debugCurrentTimeCheckEnabled: true,
    debugDeepCheckEnabled: true,
    ...overrides,
  };
}

function createVideo(
  overrides: {
    currentTime?: number;
    paused?: boolean;
    ended?: boolean;
    muted?: boolean;
    volume?: number;
    seekableEnd?: number;
  } = {},
): HTMLVideoElement {
  const currentTime = overrides.currentTime ?? 0;
  const seekableEnd = overrides.seekableEnd;

  return {
    currentTime,
    paused: overrides.paused ?? false,
    ended: overrides.ended ?? false,
    muted: overrides.muted ?? false,
    volume: overrides.volume ?? 1,
    seekable:
      typeof seekableEnd === "number"
        ? {
            length: 1,
            end: () => seekableEnd,
          }
        : {
            length: 0,
            end: () => 0,
          },
  } as unknown as HTMLVideoElement;
}

function createDeepCheckMonitorMock(
  evaluation: DeepCheckEvaluation | null = null,
): jest.Mocked<DeepCheckMonitor> {
  return {
    cleanup: jest.fn(),
    resetMonitoringState: jest.fn(),
    resetAvailability: jest.fn(),
    evaluate: jest.fn<DeepCheckEvaluation | null, [HTMLVideoElement, EvaluateDeepCheckArgs]>(
      () => evaluation,
    ),
    getAvailability: jest.fn(() => true),
    getState: jest.fn(() => createDeepCheckState()),
  };
}

describe("monitor runner", () => {
  it("updates the overlay during warmup without triggering stall handling", () => {
    const nowMs = 0;
    const video = createVideo({ currentTime: 10 });
    const deepCheckMonitor = createDeepCheckMonitorMock({
      stalled: false,
      visual: {
        visualEligible: true,
        frameChanged: true,
      },
      audio: {
        audioEligible: true,
        audioSilent: false,
      },
    });
    const overlay = {
      update: jest.fn(),
      hide: jest.fn(),
    };
    const onStall = jest.fn(() => true);
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
    };
    const runner = createMonitorRunner(
      {
        initialSettings: createSettings({
          deepCheckModeEnabled: true,
        }),
        onStall,
        logger,
        getProgramContext: () => ({}),
      },
      {
        deepCheckMonitor,
        overlay,
        findVideo: () => video,
        now: () => nowMs,
      },
    );

    runner.tick();

    expect(overlay.update).toHaveBeenCalledTimes(1);
    expect(overlay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        inWarmup: true,
        warmupRemainingMs: 60_000,
      }),
    );
    expect(deepCheckMonitor.evaluate).toHaveBeenCalledWith(
      video,
      expect.objectContaining({
        inWarmup: true,
      }),
    );
    expect(onStall).not.toHaveBeenCalled();
  });

  it("evaluates deep check only when the normal check has not stalled", () => {
    const nowMs = 0;
    const video = createVideo({ currentTime: 10 });
    const deepCheckMonitor = createDeepCheckMonitorMock();
    const runner = createMonitorRunner(
      {
        initialSettings: createSettings({
          debugWarmupEnabled: false,
          deepCheckModeEnabled: true,
        }),
        onStall: jest.fn(() => true),
        logger: {
          debug: jest.fn(),
          warn: jest.fn(),
          trace: jest.fn(),
        },
        getProgramContext: () => ({}),
      },
      {
        deepCheckMonitor,
        overlay: {
          update: jest.fn(),
          hide: jest.fn(),
        },
        findVideo: () => video,
        now: () => nowMs,
      },
    );

    runner.tick();

    expect(deepCheckMonitor.evaluate).toHaveBeenCalledTimes(1);
  });

  it("prioritizes the normal stall before deep check evaluation", () => {
    let nowMs = 0;
    const video = createVideo({ currentTime: 10 });
    const deepCheckMonitor = createDeepCheckMonitorMock();
    const overlay = {
      update: jest.fn(),
      hide: jest.fn(),
    };
    const onStall = jest.fn(() => true);
    const runner = createMonitorRunner(
      {
        initialSettings: createSettings({
          debugWarmupEnabled: false,
          deepCheckModeEnabled: true,
        }),
        onStall,
        logger: {
          debug: jest.fn(),
          warn: jest.fn(),
          trace: jest.fn(),
        },
        getProgramContext: () => ({}),
      },
      {
        deepCheckMonitor,
        overlay,
        findVideo: () => video,
        now: () => nowMs,
      },
    );

    runner.tick();
    deepCheckMonitor.evaluate.mockClear();
    overlay.update.mockClear();

    nowMs = 20_000;
    runner.tick();

    expect(onStall).toHaveBeenCalledWith("currentTime", 20_000);
    expect(deepCheckMonitor.evaluate).not.toHaveBeenCalled();
    expect(overlay.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["paused", createVideo({ currentTime: 10, paused: true })],
    ["ended", createVideo({ currentTime: 10, ended: true })],
    ["chasePlay", createVideo({ currentTime: 10, seekableEnd: 20 })],
  ])("resets deep check monitoring state when %s skips monitoring", (_label, video) => {
    const deepCheckMonitor = createDeepCheckMonitorMock();
    const onStall = jest.fn(() => true);
    const runner = createMonitorRunner(
      {
        initialSettings: createSettings({
          debugWarmupEnabled: false,
          deepCheckModeEnabled: true,
        }),
        onStall,
        logger: {
          debug: jest.fn(),
          warn: jest.fn(),
          trace: jest.fn(),
        },
        getProgramContext: () => ({}),
      },
      {
        deepCheckMonitor,
        overlay: {
          update: jest.fn(),
          hide: jest.fn(),
        },
        findVideo: () => video,
        now: () => 0,
      },
    );

    runner.tick();

    expect(deepCheckMonitor.resetMonitoringState).toHaveBeenCalledTimes(1);
    expect(deepCheckMonitor.evaluate).not.toHaveBeenCalled();
    expect(onStall).not.toHaveBeenCalled();
  });

  it("skips stall detection while the page-local monitor switch is off", () => {
    let nowMs = 0;
    const video = createVideo({ currentTime: 10 });
    const deepCheckMonitor = createDeepCheckMonitorMock();
    const overlay = {
      update: jest.fn(),
      hide: jest.fn(),
    };
    const onStall = jest.fn(() => true);
    const runner = createMonitorRunner(
      {
        initialSettings: createSettings({
          debugWarmupEnabled: false,
          deepCheckModeEnabled: true,
        }),
        onStall,
        logger: {
          debug: jest.fn(),
          warn: jest.fn(),
          trace: jest.fn(),
        },
        getProgramContext: () => ({}),
      },
      {
        deepCheckMonitor,
        overlay,
        findVideo: () => video,
        now: () => nowMs,
      },
    );

    runner.updateSessionSettings({ enabled: false });
    runner.tick();

    nowMs = 60_000;
    runner.tick();

    expect(deepCheckMonitor.resetMonitoringState).toHaveBeenCalled();
    expect(deepCheckMonitor.evaluate).not.toHaveBeenCalled();
    expect(onStall).not.toHaveBeenCalled();
    expect(overlay.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        inWarmup: false,
        warmupRemainingMs: 0,
      }),
    );
  });

  it("resets the stall baseline when the page-local monitor switch is turned back on", () => {
    let nowMs = 0;
    const video = createVideo({ currentTime: 10 });
    const deepCheckMonitor = createDeepCheckMonitorMock();
    const onStall = jest.fn(() => true);
    const runner = createMonitorRunner(
      {
        initialSettings: createSettings({
          debugWarmupEnabled: false,
        }),
        onStall,
        logger: {
          debug: jest.fn(),
          warn: jest.fn(),
          trace: jest.fn(),
        },
        getProgramContext: () => ({}),
      },
      {
        deepCheckMonitor,
        overlay: {
          update: jest.fn(),
          hide: jest.fn(),
        },
        findVideo: () => video,
        now: () => nowMs,
      },
    );

    runner.tick();
    runner.updateSessionSettings({ enabled: false });

    nowMs = 30_000;
    runner.tick();
    expect(onStall).not.toHaveBeenCalled();

    runner.updateSessionSettings({ enabled: true });
    runner.tick();
    expect(onStall).not.toHaveBeenCalled();

    nowMs = 50_000;
    runner.tick();
    expect(onStall).toHaveBeenCalledWith("currentTime", 50_000);
  });
});
