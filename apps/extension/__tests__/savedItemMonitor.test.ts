import { afterEach, describe, expect, it, vi } from "vitest";
import { activeMonitoringTabs, cleanupOrphanedMonitoringTab } from "../src/savedItemMonitor";

afterEach(() => {
  activeMonitoringTabs.clear();
  vi.unstubAllGlobals();
});

describe("orphaned monitoring tab cleanup", () => {
  it("removes restored tabs even while their monitoring URL is pending", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { tabs: { remove } });

    await cleanupOrphanedMonitoringTab({
      id: 7,
      url: "chrome://newtab/",
      pendingUrl: "https://shop.example.com/item#tracer-internal-price-monitor",
    } as chrome.tabs.Tab);

    expect(remove).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("keeps user tabs and tabs owned by an active monitor", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { tabs: { remove } });
    activeMonitoringTabs.add(8);

    await cleanupOrphanedMonitoringTab({ id: 8, url: "https://shop.example.com/item#tracer-internal-price-monitor" } as chrome.tabs.Tab);
    await cleanupOrphanedMonitoringTab({ id: 9, url: "https://shop.example.com/item" } as chrome.tabs.Tab);

    expect(remove).not.toHaveBeenCalled();
  });
});
