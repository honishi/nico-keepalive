export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogEntry = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: string;
  providerName?: string;
};

export type CustomSound = {
  fileName: string;
  dataUrl: string; // Base64 data URL
};

export type ReloadStats = {
  count: number;
  lastReloadAt?: number;
};

export type ProgramState = {
  fullscreen?: boolean;
  updatedAt?: number;
  // 将来拡張用に他の状態もここへ追加する
  [key: string]: unknown;
};

export type ProgramStateMap = Record<string, ProgramState>;

export type Settings = {
  enabled: boolean;
  soundEnabled?: boolean;
  soundVolume?: number; // 0-100
  customSound?: CustomSound | null;
  deepCheckModeEnabled?: boolean;
  deepCheckThresholdSec?: number;
  deepCheckOverlayEnabled?: boolean;
  debugWarmupEnabled?: boolean;
  debugCurrentTimeCheckEnabled?: boolean;
  debugDeepCheckEnabled?: boolean;
};

export const STORAGE_KEYS = {
  settings: "settings",
  logs: "logs",
  programStateMap: "programStateMap",
  reloadCount: "reloadCount",
} as const;

export const LOG_MAX = 1_000;
