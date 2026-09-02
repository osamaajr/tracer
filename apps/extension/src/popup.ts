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
  | "error";

const defaultApiBaseUrl = "http://127.0.0.1:4000";
const defaultDashboardBaseUrl = "http://127.0.0.1:5173";
const startWithDetectedPreview = import.meta.env.MODE !== "test";

const app = getElement<HTMLElement>("app");
const apiInput = getElement<HTMLInputElement>("apiBaseUrl");
const saveButton = getElement<HTMLButtonElement>("save");
const scanButton = getElement<HTMLButtonElement>("scan");
const protectButton = getElement<HTMLButtonElement>("protect");
const reviewDetailsButton = getElement<HTMLButtonElement>("reviewDetails");
const maybeLaterButton = getElement<HTMLButtonElement>("maybeLater");
const stateCloseButton = getElement<HTMLButtonElement>("stateClose");
const settingsToggle = getElement<HTMLButtonElement>("settingsToggle");
const settingsPanel = getElement<HTMLElement>("settingsPanel");
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
const productImageFrame = getElement<HTMLElement>("productImageFrame");
const productImage = getElement<HTMLImageElement>("productImage");
const summaryProductName = getElement<HTMLElement>("summaryProductName");
const summarySubtitle = getElement<HTMLElement>("summarySubtitle");
const summaryPaid = getElement<HTMLElement>("summaryPaid");
const summaryImageFrame = getElement<HTMLElement>("summaryImageFrame");
const summaryImage = getElement<HTMLImageElement>("summaryImage");
const successTitle = getElement<HTMLElement>("successTitle");
const successCopy = getElement<HTMLElement>("successCopy");
const dashboardCta = getElement<HTMLButtonElement>("dashboardCta");
const protectedItemsCta = getElement<HTMLButtonElement>("protectedItemsCta");
const howItWorksButton = getElement<HTMLButtonElement>("howItWorks");
const doneButton = getElement<HTMLButtonElement>("done");
const reviewProductName = getElement<HTMLInputElement>("reviewProductName");
const reviewPrice = getElement<HTMLInputElement>("reviewPrice");
const reviewDate = getElement<HTMLInputElement>("reviewDate");
const reviewUrl = getElement<HTMLInputElement>("reviewUrl");
const saveReviewButton = getElement<HTMLButtonElement>("saveReview");

let capturedDraft: PurchaseDraft | null = null;
let currentState: PopupState = "detecting";
let dashboardBaseUrl = defaultDashboardBaseUrl;
let protectedPurchaseId: string | null = null;

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

productImage.addEventListener("error", () => {
  productImageFrame.dataset.hasImage = "false";
});
summaryImage.addEventListener("error", () => {
  summaryImageFrame.dataset.hasImage = "false";
});

void chrome.storage.sync.get("apiBaseUrl").then((stored) => {
  apiInput.value = typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl : defaultApiBaseUrl;
});

void chrome.storage.sync.get("dashboardBaseUrl").then((stored) => {
  dashboardBaseUrl =
    typeof stored.dashboardBaseUrl === "string"
      ? stored.dashboardBaseUrl
      : defaultDashboardBaseUrl;
  dashboardLink.href = buildDashboardUrl();
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
  window.close();
});
doneButton.addEventListener("click", () => {
  openExtensionUrl(buildDashboardUrl());
});

settingsToggle.addEventListener("click", () => {
  const isVisible = settingsPanel.dataset.visible === "true";
  settingsPanel.dataset.visible = String(!isVisible);
  settingsToggle.setAttribute("aria-expanded", String(!isVisible));
});

dashboardCta.addEventListener("click", () => {
  openExtensionUrl(buildDashboardUrl());
});

