import {
  createDeepCheckState,
  type DeepCheckState,
  DEEP_CHECK_FRAME_HEIGHT,
  DEEP_CHECK_FRAME_WIDTH,
  getFrameAverageDiff,
  getTimeDomainRms,
  hasFrameMeaningfulChange,
  isSilentFromTimeDomainData,
  reduceDeepCheckState,
} from "../../shared/deep-check";
import type { MonitorLogger, ProgramContext } from "../types";

export type DeepCheckVisualResult = {
  visualEligible: boolean;
  frameChanged: boolean;
  frameAverageDiff?: number;
  previousFrame?: Uint8ClampedArray | null;
  nextFrame?: Uint8ClampedArray | null;
};

export type DeepCheckAudioResult = {
  audioEligible: boolean;
  audioSilent: boolean;
  audioRms?: number;
};

export type DeepCheckEvaluation = {
  stalled: boolean;
  visual: DeepCheckVisualResult;
  audio: DeepCheckAudioResult;
};

export type EvaluateDeepCheckArgs = {
  nowMs: number;
  thresholdMs: number;
  enabled: boolean;
  inWarmup?: boolean;
};

export type DeepCheckMonitor = {
  cleanup: () => void;
  resetMonitoringState: () => void;
  resetAvailability: () => void;
  evaluate: (video: HTMLVideoElement, args: EvaluateDeepCheckArgs) => DeepCheckEvaluation | null;
  getAvailability: () => boolean;
  getState: () => DeepCheckState;
};

type DeepCheckMonitorDependencies = {
  logger: Pick<MonitorLogger, "warn" | "trace">;
  getProgramContext: () => ProgramContext;
};

