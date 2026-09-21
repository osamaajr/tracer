import { WatchlistRepository, connectAcceptedSavedItems, type AcceptedProtectionResponse } from "./watchlistRepository";
import { normalizeSavedUrl, type SavedProduct, type SavedItem } from "@afterbuy/core";
import type { PurchaseDraft } from "@afterbuy/core";
import {
  buildPriceDropNotifications,
  type SyncedPriceDrop,
} from "./priceDropNotifications";
import {
  buildInternalMonitoringUrl,
  evaluateSavedPrice,
  isInternalMonitoringUrl,
} from "./savedPriceMonitoring";

interface ProtectPurchaseMessage {
  type: "AFTERBUY_PROTECT_PURCHASE";
  purchaseDraft: PurchaseDraft;
}

interface SyncOpportunitiesMessage {
  type: "TRACER_SYNC_OPPORTUNITIES";
}

interface CheckPurchaseProtectionMessage {
  type: "TRACER_CHECK_PURCHASE_PROTECTION";
  purchaseDraft: PurchaseDraft;
}

interface PurchasePageCandidateMessage {
  type: "TRACER_PURCHASE_PAGE_CANDIDATE";
  url: string;
}

interface GetCachedPageScanMessage {
  type: "TRACER_GET_CACHED_PAGE_SCAN";
  tabId: number;
  url: string;
}

type ExtensionMessage =
  | ProtectPurchaseMessage
  | SyncOpportunitiesMessage
  | CheckPurchaseProtectionMessage
  | PurchasePageCandidateMessage
  | GetCachedPageScanMessage;

interface PageScanResponse {
  ok: boolean;
  draft?: PurchaseDraft;
}

interface ExtensionOpportunity {
  id: string;
  title: string;
  retailerId: string;
  potentialSavingDisplay: string;
  claimUrl: string;
  status: "open" | "viewed";
}

interface ExtensionSyncResponse {
  protectedPurchaseCount: number;
  openOpportunityCount: number;
  opportunities: ExtensionOpportunity[];
  priceDrops: SyncedPriceDrop[];
}

interface PendingProtectedPurchase {
  id: string;
  draft: PurchaseDraft;
  queuedAt: string;
}

const defaultApiBaseUrl =
  import.meta.env.VITE_AFTERBUY_API_BASE_URL ?? "http://127.0.0.1:4000";
const defaultUserId = import.meta.env.VITE_AFTERBUY_USER_ID ?? "dev-user-afterbuy";
const syncAlarmName = "TRACER_OPPORTUNITY_SYNC";
const savedMonitorAlarmName = "TRACER_SAVED_ITEM_MONITOR";
const syncPeriodMinutes = 60;
const savedMonitorPeriodMinutes = 360;
const startupSyncDelayMinutes = 1;
const startupSavedMonitorDelayMinutes = savedMonitorPeriodMinutes;
const pendingPurchasesStorageKey = "tracerPendingPurchases";
const autoOpenedPageByTab = new Map<number, string>();
const autoOpeningTabs = new Set<number>();
const automaticScanTimers = new Map<number, ReturnType<typeof setTimeout>>();
const pageScanCache = new Map<number, { url: string; response: PageScanResponse }>();
const activeMonitoringTabs = new Set<number>();
let apiBaseUrlPromise: Promise<string> | null = null;
let userIdPromise: Promise<string> | null = null;
let priceDropAlertsEnabledPromise: Promise<boolean> | null = null;
let savedMonitorRun: Promise<void> | null = null;

// MV3 service workers can be stopped between events. Re-checking the alarms
// whenever this worker starts keeps price watching alive even if Chrome cleared
// an alarm or the extension was reloaded during development.
void cleanupOrphanedMonitoringTabs().finally(() => ensureMonitoringSchedules());

chrome.runtime.onInstalled.addListener(() => {
  void ensureMonitoringSchedules();
});

