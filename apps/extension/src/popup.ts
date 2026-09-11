import { populateConfetti } from "./confetti";
import {
  addCalendarDays,
  defaultPolicyRegistry,
  formatMoney,
  parsePrice,
  type Money,
  type PurchaseDraft,
  type PurchaseLineItemDraft,
  type PurchaseRecord,
} from "@afterbuy/core";

interface ScanResponse {
  ok: boolean;
  failureReason?: "not_purchase_page" | "incomplete" | "scan_error";
  draft?: PurchaseDraft;
  summary?: {
    retailerName: string;
    productName: string;
    itemCount: number;
    totalDisplay: string;
    confidence: string;
  };
  error?: string;
}

interface ProtectResponse {
  accepted: Array<{
    status: "created" | "duplicate";
    purchase?: Pick<PurchaseRecord, "id">;
  }>;
  rejected: Array<{
    productName: string;
    reason: string;
  }>;
}

type ProtectMessageResponse =
  | {
      ok: true;
      response: ProtectResponse;
    }
  | {
      ok: false;
      error?: string;
    };

type CheckProtectionMessageResponse =
  | {
      ok: true;
      response: ProtectionStatusResponse;
    }
  | {
      ok: false;
      error?: string;
    };

interface ProtectionStatusResponse {
  protected: boolean;
  purchase: (Pick<PurchaseRecord, "id" | "pricePaid" | "productName"> & {
    pricePaidDisplay?: string;
  }) | null;
}

interface DashboardPurchase extends PurchaseRecord {
  currentPriceDisplay?: string | null;
  monitoringStatus?: "watching" | "price_dropped" | "monitoring_paused" | "unable_to_check" | "unavailable";
  savingDisplay?: string | null;
  savingPercentageBps?: number | null;
  priceDropDetectedAt?: string | null;
}

interface DashboardOpportunity {
  purchaseId: string;
  potentialSavingDisplay: string;
  status: string;
}

interface DashboardData {
  purchases: DashboardPurchase[];
  opportunities: DashboardOpportunity[];
}

interface CachedScanMessageResponse {
  ok: boolean;
  response?: ScanResponse;
}

type SyncMessageResponse =
  | {
      ok: true;
      response: {
        protectedPurchaseCount: number;
        openOpportunityCount: number;
      };
    }
  | { ok: false; error?: string };

type PopupState =
  | "detecting"
  | "detected"
  | "protected"
  | "duplicate"
  | "empty"
  | "incomplete"
  | "review"
  | "error"
  | "items"
  | "detail"
  | "settings";

const defaultApiBaseUrl = "http://127.0.0.1:4000";
const defaultDashboardBaseUrl = "http://127.0.0.1:5173";
const defaultUserId = "dev-user-afterbuy";
const scanTimeoutMs = 3_500;
const startWithDetectedPreview = import.meta.env.MODE === "preview";

const app = getElement<HTMLElement>("app");
const confetti = getElement<HTMLElement>("confetti");
const apiInput = getElement<HTMLInputElement>("apiBaseUrl");
const saveButton = getElement<HTMLButtonElement>("save");
const scanButton = getElement<HTMLButtonElement>("scan");
const protectButton = getElement<HTMLButtonElement>("protect");
const reviewDetailsButton = getElement<HTMLButtonElement>("reviewDetails");
const maybeLaterButton = getElement<HTMLButtonElement>("maybeLater");
const stateCloseButton = getElement<HTMLButtonElement>("stateClose");
const settingsToggle = getElement<HTMLButtonElement>("settingsToggle");
const menuToggle = getElement<HTMLButtonElement>("menuToggle");
const menuSettings = getElement<HTMLButtonElement>("menuSettings");
const popupBack = getElement<HTMLButtonElement>("popupBack");
const popupMenu = getElement<HTMLElement>("popupMenu");
const yourItemsMenu = getElement<HTMLButtonElement>("yourItemsMenu");
const itemsList = getElement<HTMLElement>("itemsList");
const itemsCount = getElement<HTMLElement>("itemsCount");
const menuItemsCount = getElement<HTMLElement>("menuItemsCount");
const detailName = getElement<HTMLElement>("detailName");
const detailStatus = getElement<HTMLElement>("detailStatus");
const deleteItem = getElement<HTMLButtonElement>("deleteItem");
const itemFacts = getElement<HTMLElement>("itemFacts");
const priceDropAlertsToggle = getElement<HTMLButtonElement>("priceDropAlertsToggle");
const monitoringToggle = getElement<HTMLButtonElement>("monitoringToggle");
const clearProtectedPurchases = getElement<HTMLButtonElement>("clearProtectedPurchases");
const clearPurchasesPill = getElement<HTMLElement>("clearPurchasesPill");
const clearConfirmation = getElement<HTMLElement>("clearConfirmation");
const clearConfirmationMessage = getElement<HTMLElement>("clearConfirmationMessage");
const cancelClearPurchases = getElement<HTMLButtonElement>("cancelClearPurchases");
const confirmClearPurchases = getElement<HTMLButtonElement>("confirmClearPurchases");
const stateTitle = getElement<HTMLElement>("stateTitle");
const stateCopy = getElement<HTMLElement>("stateCopy");
const reviewPanel = getElement<HTMLElement>("reviewPanel");
const dashboardLink = getElement<HTMLAnchorElement>("dashboardLink");
const retailerLabel = getElement<HTMLElement>("retailer");
const productName = getElement<HTMLElement>("productName");
const itemSubtitle = getElement<HTMLElement>("itemSubtitle");
const totalPaid = getElement<HTMLElement>("totalPaid");
const purchaseDate = getElement<HTMLElement>("purchaseDate");
const matchStatus = getElement<HTMLElement>("matchStatus");
const productUrlRow = getElement<HTMLElement>("productUrlRow");
const productUrl = getElement<HTMLAnchorElement>("productUrl");
const productUrlText = getElement<HTMLElement>("productUrlText");
const windowLabel = getElement<HTMLElement>("windowLabel");
const windowValue = getElement<HTMLElement>("windowValue");
const windowChip = getElement<HTMLElement>("windowChip");
const summaryProductName = getElement<HTMLElement>("summaryProductName");
const summarySubtitle = getElement<HTMLElement>("summarySubtitle");
const summaryPaid = getElement<HTMLElement>("summaryPaid");
const successTitle = getElement<HTMLElement>("successTitle");
const successCopy = getElement<HTMLElement>("successCopy");
const dashboardCta = getElement<HTMLButtonElement>("dashboardCta");
const protectedItemsCta = getElement<HTMLButtonElement>("protectedItemsCta");
const howItWorksButton = getElement<HTMLButtonElement>("howItWorks");
const reviewProductName = getElement<HTMLInputElement>("reviewProductName");
const reviewPrice = getElement<HTMLInputElement>("reviewPrice");
const reviewDate = getElement<HTMLInputElement>("reviewDate");
const reviewUrl = getElement<HTMLInputElement>("reviewUrl");
const saveReviewButton = getElement<HTMLButtonElement>("saveReview");

