import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  clearLogs,
  clearReloadCount,
  getLogs,
  getReloadCount,
  getSettings,
  setSettings,
} from "../shared/storage";
import {
  CUSTOM_SOUND_MAX_BYTES,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  SOUND_VOLUME_STEP,
  playNotificationSound,
  clampVolume,
} from "../shared/sound";
import {
  clampDeepCheckThresholdSec,
  DEFAULT_SETTINGS,
  DEEP_CHECK_THRESHOLD_MAX_SEC,
  DEEP_CHECK_THRESHOLD_MIN_SEC,
} from "../shared/settings";
import { LOG_MAX, LogEntry, Settings } from "../shared/types";

declare const __DEV__: boolean;

async function updateBadge(enabled: boolean) {
  if (!chrome?.action?.setBadgeText) return;
  try {
    await chrome.action.setBadgeText({ text: enabled ? "" : "Zz" });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Failed to set badge text", e);
  }
}

const Toggle: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    className={`toggle ${checked ? "on" : ""}`}
    aria-pressed={checked}
    disabled={disabled}
    aria-disabled={disabled}
    onClick={() => {
      if (disabled) return;
      onChange(!checked);
    }}
  />
);

const LogList: React.FC<{ logs: LogEntry[] }> = ({ logs }) => {
  const ordered = useMemo(
    () => [...logs].sort((a, b) => b.timestamp - a.timestamp).slice(0, LOG_MAX),
    [logs],
  );

  const formatContextProvider = (log: LogEntry) => {
    if (log.context) {
      return `[${log.context}]${log.providerName ? ` [${log.providerName}]` : ""}`;
    }
    if (log.providerName) {
      return `[${log.providerName}]`;
    }
    return "";
  };

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  if (ordered.length === 0) {
    return <div className="log">ログはまだありません。</div>;
  }
  return (
    <div className="logs">
      {ordered.map((log) => {
        const prefix = formatContextProvider(log);
        const levelClass = `level-${log.level.toLowerCase()}`;
        return (
          <div key={log.id} className={`log ${levelClass}`}>
            <div className="log-header">
              <span>{formatTs(log.timestamp)}</span>
              {prefix ? <span className="log-prefix">{prefix}</span> : null}
            </div>
            <div className="log-body">{log.message}</div>
          </div>
        );
      })}
    </div>
  );
};

