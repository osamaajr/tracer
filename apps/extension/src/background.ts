import type { PurchaseDraft } from "@afterbuy/core";

interface ProtectPurchaseMessage {
  type: "AFTERBUY_PROTECT_PURCHASE";
  purchaseDraft: PurchaseDraft;
}

interface SyncOpportunitiesMessage {
  type: "TRACER_SYNC_OPPORTUNITIES";
}

type ExtensionMessage = ProtectPurchaseMessage | SyncOpportunitiesMessage;

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
}

const defaultApiBaseUrl =
  import.meta.env.VITE_AFTERBUY_API_BASE_URL ?? "http://127.0.0.1:4000";
const defaultDashboardBaseUrl =
  import.meta.env.VITE_AFTERBUY_DASHBOARD_BASE_URL ?? "http://127.0.0.1:5173";
const defaultUserId = import.meta.env.VITE_AFTERBUY_USER_ID ?? "dev-user-afterbuy";
const syncAlarmName = "TRACER_OPPORTUNITY_SYNC";
const syncPeriodMinutes = 60;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSyncAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSyncAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === syncAlarmName) {
    void syncOpportunities({ notify: true });
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("tracer-opportunity:")) {
    void openDashboard();
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
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

  return false;
});

void ensureSyncAlarm();

async function protectPurchase(purchaseDraft: PurchaseDraft): Promise<unknown> {
  const apiBaseUrl = await getApiBaseUrl();
  const userId = await getUserId();
  const response = await fetch(`${apiBaseUrl}/api/purchases/protect`, {
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
    message: "Tracer will watch this order for policy-backed pay backs.",
  });
  void syncOpportunities({ notify: true });

  return body;
}

async function syncOpportunities(options: { notify: boolean }): Promise<ExtensionSyncResponse> {
  const apiBaseUrl = await getApiBaseUrl();
  const userId = await getUserId();
  const response = await fetch(`${apiBaseUrl}/api/extension/sync`, {
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
    await notifyNewOpportunities(sync.opportunities);
  }

  return sync;
}

async function notifyNewOpportunities(opportunities: ExtensionOpportunity[]): Promise<void> {
  const stored = await chrome.storage.local.get("notifiedOpportunityIds");
  const notifiedIds = Array.isArray(stored.notifiedOpportunityIds)
    ? new Set(stored.notifiedOpportunityIds.filter((id): id is string => typeof id === "string"))
    : new Set<string>();

  for (const opportunity of opportunities) {
    if (notifiedIds.has(opportunity.id)) {
      continue;
    }

    await createNotification({
      id: `tracer-opportunity:${opportunity.id}`,
      title: opportunity.title,
      message: `${opportunity.potentialSavingDisplay} may be claimable. Open Tracer to review it.`,
    });
    notifiedIds.add(opportunity.id);
  }

  await chrome.storage.local.set({
    notifiedOpportunityIds: Array.from(notifiedIds).slice(-100),
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

async function openDashboard(): Promise<void> {
  const dashboardBaseUrl = await getDashboardBaseUrl();
  await chrome.tabs.create({ url: `${dashboardBaseUrl.replace(/\/$/, "")}/dashboard` });
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

async function getApiBaseUrl(): Promise<string> {
  const stored = await chrome.storage.sync.get("apiBaseUrl");
  const configured = typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl : "";

  return configured || defaultApiBaseUrl;
}

async function getDashboardBaseUrl(): Promise<string> {
  const stored = await chrome.storage.sync.get("dashboardBaseUrl");
  const configured =
    typeof stored.dashboardBaseUrl === "string" ? stored.dashboardBaseUrl : "";

  return configured || defaultDashboardBaseUrl;
}

async function getUserId(): Promise<string> {
  const stored = await chrome.storage.local.get("tracerUserId");
  const configured = typeof stored.tracerUserId === "string" ? stored.tracerUserId : "";

  if (configured) {
    return configured;
  }

  await chrome.storage.local.set({ tracerUserId: defaultUserId });
  return defaultUserId;
}
