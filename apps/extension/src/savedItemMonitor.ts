import { normalizeSavedUrl, type SavedProduct, type SavedItem } from "@afterbuy/core";
import { evaluateSavedPrice, buildInternalMonitoringUrl, isInternalMonitoringUrl } from "./savedPriceMonitoring";
import { WatchlistRepository } from "./watchlistRepository";

export type SavedItemMonitorMode = "all" | "unavailable";

interface MonitoringNotification {
  id: string;
  title: string;
  message: string;
}

export interface SavedItemMonitorDependencies {
  getPriceDropAlertsEnabled: () => Promise<boolean>;
  createNotification: (notification: MonitoringNotification) => Promise<void>;
}

export const activeMonitoringTabs = new Set<number>();
let savedMonitorRun: Promise<void> | null = null;

export function forgetMonitoringTab(tabId: number): void {
  activeMonitoringTabs.delete(tabId);
}

export function monitorSavedItems(
  watchlist: WatchlistRepository,
  dependencies: SavedItemMonitorDependencies,
  mode: SavedItemMonitorMode = "all",
): Promise<void> {
  savedMonitorRun ??= runSavedItemMonitoring(watchlist, dependencies, mode).finally(() => {
    savedMonitorRun = null;
  });
  return savedMonitorRun;
}

async function runSavedItemMonitoring(
  watchlist: WatchlistRepository,
  dependencies: SavedItemMonitorDependencies,
  mode: SavedItemMonitorMode,
): Promise<void> {
  const settings = await chrome.storage.sync.get("monitoringEnabled").catch((): Record<string, unknown> => ({}));
  if (settings.monitoringEnabled === false) return;
  const items = (await watchlist.all()).filter((item) =>
    item.status === "saved" && (mode === "all" || item.monitoringStatus === "unavailable")
  );
  const queue = [...items].sort((left, right) =>
    Number(Boolean(left.savedPrice)) - Number(Boolean(right.savedPrice))
  );
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) await monitorSavedItem(item, watchlist, dependencies).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

async function monitorSavedItem(
  item: SavedItem,
  watchlist: WatchlistRepository,
  dependencies: SavedItemMonitorDependencies,
): Promise<void> {
  const checkedAt = new Date().toISOString();
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({
      url: buildInternalMonitoringUrl(normalizeSavedUrl(item.canonicalUrl)),
      active: false,
    });
    tabId = tab.id;
    if (typeof tabId !== "number") throw new Error("monitor_tab_unavailable");
    activeMonitoringTabs.add(tabId);
    await waitForTabReady(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ["watchlistCapture.js"] });
    const monitoredProduct = await readSavedProductWithRetries(tabId);
    const latest = monitoredProduct?.savedPrice;
    if (!latest || latest.amountMinor <= 0) {
      throw new Error("monitor_price_unavailable");
    }

    if (!item.savedPrice) {
      await watchlist.updateMonitoring(item.id, {
        savedPrice: latest,
        currentPrice: latest,
        monitoringStatus: "watching",
        lastCheckedAt: checkedAt,
      });
      return;
    }
    if (latest.currency !== item.savedPrice.currency) throw new Error("monitor_currency_changed");

    const decision = evaluateSavedPrice(item, latest, checkedAt);
    const updatedItem = await watchlist.updateMonitoring(item.id, {
      currentPrice: decision.currentPrice,
      ...(decision.priceDropAmount ? { priceDropAmount: decision.priceDropAmount } : { priceDropAmount: undefined }),
      ...(decision.priceDropPercent !== undefined ? { priceDropPercent: decision.priceDropPercent } : { priceDropPercent: undefined }),
      monitoringStatus: decision.monitoringStatus,
      lastCheckedAt: decision.lastCheckedAt,
      ...(decision.lastNotifiedPrice ? { lastNotifiedPrice: decision.lastNotifiedPrice } : { lastNotifiedPrice: undefined }),
    });
    if (updatedItem && decision.shouldNotify && await dependencies.getPriceDropAlertsEnabled()) {
      const saving = formatMonitoringMoney(decision.priceDropAmount!);
      const percentText = decision.priceDropPercent === undefined ? "" : ` (${decision.priceDropPercent}%)`;
      await dependencies.createNotification({
        id: `tracer-saved-drop:${item.id}:${latest.amountMinor}`,
        title: "Price drop detected",
        message: `${item.name} is now ${formatMonitoringMoney(latest)} — ${saving} less${percentText}.`,
      }).catch(() => undefined);
    }
  } catch {
    // A temporary loading, network, or extraction failure must not erase a valid
    // price or turn an actively watched item into a permanent error state.
    if (!item.savedPrice && !item.currentPrice) {
      await watchlist.updateMonitoring(item.id, { monitoringStatus: "unavailable", lastCheckedAt: checkedAt });
    } else if (item.monitoringStatus === "unavailable") {
      await watchlist.updateMonitoring(item.id, {
        monitoringStatus: item.priceDropAmount ? "price_dropped" : "watching",
      });
    }
  } finally {
    if (typeof tabId === "number") {
      await chrome.tabs.remove(tabId).catch(() => undefined);
      activeMonitoringTabs.delete(tabId);
    }
  }
}

export async function cleanupOrphanedMonitoringTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({}).catch((): chrome.tabs.Tab[] => []);
  await Promise.all(tabs.map(async (tab) => {
    if (
      typeof tab.id === "number" &&
      tab.url &&
      isInternalMonitoringUrl(tab.url) &&
      !activeMonitoringTabs.has(tab.id)
    ) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }));
}

async function readSavedProductWithRetries(tabId: number): Promise<SavedProduct | null> {
  const delays = [0, 300, 700, 1_500, 2_500];
  let lastProduct: SavedProduct | null = null;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await chrome.tabs.sendMessage(tabId, { type: "TRACER_EXTRACT_SAVED_PRODUCT" }) as { product?: SavedProduct | null };
    lastProduct = response?.product ?? lastProduct;
    if (lastProduct?.savedPrice) return lastProduct;
  }
  return lastProduct;
}

function waitForTabReady(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("monitor_tab_timeout")); }, 15_000);
    const cleanup = () => { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); };
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") { cleanup(); resolve(); }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") { cleanup(); resolve(); }
    }).catch(() => { cleanup(); reject(new Error("monitor_tab_closed")); });
  });
}

function formatMonitoringMoney(money: { amountMinor: number; currency: string }): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: money.currency }).format(money.amountMinor / 100);
}
