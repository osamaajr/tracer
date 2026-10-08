import type { SavedProduct, SavedItem } from "@tracer/core";
import { evaluateSavedPrice, isInternalMonitoringUrl } from "./savedPriceMonitoring";
import { checkSavedProductPrice } from "./savedProductPriceCheck";
import { WatchlistRepository } from "./watchlistRepository";

export type SavedItemMonitorMode = "all" | "unavailable";

interface MonitoringNotification {
  id: string;
  title: string;
  message: string;
}

export interface SavedItemMonitorDependencies {
  checkPrice?: (item: SavedItem) => Promise<SavedProduct | null>;
  getPriceDropAlertsEnabled: () => Promise<boolean>;
  createNotification: (notification: MonitoringNotification) => Promise<void>;
}

let savedMonitorRun: Promise<void> | null = null;

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
  try {
    const checkPrice = dependencies.checkPrice ?? checkSavedProductPrice;
    const monitoredProduct = await checkPrice(item);
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
      // Keep an existing delivery marker while a new alert is pending, but
      // clear it after recovery so a later return to the same low price can
      // generate a fresh notification.
      ...(!decision.shouldNotify ? { lastNotifiedPrice: decision.lastNotifiedPrice } : {}),
    });
    if (updatedItem && decision.shouldNotify && await dependencies.getPriceDropAlertsEnabled()) {
      const saving = formatMonitoringMoney(decision.priceDropAmount!);
      await dependencies.createNotification({
        id: `tracer-saved-drop:${item.id}:${latest.amountMinor}`,
        title: "Price drop detected",
        message: `${item.name} is now ${formatMonitoringMoney(latest)} — ${saving} less.`,
      });
      // A failed browser notification must remain retryable on the next check.
      // Persist the delivery marker only after Chrome confirms creation.
      await watchlist.updateMonitoring(item.id, { lastNotifiedPrice: latest });
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
  }
}

export async function cleanupOrphanedMonitoringTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({}).catch((): chrome.tabs.Tab[] => []);
  await Promise.all(tabs.map(cleanupOrphanedMonitoringTab));
}

export async function cleanupOrphanedMonitoringTab(tab: chrome.tabs.Tab): Promise<void> {
  // Migration cleanup only: new price checks never create browser tabs.
  if (typeof tab.id !== "number") return;
  if (isInternalMonitoringUrl(tab.url ?? "") || isInternalMonitoringUrl(tab.pendingUrl ?? "")) {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

function formatMonitoringMoney(money: { amountMinor: number; currency: string }): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: money.currency }).format(money.amountMinor / 100);
}
