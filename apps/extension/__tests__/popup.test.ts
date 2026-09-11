import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gbp, type PurchaseDraft } from "@afterbuy/core";

const popupPath = new URL("../popup.html", import.meta.url);
const originalFetch = globalThis.fetch;

const purchaseDraft: PurchaseDraft = {
  retailerId: "john-lewis",
  retailerName: "Example Store",
  storeHost: "store.example.com",
  sourceUrl: "https://store.example.com/orders/123",
  orderReference: "123",
  purchasedAt: "2026-08-30T09:15:00.000Z",
  captureMethod: "generic_schema_org",
  captureConfidence: "high",
  lineItems: [
    {
      productName: "Sony WH-1000XM5",
      quantity: 1,
      pricePaid: gbp(34_999),
      productUrl: "https://store.example.com/sony-wh-1000xm5",
      productUrlConfidence: "high",
      imageUrl: "https://store.example.com/headphones.png",
    },
  ],
};

interface PopupHarnessOptions {
  cachedScanResponse?: unknown;
  protected?: boolean;
  protectResponse?: unknown;
  dashboardBaseUrl?: string;
  dashboardResponse?: {
    purchases: Array<Record<string, unknown>>;
    opportunities: Array<Record<string, unknown>>;
  };
  deleteStatus?: number;
  scanResponse?: unknown;
  tabUrl?: string;
}

