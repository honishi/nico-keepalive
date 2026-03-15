import { DEEP_CHECK_FRAME_HEIGHT, DEEP_CHECK_FRAME_WIDTH } from "../shared/deep-check";

const MONITOR_DEBUG_PANEL_ID = "nico-keepalive-monitor-debug";
const SECTION_TITLE_MARGIN_BOTTOM_PX = 6;
const SECTION_CONTENT_MARGIN_BOTTOM_PX = 10;

let monitorDebugOverlayMinimized = false;

export type NormalCheckDebugSnapshot = {
  currentTimeSec: number;
  lastObservedCurrentTimeSec: number;
  deltaSec: number;
  timeMoved: boolean;
  idleSec: number;
  thresholdSec: number;
  epsilonSec: number;
  enabled: boolean;
  stalled: boolean;
  paused: boolean;
  ended: boolean;
};

export type DeepCheckOverlaySnapshot = {
  enabled: boolean;
  available: boolean;
  stalled: boolean;
  visualEligible: boolean;
  frameChanged: boolean;
  frameAverageDiff?: number;
  previousFrame?: Uint8ClampedArray | null;
  nextFrame?: Uint8ClampedArray | null;
  audioEligible: boolean;
  audioSilent: boolean;
  audioRms?: number;
  visualIdleSec?: number;
  audioIdleSec?: number;
  thresholdSec: number;
  muted: boolean;
  volume: number;
};

export type MonitorDebugOverlayUpdateArgs = {
  enabled: boolean;
  inWarmup?: boolean;
  warmupRemainingMs?: number;
  normalCheck?: NormalCheckDebugSnapshot;
  deepCheck?: DeepCheckOverlaySnapshot | null;
};

type MonitorDebugOverlayElements = {
  root: HTMLDivElement;
  header: HTMLDivElement;
  title: HTMLDivElement;
  body: HTMLDivElement;
  toggleButton: HTMLButtonElement;
  previousCanvas: HTMLCanvasElement;
  currentCanvas: HTMLCanvasElement;
  headerStats: HTMLPreElement;
  normalTitle: HTMLDivElement;
  normalStats: HTMLPreElement;
  deepTitle: HTMLDivElement;
  deepCanvases: HTMLDivElement;
  deepStats: HTMLPreElement;
};