let capturedDraft: PurchaseDraft | null = null;
let currentState: PopupState = "detecting";
let apiBaseUrl = defaultApiBaseUrl;
let dashboardBaseUrl = defaultDashboardBaseUrl;
let protectedPurchaseId: string | null = null;
let itemsReturnState: PopupState = "empty";
let settingsReturnState: PopupState = "empty";
let selectedPurchaseId: string | null = null;
let itemsLoadRunId = 0;
let activeScanRunId = 0;
let dashboardCache: DashboardData | null = null;
let confettiPopulated = false;
let tracerUserIdPromise: Promise<string> | null = null;

const previewPurchaseDraft: PurchaseDraft = {
  retailerId: "example-store",
  retailerName: "Example Store",
  storeHost: "store.example.com",
  sourceUrl: "https://store.example.com/sony-wh-1000xm5-wireless-noise-cancelling-headphones",
  purchasedAt: "2025-05-24T12:00:00.000Z",
  captureMethod: "retailer_adapter",
  captureConfidence: "high",
  orderReference: "JL1234567890",
  lineItems: [
    {
      productName: "Sony WH-1000XM5",
      quantity: 1,
      pricePaid: { amountMinor: 34_999, currency: "GBP" },
      productUrl: "https://store.example.com/sony-wh-1000xm5-wireless-noise-cancelling-headphones",
      productUrlConfidence: "high",
      externalProductId: "sony-wh-1000xm5-black",
      imageUrl: getExtensionAssetUrl("assets/product-headphones.png"),
    },
  ],
};


const preferencesReady = chrome.storage.sync.get([
  "apiBaseUrl",
  "dashboardBaseUrl",
  "priceDropAlertsEnabled",
  "monitoringEnabled",
]).then((stored) => {
  apiBaseUrl = typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl : defaultApiBaseUrl;
  dashboardBaseUrl = typeof stored.dashboardBaseUrl === "string"
    ? stored.dashboardBaseUrl
    : defaultDashboardBaseUrl;
  apiInput.value = apiBaseUrl;
  dashboardLink.href = buildDashboardUrl();
  setSwitchValue(priceDropAlertsToggle, stored.priceDropAlertsEnabled !== false);
  const monitoringEnabled = stored.monitoringEnabled !== false;
  setSwitchValue(monitoringToggle, monitoringEnabled);
  void persistMonitoringSetting(monitoringEnabled).catch(() => undefined);
});

void refreshOpportunityStatus();
if (startWithDetectedPreview) {
  renderDetectedPreview();
} else {
  void scanActiveTab();
}

saveButton.addEventListener("click", () => {
  const value = apiInput.value.trim();

  if (
    !value.startsWith("http://localhost:") &&
    !value.startsWith("http://127.0.0.1:") &&
    !value.startsWith("https://")
  ) {
    renderState("error", "Check the API URL.", "Use a local development URL or an HTTPS API URL.");
    return;
  }

  void chrome.storage.sync.set({ apiBaseUrl: value }).then(() => {
    apiBaseUrl = value;
    dashboardCache = null;
    renderState(currentState, "Settings saved.", "Tracer will use this API URL for local testing.");
  });
});

scanButton.addEventListener("click", () => {
  void scanActiveTab();
});

