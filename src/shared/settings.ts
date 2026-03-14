import { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 100,
  customSound: null,
  deepCheckModeEnabled: false,
  deepCheckOverlayEnabled: false,
  debugWarmupEnabled: true,
  debugCurrentTimeCheckEnabled: true,
  debugDeepCheckEnabled: true,
};

export function normalizeSettings(settings?: Partial<Settings> | null): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
  };
}