export function hideMonitorDebugOverlay() {
  const existing = document.getElementById(MONITOR_DEBUG_PANEL_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
}

export function updateMonitorDebugOverlay(args: MonitorDebugOverlayUpdateArgs) {
  if (!args.enabled) {
    hideMonitorDebugOverlay();
    return;
  }

  const panel = ensureMonitorDebugOverlay();
  if (!panel) return;

  applyMinimizedState(panel);

  const deepCheck = args.deepCheck;
  drawFrameThumbnail(panel.previousCanvas, deepCheck?.previousFrame);
  drawFrameThumbnail(panel.currentCanvas, deepCheck?.nextFrame);

  const normalCheck = args.normalCheck;
  const deepCheckEnabled = deepCheck?.enabled ?? false;
  panel.normalTitle.textContent = `🔵 normal check (enabled=${normalCheck?.enabled ?? false})`;
  panel.deepTitle.textContent = `🔵 deep check (enabled=${deepCheckEnabled} available=${
    deepCheck?.available ?? false
  })`;
  panel.normalTitle.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepTitle.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepCanvases.style.display = deepCheckEnabled ? "flex" : "none";
  panel.deepStats.style.display = "block";
  panel.headerStats.textContent = [
    `paused=${normalCheck?.paused ?? false} ended=${normalCheck?.ended ?? false}`,
    `${formatOverlayBoolean("warmup", args.inWarmup === true, "warmup")} remainingSec=${
      typeof args.warmupRemainingMs === "number" ? Math.ceil(args.warmupRemainingMs / 1000) : 0
    }`,
  ].join("\n");
  panel.normalStats.textContent = [
    `currentTime=${normalCheck?.currentTimeSec.toFixed(2) ?? "n/a"} lastObserved=${
      normalCheck?.lastObservedCurrentTimeSec.toFixed(2) ?? "n/a"
    } delta=${normalCheck?.deltaSec.toFixed(2) ?? "n/a"} ${formatOverlayBoolean(
      "moved",
      normalCheck?.timeMoved ?? false,
      "movement",
    )}`,
    `idleSec=${normalCheck?.idleSec.toFixed(1) ?? "n/a"} thresholdSec=${
      normalCheck?.thresholdSec ?? "n/a"
    } epsilonSec=${normalCheck?.epsilonSec.toFixed(2) ?? "n/a"}`,
    formatOverlayBoolean("stalled", normalCheck?.stalled ?? false, "stalled"),
  ].join("\n");
  panel.deepStats.textContent = [
    `frameDiff=${
      typeof deepCheck?.frameAverageDiff === "number"
        ? deepCheck.frameAverageDiff.toFixed(2)
        : "n/a"
    } ${formatOverlayBoolean("changed", deepCheck?.frameChanged ?? false, "movement")} eligible=${
      deepCheck?.visualEligible ?? false
    }`,
    `audioRms=${
      typeof deepCheck?.audioRms === "number" ? deepCheck.audioRms.toFixed(2) : "n/a"
    } ${formatOverlayBoolean("silent", deepCheck?.audioSilent ?? false, "silent")} eligible=${
      deepCheck?.audioEligible ?? false
    }`,
    `visualIdleSec=${
      typeof deepCheck?.visualIdleSec === "number" ? deepCheck.visualIdleSec.toFixed(1) : "n/a"
    } audioIdleSec=${
      typeof deepCheck?.audioIdleSec === "number" ? deepCheck.audioIdleSec.toFixed(1) : "n/a"
    } thresholdSec=${deepCheck?.thresholdSec ?? "n/a"}`,
    `muted=${deepCheck?.muted ?? false} volume=${
      typeof deepCheck?.volume === "number" ? deepCheck.volume.toFixed(2) : "n/a"
    } ${formatOverlayBoolean("stalled", deepCheck?.stalled ?? false, "stalled")}`,
  ].join("\n");
  if (!deepCheckEnabled) {
    panel.deepStats.textContent = "check disabled";
  }
}

function formatOverlayBoolean(
  label: string,
  value: boolean,
  kind: "warmup" | "movement" | "silent" | "stalled",
): string {
  switch (kind) {
    case "warmup":
      return value ? `😴${label}=true` : `👀${label}=false`;
    case "movement":
      return value ? `✅${label}=true` : `‼️${label}=false`;
    case "silent":
      return value ? `‼️${label}=true` : `✅${label}=false`;
    case "stalled":
      return value ? `‼️${label}=true` : `✅${label}=false`;
  }
}

function ensureMonitorDebugOverlay(): MonitorDebugOverlayElements | null {
  const existing = document.getElementById(MONITOR_DEBUG_PANEL_ID);
  if (existing instanceof HTMLDivElement) {
    const header = existing.querySelector("[data-role='header']") as HTMLDivElement | null;
    const title = existing.querySelector("[data-role='title']") as HTMLDivElement | null;
    const body = existing.querySelector("[data-role='body']") as HTMLDivElement | null;
    const toggleButton = existing.querySelector("[data-role='toggle']") as HTMLButtonElement | null;
    const previousCanvas = existing.querySelector(
      "[data-role='previous']",
    ) as HTMLCanvasElement | null;
    const currentCanvas = existing.querySelector(
      "[data-role='current']",
    ) as HTMLCanvasElement | null;
    const headerStats = existing.querySelector(
      "[data-role='header-stats']",
    ) as HTMLPreElement | null;
    const normalTitle = existing.querySelector(
      "[data-role='normal-title']",
    ) as HTMLDivElement | null;
    const normalStats = existing.querySelector(
      "[data-role='normal-stats']",
    ) as HTMLPreElement | null;
    const deepTitle = existing.querySelector("[data-role='deep-title']") as HTMLDivElement | null;
    const deepCanvases = existing.querySelector(
      "[data-role='deep-canvases']",
    ) as HTMLDivElement | null;
    const deepStats = existing.querySelector("[data-role='deep-stats']") as HTMLPreElement | null;
    if (
      header &&
      title &&
      body &&
      toggleButton &&
      previousCanvas &&
      currentCanvas &&
      headerStats &&
      normalTitle &&
      normalStats &&
      deepTitle &&
      deepCanvases &&
      deepStats
    ) {
      return {
        root: existing,
        header,
        title,
        body,
        toggleButton,
        previousCanvas,
        currentCanvas,
        headerStats,
        normalTitle,
        normalStats,
        deepTitle,
        deepCanvases,
        deepStats,
      };
    }
  }

  const root = document.createElement("div");
  root.id = MONITOR_DEBUG_PANEL_ID;
  root.style.position = "fixed";
  root.style.left = "16px";
  root.style.top = "16px";
  root.style.zIndex = "999999";
  root.style.padding = "10px";
  root.style.background = "rgba(0, 0, 0, 0.85)";
  root.style.color = "#fff";
  root.style.borderRadius = "8px";
  root.style.fontFamily = "ui-monospace, SFMono-Regular, monospace";
  root.style.fontSize = "11px";
  root.style.lineHeight = "1.4";
  root.style.pointerEvents = "auto";
  root.style.maxWidth = "360px";

  const header = document.createElement("div");
  header.dataset.role = "header";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "8px";
  header.style.marginBottom = "8px";

  const title = document.createElement("div");
  title.dataset.role = "title";
  title.textContent = "🔵 nico-keepalive debug view";
  title.style.fontWeight = "700";

  const toggleButton = document.createElement("button");
  toggleButton.dataset.role = "toggle";
  toggleButton.type = "button";
  toggleButton.textContent = monitorDebugOverlayMinimized ? "+" : "-";
  toggleButton.style.pointerEvents = "auto";
  toggleButton.style.border = "1px solid rgba(255,255,255,0.25)";
  toggleButton.style.background = "rgba(255,255,255,0.08)";
  toggleButton.style.color = "#fff";
  toggleButton.style.borderRadius = "4px";
  toggleButton.style.font = "inherit";
  toggleButton.style.lineHeight = "1";
  toggleButton.style.padding = "2px 6px";
  toggleButton.style.cursor = "pointer";
  toggleButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    monitorDebugOverlayMinimized = !monitorDebugOverlayMinimized;
    applyMinimizedState(panel);
  });

  const body = document.createElement("div");
  body.dataset.role = "body";
  body.style.display = monitorDebugOverlayMinimized ? "none" : "block";
  body.style.pointerEvents = "none";

  const panel = {
    root,
    header,
    title,
    body,
    toggleButton,
    previousCanvas: document.createElement("canvas"),
    currentCanvas: document.createElement("canvas"),
    headerStats: document.createElement("pre"),
    normalTitle: document.createElement("div"),
    normalStats: document.createElement("pre"),
    deepTitle: document.createElement("div"),
    deepCanvases: document.createElement("div"),
    deepStats: document.createElement("pre"),
  };

  header.addEventListener("click", (event) => {
    if (!monitorDebugOverlayMinimized) return;
    event.preventDefault();
    monitorDebugOverlayMinimized = false;
    applyMinimizedState(panel);
  });

  header.appendChild(title);
  header.appendChild(toggleButton);

  panel.headerStats.dataset.role = "header-stats";
  panel.headerStats.style.margin = `0 0 ${SECTION_CONTENT_MARGIN_BOTTOM_PX}px`;
  panel.headerStats.style.paddingLeft = "12px";
  panel.headerStats.style.whiteSpace = "pre-wrap";

  panel.normalTitle.dataset.role = "normal-title";
  panel.normalTitle.textContent = "🔵 normal check";
  panel.normalTitle.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.normalTitle.style.fontWeight = "700";

  panel.normalStats.dataset.role = "normal-stats";
  panel.normalStats.style.margin = `0 0 ${SECTION_CONTENT_MARGIN_BOTTOM_PX}px`;
  panel.normalStats.style.paddingLeft = "12px";
  panel.normalStats.style.whiteSpace = "pre-wrap";

  panel.deepTitle.dataset.role = "deep-title";
  panel.deepTitle.textContent = "🔵 deep check";
  panel.deepTitle.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepTitle.style.fontWeight = "700";

  panel.deepCanvases.dataset.role = "deep-canvases";
  panel.deepCanvases.style.display = "flex";
  panel.deepCanvases.style.alignItems = "center";
  panel.deepCanvases.style.gap = "8px";
  panel.deepCanvases.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepCanvases.style.paddingLeft = "12px";

  panel.previousCanvas.dataset.role = "previous";
  panel.previousCanvas.width = DEEP_CHECK_FRAME_WIDTH;
  panel.previousCanvas.height = DEEP_CHECK_FRAME_HEIGHT;
  panel.previousCanvas.style.width = "128px";
  panel.previousCanvas.style.height = "72px";
  panel.previousCanvas.style.background = "#111";
  panel.previousCanvas.style.border = "1px solid rgba(255,255,255,0.2)";

  const arrow = document.createElement("div");
  arrow.textContent = "➔";
  arrow.style.color = "rgba(255,255,255,0.7)";
  arrow.style.fontSize = "16px";
  arrow.style.lineHeight = "1";

  panel.currentCanvas.dataset.role = "current";
  panel.currentCanvas.width = DEEP_CHECK_FRAME_WIDTH;
  panel.currentCanvas.height = DEEP_CHECK_FRAME_HEIGHT;
  panel.currentCanvas.style.width = "128px";
  panel.currentCanvas.style.height = "72px";
  panel.currentCanvas.style.background = "#111";
  panel.currentCanvas.style.border = "1px solid rgba(255,255,255,0.2)";

  panel.deepCanvases.appendChild(panel.previousCanvas);
  panel.deepCanvases.appendChild(arrow);
  panel.deepCanvases.appendChild(panel.currentCanvas);

  panel.deepStats.dataset.role = "deep-stats";
  panel.deepStats.style.margin = "0";
  panel.deepStats.style.paddingLeft = "12px";
  panel.deepStats.style.whiteSpace = "pre-wrap";

  body.appendChild(panel.headerStats);
  body.appendChild(panel.normalTitle);
  body.appendChild(panel.normalStats);
  body.appendChild(panel.deepTitle);
  body.appendChild(panel.deepCanvases);
  body.appendChild(panel.deepStats);

  root.appendChild(header);
  root.appendChild(body);
  applyMinimizedState(panel);
  document.body.appendChild(root);

  return panel;
}

function applyMinimizedState(panel: MonitorDebugOverlayElements) {
  panel.root.style.padding = monitorDebugOverlayMinimized ? "6px 8px" : "10px";
  panel.header.style.marginBottom = monitorDebugOverlayMinimized
    ? "0"
    : `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.title.textContent = monitorDebugOverlayMinimized
    ? "🔵 nico-keepalive"
    : "🔵 nico-keepalive debug view";
  panel.body.style.display = monitorDebugOverlayMinimized ? "none" : "block";
  panel.toggleButton.textContent = monitorDebugOverlayMinimized ? "+" : "-";
}

function drawFrameThumbnail(
  targetCanvas: HTMLCanvasElement,
  frame: Uint8ClampedArray | null | undefined,
) {
  const context = targetCanvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  if (!frame) {
    context.fillStyle = "#111";
    context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    context.fillStyle = "#999";
    context.font = "6px sans-serif";
    context.fillText("n/a", 2, 8);
    return;
  }

  const imageData = new ImageData(
    new Uint8ClampedArray(frame),
    DEEP_CHECK_FRAME_WIDTH,
    DEEP_CHECK_FRAME_HEIGHT,
  );
  context.putImageData(imageData, 0, 0);
}
