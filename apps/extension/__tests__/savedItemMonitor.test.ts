import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedItem } from "@tracer/core";
import { cleanupOrphanedMonitoringTab, monitorSavedItems } from "../src/savedItemMonitor";
import { WatchlistRepository, watchlistKey } from "../src/watchlistRepository";

const money = (amountMinor: number) => ({ amountMinor, currency: "GBP" });
const item: SavedItem = {
  id: "trousers", name: "Regular Fit Suit trousers", retailer: "H&M", retailerId: "store_www2-hm-com",
  canonicalUrl: "https://www2.hm.com/en_gb/productpage.1347121001.html",
  savedAt: "2026-10-05T12:00:00.000Z", savedPrice: money(4499), currentPrice: money(4499),
  monitoringStatus: "watching", status: "saved",
};
function setup(items: SavedItem[] = [item], enabled = true) {
  const stored: Record<string, unknown> = { [watchlistKey]: structuredClone(items) };
  const watchlist = new WatchlistRepository({ get: async () => stored, set: async (value) => { Object.assign(stored, value); } });
  const tabs = { create: vi.fn(), update: vi.fn(), remove: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue([]) };
  vi.stubGlobal("chrome", { storage: { sync: { get: vi.fn().mockResolvedValue({ monitoringEnabled: enabled }) } }, tabs, windows: { create: vi.fn() } });
  const dependencies = { checkPrice: vi.fn().mockImplementation(async (target: SavedItem) => ({ ...target, savedPrice: money(3499) })),
    getPriceDropAlertsEnabled: vi.fn().mockResolvedValue(true), createNotification: vi.fn().mockResolvedValue(undefined) };
  return { watchlist, tabs, dependencies };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("legacy monitoring tab cleanup", () => {
  it("removes only the exact old marker including restored pending URLs", async () => {
    const { tabs } = setup();
    await cleanupOrphanedMonitoringTab({ id: 7, url: "chrome://newtab/", pendingUrl: "https://shop.example.com/item#tracer-internal-price-monitor" } as chrome.tabs.Tab);
    for (const url of [item.canonicalUrl, item.canonicalUrl + "#user-bookmark", item.canonicalUrl + "#tracer-internal-price-monitor-extra"]) {
      await cleanupOrphanedMonitoringTab({ id: 9, url } as chrome.tabs.Tab);
    }
    expect(tabs.remove).toHaveBeenCalledExactlyOnceWith(7);
  });
});

describe("tab-free saved-item monitoring", () => {
  it("stores real price drops and preserves the existing notification text", async () => {
    const { watchlist, tabs, dependencies } = setup();
    await monitorSavedItems(watchlist, dependencies);
    expect((await watchlist.list())[0]).toMatchObject({ currentPrice: money(3499), priceDropAmount: money(1000), monitoringStatus: "price_dropped", lastNotifiedPrice: money(3499) });
    expect(dependencies.createNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Price drop detected", message: "Regular Fit Suit trousers is now £34.99 — £10.00 less." }));
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.remove).not.toHaveBeenCalled();
  });
  it("processes all items with at most two checks and coalesces overlapping runs", async () => {
    const { watchlist, tabs, dependencies } = setup(Array.from({ length: 10 }, (_, n) => ({ ...item, id: `item-${n}` })));
    let running = 0; let peak = 0;
    dependencies.checkPrice.mockImplementation(async (target: SavedItem) => {
      running++; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1)); running--;
      return { ...target, savedPrice: money(4499) };
    });
    const first = monitorSavedItems(watchlist, dependencies);
    expect(monitorSavedItems(watchlist, dependencies)).toBe(first);
    await first;
    expect(dependencies.checkPrice).toHaveBeenCalledTimes(10);
    expect(peak).toBe(2);
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.remove).not.toHaveBeenCalled();
  });
  it("honours the pause setting and skips protected purchases", async () => {
    const paused = setup([item], false);
    await monitorSavedItems(paused.watchlist, paused.dependencies);
    expect(paused.dependencies.checkPrice).not.toHaveBeenCalled();
    const protectedItem = setup([{ ...item, status: "protected" }]);
    await monitorSavedItems(protectedItem.watchlist, protectedItem.dependencies);
    expect(protectedItem.dependencies.checkPrice).not.toHaveBeenCalled();
  });
  it("retries only unavailable items and establishes a missing baseline", async () => {
    const { watchlist, dependencies } = setup([item, { ...item, id: "missing", savedPrice: undefined, currentPrice: undefined, monitoringStatus: "unavailable" }]);
    await monitorSavedItems(watchlist, dependencies, "unavailable");
    expect(dependencies.checkPrice).toHaveBeenCalledTimes(1);
    expect((await watchlist.list()).find((x) => x.id === "missing")).toMatchObject({ savedPrice: money(3499), currentPrice: money(3499), monitoringStatus: "watching" });
    expect(dependencies.createNotification).not.toHaveBeenCalled();
  });
  it.each(["network", "missing", "currency"])("keeps the verified price after %s failure without opening tabs", async (failure) => {
    const { watchlist, tabs, dependencies } = setup();
    if (failure === "network") dependencies.checkPrice.mockRejectedValue(new Error("offline"));
    if (failure === "missing") dependencies.checkPrice.mockResolvedValue(null);
    if (failure === "currency") dependencies.checkPrice.mockResolvedValue({ ...item, savedPrice: { amountMinor: 3000, currency: "USD" } });
    await monitorSavedItems(watchlist, dependencies);
    expect((await watchlist.list())[0]).toMatchObject({ currentPrice: money(4499), monitoringStatus: "watching" });
    expect(dependencies.createNotification).not.toHaveBeenCalled();
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.remove).not.toHaveBeenCalled();
  });
  it("marks an unpriced failure unavailable and continues checking other items", async () => {
    const { watchlist, dependencies } = setup([{ ...item, id: "missing", savedPrice: undefined, currentPrice: undefined }, item]);
    dependencies.checkPrice.mockImplementation(async (target: SavedItem) => {
      if (target.id === "missing") throw new Error("offline");
      return { ...target, savedPrice: money(3499) };
    });
    await monitorSavedItems(watchlist, dependencies);
    expect((await watchlist.list()).find((x) => x.id === "missing")).toMatchObject({ monitoringStatus: "unavailable", lastCheckedAt: expect.any(String) });
    expect(dependencies.createNotification).toHaveBeenCalledTimes(1);
  });
  it("does not recreate or notify for an item removed during a check", async () => {
    const { watchlist, dependencies } = setup();
    dependencies.checkPrice.mockImplementation(async () => { await watchlist.remove(item.id); return { ...item, savedPrice: money(3499) }; });
    await monitorSavedItems(watchlist, dependencies);
    expect(await watchlist.list()).toEqual([]);
    expect(dependencies.createNotification).not.toHaveBeenCalled();
  });
  it("deduplicates alerts, then permits a fresh alert after recovery", async () => {
    const { watchlist, dependencies } = setup();
    await monitorSavedItems(watchlist, dependencies);
    await monitorSavedItems(watchlist, dependencies);
    expect(dependencies.createNotification).toHaveBeenCalledTimes(1);
    dependencies.checkPrice.mockResolvedValue({ ...item, savedPrice: money(4499) });
    await monitorSavedItems(watchlist, dependencies);
    dependencies.checkPrice.mockResolvedValue({ ...item, savedPrice: money(3499) });
    await monitorSavedItems(watchlist, dependencies);
    expect(dependencies.createNotification).toHaveBeenCalledTimes(2);
  });
  it("keeps failed notifications retryable and respects disabled alerts", async () => {
    const { watchlist, dependencies } = setup();
    dependencies.getPriceDropAlertsEnabled.mockResolvedValue(false);
    await monitorSavedItems(watchlist, dependencies);
    expect(dependencies.createNotification).not.toHaveBeenCalled();
    dependencies.getPriceDropAlertsEnabled.mockResolvedValue(true);
    dependencies.createNotification.mockRejectedValueOnce(new Error("notification failed"));
    await monitorSavedItems(watchlist, dependencies);
    expect((await watchlist.list())[0]?.lastNotifiedPrice).toBeUndefined();
    await monitorSavedItems(watchlist, dependencies);
    expect((await watchlist.list())[0]?.lastNotifiedPrice).toEqual(money(3499));
  });
});
