import { COUNTDOWN_MS } from "../src/shared/reload-policy";

describe("reload policy", () => {
  it("exports countdown duration", () => {
    expect(COUNTDOWN_MS).toBe(5_000);
  });
});
