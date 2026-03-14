import { DEFAULT_SETTINGS, normalizeSettings } from "../src/shared/settings";

describe("settings defaults", () => {
  it("keeps deep check mode disabled by default", () => {
    expect(DEFAULT_SETTINGS.deepCheckModeEnabled).toBe(false);
  });

  it("fills deep check mode when old settings are loaded", () => {
    expect(normalizeSettings({ enabled: true }).deepCheckModeEnabled).toBe(false);
  });
});
