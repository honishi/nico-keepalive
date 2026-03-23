import { DEEP_CHECK_FRAME_HEIGHT, DEEP_CHECK_FRAME_WIDTH } from "../content/checks/deep-check-core";

const MONITOR_OVERLAY_PANEL_ID = "nico-keepalive-monitor";
const SECTION_TITLE_MARGIN_BOTTOM_PX = 6;
const SECTION_CONTENT_MARGIN_BOTTOM_PX = 10;
const MONITOR_OVERLAY_INITIAL_LEFT_PX = 16;
const MONITOR_OVERLAY_INITIAL_TOP_PX = 16;
const MONITOR_OVERLAY_DRAG_THRESHOLD_PX = 3;
const OVERLAY_ICON_COLUMN_PX = 20;
const OVERLAY_ICON_GAP_PX = 8;
const OVERLAY_SECTION_INDENT_PX = OVERLAY_ICON_COLUMN_PX + OVERLAY_ICON_GAP_PX;

let monitorOverlayMinimized = true;
let monitorOverlayPosition = {
  left: MONITOR_OVERLAY_INITIAL_LEFT_PX,
  top: MONITOR_OVERLAY_INITIAL_TOP_PX,
};

export type NormalCheckSnapshot = {
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

export type MonitorOverlayUpdateArgs = {
  enabled: boolean;
  inWarmup?: boolean;
  warmupRemainingMs?: number;
  chasePlay?: boolean;
  normalCheck?: NormalCheckSnapshot;
  deepCheck?: DeepCheckOverlaySnapshot | null;
};

type MonitorOverlayElements = {
  root: HTMLDivElement;
  header: HTMLDivElement;
  dragHandle: HTMLDivElement;
  statusSummary: HTMLDivElement;
  body: HTMLDivElement;
  toggleButton: HTMLButtonElement;
  previousCanvas: HTMLCanvasElement;
  currentCanvas: HTMLCanvasElement;
  generalTitle: HTMLDivElement;
  generalStats: HTMLPreElement;
  normalTitle: HTMLDivElement;
  normalStats: HTMLPreElement;
  deepTitle: HTMLDivElement;
  deepCanvases: HTMLDivElement;
  deepStats: HTMLPreElement;
};

function clampMonitorOverlayPosition(left: number, top: number, root: HTMLDivElement) {
  const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
  return {
    left: Math.min(maxLeft, Math.max(0, left)),
    top: Math.min(maxTop, Math.max(0, top)),
  };
}

function applyMonitorOverlayPosition(panel: MonitorOverlayElements) {
  monitorOverlayPosition = clampMonitorOverlayPosition(
    monitorOverlayPosition.left,
    monitorOverlayPosition.top,
    panel.root,
  );
  panel.root.style.left = `${monitorOverlayPosition.left}px`;
  panel.root.style.top = `${monitorOverlayPosition.top}px`;
}

export function hideMonitorOverlay() {
  monitorOverlayMinimized = true;
  const existing = document.getElementById(MONITOR_OVERLAY_PANEL_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
}

export function updateMonitorOverlay(args: MonitorOverlayUpdateArgs) {
  if (!args.enabled) {
    hideMonitorOverlay();
    return;
  }

  const panel = ensureMonitorOverlay();
  if (!panel) return;

  applyMinimizedState(panel);

  const deepCheck = args.deepCheck;
  drawFrameThumbnail(panel.previousCanvas, deepCheck?.previousFrame);
  drawFrameThumbnail(panel.currentCanvas, deepCheck?.nextFrame);

  const normalCheck = args.normalCheck;
  const shouldMaskStatusSummary =
    (normalCheck?.paused ?? false) || (normalCheck?.ended ?? false) || (args.chasePlay ?? false);
  const deepCheckEnabled = deepCheck?.enabled ?? false;
  // ステータスサマリーでは、deep check の映像/音の両方が使えるときだけ状態を表示する。
  const canShowDeepCheckSummaryStatus =
    deepCheckEnabled &&
    (deepCheck?.visualEligible ?? false) === true &&
    (deepCheck?.audioEligible ?? false) === true;
  const collapsedStopStalled = (normalCheck?.stalled ?? false) || (deepCheck?.stalled ?? false);
  setOverlayTitle(panel.generalTitle, "🔵", "general status");
  setOverlayTitle(
    panel.normalTitle,
    "🔵",
    `normal check (enabled=${normalCheck?.enabled ?? false})`,
  );
  setOverlayTitle(
    panel.deepTitle,
    "🔵",
    `deep check (enabled=${deepCheckEnabled} available=${deepCheck?.available ?? false})`,
  );
  const statusSummaryEntries: [string, string][] = [
    ["再生", formatOverlayStatusIcon(normalCheck?.timeMoved ?? false, "movement")],
    [
      "映像",
      canShowDeepCheckSummaryStatus
        ? formatOverlayStatusIcon(deepCheck?.frameChanged ?? false, "movement")
        : "-",
    ],
    [
      "音",
      canShowDeepCheckSummaryStatus
        ? formatOverlayStatusIcon(deepCheck?.audioSilent ?? false, "silent")
        : "-",
    ],
    ["判定", formatOverlayStatusIcon(collapsedStopStalled, "stalled")],
  ];
  panel.statusSummary.textContent = statusSummaryEntries
    .map(([label, value]) => `${label}: ${shouldMaskStatusSummary ? "ー" : value}`)
    .join("  ");
  panel.normalTitle.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepTitle.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepCanvases.style.display = deepCheckEnabled ? "flex" : "none";
  panel.deepStats.style.display = "block";
  panel.generalStats.textContent = [
    `paused=${normalCheck?.paused ?? false} ended=${normalCheck?.ended ?? false} chasePlay=${
      args.chasePlay ?? false
    }`,
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
      return value ? `💤${label}=true` : `👀${label}=false`;
    case "movement":
      return value ? `✅${label}=true` : `⚠️${label}=false`;
    case "silent":
      return value ? `⚠️${label}=true` : `✅${label}=false`;
    case "stalled":
      return value ? `🛑${label}=true` : `✅${label}=false`;
  }
}

function ensureMonitorOverlay(): MonitorOverlayElements | null {
  const existing = document.getElementById(MONITOR_OVERLAY_PANEL_ID);
  if (existing instanceof HTMLDivElement) {
    const header = existing.querySelector("[data-role='header']") as HTMLDivElement | null;
    const dragHandle = existing.querySelector("[data-role='drag-handle']") as HTMLDivElement | null;
    const statusSummary = existing.querySelector(
      "[data-role='status-summary']",
    ) as HTMLDivElement | null;
    const body = existing.querySelector("[data-role='body']") as HTMLDivElement | null;
    const toggleButton = existing.querySelector("[data-role='toggle']") as HTMLButtonElement | null;
    const previousCanvas = existing.querySelector(
      "[data-role='previous']",
    ) as HTMLCanvasElement | null;
    const currentCanvas = existing.querySelector(
      "[data-role='current']",
    ) as HTMLCanvasElement | null;
    const generalTitle = existing.querySelector(
      "[data-role='general-title']",
    ) as HTMLDivElement | null;
    const generalStats = existing.querySelector(
      "[data-role='general-stats']",
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
      dragHandle &&
      statusSummary &&
      body &&
      toggleButton &&
      previousCanvas &&
      currentCanvas &&
      generalTitle &&
      generalStats &&
      normalTitle &&
      normalStats &&
      deepTitle &&
      deepCanvases &&
      deepStats
    ) {
      return {
        root: existing,
        header,
        dragHandle,
        statusSummary,
        body,
        toggleButton,
        previousCanvas,
        currentCanvas,
        generalTitle,
        generalStats,
        normalTitle,
        normalStats,
        deepTitle,
        deepCanvases,
        deepStats,
      };
    }
  }

  const root = document.createElement("div");
  root.id = MONITOR_OVERLAY_PANEL_ID;
  root.style.position = "fixed";
  root.style.left = `${monitorOverlayPosition.left}px`;
  root.style.top = `${monitorOverlayPosition.top}px`;
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
  header.style.gap = `${OVERLAY_ICON_GAP_PX}px`;
  header.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;

  const dragHandle = document.createElement("div");
  dragHandle.dataset.role = "drag-handle";
  dragHandle.style.display = "flex";
  dragHandle.style.alignItems = "center";
  dragHandle.style.flex = "1";
  dragHandle.style.minWidth = "0";
  dragHandle.style.cursor = "grab";

  const toggleButton = document.createElement("button");
  toggleButton.dataset.role = "toggle";
  toggleButton.type = "button";
  toggleButton.style.pointerEvents = "auto";
  toggleButton.style.display = "inline-flex";
  toggleButton.style.alignItems = "center";
  toggleButton.style.justifyContent = "center";
  toggleButton.style.width = `${OVERLAY_ICON_COLUMN_PX}px`;
  toggleButton.style.height = `${OVERLAY_ICON_COLUMN_PX}px`;
  toggleButton.style.padding = "0";
  toggleButton.style.borderStyle = "none";
  toggleButton.style.borderWidth = "0";
  toggleButton.style.background = "transparent";
  toggleButton.style.color = "#fff";
  toggleButton.style.font = "inherit";
  toggleButton.style.fontSize = "16px";
  toggleButton.style.fontWeight = "700";
  toggleButton.style.lineHeight = "1";
  toggleButton.style.cursor = "pointer";
  toggleButton.style.flexShrink = "0";
  syncToggleButton(toggleButton, monitorOverlayMinimized);
  toggleButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    monitorOverlayMinimized = !monitorOverlayMinimized;
    applyMinimizedState(panel);
  });

  const body = document.createElement("div");
  body.dataset.role = "body";
  body.style.display = monitorOverlayMinimized ? "none" : "block";
  body.style.pointerEvents = "none";

  const panel = {
    root,
    header,
    dragHandle,
    statusSummary: document.createElement("div"),
    body,
    toggleButton,
    previousCanvas: document.createElement("canvas"),
    currentCanvas: document.createElement("canvas"),
    generalTitle: document.createElement("div"),
    generalStats: document.createElement("pre"),
    normalTitle: document.createElement("div"),
    normalStats: document.createElement("pre"),
    deepTitle: document.createElement("div"),
    deepCanvases: document.createElement("div"),
    deepStats: document.createElement("pre"),
  };

  let dragPointerId: number | null = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;
  let suppressHeaderClick = false;

  const endDrag = () => {
    dragPointerId = null;
    dragHandle.style.cursor = "grab";
    document.body.style.userSelect = "";
  };

  dragHandle.addEventListener("pointerdown", (event) => {
    dragPointerId = event.pointerId;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    dragStartLeft = monitorOverlayPosition.left;
    dragStartTop = monitorOverlayPosition.top;
    suppressHeaderClick = false;
    dragHandle.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    dragHandle.setPointerCapture(event.pointerId);
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStartClientX;
    const deltaY = event.clientY - dragStartClientY;

    if (
      Math.abs(deltaX) >= MONITOR_OVERLAY_DRAG_THRESHOLD_PX ||
      Math.abs(deltaY) >= MONITOR_OVERLAY_DRAG_THRESHOLD_PX
    ) {
      suppressHeaderClick = true;
    }

    monitorOverlayPosition = {
      left: dragStartLeft + deltaX,
      top: dragStartTop + deltaY,
    };
    applyMonitorOverlayPosition(panel);
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (dragPointerId !== event.pointerId) return;
    dragHandle.releasePointerCapture(event.pointerId);
    endDrag();
  });

  dragHandle.addEventListener("pointercancel", (event) => {
    if (dragPointerId !== event.pointerId) return;
    endDrag();
  });

  dragHandle.addEventListener("click", (event) => {
    if (suppressHeaderClick) {
      suppressHeaderClick = false;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    monitorOverlayMinimized = !monitorOverlayMinimized;
    applyMinimizedState(panel);
  });

  panel.statusSummary.dataset.role = "status-summary";
  panel.statusSummary.style.display = "flex";
  panel.statusSummary.style.alignItems = "center";
  panel.statusSummary.style.margin = "0";
  panel.statusSummary.style.whiteSpace = "pre-wrap";
  panel.statusSummary.style.fontWeight = "700";
  panel.statusSummary.style.flex = "1";

  dragHandle.appendChild(panel.statusSummary);
  header.appendChild(toggleButton);
  header.appendChild(dragHandle);

  panel.generalTitle.dataset.role = "general-title";
  styleOverlayTitle(panel.generalTitle);
  setOverlayTitle(panel.generalTitle, "🔵", "general status");

  panel.generalStats.dataset.role = "general-stats";
  panel.generalStats.style.margin = `0 0 ${SECTION_CONTENT_MARGIN_BOTTOM_PX}px`;
  panel.generalStats.style.paddingLeft = `${OVERLAY_SECTION_INDENT_PX}px`;
  panel.generalStats.style.whiteSpace = "pre-wrap";

  panel.normalTitle.dataset.role = "normal-title";
  styleOverlayTitle(panel.normalTitle);
  setOverlayTitle(panel.normalTitle, "🔵", "normal check");

  panel.normalStats.dataset.role = "normal-stats";
  panel.normalStats.style.margin = `0 0 ${SECTION_CONTENT_MARGIN_BOTTOM_PX}px`;
  panel.normalStats.style.paddingLeft = `${OVERLAY_SECTION_INDENT_PX}px`;
  panel.normalStats.style.whiteSpace = "pre-wrap";

  panel.deepTitle.dataset.role = "deep-title";
  styleOverlayTitle(panel.deepTitle);
  setOverlayTitle(panel.deepTitle, "🔵", "deep check");

  panel.deepCanvases.dataset.role = "deep-canvases";
  panel.deepCanvases.style.display = "flex";
  panel.deepCanvases.style.alignItems = "center";
  panel.deepCanvases.style.gap = "8px";
  panel.deepCanvases.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.deepCanvases.style.paddingLeft = `${OVERLAY_SECTION_INDENT_PX}px`;

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
  panel.deepStats.style.paddingLeft = `${OVERLAY_SECTION_INDENT_PX}px`;
  panel.deepStats.style.whiteSpace = "pre-wrap";

  body.appendChild(panel.generalTitle);
  body.appendChild(panel.generalStats);
  body.appendChild(panel.normalTitle);
  body.appendChild(panel.normalStats);
  body.appendChild(panel.deepTitle);
  body.appendChild(panel.deepCanvases);
  body.appendChild(panel.deepStats);

  root.appendChild(header);
  root.appendChild(body);
  applyMinimizedState(panel);
  document.body.appendChild(root);
  applyMonitorOverlayPosition(panel);

  return panel;
}

function applyMinimizedState(panel: MonitorOverlayElements) {
  panel.root.style.padding = monitorOverlayMinimized ? "6px 8px" : "10px";
  panel.header.style.marginBottom = monitorOverlayMinimized
    ? "0"
    : `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  panel.body.style.display = monitorOverlayMinimized ? "none" : "block";
  syncToggleButton(panel.toggleButton, monitorOverlayMinimized);
  applyMonitorOverlayPosition(panel);
}

function syncToggleButton(button: HTMLButtonElement, minimized: boolean) {
  button.dataset.state = minimized ? "collapsed" : "expanded";
  button.setAttribute(
    "aria-label",
    minimized ? "Expand monitor overlay" : "Collapse monitor overlay",
  );
  button.textContent = minimized ? "＋" : "−";
}

function styleOverlayTitle(title: HTMLDivElement) {
  title.style.display = "flex";
  title.style.alignItems = "center";
  title.style.gap = `${OVERLAY_ICON_GAP_PX}px`;
  title.style.marginBottom = `${SECTION_TITLE_MARGIN_BOTTOM_PX}px`;
  title.style.fontWeight = "700";
}

function setOverlayTitle(title: HTMLDivElement, icon: string, label: string) {
  const iconElement = document.createElement("span");
  iconElement.textContent = icon;
  iconElement.style.display = "inline-flex";
  iconElement.style.alignItems = "center";
  iconElement.style.justifyContent = "center";
  iconElement.style.width = `${OVERLAY_ICON_COLUMN_PX}px`;
  iconElement.style.flexShrink = "0";

  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  labelElement.style.display = "inline-flex";
  labelElement.style.alignItems = "center";
  labelElement.style.minWidth = "0";

  title.replaceChildren(iconElement, labelElement);
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

function formatOverlayStatusIcon(value: boolean, kind: "movement" | "silent" | "stalled"): string {
  switch (kind) {
    case "movement":
      return value ? "✅" : "⚠️";
    case "silent":
      return value ? "⚠️" : "✅";
    case "stalled":
      return value ? "🛑" : "✅";
  }
}
