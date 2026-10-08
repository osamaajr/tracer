import { WatchlistRepository, connectAcceptedSavedItems, type AcceptedProtectionResponse } from "./watchlistRepository";
import { isPrePurchaseCheckoutUrl, type SavedProduct } from "@tracer/core";
import type { PurchaseDraft } from "@tracer/core";
import {
  buildPriceDropNotifications,
  type SyncedPriceDrop,
} from "./priceDropNotifications";
import {
  getPendingPurchases,
  queuePendingPurchase,
  samePurchaseDraft,
  setPendingPurchases,
  type PendingProtectedPurchase,
} from "./pendingPurchases";
import {
  cleanupOrphanedMonitoringTabs,
  cleanupOrphanedMonitoringTab,
  monitorSavedItems,
} from "./savedItemMonitor";
import { savedMonitorReadyAtKey, shouldRunSavedMonitorAlarm } from "./savedMonitorAlarm";
import { configuredBaseUrl, defaultApiBaseUrl } from "./config";
import { getTracerUserId } from "./identity";
import { purchaseDraftForUpload, readPurchaseProtection } from "./purchaseProtection";

const serviceWorkerStartedAt = performance.now();
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const backgroundTraceEnabled = import.meta.env.MODE !== "production" || import.meta.env.VITE_TRACER_STARTUP_TRACE === true;
if (backgroundTraceEnabled) {
  console.debug(`[Tracer startup] service worker module evaluation began (timeOrigin ${performance.timeOrigin})`);
}

interface ProtectPurchaseMessage {
  type: "TRACER_PROTECT_PURCHASE";
  purchaseDraft: PurchaseDraft;
}

interface SyncOpportunitiesMessage {
  type: "TRACER_SYNC_OPPORTUNITIES";
}

interface FlushPendingPurchasesMessage {
  type: "TRACER_FLUSH_PENDING_PURCHASES";
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
  | FlushPendingPurchasesMessage
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

const syncAlarmName = "TRACER_OPPORTUNITY_SYNC";
const savedMonitorAlarmName = "TRACER_SAVED_ITEM_MONITOR";
const syncPeriodMinutes = 60;
const savedMonitorPeriodMinutes = 360;
const startupSyncDelayMinutes = 1;
const autoOpenedPageByTab = new Map<number, string>();
const autoOpeningTabs = new Set<number>();
const automaticScanTimers = new Map<number, ReturnType<typeof setTimeout>>();
const pageScanCache = new Map<number, { url: string; response: PageScanResponse }>();
let apiBaseUrlPromise: Promise<string> | null = null;
let userIdPromise: Promise<string> | null = null;
let priceDropAlertsEnabledPromise: Promise<boolean> | null = null;

// Session storage survives MV3 worker restarts but clears on browser restart.
// Register listeners synchronously so Chrome can deliver startup events.
chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([ensureSyncAlarm(), resetSavedMonitorAlarm(), cleanupOrphanedMonitoringTabs()]);
});