describe("extension popup", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    globalThis.fetch = originalFetch;
  });

  it("enters a loading state and prevents duplicate protect clicks", async () => {
    const protectCallbacks: Array<(response: unknown) => void> = [];
    const harness = await setupPopup({
      protectResponse: "defer",
      onProtectCallback: (callback) => protectCallbacks.push(callback),
    });
    await flushPopup();

    harness.protectButton.click();
    harness.protectButton.click();

    expect(harness.protectButton.disabled).toBe(true);
    expect(harness.protectButton.textContent).toBe("Protecting...");
    expect(harness.protectMessages()).toHaveLength(1);

    protectCallbacks[0]?.({
      ok: true,
      response: {
        accepted: [{ status: "created", purchase: { id: "pur_123" } }],
        rejected: [],
      },
    });
    await flushPopup();
  });

  it("shows the idle state on ordinary pages with no purchase", async () => {
    const harness = await setupPopup({
      dashboardBaseUrl: "https://app.tracer.test",
      scanResponse: {
        ok: false,
        error: "No order confirmation data found on this page.",
      },
      tabUrl: "https://example.com/articles/story",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("empty");
    expect(text("stateTitle")).toBe("No purchase found");
    expect(text("idleHeading")).toBe("No purchase found");
    expect(text("idleFeatureCard")).toContain("Price drops");
    expect(text("idleFeatureCard")).toContain("Policy windows");
    expect(text("idleFeatureCard")).toContain("Alerts");

    harness.protectedItemsCta.click();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe("items");
    expect(harness.tabsCreate).not.toHaveBeenCalled();

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("empty");

    harness.howItWorksButton.click();
    expect(harness.tabsCreate).toHaveBeenCalledWith({
      url: "https://app.tracer.test/#demo",
    });
  });

  it("keeps checkout-like pages with incomplete extraction out of the idle state", async () => {
    const harness = await setupPopup({
      scanResponse: {
        ok: false,
        error: "Tracer could not read enough purchase details yet.",
      },
      tabUrl: "https://shop.example.com/checkout/order-confirmation/ABC",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("incomplete");
    expect(text("stateTitle")).toBe("We need a little more detail.");
    expect(text("stateCopy")).toBe("This looks like an order page, but Tracer could not read enough reliable details.");
  });

  it("shows no purchase found when the scanner identifies an image-gallery page", async () => {
    const harness = await setupPopup({
      scanResponse: {
        ok: false,
        failureReason: "not_purchase_page",
        error: "No order confirmation data found on this page.",
      },
      tabUrl: "https://dribbble.com/shots/26732309-skincare-order-confirmation-ui",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("empty");
    expect(text("idleHeading")).toBe("No purchase found");
    expect(text("stateCopy")).not.toContain("RangeError");
  });

  it("renders the protected state with the protected purchase summary", async () => {
    const harness = await setupPopup({
      protectResponse: {
        ok: true,
        response: {
          accepted: [{ status: "created", purchase: { id: "pur_123" } }],
          rejected: [],
        },
      },
      dashboardBaseUrl: "https://app.tracer.test",
    });
    await flushPopup();

    harness.protectButton.click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("protected");
    expect(harness.app.dataset.celebrate).toBe("true");
    expect(text("successTitle")).toBe("Purchase protected");
    expect(text("summaryProductName")).toBe("Sony WH-1000XM5");
    expect(text("summaryPaid")).toBe("£349.99");
    expect(text("summaryStatus")).toBe("Monitoring active");

    harness.dashboardCta.click();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe("items");

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("protected");
  });

  it("shows already protected purchases without replaying confetti", async () => {
    const harness = await setupPopup({
      protected: true,
      dashboardBaseUrl: "https://app.tracer.test",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("duplicate");
    expect(harness.app.dataset.celebrate).toBe("false");
    expect(text("successTitle")).toBe("Already protected");
    expect(text("summaryProductName")).toBe("Sony WH-1000XM5");
    expect(text("summaryPaid")).toBe("£349.99");

    harness.dashboardCta.click();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe("items");

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("duplicate");
  });

  it("returns from details to the list and from the list to the original screen", async () => {
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: droppedDashboard(),
    });
    await flushPopup();

    harness.dashboardCta.click();
    await flushPopup();
    harness.firstItem().click();

    expect(harness.app.dataset.screen).toBe("detail");
    expect(text("detailStatus")).toBe("● Price dropped by £30");
    expect(element("detailStatus").dataset.alert).toBe("true");

    harness.popupBack.click();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe("items");
    expect(harness.dashboardRequests()).toHaveLength(1);

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("duplicate");
  });

  it("reuses the automatic background scan when the popup opens", async () => {
    const harness = await setupPopup({
      cachedScanResponse: {
        ok: true,
        draft: purchaseDraft,
        summary: {
          retailerName: purchaseDraft.retailerName,
          productName: purchaseDraft.lineItems[0]?.productName,
          itemCount: 1,
          totalDisplay: "£349.99",
          confidence: "high",
        },
      },
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("detected");
    expect(harness.executeScript).not.toHaveBeenCalled();
    expect(harness.scanMessages()).toHaveLength(0);
    expect(harness.dashboardRequests()).toHaveLength(0);
  });

  it("opens settings, persists both switches, and returns to the previous view", async () => {
    const harness = await setupPopup({ protected: true });
    await flushPopup();

    harness.menuSettings.click();
    expect(harness.app.dataset.screen).toBe("settings");
    expect(harness.priceDropAlertsToggle.getAttribute("aria-checked")).toBe("true");
    expect(harness.monitoringToggle.getAttribute("aria-checked")).toBe("true");

    harness.priceDropAlertsToggle.click();
    harness.monitoringToggle.click();
    await flushPopup();

    expect(harness.storageSet).toHaveBeenCalledWith({ priceDropAlertsEnabled: false });
    expect(harness.storageSet).toHaveBeenCalledWith({ monitoringEnabled: false });

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("duplicate");
  });

  it("clears every protected purchase from settings", async () => {
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: droppedDashboard(),
    });
    await flushPopup();

    harness.menuSettings.click();
    harness.clearProtectedPurchases.click();
    expect(harness.deleteRequests()).toHaveLength(0);
    harness.confirmClearPurchases.click();
    await flushPopup();

    expect(harness.deleteRequests()).toHaveLength(1);
    expect(text("menuItemsCount")).toBe("(0)");
    expect(harness.clearProtectedPurchases.disabled).toBe(false);
  });

  it("deletes the final item, shows the empty list, and returns to a protectable purchase", async () => {
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: droppedDashboard(),
    });
    await flushPopup();

    harness.dashboardCta.click();
    await flushPopup();
    harness.firstItem().click();
    harness.deleteItem.click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("items");
    expect(text("itemsCount")).toBe("0 items");
    expect(text("itemsList")).toContain("No protected purchases");
    expect(harness.deleteRequests()).toHaveLength(1);

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("detected");
  });

  it("keeps item details usable when deletion fails", async () => {
    const harness = await setupPopup({
      dashboardResponse: droppedDashboard(),
      deleteStatus: 500,
    });
    await flushPopup();

    harness.protectedItemsCta.click();
    await flushPopup();
    harness.firstItem().click();
    harness.deleteItem.click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("detail");
    expect(text("detailStatus")).toBe("Couldn’t remove this item. Try again.");
    expect(harness.deleteItem.disabled).toBe(false);
  });

  it("keeps the purchase visible on API failure and retries successfully", async () => {
    let protectResponse: unknown = {
      ok: false,
      error: "Tracer API returned 500",
    };
    const harness = await setupPopup({
      protectResponse: () => protectResponse,
    });
    await flushPopup();

    harness.protectButton.click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("error");
    expect(harness.app.dataset.retryable).toBe("true");
    expect(text("stateTitle")).toBe("Could not protect this purchase.");
    expect(text("productName")).toBe("Sony WH-1000XM5");
    expect(harness.protectButton.disabled).toBe(false);
    expect(harness.protectButton.textContent).toBe("Retry");

    protectResponse = {
      ok: true,
      response: {
        accepted: [{ status: "created", purchase: { id: "pur_retry" } }],
        rejected: [],
      },
    };

    harness.protectButton.click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("protected");
    expect(text("successTitle")).toBe("Purchase protected");
  });
});

async function setupPopup(
  options: PopupHarnessOptions & {
    protectResponse?: unknown | (() => unknown);
    onProtectCallback?: (callback: (response: unknown) => void) => void;
  } = {},
) {
  const { window } = parseHTML(readFileSync(popupPath, "utf8"));
  const runtimeSendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
    if (message.type === "TRACER_GET_CACHED_PAGE_SCAN") {
      callback(options.cachedScanResponse
        ? { ok: true, response: options.cachedScanResponse }
        : { ok: false });
      return;
    }

    if (message.type === "TRACER_SYNC_OPPORTUNITIES") {
      callback({
        ok: true,
        response: {
          protectedPurchaseCount: 0,
          openOpportunityCount: 0,
        },
      });
      return;
    }

    if (message.type === "TRACER_CHECK_PURCHASE_PROTECTION") {
      callback({
        ok: true,
        response: {
          protected: Boolean(options.protected),
          purchase: options.protected
            ? {
                id: "pur_existing",
                productName: purchaseDraft.lineItems[0]?.productName,
                pricePaid: purchaseDraft.lineItems[0]?.pricePaid,
                pricePaidDisplay: "£349.99",
              }
            : null,
        },
      });
      return;
    }

    if (message.type === "AFTERBUY_PROTECT_PURCHASE") {
      if (options.protectResponse === "defer") {
        options.onProtectCallback?.(callback);
        return;
      }

      callback(
        typeof options.protectResponse === "function"
          ? options.protectResponse()
          : options.protectResponse,
      );
    }
  });
  const tabsCreate = vi.fn();
  const storageSet = vi.fn(async () => undefined);
  const localStorageSet = vi.fn(async () => undefined);
  const executeScript = vi.fn().mockResolvedValue([]);
  const tabSendMessage = vi.fn((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
    callback(
      options.scanResponse ?? {
        ok: true,
        draft: purchaseDraft,
        summary: {
          retailerName: purchaseDraft.retailerName,
          productName: purchaseDraft.lineItems[0]?.productName,
          itemCount: 1,
          totalDisplay: "£349.99",
          confidence: "high",
        },
      },
    );
  });
  const dashboard = structuredClone(options.dashboardResponse ?? {
    purchases: [],
    opportunities: [],
  });
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/dashboard")) {
      return {
        ok: true,
        status: 200,
        json: async () => structuredClone(dashboard),
      };
    }

    if (url.endsWith("/api/settings/monitoring") && init?.method === "PUT") {
      return { ok: true, status: 204 };
    }

    if (init?.method === "DELETE") {
      const status = options.deleteStatus ?? 204;
      if (status === 204) {
        const purchaseId = decodeURIComponent(url.split("/").at(-1) ?? "");
        dashboard.purchases = dashboard.purchases.filter((purchase) => purchase.id !== purchaseId);
        dashboard.opportunities = dashboard.opportunities.filter(
          (opportunity) => opportunity.purchaseId !== purchaseId,
        );
      }
      return { ok: status >= 200 && status < 300, status };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  Object.assign(globalThis, {
    window,
    document: window.document,
    fetch: fetchMock,
    chrome: {
      runtime: {
        sendMessage: runtimeSendMessage,
        lastError: undefined,
      },
      scripting: {
        executeScript,
      },
      storage: {
        local: {
          get: vi.fn(async () => ({ tracerUserId: "dev-user" })),
          set: localStorageSet,
        },
        sync: {
          get: vi.fn(async (key: string | string[]) => {
            const keys = Array.isArray(key) ? key : [key];
            return {
              ...(keys.includes("dashboardBaseUrl") && options.dashboardBaseUrl
                ? { dashboardBaseUrl: options.dashboardBaseUrl }
                : {}),
            };
          }),
          set: storageSet,
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: options.tabUrl ?? purchaseDraft.sourceUrl }]),
        sendMessage: tabSendMessage,
        create: tabsCreate,
      },
    },
  });
  Object.assign(window, {
    close: vi.fn(),
  });

  await import("../src/popup");

  return {
    app: element("app"),
    protectButton: element<HTMLButtonElement>("protect"),
    dashboardCta: element<HTMLButtonElement>("dashboardCta"),
    protectedItemsCta: element<HTMLButtonElement>("protectedItemsCta"),
    popupBack: element<HTMLButtonElement>("popupBack"),
    menuSettings: element<HTMLButtonElement>("menuSettings"),
    priceDropAlertsToggle: element<HTMLButtonElement>("priceDropAlertsToggle"),
    monitoringToggle: element<HTMLButtonElement>("monitoringToggle"),
    clearProtectedPurchases: element<HTMLButtonElement>("clearProtectedPurchases"),
    confirmClearPurchases: element<HTMLButtonElement>("confirmClearPurchases"),
    deleteItem: element<HTMLButtonElement>("deleteItem"),
    howItWorksButton: element<HTMLButtonElement>("howItWorks"),
    runtimeSendMessage,
    storageSet,
    executeScript,
    tabsCreate,
    protectMessages: () =>
      runtimeSendMessage.mock.calls.filter(([message]) => {
        return (message as { type: string }).type === "AFTERBUY_PROTECT_PURCHASE";
      }),
    deleteRequests: () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    dashboardRequests: () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/dashboard")),
    scanMessages: () => tabSendMessage.mock.calls.filter(([, message]) => {
      return (message as { type: string }).type === "AFTERBUY_SCAN_PAGE";
    }),
    firstItem: () => element<HTMLElement>("itemsList").querySelector<HTMLButtonElement>(".item-row")!,
  };
}

function droppedDashboard() {
  return {
    purchases: [{
      id: "pur_existing",
      productName: "Sony WH-1000XM5",
      pricePaid: gbp(34_900),
      currentPriceDisplay: "£319",
      monitoringStatus: "price_dropped",
      savingDisplay: "£30",
    }],
    opportunities: [{
      purchaseId: "pur_existing",
      potentialSavingDisplay: "£30",
      status: "open",
    }],
  };
}

async function flushPopup(): Promise<void> {
  await wait(0);
  await wait(0);
  await wait(0);
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);

  if (!node) {
    throw new Error(`Missing test element: ${id}`);
  }

  return node as T;
}

function text(id: string): string {
  return element(id).textContent?.trim() ?? "";
}