chrome.runtime.onStartup.addListener(() => {
  void cleanupOrphanedMonitoringTabs().finally(() => resetAlarmsAfterStartup());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === syncAlarmName) {
    void syncOpportunities({ notify: true });
  }
  if (alarm.name === savedMonitorAlarmName) {
    void monitorSavedItems();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("tracer-price-drop:") || notificationId.startsWith("tracer-saved-drop:")) {
    void chrome.action.openPopup();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeMonitoringTabs.delete(tabId);
  autoOpenedPageByTab.delete(tabId);
  autoOpeningTabs.delete(tabId);
  const timer = automaticScanTimers.get(tabId);
  if (timer) clearTimeout(timer);
  automaticScanTimers.delete(tabId);
  pageScanCache.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    isInternalMonitoringUrl(tab.url) &&
    !activeMonitoringTabs.has(tabId)
  ) {
    void chrome.tabs.remove(tabId).catch(() => undefined);
    return;
  }
  if (changeInfo.status === "loading" || changeInfo.url) {
    autoOpenedPageByTab.delete(tabId);
    pageScanCache.delete(tabId);
  }
  if (changeInfo.status === "complete" && tab.url && isLikelyPurchaseUrl(tab.url)) {
    scheduleAutomaticScan(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => {
    if (tab.url && isLikelyPurchaseUrl(tab.url)) {
      scheduleAutomaticScan(tabId, tab.url);
    }
  }).catch(() => undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.apiBaseUrl) {
    apiBaseUrlPromise = null;
  }
  if (areaName === "sync" && changes.priceDropAlertsEnabled) {
    priceDropAlertsEnabledPromise = null;
  }
  if (areaName === "sync" && changes.monitoringEnabled) {
    void syncMonitoringPreference();
  }
  if (areaName === "local" && changes.tracerUserId) {
    userIdPromise = null;
  }
});

const watchlist = new WatchlistRepository(chrome.storage.local);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!String(message?.type).startsWith('TRACER_WATCHLIST_')) return false;
  // Writes are only accepted from extension pages, never website content scripts.
  if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  let task: Promise<unknown>;
  switch (message.type) {
    case 'TRACER_WATCHLIST_LIST': task = watchlist.list(); break;
    case 'TRACER_WATCHLIST_SAVE': task = watchlist.save(message.product as SavedProduct); break;
    case 'TRACER_WATCHLIST_REMOVE': task = watchlist.remove(message.id); break;
    case 'TRACER_WATCHLIST_CLEAR': task = watchlist.clearSaved(); break;
    case 'TRACER_WATCHLIST_MONITOR': task = monitorSavedItems(message.onlyUnavailable ? "unavailable" : "all"); break;
    default: return false;
  }
  void task.then(result => respond({ok:true, result})).catch(() => respond({ok:false, error:'Could not update saved items. Please try again.'}));
  return true;
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "TRACER_PURCHASE_PAGE_CANDIDATE") {
    void openPopupForDetectedPurchase(message, _sender).then((detected) => {
      sendResponse({ detected });
    });
    return true;
  }

  if (message.type === "TRACER_GET_CACHED_PAGE_SCAN") {
    const cached = pageScanCache.get(message.tabId);
    const url = canonicalPageKey(message.url);
    sendResponse(
      cached && url === cached.url
        ? { ok: true, response: cached.response }
        : { ok: false },
    );
    return false;
  }

  if (message.type === "AFTERBUY_PROTECT_PURCHASE") {
    void protectPurchase(message.purchaseDraft)
      .then((response) => {
        sendResponse({ ok: true, response });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to protect purchase",
        });
      });

    return true;
  }

  if (message.type === "TRACER_SYNC_OPPORTUNITIES") {
    void syncOpportunities({ notify: false })
      .then((response) => {
        sendResponse({ ok: true, response });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to sync Tracer",
        });
      });

    return true;
  }

  if (message.type === "TRACER_CHECK_PURCHASE_PROTECTION") {
    void checkPurchaseProtection(message.purchaseDraft)
      .then((response) => {
        sendResponse({ ok: true, response });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to check protection status",
        });
      });

    return true;
  }

  return false;
});

