import { Settings } from "./types";

export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 100;
export const SOUND_VOLUME_STEP = 5;
export const CUSTOM_SOUND_MAX_BYTES = 1 * 1024 * 1024; // 1MB

const DEFAULT_SOUND_PATH = "sounds/notify_reload.mp3";

const isChromeAvailable = typeof chrome !== "undefined" && !!chrome.runtime?.getURL;

function getDefaultSoundUrl(): string {
  return isChromeAvailable ? chrome.runtime.getURL(DEFAULT_SOUND_PATH) : DEFAULT_SOUND_PATH;
}

function resolveSoundSource(settings: Settings, opts?: { forceDefault?: boolean }) {
  const forceDefault = opts?.forceDefault ?? false;
  if (!forceDefault && settings.customSound?.dataUrl) {
    return settings.customSound.dataUrl;
  }
  return getDefaultSoundUrl();
}

export async function playNotificationSound(
  settings: Settings,
  options?: {
    allowWhenDisabled?: boolean;
    forceDefault?: boolean;
    onError?: (err: unknown) => void;
  },
): Promise<void> {
  const allowWhenDisabled = options?.allowWhenDisabled ?? false;
  if (!allowWhenDisabled && settings.soundEnabled === false) return;

  const src = resolveSoundSource(settings, {
    forceDefault: options?.forceDefault,
  });
  const volume = clampVolume(settings.soundVolume ?? SOUND_VOLUME_MAX);

  try {
    const audio = new Audio(src);
    audio.volume = volume / 100;
    audio.currentTime = 0;
    await audio.play();
  } catch (err) {
    if (options?.onError) {
      options.onError(err);
    } else {
      // eslint-disable-next-line no-console
      console.warn("通知音の再生に失敗しました", err);
    }
  }
}

export function clampVolume(volume: number): number {
  if (Number.isNaN(volume)) return SOUND_VOLUME_MAX;
  return Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, volume));
}
