import { formatDurationLabel } from "../src/entry/popup";

describe("formatDurationLabel", () => {
  it("shows seconds for sub-minute durations", () => {
    expect(formatDurationLabel(20)).toBe("20秒");
  });

  it("shows zero-padded seconds for exact-minute durations", () => {
    expect(formatDurationLabel(60)).toBe("1分00秒");
    expect(formatDurationLabel(120)).toBe("2分00秒");
  });

  it("shows minute and second durations", () => {
    expect(formatDurationLabel(80)).toBe("1分20秒");
  });
});