maybeLaterButton.addEventListener("click", () => {
  window.close();
});
stateCloseButton.addEventListener("click", () => {
  if (currentState === "error" && capturedDraft) {
    protectButton.click();
    return;
  }
  window.close();
});
settingsToggle.addEventListener("click", openSettings);
menuToggle.addEventListener("click", () => { popupMenu.hidden = !popupMenu.hidden; menuToggle.setAttribute("aria-expanded", String(!popupMenu.hidden)); });
yourItemsMenu.addEventListener("click", openProtectedItems);
menuSettings.addEventListener("click", openSettings);
getElement<HTMLButtonElement>("menuHelp").addEventListener("click", () => {
  popupMenu.hidden = true;
  openExtensionUrl(`${dashboardBaseUrl.replace(/\/$/, "")}/`);
});
popupBack.addEventListener("click", navigateBack);
priceDropAlertsToggle.addEventListener("click", () => {
  void toggleSetting(priceDropAlertsToggle, "priceDropAlertsEnabled");
});
monitoringToggle.addEventListener("click", () => {
  void toggleSetting(monitoringToggle, "monitoringEnabled");
});
clearProtectedPurchases.addEventListener("click", () => {
  showClearConfirmation();
});
cancelClearPurchases.addEventListener("click", () => {
  hideClearConfirmation();
  clearProtectedPurchases.focus();
});
clearConfirmation.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmClearPurchases.disabled) {
    hideClearConfirmation();
    clearProtectedPurchases.focus();
  }
});
confirmClearPurchases.addEventListener("click", () => {
  void clearAllProtectedPurchases();
});
deleteItem.addEventListener("click", () => { void deleteSelectedPurchase(); });

dashboardCta.addEventListener("click", openProtectedItems);
protectedItemsCta.addEventListener("click", openProtectedItems);

howItWorksButton.addEventListener("click", () => {
  openExtensionUrl(buildHowItWorksUrl());
});

reviewDetailsButton.addEventListener("click", () => {
  if (!capturedDraft) {
    return;
  }

  const isVisible = reviewPanel.dataset.visible === "true";
  reviewPanel.dataset.visible = String(!isVisible);
  reviewDetailsButton.setAttribute("aria-expanded", String(!isVisible));

  if (!isVisible) {
    populateReviewForm(capturedDraft);
    renderState("review", "Review the details.", "Edit anything Tracer should track more accurately.");
  } else {
    renderState("detected", "Purchase detected", "Review it once, then protect it.");
  }
});

saveReviewButton.addEventListener("click", () => {
  if (!capturedDraft) {
    return;
  }

  const reviewed = buildReviewedDraft(capturedDraft);

  if (!reviewed.ok) {
    renderState("error", "One detail needs attention.", reviewed.error);
    return;
  }

  capturedDraft = reviewed.draft;
  protectedPurchaseId = null;
  renderCapturedPurchase(capturedDraft);
  renderState("detected", "Details updated.", "Tracer will use these fields to protect the purchase.");
  reviewPanel.dataset.visible = "false";
  reviewDetailsButton.setAttribute("aria-expanded", "false");
});

protectButton.addEventListener("click", () => {
  if (protectButton.dataset.loading === "true") {
    return;
  }

  if (!capturedDraft) {
    renderState(
      "incomplete",
      "We need a little more detail.",
      "Tracer could not read enough purchase details from this page yet.",
    );
    return;
  }

  protectButton.disabled = true;
  protectButton.dataset.loading = "true";
  protectButton.textContent = "Protecting...";

  chrome.runtime.sendMessage(
    {
      type: "AFTERBUY_PROTECT_PURCHASE",
      purchaseDraft: capturedDraft,
    },
    (response?: ProtectMessageResponse) => {
      protectButton.dataset.loading = "false";

      if (response?.ok) {
        const accepted = response.response.accepted;
        const rejected = response.response.rejected;
        const protectedPurchase = accepted[0]?.purchase;
        const duplicate = accepted.some((item) => item.status === "duplicate");

        if (accepted.length === 0) {
          protectButton.disabled = false;
          protectButton.textContent = "Retry";
          renderState(
            "error",
            "Protection needs review.",
            rejected[0]?.reason ?? "Tracer could not protect this purchase yet.",
          );
          return;
        }

        protectedPurchaseId = protectedPurchase?.id ?? null;
        dashboardCache = null;
        renderProtectedPurchase({
          title: duplicate ? "Already protected" : "Purchase protected",
          newlyProtected: !duplicate,
        });
        return;
      }

      protectButton.disabled = false;
      protectButton.textContent = "Retry";
      renderState("error", "Could not protect this purchase.", response?.error ?? "Try again shortly.");
    },
  );
});

