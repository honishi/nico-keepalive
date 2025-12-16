import { LOG_MAX, LogEntry, ProgramStateMap, Settings, STORAGE_KEYS } from "./types";

const defaultSettings: Settings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 100,
  customSound: null,
};

const safeStorage: chrome.storage.StorageArea | null =
  typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;

const LOG_LOCK_NAME = "nico-keepalive:logs";
const PROGRAM_STATE_LOCK_NAME = "nico-keepalive:program-state";

async function withStorageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined;

  if (locks?.request) {
    return locks.request(name, fn);
  }

  return fn();
}

export async function getSettings(): Promise<Settings> {
  if (!safeStorage) return defaultSettings;
  return new Promise((resolve) => {
    safeStorage.get(STORAGE_KEYS.settings, (items) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("[nico-keepalive/storage] Failed to get settings", err);
        resolve(defaultSettings);
        return;
      }
      const stored = items[STORAGE_KEYS.settings] as Settings | undefined;
      resolve({ ...defaultSettings, ...stored });
    });
  });
}

export async function setSettings(settings: Settings): Promise<void> {
  if (!safeStorage) return;
  return new Promise((resolve, reject) => {
    safeStorage.set({ [STORAGE_KEYS.settings]: settings }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

export async function getLogs(): Promise<LogEntry[]> {
  if (!safeStorage) return [];
  return new Promise((resolve) => {
    safeStorage.get(STORAGE_KEYS.logs, (items) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("[nico-keepalive/storage] Failed to get logs", err);
        resolve([]);
        return;
      }
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

  return withStorageLock(LOG_LOCK_NAME, async () => {
    const current = await getLogs();
    const updated = [...current, nextEntry].slice(-LOG_MAX);

    await new Promise<void>((resolve) => {
      safeStorage.set({ [STORAGE_KEYS.logs]: updated }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn("[nico-keepalive/storage] Failed to save logs", err);
        }
        resolve();
      });
    });
  });
}

export async function clearLogs(): Promise<void> {
  if (!safeStorage) return;
  return new Promise((resolve, reject) => {
    safeStorage.set({ [STORAGE_KEYS.logs]: [] }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

async function getProgramStateMap(): Promise<ProgramStateMap> {
  if (!safeStorage) return {};
  return new Promise((resolve) => {
    safeStorage.get(STORAGE_KEYS.programStateMap, (items) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("[nico-keepalive/storage] Failed to get program state map", err);
        resolve({});
        return;
      }
      const stored = items[STORAGE_KEYS.programStateMap] as ProgramStateMap | undefined;
      resolve(stored ?? {});
    });
  });
}

async function setProgramStateMap(map: ProgramStateMap): Promise<void> {
  if (!safeStorage) return;
  return new Promise((resolve, reject) => {
    safeStorage.set({ [STORAGE_KEYS.programStateMap]: map }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

export async function updateProgramStateMap<T>(
  updater: (
    current: ProgramStateMap,
  ) => { map: ProgramStateMap; result?: T } | Promise<{ map: ProgramStateMap; result?: T }>,
): Promise<T | undefined> {
  return withStorageLock(PROGRAM_STATE_LOCK_NAME, async () => {
    const current = await getProgramStateMap();
    const { map, result } = await updater(current);
    await setProgramStateMap(map);
    return result;
  });
}
