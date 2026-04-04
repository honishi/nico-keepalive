import { hideMonitorOverlay, updateMonitorOverlay } from "../src/view/monitor-overlay";

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: jest.fn(() => ({
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      putImageData: jest.fn(),
    })),
  });
});

afterEach(() => {
  hideMonitorOverlay();
  document.body.innerHTML = "";
});

describe("monitor overlay", () => {
  it("renders the collapsed summary on a single header row without the old title", () => {
    updateMonitorOverlay({
      enabled: true,
      monitorSessionEnabled: true,
      normalCheck: {
        currentTimeSec: 10,
        lastObservedCurrentTimeSec: 5,
        deltaSec: 5,
        timeMoved: true,
        idleSec: 0,
        thresholdSec: 20,
        epsilonSec: 0.1,
        enabled: true,
        stalled: false,
        paused: false,
        ended: false,
      },
      deepCheck: {
        enabled: true,
        available: true,
        stalled: false,
        visualEligible: true,
        frameChanged: true,
        audioEligible: true,
        audioSilent: false,
        thresholdSec: 60,
        muted: false,
        volume: 1,
      },
    });

    const panel = document.getElementById("nico-keepalive-monitor") as HTMLDivElement | null;
    expect(panel).not.toBeNull();

    const header = panel?.querySelector("[data-role='header']");
    const dragHandle = panel?.querySelector("[data-role='drag-handle']");
    const actions = panel?.querySelector("[data-role='actions']");
    const summary = panel?.querySelector("[data-role='status-summary']");
    const monitorToggleButton = panel?.querySelector(
      "[data-role='monitor-toggle']",
    ) as HTMLButtonElement | null;
    const toggleButton = panel?.querySelector("[data-role='toggle']") as HTMLButtonElement | null;
    const body = panel?.querySelector("[data-role='body']") as HTMLDivElement | null;
    const generalTitle = panel?.querySelector(
      "[data-role='general-title']",
    ) as HTMLDivElement | null;
    const generalTitleIcon = generalTitle?.firstElementChild as HTMLSpanElement | null;

    expect(panel?.textContent).not.toContain("nico-keepalive monitor status");
    expect(header?.firstElementChild).toBe(toggleButton);
    expect(header?.children.item(1)).toBe(actions);
    expect(header?.lastElementChild).toBe(dragHandle);
    expect(actions?.firstElementChild).toBe(monitorToggleButton);
    expect(actions?.childElementCount).toBe(1);
    expect(summary?.textContent).toBe("再生: ✅  映像: ✅  音: ✅  判定: ✅");
    expect(monitorToggleButton?.dataset.state).toBe("enabled");
    expect(monitorToggleButton?.getAttribute("aria-label")).toBe(
      "Disable monitoring and reload on this page",
    );
    expect(monitorToggleButton?.textContent).toBe("ON");
    expect(toggleButton?.dataset.state).toBe("collapsed");
    expect(toggleButton?.getAttribute("aria-label")).toBe("Expand monitor overlay");
    expect(toggleButton?.textContent).toBe("＋");
    expect(toggleButton?.style.borderStyle).toBe("none");
    expect(toggleButton?.style.borderWidth).toBe("0px");
    expect(toggleButton?.style.background).toBe("transparent");
    expect(toggleButton?.style.display).toBe("inline-flex");
    expect(toggleButton?.style.width).toBe("20px");
    expect(toggleButton?.style.height).toBe("20px");
    expect(generalTitle?.style.display).toBe("flex");
    expect(generalTitle?.style.gap).toBe("8px");
    expect(generalTitleIcon?.textContent).toBe("🔵");
    expect(generalTitleIcon?.style.width).toBe("20px");
    expect(body?.style.display).toBe("none");
  });

  it("shows the general status section when expanded", () => {
    updateMonitorOverlay({
      enabled: true,
      monitorSessionEnabled: true,
      inWarmup: false,
      warmupRemainingMs: 0,
      chasePlay: false,
      normalCheck: {
        currentTimeSec: 10,
        lastObservedCurrentTimeSec: 10,
        deltaSec: 0,
        timeMoved: false,
        idleSec: 5,
        thresholdSec: 20,
        epsilonSec: 0.1,
        enabled: true,
        stalled: false,
        paused: false,
        ended: false,
      },
      deepCheck: {
        enabled: false,
        available: false,
        stalled: false,
        visualEligible: false,
        frameChanged: false,
        audioEligible: false,
        audioSilent: false,
        thresholdSec: 60,
        muted: false,
        volume: 1,
      },
    });

    const toggleButton = document.querySelector("[data-role='toggle']") as HTMLButtonElement | null;
    toggleButton?.click();

    const body = document.querySelector("[data-role='body']") as HTMLDivElement | null;
    const generalTitle = document.querySelector("[data-role='general-title']");
    const generalStats = document.querySelector("[data-role='general-stats']");
    const generalTitleLabel = generalTitle?.lastElementChild as HTMLSpanElement | null;
    const normalStats = document.querySelector(
      "[data-role='normal-stats']",
    ) as HTMLPreElement | null;

    expect(toggleButton?.dataset.state).toBe("expanded");
    expect(toggleButton?.getAttribute("aria-label")).toBe("Collapse monitor overlay");
    expect(toggleButton?.textContent).toBe("−");
    expect(body?.style.display).toBe("block");
    expect(generalTitle?.textContent).toBe("🔵general status");
    expect(generalTitleLabel?.textContent).toBe("general status");
    expect((generalStats as HTMLPreElement | null)?.style.paddingLeft).toBe("28px");
    expect(normalStats?.style.paddingLeft).toBe("28px");
    expect(generalStats?.textContent).toContain("sessionEnabled=true");
    expect(generalStats?.textContent).toContain("paused=false ended=false chasePlay=false");
    expect(generalStats?.textContent).toContain("👀warmup=false remainingSec=0");
  });

  it("toggles the overlay when the drag handle is clicked", () => {
    updateMonitorOverlay({
      enabled: true,
      monitorSessionEnabled: true,
      normalCheck: {
        currentTimeSec: 10,
        lastObservedCurrentTimeSec: 10,
        deltaSec: 0,
        timeMoved: false,
        idleSec: 5,
        thresholdSec: 20,
        epsilonSec: 0.1,
        enabled: true,
        stalled: false,
        paused: false,
        ended: false,
      },
      deepCheck: {
        enabled: false,
        available: false,
        stalled: false,
        visualEligible: false,
        frameChanged: false,
        audioEligible: false,
        audioSilent: false,
        thresholdSec: 60,
        muted: false,
        volume: 1,
      },
    });

    const dragHandle = document.querySelector("[data-role='drag-handle']") as HTMLDivElement | null;
    const body = document.querySelector("[data-role='body']") as HTMLDivElement | null;
    const toggleButton = document.querySelector("[data-role='toggle']") as HTMLButtonElement | null;

    dragHandle?.click();
    expect(body?.style.display).toBe("block");
    expect(toggleButton?.dataset.state).toBe("expanded");

    dragHandle?.click();
    expect(body?.style.display).toBe("none");
    expect(toggleButton?.dataset.state).toBe("collapsed");
  });

  it("toggles the page-local monitor state from the header switch", () => {
    const onToggleMonitorSessionEnabled = jest.fn();

    updateMonitorOverlay({
      enabled: true,
      monitorSessionEnabled: true,
      onToggleMonitorSessionEnabled,
      normalCheck: {
        currentTimeSec: 10,
        lastObservedCurrentTimeSec: 10,
        deltaSec: 0,
        timeMoved: false,
        idleSec: 5,
        thresholdSec: 20,
        epsilonSec: 0.1,
        enabled: true,
        stalled: false,
        paused: false,
        ended: false,
      },
      deepCheck: {
        enabled: false,
        available: false,
        stalled: false,
        visualEligible: false,
        frameChanged: false,
        audioEligible: false,
        audioSilent: false,
        thresholdSec: 60,
        muted: false,
        volume: 1,
      },
    });

    const monitorToggleButton = document.querySelector(
      "[data-role='monitor-toggle']",
    ) as HTMLButtonElement | null;

    monitorToggleButton?.click();

    expect(onToggleMonitorSessionEnabled).toHaveBeenCalledWith(false);

    updateMonitorOverlay({
      enabled: true,
      monitorSessionEnabled: false,
      onToggleMonitorSessionEnabled,
      normalCheck: {
        currentTimeSec: 10,
        lastObservedCurrentTimeSec: 10,
        deltaSec: 0,
        timeMoved: false,
        idleSec: 5,
        thresholdSec: 20,
        epsilonSec: 0.1,
        enabled: false,
        stalled: false,
        paused: false,
        ended: false,
      },
      deepCheck: {
        enabled: false,
        available: false,
        stalled: false,
        visualEligible: false,
        frameChanged: false,
        audioEligible: false,
        audioSilent: false,
        thresholdSec: 60,
        muted: false,
        volume: 1,
      },
    });

    expect(monitorToggleButton?.dataset.state).toBe("disabled");
    expect(monitorToggleButton?.textContent).toBe("OFF");
    expect(monitorToggleButton?.getAttribute("aria-label")).toBe(
      "Enable monitoring and reload on this page",
    );
    expect(document.querySelector("[data-role='status-summary']")?.textContent).toBe(
      "再生: ー  映像: ー  音: ー  判定: ー",
    );
  });
});