async function scanActiveTab(): Promise<void> {
  const runId = ++activeScanRunId;
  capturedDraft = null;
  protectedPurchaseId = null;
  renderState("detecting", "Looking for reliable order details...", "This usually takes a few seconds.");
  reviewPanel.dataset.visible = "false";
  scanButton.disabled = true;
  protectButton.disabled = true;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect this purchase";
  reviewDetailsButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (runId !== activeScanRunId) return;

    if (!tab?.id || !isScannableTabUrl(tab.url)) {
      renderState(
        "empty",
        "No purchase found",
        "We couldn’t find a recent purchase on this page.",
      );
      return;
    }

    const cachedResponse = await getCachedPageScan(tab.id, tab.url ?? "");
    let response = cachedResponse;

    if (!response) {
      await withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["genericCapture.js"],
        }),
        scanTimeoutMs,
        "Page scan timed out.",
      );

      if (runId !== activeScanRunId) return;
      response = await sendScanMessage(tab.id);
    }

    if (runId !== activeScanRunId) return;

    if (!response.ok || !response.draft) {
      if (
        response.failureReason === "incomplete" ||
        (!response.failureReason && isLikelyPurchasePage(tab.url))
      ) {
        renderState(
          "incomplete",
          "We need a little more detail.",
          "This looks like an order page, but Tracer could not read enough reliable details.",
        );
        return;
      }

      renderState(
        "empty",
        "No purchase found",
        "We couldn’t find a recent purchase on this page.",
      );
      return;
    }

    capturedDraft = response.draft;
    renderCapturedPurchase(response.draft, response.summary);
    renderState("detected", "Purchase detected", "Ready to protect this purchase.");

    const protectionStatus = await checkProtectionStatus(response.draft);
    if (runId !== activeScanRunId) return;
    if (protectionStatus?.protected) {
      protectedPurchaseId = protectionStatus.purchase?.id ?? null;
      const protectedOptions: Parameters<typeof renderProtectedPurchase>[0] = {
        title: "Already protected",
        newlyProtected: false,
      };

      if (protectionStatus.purchase?.pricePaidDisplay) {
        protectedOptions.pricePaidDisplay = protectionStatus.purchase.pricePaidDisplay;
      }

      renderProtectedPurchase(protectedOptions);
      return;
    }
  } catch (error) {
    if (runId !== activeScanRunId) return;
    capturedDraft = null;
    const message = error instanceof Error ? error.message : "";
    if (/error page|cannot access|receiving end does not exist|frame with id|timed out/i.test(message)) {
      renderState("empty", "No purchase found", "We couldn’t find a recent purchase on this page.");
    } else {
      renderState("error", "Scan failed.", message || "Unable to scan this page.");
    }
  } finally {
    if (runId === activeScanRunId) {
      scanButton.disabled = false;
    }
  }
}

function renderDetectedPreview(): void {
  capturedDraft = previewPurchaseDraft;
  protectedPurchaseId = null;
  reviewPanel.dataset.visible = "false";
  scanButton.disabled = false;
  protectButton.disabled = false;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect this purchase";
  reviewDetailsButton.disabled = false;
  renderCapturedPurchase(previewPurchaseDraft, {
    retailerName: previewPurchaseDraft.retailerName,
    productName: previewPurchaseDraft.lineItems[0]?.productName ?? "Detected purchase",
    itemCount: previewPurchaseDraft.lineItems.length,
    totalDisplay: formatMoney(previewPurchaseDraft.lineItems[0]?.pricePaid ?? { amountMinor: 0, currency: "GBP" }),
    confidence: previewPurchaseDraft.captureConfidence,
  });
  windowLabel.textContent = "Eligible window";
  windowValue.textContent = "24 May - 24 Nov 2025";
  windowChip.textContent = "180 days left";
  renderState("detected", "Purchase found", "We’ll keep an eye on the price and notify you if it drops.");
}

function renderCapturedPurchase(draft: PurchaseDraft, summary?: ScanResponse["summary"]): void {
  const primaryItem = draft.lineItems[0];
  const total = sumLineItemTotals(draft.lineItems);
  const itemCount = draft.lineItems.length;

  productName.textContent = primaryItem?.productName ?? summary?.productName ?? "Detected purchase";
  itemSubtitle.textContent = buildSubtitle(draft, itemCount);
  totalPaid.textContent = total ? formatMoney(total) : summary?.totalDisplay ?? "Needs review";
  retailerLabel.textContent = draft.retailerName || summary?.retailerName || "Store";
  purchaseDate.textContent = formatDisplayDate(draft.purchasedAt);
  matchStatus.textContent = buildMatchLabel(draft, primaryItem);
  matchStatus.dataset.quality = buildMatchQuality(draft, primaryItem);
  renderProductUrl(primaryItem?.productUrl);
  renderPolicyWindow(draft);

  protectButton.disabled = false;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect this purchase";
  reviewDetailsButton.disabled = false;
}

function renderProtectedPurchase(options: {
  title: "Purchase protected" | "Already protected";
  newlyProtected: boolean;
  pricePaidDisplay?: string;
}): void {
  const draft = capturedDraft;
  const primaryItem = draft?.lineItems[0];
  const total = draft ? sumLineItemTotals(draft.lineItems) : null;

  successTitle.textContent = options.title;
  successCopy.textContent =
    options.title === "Already protected"
      ? "We’re already watching this purchase for price drops."
      : "We’re now watching for price drops. We’ll let you know when it changes.";
  app.dataset.celebrate = String(options.newlyProtected);
  summaryProductName.textContent = primaryItem?.productName ?? "Protected purchase";
  summarySubtitle.textContent = draft ? buildSubtitle(draft, draft.lineItems.length) : "Monitoring active";
  summaryPaid.textContent = options.pricePaidDisplay ?? (total ? formatMoney(total) : "Protected");
  renderState(options.title === "Already protected" ? "duplicate" : "protected", options.title, successCopy.textContent);
  dashboardCta.textContent = "View your items";
  dashboardCta.focus();

  if (options.newlyProtected) {
    if (!confettiPopulated) {
      populateConfetti(confetti);
      confettiPopulated = true;
    }
    window.setTimeout(() => {
      app.dataset.celebrate = "false";
    }, 1_800);
  }
}

function renderState(state: PopupState, title: string, copy: string): void {
  currentState = state;
  app.dataset.screen = state;
  app.dataset.retryable = String(state === "error" && capturedDraft !== null);
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  stateCloseButton.textContent = state === "error" && capturedDraft ? "Retry" : "Maybe later";

  if (state !== "protected" && state !== "duplicate") {
    app.dataset.celebrate = "false";
  }
}