async function openPopupForDetectedPurchase(
  message: PurchasePageCandidateMessage,
  sender: chrome.runtime.MessageSender,
): Promise<boolean> {
  const tab = sender.tab;
  if (typeof tab?.id !== "number") {
    return false;
  }

  return openPopupForTab(tab, message.url);
}

async function openPopupForTab(
  tab: chrome.tabs.Tab,
  rawUrl: string,
): Promise<boolean> {
  if (typeof tab.id !== "number" || autoOpeningTabs.has(tab.id)) return false;

  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  const targetWindow = await chrome.windows.get(tab.windowId);
  if (!targetWindow.focused || activeTab?.id !== tab.id) return false;

  const canonicalUrl = canonicalPageKey(rawUrl);
  if (!canonicalUrl) {
    return false;
  }

  const pageKey = canonicalUrl;
  if (autoOpenedPageByTab.get(tab.id) === pageKey) {
    return true;
  }

  autoOpeningTabs.add(tab.id);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["genericCapture.js"],
    });
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "AFTERBUY_SCAN_PAGE",
    }) as PageScanResponse;
    if (!response?.ok || !response.draft) {
      return false;
    }

    const existingProtection = await checkPurchaseProtection(response.draft) as { protected?: boolean };
    if (existingProtection.protected) {
      autoOpenedPageByTab.set(tab.id, pageKey);
      return true;
    }

    pageScanCache.set(tab.id, { url: canonicalUrl, response });
    await chrome.action.openPopup(
      typeof tab.windowId === "number" ? { windowId: tab.windowId } : undefined,
    );
    autoOpenedPageByTab.set(tab.id, pageKey);
    return true;
  } catch {
    // The page may navigate or close between detection and opening the popup.
    return false;
  } finally {
    autoOpeningTabs.delete(tab.id);
  }
}

function scheduleAutomaticScan(tabId: number, url: string, attempt = 0): void {
  const previous = automaticScanTimers.get(tabId);
  if (previous) clearTimeout(previous);

  const timer = setTimeout(() => {
    automaticScanTimers.delete(tabId);
    void chrome.tabs.get(tabId).then(async (tab) => {
      if (!tab.url || canonicalPageKey(tab.url) !== canonicalPageKey(url)) return;
      const detected = await openPopupForTab(tab, tab.url);
      if (!detected && attempt < 5) {
        scheduleAutomaticScan(tabId, tab.url, attempt + 1);
      }
    }).catch(() => undefined);
  }, attempt === 0 ? 350 : Math.min(2_000, 350 * 2 ** attempt));

  automaticScanTimers.set(tabId, timer);
}

function isLikelyPurchaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocal) return /^\/tracer-demo-order(?:[-/]|\.html)/i.test(url.pathname);
    if (url.protocol !== "https:") return false;
    return (
      (url.hostname.toLowerCase() === "shopify.com" &&
        /^\/\d+\/account\/orders\/[a-z0-9_-]+\/?$/i.test(url.pathname)) ||
      /(?:checkout|order|confirmation|thank[-_]?you)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function canonicalPageKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function protectPurchase(purchaseDraft: PurchaseDraft): Promise<unknown> {
  try {
    const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
    const response = await postProtectedPurchase(apiBaseUrl, userId, purchaseDraft);
    if (!response.ok) {
      const reason = await readResponseError(response);
      if (response.status >= 400 && response.status < 500) {
        return {
          accepted: [],
          rejected: [{
            productName: purchaseDraft.lineItems[0]?.productName ?? "Purchase",
            reason: reason || "Review the purchase details and try again.",
          }],
        };
      }
      throw new Error(reason || `Tracer API returned ${response.status}`);
    }

    const body = (await response.json()) as AcceptedProtectionResponse;
    await connectAcceptedSavedItems(watchlist, body);
    void createNotification({
      id: `tracer-protected:${Date.now()}`,
      title: "Purchase protected",
      message: "Tracer will monitor this item for price drops.",
    }).catch(() => undefined);
    void syncOpportunities({ notify: true });
    return body;
  } catch {
    const queued = await queuePendingPurchase(purchaseDraft);
    void createNotification({
      id: `tracer-saved:${queued.purchase.id}`,
      title: queued.created ? "Purchase saved" : "Already saved",
      message: "Tracer will start monitoring automatically when it reconnects.",
    }).catch(() => undefined);
    return {
      accepted: [{
        status: queued.created ? "created" : "duplicate",
        purchase: { id: queued.purchase.id },
        pendingSync: true,
      }],
      rejected: [],
      pendingSync: true,
    };
  }
}

async function checkPurchaseProtection(purchaseDraft: PurchaseDraft): Promise<unknown> {
  const pending = (await getPendingPurchases().catch(() => [])).find((purchase) => samePurchaseDraft(purchase.draft, purchaseDraft));
  const pendingItem = pending?.draft.lineItems[0];
  if (pending && pendingItem) {
    return {
      protected: true,
      purchase: {
        id: pending.id,
        productName: pendingItem.productName,
        pricePaid: pendingItem.pricePaid,
      },
      pendingSync: true,
    };
  }

  try {
    const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
    const response = await fetchApi(`${apiBaseUrl}/api/purchases/protection-status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-afterbuy-user-id": userId,
      },
      body: JSON.stringify({ purchaseDraft }),
    });
    if (!response.ok) return { protected: false, purchase: null };
    return (await response.json()) as unknown;
  } catch {
    return { protected: false, purchase: null };
  }
}

async function syncOpportunities(options: { notify: boolean }): Promise<ExtensionSyncResponse> {
  try {
    const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
    await flushPendingPurchases(apiBaseUrl, userId).catch(() => undefined);
    const response = await fetchApi(`${apiBaseUrl}/api/extension/sync`, {
      headers: { "x-afterbuy-user-id": userId },
    });
    if (!response.ok) throw new Error(`Tracer API returned ${response.status}`);
    const sync = (await response.json()) as ExtensionSyncResponse;

    if (options.notify) {
      await notifyNewPriceDrops(sync.priceDrops ?? [], await getPriceDropAlertsEnabled()).catch(() => undefined);
    }

    return sync;
  } catch {
    const pending = await getPendingPurchases().catch(() => []);
    return {
      protectedPurchaseCount: pending.reduce((total, purchase) => total + purchase.draft.lineItems.length, 0),
      openOpportunityCount: 0,
      opportunities: [],
      priceDrops: [],
    };
  }
}

function postProtectedPurchase(apiBaseUrl: string, userId: string, purchaseDraft: PurchaseDraft): Promise<Response> {
  return fetchApi(`${apiBaseUrl}/api/purchases/protect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-afterbuy-user-id": userId,
    },
    body: JSON.stringify({ purchaseDraft }),
  });
}

async function flushPendingPurchases(apiBaseUrl: string, userId: string): Promise<void> {
  const pending = await getPendingPurchases();
  if (pending.length === 0) return;
  const remaining: PendingProtectedPurchase[] = [];

  for (const purchase of pending) {
    try {
      const response = await postProtectedPurchase(apiBaseUrl, userId, purchase.draft);
      if (!response.ok) remaining.push(purchase);
      else {
        const body = await response.json() as AcceptedProtectionResponse;
        if ((body.accepted?.length ?? 0) === 0) {
          remaining.push(purchase);
        } else {
          await connectAcceptedSavedItems(watchlist, body);
        }
      }
    } catch {
      remaining.push(purchase);
    }
  }

  if (remaining.length !== pending.length) {
    await chrome.storage.local.set({ [pendingPurchasesStorageKey]: remaining });
  }
}

async function queuePendingPurchase(draft: PurchaseDraft): Promise<{ purchase: PendingProtectedPurchase; created: boolean }> {
  const pending = await getPendingPurchases();
  const existing = pending.find((purchase) => samePurchaseDraft(purchase.draft, draft));
  if (existing) return { purchase: existing, created: false };
  const purchase: PendingProtectedPurchase = {
    id: buildPendingPurchaseId(draft),
    draft,
    queuedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [pendingPurchasesStorageKey]: [...pending, purchase] });
  return { purchase, created: true };
}