type AudioContextWithWebkit = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type HTMLVideoElementWithCapture = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export function createDeepCheckMonitor(deps: DeepCheckMonitorDependencies): DeepCheckMonitor {
  let deepCheckState = createDeepCheckState();
  let deepCheckCanvas: HTMLCanvasElement | null = null;
  let deepCheckCanvasContext: CanvasRenderingContext2D | null = null;
  let deepCheckLastFrame: Uint8ClampedArray | null = null;
  let deepCheckAudioContext: AudioContext | null = null;
  let deepCheckAnalyser: AnalyserNode | null = null;
  let deepCheckAudioData: Uint8Array | null = null;
  let deepCheckAudioSource: MediaStreamAudioSourceNode | null = null;
  let deepCheckAudioStream: MediaStream | null = null;
  let deepCheckAudioTrackSignature: string | null = null;
  let deepCheckSourceVideo: HTMLVideoElement | null = null;
  let deepCheckAvailable = true;
  let deepCheckFallbackLogged = false;

  function getDeepCheckAudioTrackSignature(stream: MediaStream | null): string {
    if (!stream) return "n/a";

    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return "none";

    return tracks
      .map((track) => {
        return [
          track.id,
          track.readyState,
          track.enabled ? "1" : "0",
          track.muted ? "1" : "0",
        ].join(":");
      })
      .join("|");
  }

  function resetMonitoringState() {
    deepCheckState = createDeepCheckState();
    deepCheckLastFrame = null;
  }

  function resetAvailability() {
    deepCheckAvailable = true;
    deepCheckFallbackLogged = false;
    resetMonitoringState();
  }

  function cleanup() {
    deepCheckCanvas = null;
    deepCheckCanvasContext = null;
    deepCheckLastFrame = null;
    deepCheckAudioData = null;
    deepCheckSourceVideo = null;
    deepCheckAudioStream = null;
    deepCheckAudioTrackSignature = null;

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
    cleanup();
    resetMonitoringState();
    deepCheckAvailable = false;

    if (!deepCheckFallbackLogged) {
      deepCheckFallbackLogged = true;
      deps.logger.warn(
        `deep check mode を無効化しました: ${reason}. 通常判定にフォールバックします`,
      );
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
      deps.logger.trace(
        `deep check audio reset: source video changed currentTime=${video.currentTime.toFixed(2)}`,
      );
      cleanup();
      resetMonitoringState();
    }

    if (
      deepCheckAudioContext &&
      deepCheckAnalyser &&
      deepCheckAudioData &&
      deepCheckAudioSource &&
      deepCheckAudioStream &&
      deepCheckSourceVideo === video
    ) {
      const currentTrackSignature = getDeepCheckAudioTrackSignature(deepCheckAudioStream);
      if (currentTrackSignature === deepCheckAudioTrackSignature) {
        return true;
      }

      deps.logger.trace(
        `deep check audio reset: audio tracks changed previous=${
          deepCheckAudioTrackSignature ?? "n/a"
        } current=${currentTrackSignature} currentTime=${video.currentTime.toFixed(2)}`,
      );
      cleanup();
      resetMonitoringState();
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
      deepCheckAudioTrackSignature = getDeepCheckAudioTrackSignature(deepCheckAudioStream);
      deepCheckSourceVideo = video;
      return true;
    } catch (err) {
      disableDeepCheck(`音声解析の初期化に失敗しました: ${String(err)}`);
      return false;
    }
  }

  function sampleDeepCheckFrame(video: HTMLVideoElement): DeepCheckVisualResult {
    if (!ensureDeepCheckCanvas()) {
      return { visualEligible: false, frameChanged: false };
    }

    if (video.videoWidth === 0 || video.videoHeight === 0 || !deepCheckCanvasContext) {
      return { visualEligible: false, frameChanged: false };
    }

    try {
      deepCheckCanvasContext.drawImage(
        video,
        0,
        0,
        DEEP_CHECK_FRAME_WIDTH,
        DEEP_CHECK_FRAME_HEIGHT,
      );
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

  function sampleDeepCheckAudio(video: HTMLVideoElement): DeepCheckAudioResult {
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

  function logDeepCheckMetrics(
    video: HTMLVideoElement,
    visual: DeepCheckVisualResult,
    audio: DeepCheckAudioResult,
    stalled: boolean,
    nowMs: number,
    thresholdMs: number,
  ) {
    const visualIdleSec = ((nowMs - deepCheckState.lastVisualChangeAtMs) / 1000).toFixed(1);
    const audioIdleSec = ((nowMs - deepCheckState.lastAudioActiveAtMs) / 1000).toFixed(1);
    const frameDiffText =
      typeof visual.frameAverageDiff === "number" ? visual.frameAverageDiff.toFixed(2) : "n/a";
    const audioRmsText = typeof audio.audioRms === "number" ? audio.audioRms.toFixed(2) : "n/a";
    const context = deps.getProgramContext();
    const contextPart = context.programId ? `[${context.programId}] ` : "";
    const providerPart = context.providerName ? `[${context.providerName}] ` : "";
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
      `thresholdSec=${Math.round(thresholdMs / 1000)}`,
      `muted=${video.muted}`,
      `volume=${video.volume.toFixed(2)}`,
      `stalled=${stalled}`,
    ].join(" ");

    deps.logger.trace(`${contextPart}${providerPart}${message}`);
  }

  function evaluate(
    video: HTMLVideoElement,
    args: EvaluateDeepCheckArgs,
  ): DeepCheckEvaluation | null {
    if (!args.enabled || !deepCheckAvailable) {
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
        nowMs: args.nowMs,
        inWarmup: args.inWarmup === true,
        paused: false,
        ended: false,
        visualEligible: visual.visualEligible,
        frameChanged: visual.frameChanged,
        audioEligible: audio.audioEligible,
        audioSilent: audio.audioSilent,
      },
      args.thresholdMs,
    );

    deepCheckState = result.state;
    logDeepCheckMetrics(video, visual, audio, result.stalled, args.nowMs, args.thresholdMs);

    return {
      visual,
      audio,
      stalled: args.inWarmup === true ? false : result.stalled,
    };
  }

  return {
    cleanup,
    resetMonitoringState,
    resetAvailability,
    evaluate,
    getAvailability: () => deepCheckAvailable,
    getState: () => deepCheckState,
  };
}
