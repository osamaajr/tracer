import type { SavedProduct, SavedItem } from "@tracer/core";
import { evaluateSavedPrice, isInternalMonitoringUrl } from "./savedPriceMonitoring";
import { checkSavedProductPrice } from "./savedProductPriceCheck";
import { WatchlistRepository } from "./watchlistRepository";

export type SavedItemMonitorMode = "all" | "unavailable" | "stale";

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
  const now = Date.now();
  const items = (await watchlist.all()).filter((item) => {
    if (item.status !== 'saved') return false;
    if (mode === 'all') return true;
    if (mode === 'unavailable') return item.monitoringStatus === 'unavailable' || item.monitoringStatus === 'out_of_stock';
    const checkedAt = Date.parse(item.lastCheckedAt ?? '');
    return item.availability === undefined || !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt >= 15 * 60_000;
  });
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
    if (!monitoredProduct) throw new Error('monitor_product_unavailable');
    const latest = monitoredProduct?.savedPrice;
    if (latest && (!Number.isSafeInteger(latest.amountMinor) || latest.amountMinor <= 0 || item.savedPrice && latest.currency !== item.savedPrice.currency)) {
      throw new Error('monitor_price_invalid');
    }
    const availability = monitoredProduct.availability && monitoredProduct.availability !== 'unknown'
      ? monitoredProduct.availability : item.availability ?? (item.monitoringStatus === 'out_of_stock' ? 'out_of_stock' : 'unknown');
    if (availability === 'out_of_stock') {
      await watchlist.updateMonitoring(item.id, {
        availability,
        monitoringStatus: 'out_of_stock',
        ...(latest ? { currentPrice: latest, ...(!item.savedPrice ? { savedPrice: latest } : {}) } : {}),
        priceDropAmount: undefined,
        priceDropPercent: undefined,
        lastCheckedAt: checkedAt,
      });
      return;
    }
    if (!latest || latest.amountMinor <= 0) {
      throw new Error("monitor_price_unavailable");
    }

    if (!item.savedPrice) {
      await watchlist.updateMonitoring(item.id, {
        savedPrice: latest,
        currentPrice: latest,
        monitoringStatus: "watching",
        availability,
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
      availability,
      lastCheckedAt: decision.lastCheckedAt,
      // Keep an existing delivery marker while a new alert is pending, but
      // clear it after recovery so a later return to the same low price can
      // generate a fresh notification.
      ...(!decision.shouldNotify ? { lastNotifiedPrice: decision.lastNotifiedPrice } : {}),
    });
    if (updatedItem && decision.shouldNotify) {
      const saving = formatMonitoringMoney(decision.priceDropAmount!);
      try {
        if (!await dependencies.getPriceDropAlertsEnabled()) return;
        await dependencies.createNotification({
          id: `tracer-saved-drop:${item.id}:${latest.amountMinor}`,
          title: "Price drop detected",
          message: `${item.name} is now ${formatMonitoringMoney(latest)} — ${saving} less.`,
        });
        // Notification failure is retryable and is not a failed price check.
        await watchlist.updateMonitoring(item.id, { lastNotifiedPrice: latest });
      } catch { /* Keep the verified drop and retry notification delivery later. */ }
    }
  } catch {
    // Preserve the last price and verified stock. A failed request does not
    // establish recovery or make an old price a freshly checked one.
    await watchlist.updateMonitoring(item.id, {
      monitoringStatus: item.availability === 'out_of_stock' || item.monitoringStatus === 'out_of_stock' ? 'out_of_stock' : 'unavailable',
    });
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
