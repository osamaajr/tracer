import { WatchlistRepository } from "../src/watchlistRepository";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gbp, type PurchaseDraft, type SavedProduct } from "@afterbuy/core";

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
  savedProduct?: SavedProduct | null;
  saveFailure?: boolean;

  cachedScanResponse?: unknown;
  protected?: boolean;
  protectResponse?: unknown;
  dashboardBaseUrl?: string;
  dashboardResponse?: {
    purchases: Array<Record<string, unknown>>;
    opportunities: Array<Record<string, unknown>>;
  };
  pendingPurchases?: Array<Record<string, unknown>>;
  monitoringSettingsStatus?: number;
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

  it("saves a product, shows confirmation, deduplicates, and separates Saved from Protected", async () => {
    const harness = await setupPopup({
      savedProduct: {name:'Desk lamp',retailer:'shop.example.com',retailerId:'store_shop-example-com',canonicalUrl:'https://shop.example.com/products/lamp'},
      scanResponse: {ok:false,failureReason:'not_purchase_page'},
      tabUrl:'https://shop.example.com/products/lamp',
      dashboardResponse: droppedDashboard(),
    });
    await flushPopup();
    expect(harness.app.dataset.screen).toBe('watchlist');
    expect(text('watchProduct')).toContain('Desk lamp');
    element<HTMLButtonElement>('saveToTracer').click();
    await flushPopup();
    expect(text('watchHeading')).toBe('Saved.');
    expect(text('saveToTracer')).toBe('Saved');
    expect(element<HTMLButtonElement>('saveToTracer').dataset.status).toBe('saved');
    expect(harness.app.dataset.celebrate).toBe('true');
    expect(element('watchlistConfetti').children.length).toBeGreaterThan(0);
    expect(harness.protectMessages()).toHaveLength(0);
    element<HTMLButtonElement>('viewSaved').click();
    await flushPopup();
    expect(text('itemsList')).toContain('Desk lamp');
    expect(text('itemsList')).not.toContain('Sony');
    element<HTMLButtonElement>('protectedTab').click();
    await flushPopup();
    expect(text('itemsList')).toContain('Sony');
    expect(text('itemsList')).not.toContain('Desk lamp');
    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe('watchlist');
    element<HTMLButtonElement>('scan').click();
    await flushPopup();
    expect(text('watchHeading')).toBe('Already saved.');
    expect(element<HTMLButtonElement>('saveToTracer').disabled).toBe(true);
    element<HTMLButtonElement>('viewSaved').click();
    await flushPopup();
    element('itemsList').querySelector<HTMLButtonElement>('button')!.click();
    await flushPopup();
    expect(text('itemsList')).toContain('A place for your maybes.');
    expect(harness.deleteRequests()).toHaveLength(0);
  });

  it("keeps a failed save retryable without falsely claiming success", async () => {
    const harness = await setupPopup({savedProduct:{name:'Lamp',retailer:'shop.example.com',retailerId:'shop',canonicalUrl:'https://shop.example.com/products/lamp'},saveFailure:true,scanResponse:{ok:false,failureReason:'not_purchase_page'},tabUrl:'https://shop.example.com/products/lamp'});
    await flushPopup();
    element<HTMLButtonElement>('saveToTracer').click();
    await flushPopup();
    expect(element<HTMLButtonElement>('saveToTracer').disabled).toBe(false);
    expect(text('watchFeedback')).toContain('Could not save');
    expect(harness.protectMessages()).toHaveLength(0);
  });

  it("never offers saving a detected purchase or runs deeper product extraction for it", async () => {
    const harness=await setupPopup();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe('detected');
    expect(harness.executeScript.mock.calls.some(([args])=>args.files.includes('watchlistCapture.js'))).toBe(false);
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

  it("shows nothing to save on ordinary pages", async () => {
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
    expect(text("stateTitle")).toBe("Nothing to save here");
    expect(text("idleHeading")).toBe("Nothing to save here");
    element<HTMLButtonElement>("emptyContinueBrowsing").click();
    expect(window.close).toHaveBeenCalled();

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

  it("scans the page when an automatic purchase cache is unavailable", async () => {
    const harness = await setupPopup({
      cachedScanResponse: null,
      scanResponse: {
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
      tabUrl: "https://shopify.com/83196445016/account/orders/example",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("detected");
    expect(harness.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["genericCapture.js"],
    });
    expect(harness.scanMessages()).toHaveLength(1);
  });

  it("keeps manual opens save-focused when the page is not a purchase", async () => {
    const harness = await setupPopup({
      scanResponse: {
        ok: false,
        error: "Tracer could not read enough purchase details yet.",
      },
      tabUrl: "https://shop.example.com/checkout/order-confirmation/ABC",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("empty");
    expect(text("stateTitle")).toBe("Nothing to save here");
    expect(text("stateCopy")).toBe("Open Tracer on a product page to save it for later.");
  });

  it("offers the watchlist when manually opened on a product page", async () => {
    const harness = await setupPopup({
      scanResponse: {
        ok: false,
        failureReason: "incomplete",
        error: "Tracer could not read enough purchase details yet.",
      },
      savedProduct: {
        name: "Oversized flannel shirt",
        retailer: "H&M",
        retailerId: "store_www2-hm-com",
        canonicalUrl: "https://www2.hm.com/en_gb/productpage.1360951001.html",
        savedPrice: gbp(3_799),
      },
      tabUrl: "https://www2.hm.com/en_gb/productpage.1360951001.html",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("watchlist");
    expect(text("watchProduct")).toContain("Oversized flannel shirt");
    expect(text("saveToTracer")).toBe("Save to Tracer");
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
    expect(text("idleHeading")).toBe("Nothing to save here");
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

  it("keeps monitoring off and greys every protected item when server sync fails", async () => {
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: droppedDashboard(),
      monitoringSettingsStatus: 503,
    });
    await flushPopup();

    harness.dashboardCta.click();
    await flushPopup();
    harness.menuSettings.click();
    harness.monitoringToggle.click();
    await flushPopup();

    expect(harness.monitoringToggle.getAttribute("aria-checked")).toBe("false");
    expect(harness.storageSet).toHaveBeenCalledWith({ monitoringEnabled: false });

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("items");
    expect(harness.firstItem().dataset.paused).toBe("true");
    expect(harness.firstItem().textContent).toContain("Paused");
    expect(harness.firstItem().textContent).not.toContain("Price dropped");
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

  it("clears offline protected purchases locally without sending synthetic ids to the API", async () => {
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: { purchases: [], opportunities: [] },
      pendingPurchases: [{ id: "pending_123", draft: purchaseDraft, queuedAt: "2026-09-11T10:00:00.000Z" }],
    });
    await flushPopup();

    harness.dashboardCta.click();
    await flushPopup();
    expect(text("itemsList")).toContain("Sony WH-1000XM5");
    harness.menuSettings.click();
    harness.clearProtectedPurchases.click();
    harness.confirmClearPurchases.click();
    await flushPopup();

    expect(harness.deleteRequests()).toHaveLength(0);
    expect(harness.localStorageSet).toHaveBeenCalledWith({ tracerPendingPurchases: [] });
    expect(text("itemsCount")).toBe("0 items");
  });

  it("confirms before clearing saved items and leaves protected purchases alone", async () => {
    const harness = await setupPopup({
      savedProduct: {name:'Desk lamp',retailer:'shop.example.com',retailerId:'shop',canonicalUrl:'https://shop.example.com/products/lamp'},
      scanResponse: {ok:false,failureReason:'not_purchase_page'},
      tabUrl:'https://shop.example.com/products/lamp',
      dashboardResponse: droppedDashboard(),
    });
    await flushPopup();
    element<HTMLButtonElement>('saveToTracer').click();
    await flushPopup();

    harness.menuSettings.click();
    harness.clearSavedItems.click();
    expect(harness.watchlistClearMessages()).toHaveLength(0);
    expect(harness.clearSavedPill.dataset.confirming).toBe('true');
    harness.confirmClearSaved.click();
    await flushPopup();

    expect(harness.watchlistClearMessages()).toHaveLength(1);
    expect(harness.deleteRequests()).toHaveLength(0);
    expect(harness.clearSavedPill.dataset.confirming).toBe('false');
    harness.popupBack.click();
    element<HTMLButtonElement>('viewSaved').click();
    await flushPopup();
    expect(text('itemsList')).toContain('A place for your maybes.');
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

  it("saves the purchase locally when the service is unavailable", async () => {
    const protectResponse: unknown = {
      ok: false,
      error: "Tracer API returned 500",
    };
    const harness = await setupPopup({
      protectResponse: () => protectResponse,
    });
    await flushPopup();

    harness.protectButton.click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("protected");
    expect(text("successTitle")).toBe("Purchase saved");
    expect(text("successCopy")).toContain("Saved on this device");
    expect(text("summaryStatus")).toBe("Watching");
    expect(harness.localStorageSet).toHaveBeenCalledWith(expect.objectContaining({
      tracerPendingPurchases: expect.any(Array),
    }));

    harness.dashboardCta.click();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe("items");
    expect(text("itemsList")).toContain("Sony WH-1000XM5");
    expect(text("itemsList")).toContain("Watching");
  });
});

async function setupPopup(
  options: PopupHarnessOptions & {
    protectResponse?: unknown | (() => unknown);
    onProtectCallback?: (callback: (response: unknown) => void) => void;
  } = {},
) {
  const { window } = parseHTML(readFileSync(popupPath, "utf8"));
  const defaultPurchaseScan = {
    ok: true,
    draft: purchaseDraft,
    summary: {
      retailerName: purchaseDraft.retailerName,
      productName: purchaseDraft.lineItems[0]?.productName,
      itemCount: 1,
      totalDisplay: "£349.99",
      confidence: "high",
    },
  };
  const cachedScanResponse = options.cachedScanResponse ?? (
    options.scanResponse === undefined && options.savedProduct === undefined
      ? defaultPurchaseScan
      : null
  );
  const runtimeSendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
    if (message.type === "TRACER_WATCHLIST_SAVE") {
      if (options.saveFailure) return Promise.resolve({ok:false,error:'Could not save. Try again.'});
      return watchlist.save((message as {type:string; product:SavedProduct}).product).then(result => ({ok:true,result}));
    }
    if (message.type === "TRACER_WATCHLIST_LIST") return watchlist.list().then(result => ({ok:true,result}));
    if (message.type === "TRACER_WATCHLIST_REMOVE") return watchlist.remove((message as {type:string; id:string}).id).then(result => ({ok:true,result}));
    if (message.type === "TRACER_WATCHLIST_CLEAR") return watchlist.clearSaved().then(result => ({ok:true,result}));
    if (message.type === "TRACER_GET_CACHED_PAGE_SCAN") {
      callback(cachedScanResponse
        ? { ok: true, response: cachedScanResponse }
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
  const localStore: Record<string, unknown> = {
    tracerUserId: "dev-user",
    ...(options.pendingPurchases ? { tracerPendingPurchases: options.pendingPurchases } : {}),
  };
  const localStorageSet = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(localStore, values);
  });
  const watchlist = new WatchlistRepository({get:async key => ({[key]:localStore[key]}),set:localStorageSet});
  const executeScript = vi.fn().mockResolvedValue([]);
  const tabSendMessage = vi.fn((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
    if ((_message as {type:string}).type === 'TRACER_EXTRACT_SAVED_PRODUCT') return Promise.resolve({product:options.savedProduct ?? null});
    callback(
      options.scanResponse ?? defaultPurchaseScan,
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
      const status = options.monitoringSettingsStatus ?? 204;
      return { ok: status >= 200 && status < 300, status };
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
          get: vi.fn(async (key: string | string[]) => {
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(keys.filter((item) => item in localStore).map((item) => [item, localStore[item]]));
          }),
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
    clearSavedItems: element<HTMLButtonElement>("clearSavedItems"),
    clearSavedPill: element<HTMLElement>("clearSavedPill"),
    confirmClearSaved: element<HTMLButtonElement>("confirmClearSaved"),
    deleteItem: element<HTMLButtonElement>("deleteItem"),
    howItWorksButton: element<HTMLButtonElement>("howItWorks"),
    runtimeSendMessage,
    storageSet,
    localStorageSet,
    executeScript,
    tabsCreate,
    protectMessages: () =>
      runtimeSendMessage.mock.calls.filter(([message]) => {
        return (message as { type: string }).type === "AFTERBUY_PROTECT_PURCHASE";
      }),
    deleteRequests: () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    dashboardRequests: () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/dashboard")),
    watchlistClearMessages: () => runtimeSendMessage.mock.calls.filter(([message]) => (message as {type:string}).type === 'TRACER_WATCHLIST_CLEAR'),
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
