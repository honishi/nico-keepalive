const NO_TIME_CHANGE_THRESHOLD_MS = 20_000;
const TIME_CHANGE_EPSILON_SEC = 0.01;
const CHASE_PLAY_LIVE_EDGE_THRESHOLD_SEC = 5;

export type NormalCheckState = {
  lastTimeChangeAtMs: number;
  lastObservedCurrentTimeSec: number;
};

export type NormalCheckSnapshotData = {
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

export type EvaluateNormalCheckInput = {
  currentTimeSec: number;
  nowMs: number;
  enabled: boolean;
  paused: boolean;
  ended: boolean;
  inWarmup?: boolean;
  resetBaseline?: boolean;
};

export type NormalCheckResult = {
  state: NormalCheckState;
  snapshot: NormalCheckSnapshotData;
  stalled: boolean;
  timeMoved: boolean;
};

export function createNormalCheckState(nowMs = Date.now(), currentTimeSec = 0): NormalCheckState {
  return {
    lastTimeChangeAtMs: nowMs,
    lastObservedCurrentTimeSec: currentTimeSec,
  };
}

export function isChasePlay(video: HTMLVideoElement, currentTimeSec: number): boolean {
  if (video.seekable.length === 0) return false;

  try {
    const liveEdgeSec = video.seekable.end(video.seekable.length - 1);
    if (!Number.isFinite(liveEdgeSec)) return false;
    return liveEdgeSec - currentTimeSec > CHASE_PLAY_LIVE_EDGE_THRESHOLD_SEC;
  } catch {
    return false;
  }
}

export function evaluateNormalCheck(
  state: NormalCheckState,
  input: EvaluateNormalCheckInput,
): NormalCheckResult {
  const deltaSec = input.currentTimeSec - state.lastObservedCurrentTimeSec;
  const timeMoved = Math.abs(deltaSec) > TIME_CHANGE_EPSILON_SEC;

  if (input.inWarmup) {
    return {
      state: createNormalCheckState(input.nowMs, input.currentTimeSec),
      snapshot: createNormalCheckSnapshot({
        currentTimeSec: input.currentTimeSec,
        lastObservedCurrentTimeSec: state.lastObservedCurrentTimeSec,
        nowMs: input.nowMs,
        lastTimeChangeAtMs: state.lastTimeChangeAtMs,
        enabled: input.enabled,
        paused: input.paused,
        ended: input.ended,
        stalled: false,
      }),
      stalled: false,
      timeMoved,
    };
  }

  if (input.resetBaseline) {
    return {
      state: createNormalCheckState(input.nowMs, input.currentTimeSec),
      snapshot: createNormalCheckSnapshot({
        currentTimeSec: input.currentTimeSec,
        lastObservedCurrentTimeSec: state.lastObservedCurrentTimeSec,
        nowMs: input.nowMs,
        lastTimeChangeAtMs: input.nowMs,
        enabled: input.enabled,
        paused: input.paused,
        ended: input.ended,
        stalled: false,
      }),
      stalled: false,
      timeMoved,
    };
  }

  const nextState = timeMoved ? createNormalCheckState(input.nowMs, input.currentTimeSec) : state;
  const stalled =
    input.enabled &&
    !timeMoved &&
    input.nowMs - state.lastTimeChangeAtMs >= NO_TIME_CHANGE_THRESHOLD_MS;

  return {
    state: nextState,
    snapshot: createNormalCheckSnapshot({
      currentTimeSec: input.currentTimeSec,
      lastObservedCurrentTimeSec: state.lastObservedCurrentTimeSec,
      nowMs: input.nowMs,
      lastTimeChangeAtMs: timeMoved ? input.nowMs : state.lastTimeChangeAtMs,
      enabled: input.enabled,
      paused: input.paused,
      ended: input.ended,
      stalled,
    }),
    stalled,
    timeMoved,
  };
}

function createNormalCheckSnapshot(args: {
  currentTimeSec: number;
  lastObservedCurrentTimeSec: number;
  nowMs: number;
  lastTimeChangeAtMs: number;
  enabled: boolean;
  paused: boolean;
  ended: boolean;
  stalled: boolean;
}): NormalCheckSnapshotData {
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
