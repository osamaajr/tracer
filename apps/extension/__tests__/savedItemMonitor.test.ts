import { afterEach, describe, expect, it, vi } from "vitest";
import { activeMonitoringTabs, cleanupOrphanedMonitoringTab, monitorSavedItems } from "../src/savedItemMonitor";
import { WatchlistRepository, watchlistKey } from "../src/watchlistRepository";

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

describe("saved-item price drop", () => {
  it("stores the new current price and sends an alert without a percentage", async () => {
    const stored: Record<string, unknown> = {
      [watchlistKey]: [{
        id: "trousers",
        name: "Regular Fit Suit trousers",
        retailer: "H&M",
        retailerId: "store_www2-hm-com",
        canonicalUrl: "https://www2.hm.com/en_gb/productpage.1347121001.html",
        savedAt: "2026-10-05T12:00:00.000Z",
        savedPrice: { amountMinor: 4499, currency: "GBP" },
        currentPrice: { amountMinor: 4499, currency: "GBP" },
        monitoringStatus: "watching",
        status: "saved",
      }],
    };
    const watchlist = new WatchlistRepository({
      get: async () => stored,
      set: async (value) => { Object.assign(stored, value); },
    });
    const createNotification = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      storage: { sync: { get: vi.fn().mockResolvedValue({ monitoringEnabled: true }) } },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 17 }),
        get: vi.fn().mockResolvedValue({ id: 17, status: "complete" }),
        sendMessage: vi.fn().mockResolvedValue({ product: { savedPrice: { amountMinor: 3499, currency: "GBP" } } }),
        remove,
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    });

    await monitorSavedItems(watchlist, {
      getPriceDropAlertsEnabled: async () => true,
      createNotification,
    });

    expect((await watchlist.list())[0]).toMatchObject({
      currentPrice: { amountMinor: 3499, currency: "GBP" },
      priceDropAmount: { amountMinor: 1000, currency: "GBP" },
      monitoringStatus: "price_dropped",
    });
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Price drop detected",
      message: "Regular Fit Suit trousers is now £34.99 — £10.00 less.",
    }));
    expect(remove).toHaveBeenCalledWith(17);
  });
});