function renderProductUrl(value: string | undefined): void {
  if (!value) {
    productUrlRow.dataset.visible = "false";
    productUrl.removeAttribute("href");
    productUrlText.textContent = "Needs review";
    return;
  }

  productUrlRow.dataset.visible = "true";
  productUrl.href = value;
  productUrlText.textContent = compactUrl(value);
}

function getExtensionAssetUrl(path: string): string {
  return typeof chrome.runtime.getURL === "function" ? chrome.runtime.getURL(path) : path;
}

function renderPolicyWindow(draft: PurchaseDraft): void {
  const policy = defaultPolicyRegistry.findPolicyForRetailer(draft.retailerId, draft.purchasedAt);

  if (!policy) {
    windowLabel.textContent = "Monitoring active";
    windowValue.textContent = "Price tracking enabled";
    windowChip.textContent = "Active";
    return;
  }

  const windowEnd = addCalendarDays(draft.purchasedAt, policy.eligibilityWindowDays);
  const daysLeft = daysUntil(windowEnd);

  windowLabel.textContent = "Eligible window";
  windowValue.textContent = `${formatShortDate(draft.purchasedAt)} - ${formatShortDate(windowEnd)}`;
  windowChip.textContent = daysLeft > 0 ? `${daysLeft} days left` : "Ends today";
}

function populateReviewForm(draft: PurchaseDraft): void {
  const primaryItem = draft.lineItems[0];

  reviewProductName.value = primaryItem?.productName ?? "";
  reviewPrice.value = primaryItem ? formatMoney(primaryItem.pricePaid) : "";
  reviewDate.value = toDateTimeLocalValue(draft.purchasedAt);
  reviewUrl.value = primaryItem?.productUrl ?? "";
}

function buildReviewedDraft(
  draft: PurchaseDraft,
): { ok: true; draft: PurchaseDraft } | { ok: false; error: string } {
  const primaryItem = draft.lineItems[0];

  if (!primaryItem) {
    return { ok: false, error: "Tracer needs at least one product before it can protect this order." };
  }

  const productNameValue = reviewProductName.value.trim();
  const productUrlValue = reviewUrl.value.trim();
  const parsedPrice = parsePrice(reviewPrice.value, primaryItem.pricePaid.currency);
  const purchasedAtValue = fromDateTimeLocalValue(reviewDate.value);

  if (!productNameValue) {
    return { ok: false, error: "Add a product name before protecting this purchase." };
  }

  if (!parsedPrice) {
    return { ok: false, error: "Add the price paid using a supported format, such as GBP 349.99." };
  }

  if (!purchasedAtValue) {
    return { ok: false, error: "Add a valid purchase date." };
  }

  if (productUrlValue && !isHttpUrl(productUrlValue)) {
    return { ok: false, error: "Use a full product URL beginning with http or https." };
  }

  const lineItems = [...draft.lineItems];
  const reviewedItem: PurchaseLineItemDraft = {
    ...primaryItem,
    productName: productNameValue,
    pricePaid: parsedPrice,
  };

  if (productUrlValue) {
    reviewedItem.productUrl = productUrlValue;
    reviewedItem.productUrlConfidence = reviewedItem.productUrlConfidence ?? "medium";
  } else {
    delete reviewedItem.productUrl;
    delete reviewedItem.productUrlConfidence;
  }

  lineItems[0] = reviewedItem;

  return {
    ok: true,
    draft: {
      ...draft,
      purchasedAt: purchasedAtValue,
      lineItems,
    },
  };
}

function sendScanMessage(tabId: number): Promise<ScanResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: ScanResponse) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(response);
    };
    const timeoutId = window.setTimeout(() => {
      finish({ ok: false, error: "Page scan timed out." });
    }, scanTimeoutMs);

    chrome.tabs.sendMessage(tabId, { type: "AFTERBUY_SCAN_PAGE" }, (response?: ScanResponse) => {
      const lastError = chrome.runtime.lastError;

      if (lastError) {
        finish({
          ok: false,
          error: lastError.message ?? "Tracer could not talk to this page.",
        });
        return;
      }

      finish(response ?? { ok: false, error: "Tracer did not receive a scan response." });
    });
  });
}

function getCachedPageScan(tabId: number, url: string): Promise<ScanResponse | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "TRACER_GET_CACHED_PAGE_SCAN", tabId, url },
      (response?: CachedScanMessageResponse) => {
        void chrome.runtime.lastError;
        resolve(response?.ok && response.response ? response.response : null);
      },
    );
  });
}

function checkProtectionStatus(draft: PurchaseDraft): Promise<ProtectionStatusResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: ProtectionStatusResponse | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(response);
    };
    const timeoutId = window.setTimeout(() => finish(null), scanTimeoutMs);

    chrome.runtime.sendMessage(
      {
        type: "TRACER_CHECK_PURCHASE_PROTECTION",
        purchaseDraft: draft,
      },
      (response?: CheckProtectionMessageResponse) => {
        void chrome.runtime.lastError;
        finish(response?.ok ? response.response : null);
      },
    );
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function refreshOpportunityStatus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRACER_SYNC_OPPORTUNITIES" }, (response?: SyncMessageResponse) => {
      if (response?.ok) {
        menuItemsCount.textContent = `(${response.response.protectedPurchaseCount})`;
      }
      resolve();
    });
  });
}

