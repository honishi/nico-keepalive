import {
  createNormalCheckState,
  evaluateNormalCheck,
  isChasePlay,
} from "../src/content/checks/normal-check";

describe("normal check", () => {
  it("treats changes larger than epsilon as movement", () => {
    const result = evaluateNormalCheck(createNormalCheckState(0, 10), {
      currentTimeSec: 10.02,
      nowMs: 5_000,
      enabled: true,
      paused: false,
      ended: false,
    });

    expect(result.timeMoved).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.state.lastObservedCurrentTimeSec).toBe(10.02);
    expect(result.state.lastTimeChangeAtMs).toBe(5_000);
  });

  it("treats unchanged currentTime over the threshold as stalled", () => {
    const result = evaluateNormalCheck(createNormalCheckState(0, 10), {
      currentTimeSec: 10,
      nowMs: 20_000,
      enabled: true,
      paused: false,
      ended: false,
    });

    expect(result.timeMoved).toBe(false);
    expect(result.stalled).toBe(true);
    expect(result.snapshot.idleSec).toBe(20);
  });

  it.each([
    ["paused", { paused: true, ended: false }],
    ["ended", { paused: false, ended: true }],
    ["chasePlay", { paused: false, ended: false }],
  ])("resets the baseline when %s requires monitoring skip", (_label, flags) => {
    const result = evaluateNormalCheck(createNormalCheckState(0, 10), {
      currentTimeSec: 10,
      nowMs: 5_000,
      enabled: true,
      paused: flags.paused,
      ended: flags.ended,
      resetBaseline: true,
    });

    expect(result.stalled).toBe(false);
    expect(result.state.lastObservedCurrentTimeSec).toBe(10);
    expect(result.state.lastTimeChangeAtMs).toBe(5_000);
    expect(result.snapshot.idleSec).toBe(0);
  });

  it("updates the baseline during warmup without treating it as stalled", () => {
    const result = evaluateNormalCheck(createNormalCheckState(0, 5), {
      currentTimeSec: 5,
      nowMs: 20_000,
      enabled: true,
      paused: false,
      ended: false,
      inWarmup: true,
    });

    expect(result.stalled).toBe(false);
    expect(result.state.lastObservedCurrentTimeSec).toBe(5);
    expect(result.state.lastTimeChangeAtMs).toBe(20_000);
    expect(result.snapshot.idleSec).toBe(20);
  });

  it("treats seekable lag over the threshold as chase play", () => {
    const video = {
      seekable: {
        length: 1,
        end: () => 20,
      },
    } as unknown as HTMLVideoElement;

    expect(isChasePlay(video, 10)).toBe(true);
    expect(isChasePlay(video, 16)).toBe(false);
  });
});
