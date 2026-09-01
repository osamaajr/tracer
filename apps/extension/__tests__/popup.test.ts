import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gbp, type PurchaseDraft } from "@afterbuy/core";

const popupPath = new URL("../popup.html", import.meta.url);

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
  protected?: boolean;
  protectResponse?: unknown;
  dashboardBaseUrl?: string;
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
    expect(text("stateTitle")).toBe("Nothing to protect here.");
    expect(text("idleHeading")).toBe("Nothing to protect here.");
    expect(text("idleFeatureCard")).toContain("Price drops");
    expect(text("idleFeatureCard")).toContain("Policy windows");
    expect(text("idleFeatureCard")).toContain("Alerts");

    harness.protectedItemsCta.click();
    expect(harness.tabsCreate).toHaveBeenCalledWith({
      url: "https://app.tracer.test/dashboard",
    });

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
    expect(text("stateCopy")).toBe("Tracer could not read enough purchase details yet.");
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
    expect(harness.tabsCreate).toHaveBeenCalledWith({
      url: "https://app.tracer.test/dashboard?purchase=pur_123",
    });
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
    expect(harness.tabsCreate).toHaveBeenCalledWith({
      url: "https://app.tracer.test/dashboard?purchase=pur_existing",
    });
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

  Object.assign(globalThis, {
    window,
    document: window.document,
    chrome: {
      runtime: {
        sendMessage: runtimeSendMessage,
        lastError: undefined,
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([]),
      },
      storage: {
        sync: {
          get: vi.fn(async (key: string) => {
            if (key === "dashboardBaseUrl" && options.dashboardBaseUrl) {
              return { dashboardBaseUrl: options.dashboardBaseUrl };
            }

            return {};
          }),
          set: vi.fn(async () => undefined),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: options.tabUrl ?? purchaseDraft.sourceUrl }]),
        sendMessage: vi.fn((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
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
        }),
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
    howItWorksButton: element<HTMLButtonElement>("howItWorks"),
    runtimeSendMessage,
    tabsCreate,
    protectMessages: () =>
      runtimeSendMessage.mock.calls.filter(([message]) => {
        return (message as { type: string }).type === "AFTERBUY_PROTECT_PURCHASE";
      }),
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