function sumLineItemTotals(items: PurchaseLineItemDraft[]): Money | null {
  const first = items[0];

  if (!first) {
    return null;
  }

  const currency = first.pricePaid.currency;
  const amountMinor = items.reduce((total, item) => {
    if (item.pricePaid.currency !== currency) {
      return total;
    }

    return total + item.pricePaid.amountMinor * item.quantity;
  }, 0);

  return { amountMinor, currency };
}

function buildSubtitle(draft: PurchaseDraft, itemCount: number): string {
  if (itemCount > 1) {
    return `${itemCount} items from ${draft.retailerName}`;
  }

  const primaryItem = draft.lineItems[0];

  if (primaryItem?.productName.toLowerCase().includes("sony wh-1000xm5")) {
    return "Wireless Noise Cancelling Headphones";
  }

  return "Ready to protect";
}

function buildMatchLabel(draft: PurchaseDraft, item: PurchaseLineItemDraft | undefined): string {
  const quality = buildMatchQuality(draft, item);

  if (quality === "exact") {
    return "Exact match";
  }

  if (quality === "review") {
    return "Needs review";
  }

  return "Product identified";
}

function buildMatchQuality(
  draft: PurchaseDraft,
  item: PurchaseLineItemDraft | undefined,
): "exact" | "identified" | "review" {
  if (
    draft.captureConfidence === "high" &&
    (item?.productUrlConfidence === "high" || Boolean(item?.externalProductId) || Boolean(item?.sku))
  ) {
    return "exact";
  }

  if (item?.productUrl && draft.captureConfidence !== "low") {
    return "identified";
  }

  return "review";
}

function buildDashboardUrl(): string {
  const base = dashboardBaseUrl.replace(/\/$/, "");

  if (protectedPurchaseId) {
    return `${base}/dashboard?purchase=${encodeURIComponent(protectedPurchaseId)}`;
  }

  return `${base}/dashboard`;
}

function buildHowItWorksUrl(): string {
  return `${dashboardBaseUrl.replace(/\/$/, "")}/#demo`;
}

function openExtensionUrl(url: string): void {
  void chrome.tabs.create({ url });
}

function openProtectedItems(): void {
  popupMenu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");

  activeScanRunId += 1;

  if (currentState !== "items" && currentState !== "detail") {
    itemsReturnState = currentState;
  }

  void showProtectedItems();
}

function openSettings(): void {
  popupMenu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
  settingsToggle.setAttribute("aria-expanded", "true");
  activeScanRunId += 1;

  if (currentState !== "settings") {
    settingsReturnState = currentState;
  }

  renderState("settings", "Settings", "");
}

function closeSettings(): void {
  popupMenu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
  settingsToggle.setAttribute("aria-expanded", "false");
  hideClearConfirmation();
  const returnState = settingsReturnState;
  renderState(returnState, "", "");

  if (returnState === "detecting") {
    void scanActiveTab();
  }
}

function setSwitchValue(toggle: HTMLButtonElement, enabled: boolean): void {
  toggle.setAttribute("aria-checked", String(enabled));
}

async function toggleSetting(
  toggle: HTMLButtonElement,
  key: "priceDropAlertsEnabled" | "monitoringEnabled",
): Promise<void> {
  const previous = toggle.getAttribute("aria-checked") === "true";
  const next = !previous;
  setSwitchValue(toggle, next);

  try {
    if (key === "monitoringEnabled") {
      await persistMonitoringSetting(next);
    }
    await chrome.storage.sync.set({ [key]: next });
  } catch {
    setSwitchValue(toggle, previous);
  }
}

async function persistMonitoringSetting(enabled: boolean): Promise<void> {
  const userId = await getTracerUserId();
  const response = await withTimeout(
    fetch(`${apiBaseUrl}/api/settings/monitoring`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-afterbuy-user-id": userId,
      },
      body: JSON.stringify({ enabled }),
    }),
    5_000,
    "Settings request timed out.",
  );
  if (!response.ok) {
    throw new Error(`Settings request returned ${response.status}`);
  }
  dashboardCache = null;
}

function showClearConfirmation(): void {
  clearConfirmationMessage.textContent = "This can’t be undone.";
  clearConfirmationMessage.dataset.error = "false";
  clearPurchasesPill.dataset.confirming = "true";
  clearProtectedPurchases.setAttribute("aria-expanded", "true");
  clearProtectedPurchases.inert = true;
  clearConfirmation.inert = false;
  confirmClearPurchases.focus();
}

function hideClearConfirmation(): void {
  clearPurchasesPill.dataset.confirming = "false";
  clearProtectedPurchases.setAttribute("aria-expanded", "false");
  clearProtectedPurchases.inert = false;
  clearConfirmation.inert = true;
  confirmClearPurchases.disabled = false;
  clearProtectedPurchases.disabled = false;
  clearConfirmationMessage.dataset.error = "false";
}