async function getPendingPurchases(): Promise<PendingProtectedPurchase[]> {
  const stored = await chrome.storage.local.get(pendingPurchasesStorageKey);
  const value = stored[pendingPurchasesStorageKey];
  return Array.isArray(value) ? value.filter(isPendingPurchase) : [];
}

function isPendingPurchase(value: unknown): value is PendingProtectedPurchase {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingProtectedPurchase>;
  return typeof candidate.id === "string" && Boolean(candidate.draft) && typeof candidate.queuedAt === "string";
}

function samePurchaseDraft(left: PurchaseDraft, right: PurchaseDraft): boolean {
  if (
    left.retailerId !== right.retailerId ||
    left.purchasedAt !== right.purchasedAt ||
    left.orderReference !== right.orderReference ||
    left.lineItems.length !== right.lineItems.length
  ) {
    return false;
  }

  const unmatchedItems = [...right.lineItems];
  return left.lineItems.every((leftItem) => {
    const matchIndex = unmatchedItems.findIndex((rightItem) =>
      samePurchaseLineItem(leftItem, rightItem),
    );
    if (matchIndex === -1) return false;
    unmatchedItems.splice(matchIndex, 1);
    return true;
  });
}

function samePurchaseLineItem(
  left: PurchaseDraft["lineItems"][number],
  right: PurchaseDraft["lineItems"][number],
): boolean {
  return (
    left.productName.trim().toLowerCase() === right.productName.trim().toLowerCase() &&
    left.pricePaid.currency === right.pricePaid.currency &&
    left.pricePaid.amountMinor === right.pricePaid.amountMinor &&
    left.quantity === right.quantity
  );
}