chrome.runtime.onStartup.addListener(() => {
  void resetAlarmsAfterStartup();
  void cleanupOrphanedMonitoringTabs();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === syncAlarmName) {
    void syncOpportunities({ notify: true });
  }
  if (alarm.name === savedMonitorAlarmName) {
    void chrome.storage.session.get(savedMonitorReadyAtKey).then((stored) => {
      if (shouldRunSavedMonitorAlarm(alarm.scheduledTime, stored[savedMonitorReadyAtKey])) {
        return monitorSavedItems(watchlist, monitoringDependencies);
      }
      // An overdue alarm can arrive before onStartup, even in a fresh worker.
      if (stored[savedMonitorReadyAtKey] === undefined) return resetSavedMonitorAlarm();
    }).catch(() => undefined);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("tracer-price-drop:") || notificationId.startsWith("tracer-saved-drop:")) {
    void chrome.action.openPopup();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoOpenedPageByTab.delete(tabId);
  autoOpeningTabs.delete(tabId);
  const timer = automaticScanTimers.get(tabId);
  if (timer) clearTimeout(timer);
  automaticScanTimers.delete(tabId);
  pageScanCache.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Remove only explicitly marked tabs left by an older extension version.
  if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
    void cleanupOrphanedMonitoringTab(tab);
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
const monitoringDependencies = {
  getPriceDropAlertsEnabled,
  createNotification,
};
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
    case 'TRACER_WATCHLIST_MONITOR': task = monitorSavedItems(watchlist, monitoringDependencies, message.onlyUnavailable ? "unavailable" : "all"); break;
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

  if (message.type === "TRACER_PROTECT_PURCHASE") {
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

  if (message.type === "TRACER_FLUSH_PENDING_PURCHASES") {
    if (_sender.tab || !_sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    void Promise.all([getApiBaseUrl(), getUserId()])
      .then(([apiBaseUrl, userId]) => flushPendingPurchases(apiBaseUrl, userId))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
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

if (backgroundTraceEnabled) {
  console.debug(`[Tracer startup] service worker listeners registered: ${(performance.now() - serviceWorkerStartedAt).toFixed(1)}ms`);
}

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
  if (typeof tab.id !== "number" || autoOpeningTabs.has(tab.id) || isPrePurchaseCheckoutUrl(rawUrl)) return false;

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
      type: "TRACER_SCAN_PAGE",
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
    if (isPrePurchaseCheckoutUrl(rawUrl)) return false;
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
  const correctedPending = pending && purchaseDraft.orderTotalPaid && (
    pending.draft.orderTotalPaid?.amountMinor !== purchaseDraft.orderTotalPaid.amountMinor ||
    pending.draft.orderTotalPaid?.currency !== purchaseDraft.orderTotalPaid.currency
  ) ? (await queuePendingPurchase(purchaseDraft)).purchase : pending;
  const pendingItem = correctedPending?.draft.lineItems[0];
  if (correctedPending && pendingItem) {
    return {
      protected: true,
      purchase: {
        id: correctedPending.id,
        productName: pendingItem.productName,
        pricePaid: pendingItem.pricePaid,
        ...(correctedPending.draft.orderTotalPaid ? { orderTotalPaid: correctedPending.draft.orderTotalPaid } : {}),
      },
      pendingSync: true,
    };
  }

  try {
    const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
    return await readPurchaseProtection(purchaseDraft, apiBaseUrl, userId, fetchApi);
  } catch {
    return { protected: false, purchase: null };
  }
}

async function syncOpportunities(options: { notify: boolean }): Promise<ExtensionSyncResponse> {
  try {
    const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
    await flushPendingPurchases(apiBaseUrl, userId).catch(() => undefined);
    const response = await fetchApi(`${apiBaseUrl}/api/extension/sync`, {
      headers: { "x-tracer-user-id": userId },
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
      "x-tracer-user-id": userId,
    },
    body: JSON.stringify({ purchaseDraft: purchaseDraftForUpload(purchaseDraft) }),
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
    await setPendingPurchases(remaining);
  }
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

async function ensureSyncAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(syncAlarmName);

  if (!existing) {
    await chrome.alarms.create(syncAlarmName, {
      delayInMinutes: syncPeriodMinutes,
      periodInMinutes: syncPeriodMinutes,
    });
  }
}

async function resetAlarmsAfterStartup(): Promise<void> {
  await Promise.all([
    chrome.alarms.create(syncAlarmName, {
      delayInMinutes: startupSyncDelayMinutes,
      periodInMinutes: syncPeriodMinutes,
    }),
    resetSavedMonitorAlarm(),
  ]);
}

async function resetSavedMonitorAlarm(): Promise<void> {
  const readyAt = Date.now() + savedMonitorPeriodMinutes * 60_000;
  await chrome.storage.session.set({ [savedMonitorReadyAtKey]: readyAt });
  await chrome.alarms.create(savedMonitorAlarmName, {
    delayInMinutes: savedMonitorPeriodMinutes,
    periodInMinutes: savedMonitorPeriodMinutes,
  });
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
        "x-tracer-user-id": userId,
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
    return configuredBaseUrl(stored.apiBaseUrl, defaultApiBaseUrl);
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
  userIdPromise ??= getTracerUserId().catch((error: unknown) => {
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
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(local ? 2_000 : 5_000) });
      if (backgroundTraceEnabled) {
        console.debug(`[Tracer startup] network ${new URL(url).pathname}: ${(performance.now() - requestStartedAt).toFixed(1)}ms (HTTP ${response.status})`);
      }
      return response;
    } catch (error) {
      if (backgroundTraceEnabled) {
        console.debug(`[Tracer startup] network ${new URL(url).pathname} failed: ${(performance.now() - requestStartedAt).toFixed(1)}ms`);
      }
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(local
    ? "Tracer’s local service is offline."
    : "Cannot connect to Tracer. Check your connection and retry.", { cause: lastError });
}
