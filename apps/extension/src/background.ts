import type { PurchaseDraft } from "@afterbuy/core";
import {
  buildPriceDropNotifications,
  type SyncedPriceDrop,
} from "./priceDropNotifications";

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

const defaultApiBaseUrl =
  import.meta.env.VITE_AFTERBUY_API_BASE_URL ?? "http://127.0.0.1:4000";
const defaultUserId = import.meta.env.VITE_AFTERBUY_USER_ID ?? "dev-user-afterbuy";
const syncAlarmName = "TRACER_OPPORTUNITY_SYNC";
const syncPeriodMinutes = 60;
const autoOpenedPageByTab = new Map<number, string>();
const autoOpeningTabs = new Set<number>();
const pageScanCache = new Map<number, { url: string; response: PageScanResponse }>();
let apiBaseUrlPromise: Promise<string> | null = null;
let userIdPromise: Promise<string> | null = null;
let priceDropAlertsEnabledPromise: Promise<boolean> | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSyncAlarm();
  void syncMonitoringPreference();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSyncAlarm();
  void syncMonitoringPreference();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === syncAlarmName) {
    void syncOpportunities({ notify: true });
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("tracer-price-drop:")) {
    void chrome.action.openPopup();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoOpenedPageByTab.delete(tabId);
  autoOpeningTabs.delete(tabId);
  pageScanCache.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    autoOpenedPageByTab.delete(tabId);
    pageScanCache.delete(tabId);
  }
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
  if (!tab?.id || !tab.active || autoOpeningTabs.has(tab.id)) {
    return false;
  }

  const canonicalUrl = canonicalPageKey(message.url);
  if (!canonicalUrl) {
    return false;
  }

  const pageKey = `${canonicalUrl}|${sender.documentId ?? "current-document"}`;
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

    pageScanCache.set(tab.id, { url: canonicalUrl, response });
    autoOpenedPageByTab.set(tab.id, pageKey);
    await chrome.action.openPopup(
      typeof tab.windowId === "number" ? { windowId: tab.windowId } : undefined,
    );
    return true;
  } catch {
    // The page may navigate or close between detection and opening the popup.
    return false;
  } finally {
    autoOpeningTabs.delete(tab.id);
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
  const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
  const response = await fetchApi(`${apiBaseUrl}/api/purchases/protect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-afterbuy-user-id": userId,
    },
    body: JSON.stringify({ purchaseDraft }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Tracer API returned ${response.status}`);
  }

  const body = (await response.json()) as unknown;
  await createNotification({
    id: `tracer-protected:${Date.now()}`,
    title: "Purchase protected",
    message: "Tracer will monitor this item for price drops.",
  });
  void syncOpportunities({ notify: true });

  return body;
}

async function checkPurchaseProtection(purchaseDraft: PurchaseDraft): Promise<unknown> {
  const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
  const response = await fetchApi(`${apiBaseUrl}/api/purchases/protection-status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-afterbuy-user-id": userId,
    },
    body: JSON.stringify({ purchaseDraft }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Tracer API returned ${response.status}`);
  }

  return (await response.json()) as unknown;
}

async function syncOpportunities(options: { notify: boolean }): Promise<ExtensionSyncResponse> {
  const [apiBaseUrl, userId] = await Promise.all([getApiBaseUrl(), getUserId()]);
  const response = await fetchApi(`${apiBaseUrl}/api/extension/sync`, {
    headers: {
      "x-afterbuy-user-id": userId,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Tracer API returned ${response.status}`);
  }

  const sync = (await response.json()) as ExtensionSyncResponse;

  if (options.notify) {
    await notifyNewPriceDrops(sync.priceDrops ?? [], await getPriceDropAlertsEnabled());
  }

  return sync;
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

  for (let attempt = 0; attempt < (local ? 4 : 1); attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  throw new Error(local
    ? "Tracer’s local service is offline. Start the app with npm run dev, then retry."
    : "Cannot connect to Tracer. Check your connection and retry.", { cause: lastError });
}
