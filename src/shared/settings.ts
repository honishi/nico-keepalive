import { Settings } from "./types";

export const DEEP_CHECK_THRESHOLD_MIN_SEC = 20;
export const DEEP_CHECK_THRESHOLD_MAX_SEC = 10 * 60;
export const DEEP_CHECK_THRESHOLD_DEFAULT_SEC = 3 * 60;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 100,
  customSound: null,
  deepCheckModeEnabled: false,
  deepCheckThresholdSec: DEEP_CHECK_THRESHOLD_DEFAULT_SEC,
  monitorDebugOverlayEnabled: false,
  debugWarmupEnabled: true,
  debugCurrentTimeCheckEnabled: true,
  debugDeepCheckEnabled: true,
};

export function clampDeepCheckThresholdSec(value: number): number {
  if (!Number.isFinite(value)) return DEEP_CHECK_THRESHOLD_DEFAULT_SEC;
  return Math.min(DEEP_CHECK_THRESHOLD_MAX_SEC, Math.max(DEEP_CHECK_THRESHOLD_MIN_SEC, value));
}

export function normalizeSettings(settings?: Partial<Settings> | null): Settings {
  const legacySettings = settings as
    | (Partial<Settings> & { deepCheckOverlayEnabled?: boolean })
    | null;
  const normalizedThresholdSec =
    typeof settings?.deepCheckThresholdSec === "number"
      ? clampDeepCheckThresholdSec(settings.deepCheckThresholdSec)
      : DEEP_CHECK_THRESHOLD_DEFAULT_SEC;
  const normalizedMonitorDebugOverlayEnabled =
    typeof settings?.monitorDebugOverlayEnabled === "boolean"
      ? settings.monitorDebugOverlayEnabled
      : legacySettings?.deepCheckOverlayEnabled === true;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    deepCheckThresholdSec: normalizedThresholdSec,
    monitorDebugOverlayEnabled: normalizedMonitorDebugOverlayEnabled,
  };
}
