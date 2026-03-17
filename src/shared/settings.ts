import { Settings } from "./types";

export const DEEP_CHECK_THRESHOLD_MIN_SEC = 20;
export const DEEP_CHECK_THRESHOLD_MAX_SEC = 5 * 60;
export const DEEP_CHECK_THRESHOLD_DEFAULT_SEC = 1 * 60;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 100,
  customSound: null,
  deepCheckModeEnabled: true,
  deepCheckThresholdSec: DEEP_CHECK_THRESHOLD_DEFAULT_SEC,
  monitorOverlayEnabled: true,
  debugWarmupEnabled: true,
  debugCurrentTimeCheckEnabled: true,
  debugDeepCheckEnabled: true,
};

export function clampDeepCheckThresholdSec(value: number): number {
  if (!Number.isFinite(value)) return DEEP_CHECK_THRESHOLD_DEFAULT_SEC;
  return Math.min(DEEP_CHECK_THRESHOLD_MAX_SEC, Math.max(DEEP_CHECK_THRESHOLD_MIN_SEC, value));
}

export function normalizeSettings(settings?: Partial<Settings> | null): Settings {
  const normalizedThresholdSec =
    typeof settings?.deepCheckThresholdSec === "number"
      ? clampDeepCheckThresholdSec(settings.deepCheckThresholdSec)
      : DEEP_CHECK_THRESHOLD_DEFAULT_SEC;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    deepCheckThresholdSec: normalizedThresholdSec,
  };
}
