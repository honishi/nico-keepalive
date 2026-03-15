import {
  DEFAULT_SETTINGS,
  DEEP_CHECK_THRESHOLD_DEFAULT_SEC,
  DEEP_CHECK_THRESHOLD_MAX_SEC,
  DEEP_CHECK_THRESHOLD_MIN_SEC,
  normalizeSettings,
} from "../src/shared/settings";

describe("settings defaults", () => {
  it("keeps deep check mode disabled by default", () => {
    expect(DEFAULT_SETTINGS.deepCheckModeEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.deepCheckThresholdSec).toBe(120);
  });

  it("fills deep check mode when old settings are loaded", () => {
    expect(normalizeSettings({ enabled: true }).deepCheckModeEnabled).toBe(false);
    expect(normalizeSettings({ enabled: true }).deepCheckThresholdSec).toBe(
      DEEP_CHECK_THRESHOLD_DEFAULT_SEC,
    );
  });

  it("keeps debug checks enabled by default", () => {
    expect(DEFAULT_SETTINGS.monitorOverlayEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.debugWarmupEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.debugCurrentTimeCheckEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.debugDeepCheckEnabled).toBe(true);
  });

  it("clamps deep check threshold into the supported range", () => {
    expect(
      normalizeSettings({ enabled: true, deepCheckThresholdSec: 1 }).deepCheckThresholdSec,
    ).toBe(DEEP_CHECK_THRESHOLD_MIN_SEC);
    expect(
      normalizeSettings({
        enabled: true,
        deepCheckThresholdSec: DEEP_CHECK_THRESHOLD_MAX_SEC + 1,
      }).deepCheckThresholdSec,
    ).toBe(DEEP_CHECK_THRESHOLD_MAX_SEC);
  });
});
