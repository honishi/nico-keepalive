export type StallReason = "currentTime" | "deepCheck";

export type ProgramContext = {
  programId?: string;
  providerName?: string;
};

export type MonitorRuntimeSettings = {
  enabled: boolean;
  deepCheckModeEnabled: boolean;
  deepCheckThresholdMs: number;
  monitorOverlayEnabled: boolean;
  debugWarmupEnabled: boolean;
  debugCurrentTimeCheckEnabled: boolean;
  debugDeepCheckEnabled: boolean;
};

export type MonitorLogger = {
  debug: (message: string) => void;
  warn: (message: string) => void;
  trace: (message: string) => void;
};

export type SessionMonitorSettings = {
  enabled: boolean;
};
