import {
  createDeepCheckState,
  DEEP_CHECK_AUDIO_SILENCE_RMS_THRESHOLD,
  DEEP_CHECK_FRAME_DIFF_THRESHOLD,
  getFrameAverageDiff,
  getTimeDomainRms,
  hasFrameMeaningfulChange,
  isSilentFromTimeDomainData,
  reduceDeepCheckState,
} from "../src/content/checks/deep-check-core";

describe("deep check helpers", () => {
  it("returns false when video changes even if audio is silent", () => {
    let state = createDeepCheckState();

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 0,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: true,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    ));

    const result = reduceDeepCheckState(
      state,
      {
        nowMs: 20_000,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: true,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    );

    expect(result.stalled).toBe(false);
  });

  it("returns false when audio is active even if the frame is static", () => {
    let state = createDeepCheckState();

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 0,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: false,
      },
      20_000,
    ));

    const result = reduceDeepCheckState(
      state,
      {
        nowMs: 20_000,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: false,
      },
      20_000,
    );

    expect(result.stalled).toBe(false);
  });

  it("returns true when static video and silent audio continue for the threshold", () => {
    let state = createDeepCheckState();

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 0,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    ));

    const result = reduceDeepCheckState(
      state,
      {
        nowMs: 20_000,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    );

    expect(result.stalled).toBe(true);
  });

  it("does not trigger during warmup", () => {
    const result = reduceDeepCheckState(
      createDeepCheckState(),
      {
        nowMs: 20_000,
        inWarmup: true,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    );

    expect(result.stalled).toBe(false);
  });

  it("resets the baseline while paused", () => {
    let state = createDeepCheckState();

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 0,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    ));

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 20_000,
        inWarmup: false,
        paused: true,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    ));

    const result = reduceDeepCheckState(
      state,
      {
        nowMs: 30_000,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    );

    expect(result.stalled).toBe(false);
  });

  it("does not advance silence time while the player is muted", () => {
    let state = createDeepCheckState();

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 0,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: false,
        audioSilent: true,
      },
      20_000,
    ));

    const result = reduceDeepCheckState(
      state,
      {
        nowMs: 20_000,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: true,
        frameChanged: false,
        audioEligible: false,
        audioSilent: true,
      },
      20_000,
    );

    expect(result.stalled).toBe(false);
  });

  it("treats a missing visual sample as not stalled", () => {
    let state = createDeepCheckState();

    ({ state } = reduceDeepCheckState(
      state,
      {
        nowMs: 0,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: false,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    ));

    const result = reduceDeepCheckState(
      state,
      {
        nowMs: 20_000,
        inWarmup: false,
        paused: false,
        ended: false,
        visualEligible: false,
        frameChanged: false,
        audioEligible: true,
        audioSilent: true,
      },
      20_000,
    );

    expect(result.stalled).toBe(false);
  });

  it("measures frame difference and audio rms with the configured thresholds", () => {
    const silentAudio = new Uint8Array(8).fill(128);
    const noisyAudio = new Uint8Array([128, 134, 123, 132, 125, 133, 122, 129]);
    const baseFrame = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255]);
    const movedFrame = new Uint8ClampedArray([12, 12, 12, 255, 40, 40, 40, 255]);

    expect(getTimeDomainRms(silentAudio)).toBe(0);
    expect(isSilentFromTimeDomainData(silentAudio, DEEP_CHECK_AUDIO_SILENCE_RMS_THRESHOLD)).toBe(
      true,
    );
    expect(getTimeDomainRms(noisyAudio)).toBeGreaterThan(DEEP_CHECK_AUDIO_SILENCE_RMS_THRESHOLD);
    expect(getFrameAverageDiff(baseFrame, movedFrame)).toBeGreaterThan(
      DEEP_CHECK_FRAME_DIFF_THRESHOLD,
    );
    expect(hasFrameMeaningfulChange(baseFrame, movedFrame, DEEP_CHECK_FRAME_DIFF_THRESHOLD)).toBe(
      true,
    );
  });
});
