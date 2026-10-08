import { WatchlistRepository } from "../src/watchlistRepository";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gbp, type PurchaseDraft, type SavedProduct } from "@tracer/core";

const popupPath = new URL("../popup.html", import.meta.url);
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const popupTimers = new Set<ReturnType<typeof setTimeout>>();
const fallbackPriceCheck = vi.fn(async () => { throw new Error("Store price unavailable in this fixture"); });

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
  imageCandidates?: string[];
  saveFailure?: boolean;

  cachedScanResponse?: unknown;
  protected?: boolean;
  savedProducts?: Array<SavedProduct | null>;
  protectResponse?: unknown;
  dashboardBaseUrl?: string;
  preferencesGate?: Promise<void>;
  dashboardResponse?: {
    purchases: Array<Record<string, unknown>>;
    opportunities: Array<Record<string, unknown>>;
  };
  dashboardFailures?: number;
  priceCheckGate?: Promise<void>;
  priceCheckFails?: boolean;
  pendingPurchases?: Array<Record<string, unknown>>;
  monitoringSettingsStatus?: number;
  deleteStatus?: number;
  scanResponse?: unknown;
  scanResponses?: unknown[];
  tabUrl?: string;
}

describe("extension popup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T09:05:00.000Z"));
    fallbackPriceCheck.mockClear();
    vi.doMock("../src/storePriceCheck", () => ({
      checkStorePrice: fallbackPriceCheck,
    }));
  });

  afterEach(() => {
    for (const timer of popupTimers) clearTimeout(timer);
    popupTimers.clear();
    vi.restoreAllMocks();
    vi.doUnmock("../src/storePriceCheck");
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    globalThis.fetch = originalFetch;
  });

  it.each([
    "https://app.tracer.test",
    "https://app.tracer.test/",
    "https://app.tracer.test/dashboard?purchase=123#items",
    "http://127.0.0.1:5174",
  ])("opens Contact from the Help menu using %s", async (dashboardBaseUrl) => {
    const harness = await setupPopup({ dashboardBaseUrl });
    await flushPopup();
    const toggle = element<HTMLButtonElement>("menuToggle");
    toggle.click();
    expect(element("popupMenu").hidden).toBe(false);

    element<HTMLButtonElement>("menuHelp").click();
    await flushPopup();

    expect(harness.tabsCreate).toHaveBeenCalledExactlyOnceWith({
      url: new URL("/contact", dashboardBaseUrl).href,
    });
    expect(element("popupMenu").hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("waits for saved preferences before opening Help", async () => {
    let releasePreferences!: () => void;
    const preferencesGate = new Promise<void>((resolve) => { releasePreferences = resolve; });
    const harness = await setupPopup({
      dashboardBaseUrl: "https://app.tracer.test",
      preferencesGate,
    });
    element<HTMLButtonElement>("menuToggle").click();
    element<HTMLButtonElement>("menuHelp").click();
    expect(harness.tabsCreate).not.toHaveBeenCalled();

    releasePreferences();
    await flushPopup();
    expect(harness.tabsCreate).toHaveBeenCalledExactlyOnceWith({
      url: "https://app.tracer.test/contact",
    });
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

  it("lets the user choose which detected product image is saved", async () => {
    const firstImage = 'https://shop.example.com/lamp-front.jpg';
    const secondImage = 'https://shop.example.com/lamp-side.jpg';
    const thirdImage = 'https://shop.example.com/lamp-room.jpg';
    const harness = await setupPopup({
      savedProduct: {
        name: 'Desk lamp',
        retailer: 'Shop',
        retailerId: 'store_shop-example-com',
        canonicalUrl: 'https://shop.example.com/products/lamp',
        imageUrl: firstImage,
      },
      imageCandidates: [firstImage, secondImage, thirdImage],
      scanResponse: {ok:false,failureReason:'not_purchase_page'},
      tabUrl: 'https://shop.example.com/products/lamp',
    });
    await flushPopup();

    const productCard = element('watchProduct');
    expect(productCard.querySelectorAll('.saved-image-arrow')).toHaveLength(2);
    expect(productCard.querySelector('img')?.getAttribute('src')).toBe(firstImage);

    productCard.querySelector<HTMLButtonElement>('.saved-image-arrow--next')?.click();
    expect(productCard.querySelector('img')?.getAttribute('src')).toBe(secondImage);

    element<HTMLButtonElement>('saveToTracer').click();
    await flushPopup();
    const saveMessage = harness.runtimeSendMessage.mock.calls
      .map(([message]) => message as {type:string; product?:SavedProduct})
      .find((message) => message.type === 'TRACER_WATCHLIST_SAVE');
    expect(saveMessage?.product?.imageUrl).toBe(secondImage);
    expect(productCard.querySelectorAll('.saved-image-arrow')).toHaveLength(0);
  });

  it("shows resized variants of the same product image only once", async () => {
    const frontImage = 'https://cdn.shop.example.com/lamp-front.jpg?width=1200&quality=90';
    const duplicateFrontImage = 'https://cdn.shop.example.com/lamp-front.jpg?quality=70&width=400';
    const sideImage = 'https://cdn.shop.example.com/lamp-side.jpg?width=1200';
    await setupPopup({
      savedProduct: {
        name: 'Desk lamp',
        retailer: 'Shop',
        retailerId: 'store_shop-example-com',
        canonicalUrl: 'https://shop.example.com/products/lamp',
        imageUrl: frontImage,
      },
      imageCandidates: [duplicateFrontImage, frontImage, sideImage],
      scanResponse: {ok:false,failureReason:'not_purchase_page'},
      tabUrl: 'https://shop.example.com/products/lamp',
    });
    await flushPopup();

    const productCard = element('watchProduct');
    const next = productCard.querySelector<HTMLButtonElement>('.saved-image-arrow--next')!;
    expect(productCard.querySelector('img')?.getAttribute('src')).toBe(frontImage);
    next.click();
    expect(productCard.querySelector('img')?.getAttribute('src')).toBe(sideImage);
    productCard.querySelector<HTMLButtonElement>('.saved-image-arrow--next')!.click();
    expect(productCard.querySelector('img')?.getAttribute('src')).toBe(frontImage);
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
    expect(harness.productMessages()).toHaveLength(0);
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
        failureReason: "not_purchase_page",
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

  it("does not scan or show a purchase on an Argos delivery step", async () => {
    const harness = await setupPopup({
      scanResponse: { ok: true, draft: purchaseDraft },
      tabUrl: "https://www.argos.co.uk/checkout/e8cd0ac7-67f9-4334-8157-304eac0011c6/delivery",
    });
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("empty");
    expect(text("stateCopy")).toBe("Open Tracer after your order is complete.");
    expect(harness.scanMessages()).toHaveLength(0);
    expect(harness.executeScript).not.toHaveBeenCalled();
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
      files: ["genericCapture.js", "watchlistCapture.js"],
    });
    expect(harness.scanMessages()).toHaveLength(1);
  });

  it("retries detection when the order details arrive just after the popup opens", async () => {
    const harness = await setupPopup({
      cachedScanResponse: null,
      scanResponses: [
        { ok: false, failureReason: "incomplete" },
        {
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
      ],
      tabUrl: "https://shopify.com/83196445016/account/orders/example",
    });

    await wait(400);
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("detected");
    expect(harness.scanMessages()).toHaveLength(2);
  });

  it("retries product extraction when the storefront is still rendering", async () => {
    const product: SavedProduct = {
      name: "Desk lamp",
      retailer: "Shop",
      retailerId: "store_shop-example-com",
      canonicalUrl: "https://shop.example.com/products/lamp",
    };
    const harness = await setupPopup({
      scanResponse: { ok: false, failureReason: "not_purchase_page" },
      savedProducts: [null, product],
      tabUrl: "https://shop.example.com/products/lamp",
    });

    await wait(400);
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("watchlist");
    expect(text("watchProduct")).toContain("Desk lamp");
    expect(harness.productMessages()).toHaveLength(2);
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

    expect(harness.app.dataset.screen).toBe("detecting");
    await wait(1_200);
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
    const protectedImage = harness.firstItem().querySelector("img");
    expect(protectedImage?.getAttribute("src")).toBe("https://store.example.com/headphones.png");
    expect(protectedImage?.getAttribute("loading")).toBe("lazy");
    harness.firstItem().click();
    await flushPopup();

    expect(harness.app.dataset.screen).toBe("detail");
    expect(text("detailStatus")).toBe("● Price dropped by £30");
    expect(element("detailStatus").dataset.alert).toBe("true");
    expect(text("detailPaid")).toBe("£349");
    expect(text("detailCurrentPrice")).toBe("£319");
    expect(element<HTMLImageElement>("detailImage").getAttribute("src")).toBe("https://store.example.com/headphones.png");
    expect(text("detailMonitoringInsight")).toContain("Last checked");
    expect(element<HTMLAnchorElement>("detailProductAction").href).toBe("https://store.example.com/sony-wh-1000xm5");
    expect(element<HTMLAnchorElement>("detailProductAction").target).toBe("_blank");
    expect(element<HTMLAnchorElement>("detailProductAction").hidden).toBe(false);
    element<HTMLButtonElement>("detailAlertsSwitch").click();
    expect(element<HTMLButtonElement>("detailAlertsSwitch").getAttribute("aria-checked")).toBe("false");

    harness.popupBack.click();
    await flushPopup();
    expect(harness.app.dataset.screen).toBe("items");
    expect(harness.dashboardRequests()).toHaveLength(1);

    harness.popupBack.click();
    expect(harness.app.dataset.screen).toBe("duplicate");
  });

  it("shows the smaller shimmer only while a real price check is running", async () => {
    let releaseCheck!: () => void;
    const priceCheckGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const dashboard = droppedDashboard();
    dashboard.purchases[0]!.currentPriceDisplay = null as unknown as string;
    dashboard.purchases[0]!.monitoringStatus = "watching";
    const harness = await setupPopup({ protected: true, dashboardResponse: dashboard, priceCheckGate });
    await flushPopup();
    harness.dashboardCta.click();
    await flushPopup();
    harness.firstItem().click();
    await flushPopup();
    expect(harness.priceCheckRequests()).toHaveLength(1);
    expect(text("detailCurrentPrice")).toBe("Checking");
    expect(element("detailCurrentPrice").dataset.checking).toBe("true");
    releaseCheck();
    await flushPopup();
    expect(text("detailCurrentPrice")).toBe("£319.99");
    expect(element("detailCurrentPrice").dataset.checking).toBe("false");
  });

  it("stops the checking shimmer and reports an unavailable price after failure", async () => {
    const dashboard = droppedDashboard();
    dashboard.purchases[0]!.currentPriceDisplay = null as unknown as string;
    dashboard.purchases[0]!.monitoringStatus = "watching";
    const harness = await setupPopup({ protected: true, dashboardResponse: dashboard, priceCheckFails: true });
    await flushPopup();
    harness.dashboardCta.click();
    await flushPopup();
    harness.firstItem().click();
    await flushPopup();
    expect(harness.priceCheckRequests()).toHaveLength(1);
    await vi.waitFor(() => expect(text("detailCurrentPrice")).toBe("Unable to check"));
    expect(element("detailCurrentPrice").dataset.checking).toBe("false");
  });

  it("keeps the last verified price visible when a refresh fails", async () => {
    const dashboard = droppedDashboard();
    dashboard.purchases[0]!.lastCheckedAt = "2026-09-01T08:00:00.000Z";
    const harness = await setupPopup({ protected: true, dashboardResponse: dashboard, priceCheckFails: true });
    await flushPopup();
    harness.dashboardCta.click();
    await flushPopup();
    harness.firstItem().click();
    await flushPopup();

    expect(harness.priceCheckRequests()).toHaveLength(1);
    await vi.waitFor(() => expect(element("detailCurrentPrice").dataset.checking).toBe("false"));
    expect(text("detailCurrentPrice")).toBe("£319");
    expect(text("detailPriceNote")).toContain("latest check failed");
    expect(element("detailCurrentPrice").dataset.checking).toBe("false");
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

  it("marks an unable-to-check purchase as an error", async () => {
    const dashboard = droppedDashboard();
    dashboard.purchases[0]!.monitoringStatus = "unable_to_check";
    dashboard.purchases[0]!.currentPriceDisplay = "Unable to check";
    dashboard.opportunities = [];
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: dashboard,
    });
    await flushPopup();

    harness.dashboardCta.click();
    await flushPopup();

    expect(harness.firstItem().dataset.error).toBe("true");
    expect(harness.firstItem().textContent).toContain("Unable to check");
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

  it("lists every item from one protected multi-item order separately", async () => {
    const multiItemDraft: PurchaseDraft = {
      ...purchaseDraft,
      orderReference: "MULTI-123",
      lineItems: [
        { productName: "Canvas jacket", quantity: 1, pricePaid: gbp(6_400), productUrl: "https://store.example.com/canvas-jacket" },
        { productName: "Heavyweight tee", quantity: 2, pricePaid: gbp(2_500), productUrl: "https://store.example.com/heavyweight-tee" },
        { productName: "Cotton cap", quantity: 1, pricePaid: gbp(1_850), productUrl: "https://store.example.com/cotton-cap" },
      ],
    };
    const harness = await setupPopup({
      protected: true,
      dashboardResponse: { purchases: [], opportunities: [] },
      pendingPurchases: [{ id: "pending_multi", draft: multiItemDraft, queuedAt: "2026-09-16T10:00:00.000Z" }],
    });
    await flushPopup();

    harness.dashboardCta.click();
    await flushPopup();

    expect(text("itemsCount")).toBe("3 items");
    expect(text("itemsList")).toContain("Canvas jacket");
    expect(text("itemsList")).toContain("Heavyweight tee");
    expect(text("itemsList")).toContain("Cotton cap");
  });

  it("clears local purchases even when the server is unreachable", async () => {
    const harness = await setupPopup({
      protected: true,
      pendingPurchases: [{ id: "pending_offline", draft: purchaseDraft, queuedAt: "2026-09-11T10:00:00.000Z" }],
    });
    await flushPopup();
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    harness.menuSettings.click();
    harness.clearProtectedPurchases.click();
    harness.confirmClearPurchases.click();
    await flushPopup();
    expect(harness.localStorageSet).toHaveBeenCalledWith({ tracerPendingPurchases: [] });
    expect(document.body.textContent).toContain("Local purchases cleared. Reconnect to clear server purchases.");
    expect(harness.confirmClearPurchases.disabled).toBe(false);
  });

  it("retries a failed purchase load when refresh is clicked", async () => {
    const harness = await setupPopup({
      dashboardResponse: droppedDashboard(),
      dashboardFailures: 1,
    });
    await flushPopup();

    harness.protectedItemsCta.click();
    await flushPopup();
    expect(text("itemsList")).toContain("No purchases saved offline");

    element<HTMLButtonElement>("itemsList").querySelector<HTMLButtonElement>(".items-refresh")!.click();
    await flushPopup();
    expect(harness.dashboardRequests()).toHaveLength(2);
    expect(text("itemsList")).toContain("Sony WH-1000XM5");
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

  it.each([false, true])("keeps a deletion error visible after a delayed price check (failure: %s)", async (priceCheckFails) => {
    let releaseCheck!: () => void;
    const priceCheckGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const dashboard = droppedDashboard();
    dashboard.purchases[0]!.lastCheckedAt = "2026-09-01T08:00:00.000Z";
    const harness = await setupPopup({ dashboardResponse: dashboard, deleteStatus: 500, priceCheckGate, priceCheckFails });
    await flushPopup();
    harness.protectedItemsCta.click();
    await flushPopup();
    harness.firstItem().click();
    await flushPopup();
    expect(text("detailCurrentPrice")).toBe("Checking");
    harness.deleteItem.click();
    await flushPopup();
    expect(text("detailStatus")).toBe("Couldn’t remove this item. Try again.");
    releaseCheck();
    await vi.waitFor(() => priceCheckFails
      ? expect(fallbackPriceCheck).toHaveBeenCalledTimes(1)
      : expect(harness.dashboardRequests()).toHaveLength(2));
    await flushPopup();
    expect(text("detailStatus")).toBe("Couldn’t remove this item. Try again.");
    expect(element("detailCurrentPrice").dataset.checking).toBe("false");
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
  vi.spyOn(window, "setTimeout").mockImplementation((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSetTimeout(...args);
    popupTimers.add(timer);
    return timer;
  });
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
    options.scanResponse === undefined && options.scanResponses === undefined && options.savedProduct === undefined
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

    if (message.type === "TRACER_PROTECT_PURCHASE") {
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
  let scanResponseIndex = 0;
  let savedProductIndex = 0;
  const tabSendMessage = vi.fn((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
    if ((_message as {type:string}).type === 'TRACER_EXTRACT_SAVED_PRODUCT') {
      return Promise.resolve({
        product: options.savedProducts
          ? options.savedProducts[Math.min(savedProductIndex++, options.savedProducts.length - 1)] ?? null
          : options.savedProduct ?? null,
        imageCandidates: options.imageCandidates ?? [],
      });
    }
    const sequenceResponse = options.scanResponses
      ? options.scanResponses[Math.min(scanResponseIndex++, options.scanResponses.length - 1)]
      : undefined;
    callback(sequenceResponse ?? options.scanResponse ?? defaultPurchaseScan);
  });
  const dashboard = structuredClone(options.dashboardResponse ?? {
    purchases: [],
    opportunities: [],
  });
  let remainingDashboardFailures = options.dashboardFailures ?? 0;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/check-price") && init?.method === "POST") {
      await options.priceCheckGate;
      if (options.priceCheckFails) return { ok: false, status: 502 };
      dashboard.purchases[0]!.currentPriceDisplay = "£319.99";
      return { ok: true, status: 200 };
    }
    if (url.endsWith("/api/dashboard")) {
      if (remainingDashboardFailures > 0) {
        remainingDashboardFailures -= 1;
        throw new TypeError("Failed to fetch");
      }
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
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: fetchMock,
    chrome: {
      runtime: {
        sendMessage: runtimeSendMessage,
        getURL: vi.fn(() => new URL("../src/storePriceCheck.ts", import.meta.url).href),
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
            await options.preferencesGate;
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
        return (message as { type: string }).type === "TRACER_PROTECT_PURCHASE";
      }),
    deleteRequests: () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    dashboardRequests: () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/dashboard")),
    priceCheckRequests: () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/check-price")),
    watchlistClearMessages: () => runtimeSendMessage.mock.calls.filter(([message]) => (message as {type:string}).type === 'TRACER_WATCHLIST_CLEAR'),
    scanMessages: () => tabSendMessage.mock.calls.filter(([, message]) => {
      return (message as { type: string }).type === "TRACER_SCAN_PAGE";
    }),
    productMessages: () => tabSendMessage.mock.calls.filter(([, message]) => {
      return (message as { type: string }).type === "TRACER_EXTRACT_SAVED_PRODUCT";
    }),
    firstItem: () => element<HTMLElement>("itemsList").querySelector<HTMLButtonElement>(".item-row")!,
  };
}

function droppedDashboard() {
  return {
    purchases: [{
      id: "pur_existing",
      productName: "Sony WH-1000XM5",
      retailerName: "Example Store",
      storeHost: "store.example.com",
      productUrl: "https://store.example.com/sony-wh-1000xm5",
      purchasedAt: "2026-08-30T09:15:00.000Z",
      createdAt: "2026-08-30T09:15:00.000Z",
      imageUrl: "https://store.example.com/headphones.png",
      pricePaid: gbp(34_900),
      currentPriceDisplay: "£319",
      lastCheckedAt: "2026-09-22T09:00:00.000Z",
      monitoringStatus: "price_dropped",
      savingDisplay: "£30",
      recentActivity: [{
        type: "price_dropped",
        title: "Price dropped",
        description: "Price is down £30.",
        occurredAt: "2026-09-22T09:00:00.000Z",
      }],
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
