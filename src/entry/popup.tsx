import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { clearLogs, getLogs, getSettings, setSettings } from "../shared/storage";
import {
  CUSTOM_SOUND_MAX_BYTES,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  SOUND_VOLUME_STEP,
  playNotificationSound,
  clampVolume,
} from "../shared/sound";
import { LOG_MAX, LogEntry, Settings } from "../shared/types";

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
      {ordered.map((log) => (
        <div key={log.id} className="log">
          <span>{formatTs(log.timestamp)}</span>
          {log.context
            ? `[${log.context}] ${log.providerName ? `[${log.providerName}] ` : ""}`
            : log.providerName
            ? `[${log.providerName}] `
            : ""}
          {log.message}
        </div>
      ))}
    </div>
  );
};

const defaultSettings: Settings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: SOUND_VOLUME_MAX,
  customSound: null,
};

const App: React.FC = () => {
  const [settings, setSettingsState] = useState<Settings>(defaultSettings);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [soundMessage, setSoundMessage] = useState<string>("");
  const [soundMessageType, setSoundMessageType] = useState<"info" | "error">("info");

  const disabledAll = !settings.enabled;
  const disabledSound = disabledAll || settings.soundEnabled === false;

  useEffect(() => {
    getSettings().then(async (s) => {
      const merged = { ...defaultSettings, ...s };
      setSettingsState(merged);
      await updateBadge(merged.enabled);
    });
    getLogs().then(setLogs);

    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== "local" || !changes.logs) return;
      const next = changes.logs.newValue as LogEntry[] | undefined;
      if (Array.isArray(next)) {
        setLogs(next);
      }
    };
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }
    return () => {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(listener);
      }
    };
  }, []);

  const handleClearLogs = async () => {
    await clearLogs();
    setLogs([]);
  };

  const handleToggle = async (next: boolean) => {
    const nextSettings = { ...settings, enabled: next };
    setSettingsState(nextSettings);
    await setSettings(nextSettings);
    await updateBadge(next);
  };

  const handleSoundToggle = async (next: boolean) => {
    const nextSettings = { ...settings, soundEnabled: next };
    setSettingsState(nextSettings);
    await setSettings(nextSettings);
  };

  const handleVolumeChange = async (value: number) => {
    const clamped = clampVolume(value);
    const nextSettings = { ...settings, soundVolume: clamped };
    setSettingsState(nextSettings);
    await setSettings(nextSettings);
  };

  const showSoundMessage = (message: string, type: "info" | "error" = "info") => {
    setSoundMessage(message);
    setSoundMessageType(type);
  };

  const handleCustomSoundChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > CUSTOM_SOUND_MAX_BYTES) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(2);
      showSoundMessage(`エラー: ファイルサイズ超過 (${sizeMb}MB)`, "error");
      event.target.value = "";
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const nextSettings = {
        ...settings,
        customSound: { fileName: file.name, dataUrl },
      };
      setSettingsState(nextSettings);
      await setSettings(nextSettings);
      showSoundMessage(`カスタム音を保存しました: ${file.name}`, "info");
    } catch (err) {
      console.error("Failed to load custom sound", err);
      showSoundMessage("音声の読み込みに失敗しました。別の mp3 を選択してください。", "error");
      event.target.value = "";
    }
  };

  const handleClearCustomSound = async () => {
    const nextSettings = { ...settings, customSound: null };
    setSettingsState(nextSettings);
    await setSettings(nextSettings);
    showSoundMessage("デフォルト音に戻しました", "info");
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
      showSoundMessage("通知音の再生に失敗しました", "error");
      console.error("Failed to play test sound", err);
    }
  };

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
                試しに鳴らす
              </button>
            </div>

            <div className="custom-sound">
              <div className="custom-sound-row">
                <div>
                  <p className="custom-sound-label">カスタム音声ファイル (最大1MB)</p>
                  <p className="custom-sound-status">
                    {settings.customSound?.fileName ?? "未設定（デフォルト音）"}
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
              {soundMessage && <p className={`status-text ${soundMessageType}`}>{soundMessage}</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="heading-row">
          <p className="heading">動作ログ（最新{LOG_MAX.toLocaleString()}件）</p>
          <button className="text-button" onClick={handleClearLogs}>
            クリア
          </button>
        </div>
        <div className="logs-container">
          <LogList logs={logs} />
        </div>
      </section>
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
