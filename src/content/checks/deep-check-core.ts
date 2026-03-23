export const DEEP_CHECK_FRAME_WIDTH = 32;
export const DEEP_CHECK_FRAME_HEIGHT = 18;
export const DEEP_CHECK_FRAME_DIFF_THRESHOLD = 0.01;
export const DEEP_CHECK_AUDIO_SILENCE_RMS_THRESHOLD = 0.01;

export type DeepCheckState = {
  initialized: boolean;
  lastVisualChangeAtMs: number;
  lastAudioActiveAtMs: number;
};

export type DeepCheckObservation = {
  nowMs: number;
  inWarmup: boolean;
  paused: boolean;
  ended: boolean;
  visualEligible: boolean;
  frameChanged: boolean;
  audioEligible: boolean;
  audioSilent: boolean;
};

export function createDeepCheckState(): DeepCheckState {
  return {
    initialized: false,
    lastVisualChangeAtMs: 0,
    lastAudioActiveAtMs: 0,
  };
}

export function getFrameAverageDiff(
  previousFrame: Uint8ClampedArray,
  nextFrame: Uint8ClampedArray,
): number {
  const sampleLength = Math.min(previousFrame.length, nextFrame.length);
  if (sampleLength === 0) return 0;

  let totalDiff = 0;
  let channelCount = 0;

  for (let i = 0; i + 2 < sampleLength; i += 4) {
    totalDiff += Math.abs(nextFrame[i] - previousFrame[i]);
    totalDiff += Math.abs(nextFrame[i + 1] - previousFrame[i + 1]);
    totalDiff += Math.abs(nextFrame[i + 2] - previousFrame[i + 2]);
    channelCount += 3;
  }

  return channelCount === 0 ? 0 : totalDiff / channelCount;
}

export function hasFrameMeaningfulChange(
  previousFrame: Uint8ClampedArray | null,
  nextFrame: Uint8ClampedArray,
  threshold = DEEP_CHECK_FRAME_DIFF_THRESHOLD,
): boolean {
  if (!previousFrame || previousFrame.length !== nextFrame.length) {
    return true;
  }

  return getFrameAverageDiff(previousFrame, nextFrame) > threshold;
}

export function getTimeDomainRms(timeDomainData: Uint8Array): number {
  if (timeDomainData.length === 0) return 0;

  let total = 0;
  for (let i = 0; i < timeDomainData.length; i += 1) {
    const centered = timeDomainData[i] - 128;
    total += centered * centered;
  }

  return Math.sqrt(total / timeDomainData.length);
}

export function isSilentFromTimeDomainData(
  timeDomainData: Uint8Array,
  threshold = DEEP_CHECK_AUDIO_SILENCE_RMS_THRESHOLD,
): boolean {
  return getTimeDomainRms(timeDomainData) < threshold;
}

export function reduceDeepCheckState(
  state: DeepCheckState,
  observation: DeepCheckObservation,
  thresholdMs: number,
): { state: DeepCheckState; stalled: boolean } {
  const nextState = state.initialized
    ? { ...state }
    : {
        initialized: true,
        lastVisualChangeAtMs: observation.nowMs,
        lastAudioActiveAtMs: observation.nowMs,
      };

  if (observation.inWarmup || observation.paused || observation.ended) {
    nextState.lastVisualChangeAtMs = observation.nowMs;
    nextState.lastAudioActiveAtMs = observation.nowMs;
    return { state: nextState, stalled: false };
  }

  if (!observation.visualEligible || observation.frameChanged) {
    nextState.lastVisualChangeAtMs = observation.nowMs;
  }

  if (!observation.audioEligible || !observation.audioSilent) {
    nextState.lastAudioActiveAtMs = observation.nowMs;
  }

  const visualStalled = observation.nowMs - nextState.lastVisualChangeAtMs >= thresholdMs;
  const audioStalled = observation.nowMs - nextState.lastAudioActiveAtMs >= thresholdMs;

  return {
    state: nextState,
    stalled: visualStalled && audioStalled,
  };
}