function buildPendingPurchaseId(draft: PurchaseDraft): string {
  const itemFingerprint = draft.lineItems
    .map((item) => `${item.productName.trim().toLowerCase()}|${item.pricePaid.currency}|${item.pricePaid.amountMinor}|${item.quantity}`)
    .join("||");
  const input = `${draft.retailerId}|${draft.orderReference ?? ""}|${draft.purchasedAt}|${itemFingerprint}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `local_${(hash >>> 0).toString(36)}`;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const body = await response.text();
    if (!body) return "";
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      return parsed.error ?? parsed.message ?? body;
    } catch {
      return body;
    }
  } catch {
    return "";
  }
}

async function notifyNewPriceDrops(
  priceDrops: SyncedPriceDrop[],
  alertsEnabled: boolean,
): Promise<void> {
  const stored = await chrome.storage.local.get("notifiedPriceDropEventIds");
  const notifiedIds = Array.isArray(stored.notifiedPriceDropEventIds)
    ? new Set(stored.notifiedPriceDropEventIds.filter((id): id is string => typeof id === "string"))
    : new Set<string>();

  if (!alertsEnabled) {
    for (const drop of priceDrops) {
      notifiedIds.add(drop.eventId);
    }
    await chrome.storage.local.set({
      notifiedPriceDropEventIds: Array.from(notifiedIds).slice(-200),
    });
    return;
  }

  const notifications = buildPriceDropNotifications(priceDrops, notifiedIds, alertsEnabled);

  for (const notification of notifications) {
    await createNotification({
      id: `tracer-price-drop:${notification.eventId}`,
      title: notification.title,
      message: notification.message,
    });
    notifiedIds.add(notification.eventId);
  }

  await chrome.storage.local.set({
    notifiedPriceDropEventIds: Array.from(notifiedIds).slice(-200),
  });
}

async function createNotification(input: {
  id: string;
  title: string;
  message: string;
}): Promise<void> {
  await chrome.notifications.create(input.id, {
    type: "basic",
    iconUrl: "assets/icons/icon-128.png",
    title: input.title,
    message: input.message,
  });
}

function monitorSavedItems(mode: "all" | "unavailable" = "all"): Promise<void> {
  savedMonitorRun ??= runSavedItemMonitoring(mode).finally(() => {
    savedMonitorRun = null;
  });
  return savedMonitorRun;
}

async function runSavedItemMonitoring(mode: "all" | "unavailable"): Promise<void> {
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
      if (item) await monitorSavedItem(item).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

async function monitorSavedItem(item: SavedItem): Promise<void> {
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
    if (updatedItem && decision.shouldNotify && await getPriceDropAlertsEnabled()) {
      const saving = formatMonitoringMoney(decision.priceDropAmount!);
      const percentText = decision.priceDropPercent === undefined ? "" : ` (${decision.priceDropPercent}%)`;
      await createNotification({
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

async function cleanupOrphanedMonitoringTabs(): Promise<void> {
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

async function ensureSyncAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(syncAlarmName);

  if (!existing) {
    await chrome.alarms.create(syncAlarmName, {
      delayInMinutes: syncPeriodMinutes,
      periodInMinutes: syncPeriodMinutes,
    });
  }
}

async function ensureSavedMonitorAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(savedMonitorAlarmName);
  if (!existing) {
    await chrome.alarms.create(savedMonitorAlarmName, {
      delayInMinutes: savedMonitorPeriodMinutes,
      periodInMinutes: savedMonitorPeriodMinutes,
    });
  }
}

async function ensureMonitoringSchedules(): Promise<void> {
  await Promise.all([ensureSyncAlarm(), ensureSavedMonitorAlarm()]);
}

async function resetAlarmsAfterStartup(): Promise<void> {
  await Promise.all([
    chrome.alarms.create(syncAlarmName, {
      delayInMinutes: startupSyncDelayMinutes,
      periodInMinutes: syncPeriodMinutes,
    }),
    chrome.alarms.create(savedMonitorAlarmName, {
      delayInMinutes: startupSavedMonitorDelayMinutes,
      periodInMinutes: savedMonitorPeriodMinutes,
    }),
  ]);
}

async function syncMonitoringPreference(): Promise<void> {
  try {
    const [stored, apiBaseUrl, userId] = await Promise.all([
      chrome.storage.sync.get("monitoringEnabled"),
      getApiBaseUrl(),
      getUserId(),
    ]);
    const response = await fetchApi(`${apiBaseUrl}/api/settings/monitoring`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-afterbuy-user-id": userId,
      },
      body: JSON.stringify({ enabled: stored.monitoringEnabled !== false }),
    });
    if (!response.ok) {
      throw new Error(`Settings sync returned ${response.status}`);
    }
  } catch {
    // The next startup, settings change, or popup open retries the preference sync.
  }
}

function getApiBaseUrl(): Promise<string> {
  apiBaseUrlPromise ??= chrome.storage.sync.get("apiBaseUrl").then((stored) => {
    const configured = typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl : "";
    return configured || defaultApiBaseUrl;
  }).catch((error: unknown) => {
    apiBaseUrlPromise = null;
    throw error;
  });
  return apiBaseUrlPromise;
}

function getPriceDropAlertsEnabled(): Promise<boolean> {
  priceDropAlertsEnabledPromise ??= chrome.storage.sync.get("priceDropAlertsEnabled")
    .then((stored) => stored.priceDropAlertsEnabled !== false)
    .catch((error: unknown) => {
      priceDropAlertsEnabledPromise = null;
      throw error;
    });
  return priceDropAlertsEnabledPromise;
}

function getUserId(): Promise<string> {
  userIdPromise ??= chrome.storage.local.get("tracerUserId").then(async (stored) => {
    const configured = typeof stored.tracerUserId === "string" ? stored.tracerUserId : "";

    if (configured) {
      return configured;
    }

    await chrome.storage.local.set({ tracerUserId: defaultUserId });
    return defaultUserId;
  }).catch((error: unknown) => {
    userIdPromise = null;
    throw error;
  });
  return userIdPromise;
}

async function fetchApi(url: string, options: RequestInit): Promise<Response> {
  const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
  let lastError: unknown;
  const attempts = local ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(local ? 2_000 : 5_000) });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(local
    ? "Tracer’s local service is offline."
    : "Cannot connect to Tracer. Check your connection and retry.", { cause: lastError });
}