protectedItemsCta.addEventListener("click", () => {
  openExtensionUrl(buildDashboardUrl());
});

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

        if (accepted.length === 0 && rejected.length > 0) {
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
  capturedDraft = null;
  protectedPurchaseId = null;
  renderState("detecting", "Checking this purchase...", "Tracer is looking for reliable order details on this tab.");
  reviewPanel.dataset.visible = "false";
  scanButton.disabled = true;
  protectButton.disabled = true;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect this purchase";
  reviewDetailsButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !isScannableTabUrl(tab.url)) {
      renderState(
        "empty",
        "Nothing to protect here.",
        "Tracer works on checkout and order confirmation pages.",
      );
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["genericCapture.js"],
    });

    const response = await sendScanMessage(tab.id);

    if (!response.ok || !response.draft) {
      if (isLikelyPurchasePage(tab.url)) {
        renderState(
          "incomplete",
          "We need a little more detail.",
          response.error ??
            "This looks like a checkout or order page, but Tracer could not read enough purchase details yet.",
        );
        return;
      }

      renderState(
        "empty",
        "Nothing to protect here.",
        "Tracer works on checkout and order confirmation pages.",
      );
      return;
    }

    capturedDraft = response.draft;
    renderCapturedPurchase(response.draft, response.summary);

    const protectionStatus = await checkProtectionStatus(response.draft);
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

    renderState("detected", "Purchase detected", "Ready to protect this purchase.");
  } catch (error) {
    capturedDraft = null;
    renderState("error", "Scan failed.", error instanceof Error ? error.message : "Unable to scan this page.");
  } finally {
    scanButton.disabled = false;
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
  renderState("detected", "Purchase detected", "Ready to protect this purchase.");
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
  renderProductImage(primaryItem, productImage, productImageFrame);

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
      ? "We're already watching this purchase for price drops and relevant opportunities."
      : "We're now watching this purchase for price drops and relevant opportunities.";
  app.dataset.celebrate = String(options.newlyProtected);
  summaryProductName.textContent = primaryItem?.productName ?? "Protected purchase";
  summarySubtitle.textContent = draft ? buildSubtitle(draft, draft.lineItems.length) : "Monitoring active";
  summaryPaid.textContent = options.pricePaidDisplay ?? (total ? formatMoney(total) : "Protected");
  renderProductImage(primaryItem, summaryImage, summaryImageFrame);
  renderState(options.title === "Already protected" ? "duplicate" : "protected", options.title, successCopy.textContent);
  dashboardCta.focus();

  if (options.newlyProtected) {
    window.setTimeout(() => {
      app.dataset.celebrate = "false";
    }, 1_800);
  }
}

function renderState(state: PopupState, title: string, copy: string): void {
  currentState = state;
  app.dataset.screen = state;
  stateTitle.textContent = title;
  stateCopy.textContent = copy;

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

function renderProductImage(
  item: PurchaseLineItemDraft | undefined,
  image: HTMLImageElement,
  frame: HTMLElement,
): void {
  if (!item?.imageUrl) {
    frame.dataset.hasImage = "false";
    image.removeAttribute("src");
    image.alt = "";
    return;
  }

  frame.dataset.hasImage = "true";
  image.src = item.imageUrl;
  image.alt = item.productName;
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
    chrome.tabs.sendMessage(tabId, { type: "AFTERBUY_SCAN_PAGE" }, (response?: ScanResponse) => {
      const lastError = chrome.runtime.lastError;

      if (lastError) {
        resolve({
          ok: false,
          error: lastError.message ?? "Tracer could not talk to this page.",
        });
        return;
      }

      resolve(response ?? { ok: false, error: "Tracer did not receive a scan response." });
    });
  });
}

function checkProtectionStatus(draft: PurchaseDraft): Promise<ProtectionStatusResponse | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "TRACER_CHECK_PURCHASE_PROTECTION",
        purchaseDraft: draft,
      },
      (response?: CheckProtectionMessageResponse) => {
        resolve(response?.ok ? response.response : null);
      },
    );
  });
}

function refreshOpportunityStatus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRACER_SYNC_OPPORTUNITIES" }, (response?: SyncMessageResponse) => {
      void response;
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