export function formatDurationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds.toString().padStart(2, "0")}秒`;
}

const App: React.FC = () => {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [reloadCount, setReloadCount] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusMessageType, setStatusMessageType] = useState<"info" | "error">("info");
  const [customSoundMessage, setCustomSoundMessage] = useState<string>("");
  const [customSoundMessageType, setCustomSoundMessageType] = useState<"info" | "error">("info");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const disabledAll = !settings.enabled;
  const disabledSound = disabledAll || settings.soundEnabled === false;
  const disabledDeepCheckThreshold = disabledAll || settings.deepCheckModeEnabled !== true;

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      const [nextSettings, nextLogs, nextReloadCount] = await Promise.all([
        getSettings(),
        getLogs(),
        getReloadCount(),
      ]);

      if (!isMounted) return;
      setSettingsState(nextSettings);
      setLogs(nextLogs);
      setReloadCount(nextReloadCount);
      await updateBadge(nextSettings.enabled);
      setIsLoading(false);
    })();

    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== "local") return;
      if (changes.logs) {
        const next = changes.logs.newValue as LogEntry[] | undefined;
        if (Array.isArray(next)) {
          setLogs(next);
        }
      }
      if (changes.reloadCount) {
        const next = changes.reloadCount.newValue as { count?: unknown } | undefined;
        if (next && typeof next === "object") {
          const count =
            typeof next.count === "number" && Number.isFinite(next.count) ? next.count : 0;
          setReloadCount(count);
        } else {
          setReloadCount(0);
        }
      }
    };
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }
    return () => {
      isMounted = false;
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(listener);
      }
    };
  }, []);

  const handleClearLogs = async () => {
    try {
      await clearLogs();
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear logs", err);
      showStatusMessage("ログのクリアに失敗しました。", "error");
    }
  };

  const handleClearStatus = async () => {
    try {
      await clearReloadCount();
      setReloadCount(0);
    } catch (err) {
      console.error("Failed to clear reload count", err);
      showStatusMessage("動作状況のクリアに失敗しました。", "error");
    }
  };

  const handleToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, enabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
      await updateBadge(next);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleSoundToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, soundEnabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleDeepCheckModeToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, deepCheckModeEnabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleMonitorOverlayToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, monitorOverlayEnabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleDeepCheckThresholdChange = async (value: number) => {
    const previous = settings;
    const nextThresholdSec = clampDeepCheckThresholdSec(value);
    const nextSettings = { ...settings, deepCheckThresholdSec: nextThresholdSec };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleDebugCurrentTimeCheckToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, debugCurrentTimeCheckEnabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleDebugWarmupToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, debugWarmupEnabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleDebugDeepCheckToggle = async (next: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, debugDeepCheckEnabled: next };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleVolumeChange = async (value: number) => {
    const previous = settings;
    const clamped = clampVolume(value);
    const nextSettings = { ...settings, soundVolume: clamped };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showStatusMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const showStatusMessage = (message: string, type: "info" | "error" = "info") => {
    setStatusMessage(message);
    setStatusMessageType(type);
  };

  const showCustomSoundMessage = (message: string, type: "info" | "error" = "info") => {
    setCustomSoundMessage(message);
    setCustomSoundMessageType(type);
  };

  const handleCustomSoundChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > CUSTOM_SOUND_MAX_BYTES) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(2);
      showCustomSoundMessage(`エラー: ファイルサイズ超過 (${sizeMb}MB)`, "error");
      event.target.value = "";
      return;
    }

    let dataUrl: string;
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch (err) {
      console.error("Failed to load custom sound", err);
      showCustomSoundMessage(
        "音声ファイルの読み込みに失敗しました。別の音声ファイルを選択してください。",
        "error",
      );
      event.target.value = "";
      return;
    }

    const previous = settings;
    const nextSettings = {
      ...previous,
      customSound: { fileName: file.name, dataUrl },
    };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
      showCustomSoundMessage(`カスタム音を保存しました: ${file.name}`, "info");
    } catch (err) {
      console.error("Failed to save custom sound", err);
      setSettingsState(previous);
      showCustomSoundMessage(
        "カスタム音の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。別の音声ファイルを選択してください。",
        "error",
      );
      event.target.value = "";
    }
  };

  const handleClearCustomSound = async () => {
    const previous = settings;
    const nextSettings = { ...settings, customSound: null };
    setSettingsState(nextSettings);
    try {
      await setSettings(nextSettings);
      showCustomSoundMessage("デフォルト音に戻しました", "info");
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsState(previous);
      showCustomSoundMessage(
        "設定の保存に失敗しました（ストレージ容量の上限に達した可能性があります）。",
        "error",
      );
    }
  };

  const handleTestPlay = async () => {
    try {
      await playNotificationSound(
        {
          ...settings,
          // プレビューはオフでも鳴らす。オフ時はデフォルト音を使用。
          soundEnabled: true,
        },
        {
          allowWhenDisabled: true,
          forceDefault: settings.soundEnabled === false,
        },
      );
    } catch (err) {
      showStatusMessage("通知音の再生に失敗しました", "error");
      console.error("Failed to play test sound", err);
    }
  };

  if (isLoading) {
    return (
      <div id="app" className="loading-screen" aria-busy="true">
        <div className="loading-inline">
          <span className="loading-spinner" aria-hidden="true" />
          <p className="loading-text">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div id="app">
      <section className="section">
        <p className="heading">設定</p>
        <div className="section-body">
          <div className="toggle-row">
            <span className="toggle-label">放送停止を検出し自動リロードする</span>
            <Toggle checked={settings.enabled} onChange={handleToggle} />
          </div>

          <div className="sound-section">
            <div className="toggle-row">
              <span className="toggle-label">放送停止検出時に音を鳴らす</span>
              <Toggle
                checked={settings.soundEnabled ?? true}
                onChange={handleSoundToggle}
                disabled={disabledAll}
              />
            </div>

            <div className="slider-block">
              <div className="slider-header">
                <span className="slider-label">音量</span>
                <span className="slider-value">{settings.soundVolume}%</span>
              </div>
              <input
                type="range"
                min={SOUND_VOLUME_MIN}
                max={SOUND_VOLUME_MAX}
                step={SOUND_VOLUME_STEP}
                value={settings.soundVolume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                disabled={disabledSound}
              />
              <div className="slider-scale">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>

            <div className="sound-actions">
              <button className="text-button" onClick={handleTestPlay} disabled={disabledSound}>
                テスト再生
              </button>
            </div>

            <div className="custom-sound">
              <div className="custom-sound-row">
                <div>
                  <p className="custom-sound-label">カスタムファイル (最大1MB)</p>
                  <p className="custom-sound-status">
                    {settings.customSound?.fileName ?? "未設定（デフォルト）"}
                  </p>
                </div>
                <div className="custom-sound-buttons">
                  <label className={`file-button ${disabledSound ? "disabled" : ""}`}>
                    選択
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleCustomSoundChange}
                      disabled={disabledSound}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={handleClearCustomSound}
                    disabled={disabledSound}
                  >
                    デフォルトに戻す
                  </button>
                </div>
              </div>
              {customSoundMessage && (
                <p className={`status-text ${customSoundMessageType} custom-sound-message`}>
                  {customSoundMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <p className="heading">実験機能</p>
        <div className="section-body">
          <div className="sound-section">
            <div className="toggle-row">
              <span className="toggle-label">
                高度な放送停止判定を有効にする
                <br />
                <span className="toggle-note">
                  映像の変化がなく、音も出ていない状態を停止判定に使います
                </span>
              </span>
              <Toggle
                checked={settings.deepCheckModeEnabled ?? false}
                onChange={handleDeepCheckModeToggle}
                disabled={disabledAll}
              />
            </div>

            <div className="slider-block">
              <div className="slider-header">
                <span className="slider-label">高度な停止判定までの時間</span>
                <span className="slider-value">
                  {formatDurationLabel(
                    settings.deepCheckThresholdSec ?? DEEP_CHECK_THRESHOLD_MIN_SEC,
                  )}
                </span>
              </div>
              <input
                type="range"
                min={DEEP_CHECK_THRESHOLD_MIN_SEC}
                max={DEEP_CHECK_THRESHOLD_MAX_SEC}
                step={10}
                value={settings.deepCheckThresholdSec ?? DEEP_CHECK_THRESHOLD_MIN_SEC}
                onChange={(e) => handleDeepCheckThresholdChange(Number(e.target.value))}
                disabled={disabledDeepCheckThreshold}
              />
              <div className="slider-scale">
                <span>20秒</span>
                <span>5分</span>
              </div>
            </div>

            <div className="toggle-row">
              <span className="toggle-label">
                監視状況を画面に表示する
                <br />
                <span className="toggle-note">監視の判定状況をページ上に表示します</span>
              </span>
              <Toggle
                checked={settings.monitorOverlayEnabled ?? false}
                onChange={handleMonitorOverlayToggle}
                disabled={disabledAll}
              />
            </div>
          </div>
        </div>
      </section>

      {__DEV__ && (
        <section className="section">
          <p className="heading">デバッグ</p>
          <div className="section-body debug-section">
            <div className="toggle-row">
              <span className="toggle-label">
                warmup を有効にする
                <br />
                <span className="toggle-note">
                  OFF にすると開始直後の 60 秒待ちをスキップします
                </span>
              </span>
              <Toggle
                checked={settings.debugWarmupEnabled ?? true}
                onChange={handleDebugWarmupToggle}
                disabled={disabledAll}
              />
            </div>

            <div className="toggle-row">
              <span className="toggle-label">
                通常判定を有効にする
                <br />
                <span className="toggle-note">currentTime 停滞による停止判定</span>
              </span>
              <Toggle
                checked={settings.debugCurrentTimeCheckEnabled ?? true}
                onChange={handleDebugCurrentTimeCheckToggle}
                disabled={disabledAll}
              />
            </div>

            <div className="toggle-row">
              <span className="toggle-label">
                deep 判定を有効にする
                <br />
                <span className="toggle-note">deep check mode が ON のときだけ動作します</span>
              </span>
              <Toggle
                checked={settings.debugDeepCheckEnabled ?? true}
                onChange={handleDebugDeepCheckToggle}
                disabled={disabledAll}
              />
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="heading-row">
          <p className="heading">動作状況</p>
          <button className="text-button" onClick={handleClearStatus}>
            クリア
          </button>
        </div>
        <div className="section-body stats-body">
          <div className="stats-row">
            <span className="stats-label">自動リロード発動回数</span>
            <span className="stats-value">{reloadCount.toLocaleString()}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="heading-row">
          <p className="heading">動作ログ</p>
          <button className="text-button" onClick={handleClearLogs}>
            クリア
          </button>
        </div>
        <div className="logs-container">
          <LogList logs={logs} />
        </div>
      </section>
      {statusMessage && (
        <div className="status-footer">
          <p className={`status-text ${statusMessageType}`}>{statusMessage}</p>
        </div>
      )}
    </div>
  );
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