async function clearAllProtectedPurchases(): Promise<void> {
  if (clearProtectedPurchases.disabled || confirmClearPurchases.disabled) {
    return;
  }

  clearProtectedPurchases.disabled = true;
  confirmClearPurchases.disabled = true;
  cancelClearPurchases.disabled = true;
  clearProtectedPurchases.setAttribute("aria-busy", "true");

  try {
    await preferencesReady;
    const userId = await getTracerUserId();
    let data = dashboardCache;

    if (!data) {
      const response = await withTimeout(
        fetch(`${apiBaseUrl}/api/dashboard`, {
          headers: { "x-afterbuy-user-id": userId },
        }),
        5_000,
        "Items request timed out.",
      );
      if (!response.ok) {
        throw new Error(`Items request returned ${response.status}`);
      }
      const raw = await response.json() as Partial<DashboardData>;
      data = {
        purchases: raw.purchases ?? [],
        opportunities: raw.opportunities ?? [],
      };
    }

    for (const purchase of data.purchases) {
      const response = await withTimeout(
        fetch(`${apiBaseUrl}/api/purchases/${encodeURIComponent(purchase.id)}`, {
          method: "DELETE",
          headers: { "x-afterbuy-user-id": userId },
        }),
        5_000,
        "Delete request timed out.",
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Delete request returned ${response.status}`);
      }
    }

    dashboardCache = { purchases: [], opportunities: [] };
    menuItemsCount.textContent = "(0)";
    itemsCount.textContent = "0 items";
    renderItemsMessage("No protected purchases", "Items you protect will appear here.");
    protectedPurchaseId = null;
    selectedPurchaseId = null;
    if (settingsReturnState === "protected" || settingsReturnState === "duplicate") {
      settingsReturnState = capturedDraft ? "detected" : "empty";
    } else if (settingsReturnState === "detail") {
      settingsReturnState = "items";
    }
    hideClearConfirmation();
  } catch (error) {
    console.error("Tracer could not clear protected purchases", error);
    clearConfirmationMessage.textContent = "Couldn’t clear the purchases. Try again.";
    clearConfirmationMessage.dataset.error = "true";
    confirmClearPurchases.disabled = false;
  } finally {
    clearProtectedPurchases.disabled = false;
    confirmClearPurchases.disabled = false;
    cancelClearPurchases.disabled = false;
    clearProtectedPurchases.setAttribute("aria-busy", "false");
  }
}

function navigateBack(): void {
  popupMenu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");

  if (currentState === "detail") {
    void showProtectedItems();
    return;
  }

  if (currentState === "settings") {
    closeSettings();
    return;
  }

  if (currentState === "items") {
    itemsLoadRunId += 1;
    selectedPurchaseId = null;
    const returnState = itemsReturnState;
    renderState(returnState, "", "");
    if (returnState === "detecting") {
      void scanActiveTab();
    }
  }
}

async function showProtectedItems(options: { force?: boolean } = {}): Promise<void> {
  const loadRunId = ++itemsLoadRunId;
  selectedPurchaseId = null;
  renderState("items", "Protected purchases", "");
  if (dashboardCache && !options.force) {
    renderProtectedItems(dashboardCache, loadRunId);
    return;
  }

  itemsList.replaceChildren();
  try {
    await preferencesReady;
    const userId = await getTracerUserId();
    const response = await withTimeout(
      fetch(`${apiBaseUrl}/api/dashboard`, { headers: { "x-afterbuy-user-id": userId } }),
      5_000,
      "Items request timed out.",
    );
    if (!response.ok) {
      throw new Error(`Items request returned ${response.status}`);
    }
    const raw = await response.json() as Partial<DashboardData>;
    if (loadRunId !== itemsLoadRunId || currentState !== "items") {
      return;
    }
    dashboardCache = {
      purchases: raw.purchases ?? [],
      opportunities: raw.opportunities ?? [],
    };
    renderProtectedItems(dashboardCache, loadRunId);
  } catch {
    if (loadRunId !== itemsLoadRunId || currentState !== "items") {
      return;
    }
    itemsCount.textContent = "—";
    renderItemsMessage("Couldn’t load your items", "Check the local service and try again.", true);
  }
}

function renderProtectedItems(data: DashboardData, loadRunId: number): void {
  if (loadRunId !== itemsLoadRunId || currentState !== "items") {
    return;
  }

  const { purchases, opportunities } = data;
  itemsCount.textContent = `${purchases.length} item${purchases.length === 1 ? "" : "s"}`;
  menuItemsCount.textContent = `(${purchases.length})`;

  if (purchases.length === 0) {
    renderItemsMessage("No protected purchases", "Items you protect will appear here.");
    return;
  }

  const inactiveStatuses = new Set(["dismissed", "expired", "resolved"]);
  const opportunitiesByPurchase = new Map(
    opportunities
      .filter((opportunity) => !inactiveStatuses.has(opportunity.status))
      .map((opportunity) => [opportunity.purchaseId, opportunity]),
  );
  const rows = document.createDocumentFragment();

  purchases.forEach((purchase) => {
    const opportunity = opportunitiesByPurchase.get(purchase.id);
    const priceDropped = purchase.monitoringStatus === "price_dropped";
    const savingDisplay = purchase.savingDisplay ?? opportunity?.potentialSavingDisplay ?? "";
    const row = document.createElement("button");
    row.className = "item-row";
    row.dataset.alert = String(priceDropped);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = purchase.productName;
    const status = document.createElement("span");
    status.textContent = monitoringStatusLabel(purchase.monitoringStatus);
    copy.append(name, status);
    const saving = document.createElement("em");
    saving.textContent = priceDropped ? savingDisplay : "";
    const chevron = document.createElement("i");
    chevron.textContent = "›";
    row.append(copy, saving, chevron);
    row.addEventListener("click", () => showItemDetail(purchase, opportunity));
    rows.append(row);
  });

  itemsList.replaceChildren(rows);
}

function renderItemsMessage(title: string, copy: string, retry = false): void {
  const message = document.createElement("div");
  message.className = "items-message";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("span");
  description.textContent = copy;
  message.append(heading, description);

  if (retry) {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Try again";
    retryButton.addEventListener("click", () => { void showProtectedItems({ force: true }); });
    message.append(retryButton);
  }

  itemsList.replaceChildren(message);
}

function showItemDetail(purchase: DashboardPurchase, opportunity?: DashboardOpportunity): void {
  selectedPurchaseId = purchase.id;
  renderState("detail", purchase.productName, "");
  detailName.textContent = purchase.productName;
  const priceDropped = purchase.monitoringStatus === "price_dropped";
  const savingDisplay = purchase.savingDisplay ?? opportunity?.potentialSavingDisplay ?? "";
  detailStatus.dataset.alert = String(priceDropped);
  detailStatus.dataset.error = String(purchase.monitoringStatus === "unable_to_check");
  detailStatus.textContent = priceDropped
    ? `● Price dropped by ${savingDisplay}`
    : monitoringStatusLabel(purchase.monitoringStatus);
  deleteItem.disabled = false;
  itemFacts.replaceChildren();
  const facts: Array<[string, string]> = [["Paid", formatMoney(purchase.pricePaid)], ["Current price", purchase.currentPriceDisplay ?? "Watching"]];
  if (priceDropped && savingDisplay) facts.push(["Saving", savingDisplay]);
  facts.forEach(([label, value]) => { const row = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; row.append(dt, dd); itemFacts.append(row); });
}

function monitoringStatusLabel(status: DashboardPurchase["monitoringStatus"]): string {
  switch (status) {
    case "price_dropped":
      return "● Price dropped";
    case "monitoring_paused":
      return "● Monitoring paused";
    case "unable_to_check":
    case "unavailable":
      return "● Unable to check";
    default:
      return "● Watching";
  }
}

async function deleteSelectedPurchase(): Promise<void> {
  if (!selectedPurchaseId || deleteItem.disabled) {
    return;
  }

  const purchaseId = selectedPurchaseId;
  deleteItem.disabled = true;
  deleteItem.dataset.loading = "true";
  deleteItem.setAttribute("aria-busy", "true");

  try {
    await preferencesReady;
    const userId = await getTracerUserId();
    const response = await withTimeout(
      fetch(`${apiBaseUrl}/api/purchases/${encodeURIComponent(purchaseId)}`, {
        method: "DELETE",
        headers: { "x-afterbuy-user-id": userId },
      }),
      5_000,
      "Delete request timed out.",
    );

    if (!response.ok && response.status !== 404) {
      throw new Error("delete_failed");
    }

    if (protectedPurchaseId === purchaseId) {
      protectedPurchaseId = null;
      if (itemsReturnState === "protected" || itemsReturnState === "duplicate") {
        itemsReturnState = capturedDraft ? "detected" : "empty";
      }
    }

    selectedPurchaseId = null;
    if (dashboardCache) {
      dashboardCache = {
        purchases: dashboardCache.purchases.filter((purchase) => purchase.id !== purchaseId),
        opportunities: dashboardCache.opportunities.filter(
          (opportunity) => opportunity.purchaseId !== purchaseId,
        ),
      };
    }
    await showProtectedItems();
  } catch {
    detailStatus.dataset.alert = "false";
    detailStatus.dataset.error = "true";
    detailStatus.textContent = "Couldn’t remove this item. Try again.";
    deleteItem.disabled = false;
  } finally {
    deleteItem.dataset.loading = "false";
    deleteItem.setAttribute("aria-busy", "false");
  }
}

function getTracerUserId(): Promise<string> {
  tracerUserIdPromise ??= chrome.storage.local.get("tracerUserId").then(async (stored) => {
    const configured = typeof stored.tracerUserId === "string" ? stored.tracerUserId : "";
    if (configured) return configured;
    await chrome.storage.local.set({ tracerUserId: defaultUserId });
    return defaultUserId;
  });
  return tracerUserIdPromise;
}

function daysUntil(dateOnly: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(`${dateOnly}T00:00:00.000Z`).getTime();

  if (Number.isNaN(target)) {
    return 0;
  }

  return Math.max(0, Math.ceil((target - todayUtc) / 86_400_000));
}

function formatDisplayDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Needs review";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return `${host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function isScannableTabUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return (
    value.startsWith("https://") ||
    value.startsWith("http://localhost:") ||
    value.startsWith("http://127.0.0.1:")
  );
}

function isLikelyPurchasePage(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const nonRetailHosts = [
      "behance.net",
      "canva.com",
      "dribbble.com",
      "figma.com",
      "google.com",
      "imgur.com",
      "instagram.com",
      "pexels.com",
      "pinterest.com",
      "reddit.com",
      "shutterstock.com",
      "unsplash.com",
      "vecteezy.com",
      "vectorstock.com",
    ];
    if (nonRetailHosts.some((contentHost) => host === contentHost || host.endsWith(`.${contentHost}`))) {
      return false;
    }
    if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
      return false;
    }
    const pageSignal = `${url.hostname} ${url.pathname} ${url.search}`.toLowerCase();

    return /checkout|order|confirmation|receipt|thank|complete|success|purchase/.test(pageSignal);
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing popup element: ${id}`);
  }

  return element as T;
}
