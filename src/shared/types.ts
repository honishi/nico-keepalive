export type LogLevel = "INFO" | "WARN" | "ERROR";

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

export type Settings = {
  enabled: boolean;
  soundEnabled?: boolean;
  soundVolume?: number; // 0-100
  customSound?: CustomSound | null;
};

export const STORAGE_KEYS = {
  settings: "settings",
  logs: "logs",
} as const;

export const LOG_MAX = 1_000;
