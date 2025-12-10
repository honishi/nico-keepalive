import { LOG_MAX, LogEntry, Settings, STORAGE_KEYS } from "./types";

const defaultSettings: Settings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 100,
  customSound: null,
};

const safeStorage: chrome.storage.StorageArea | null =
  typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;

export async function getSettings(): Promise<Settings> {
  if (!safeStorage) return defaultSettings;
  return new Promise((resolve) => {
    safeStorage.get(STORAGE_KEYS.settings, (items) => {
      const stored = items[STORAGE_KEYS.settings] as Settings | undefined;
      resolve({ ...defaultSettings, ...stored });
    });
  });
}

export async function setSettings(settings: Settings): Promise<void> {
  if (!safeStorage) return;
  return new Promise((resolve) => {
    safeStorage.set({ [STORAGE_KEYS.settings]: settings }, () => resolve());
  });
}

export async function getLogs(): Promise<LogEntry[]> {
  if (!safeStorage) return [];
  return new Promise((resolve) => {
    safeStorage.get(STORAGE_KEYS.logs, (items) => {
      const stored = items[STORAGE_KEYS.logs] as LogEntry[] | undefined;
      resolve(stored ?? []);
    });
  });
}

export async function pushLog(
  entry: Omit<LogEntry, "id" | "timestamp"> & Partial<Pick<LogEntry, "timestamp">>,
): Promise<void> {
  const nextEntry: LogEntry = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: entry.timestamp ?? Date.now(),
    ...entry,
  };

  if (!safeStorage) return;

  const current = await getLogs();
  const updated = [...current, nextEntry].slice(-LOG_MAX);

  return new Promise((resolve) => {
    safeStorage.set({ [STORAGE_KEYS.logs]: updated }, () => resolve());
  });
}

export async function clearLogs(): Promise<void> {
  if (!safeStorage) return;
  return new Promise((resolve) => {
    safeStorage.set({ [STORAGE_KEYS.logs]: [] }, () => resolve());
  });
}
