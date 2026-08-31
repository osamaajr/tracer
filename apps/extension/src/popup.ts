import {
  addCalendarDays,
  defaultPolicyRegistry,
  formatMoney,
  parsePrice,
  type Money,
  type PurchaseDraft,
  type PurchaseLineItemDraft,
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

type SyncMessageResponse =
  | {
      ok: true;
      response: {
        protectedPurchaseCount: number;
        openOpportunityCount: number;
      };
    }
  | { ok: false; error?: string };

type PopupState = "detecting" | "detected" | "protected" | "duplicate" | "empty" | "review" | "error";

const defaultApiBaseUrl = "http://127.0.0.1:4000";
const defaultDashboardBaseUrl = "http://127.0.0.1:5173";

const apiInput = getElement<HTMLInputElement>("apiBaseUrl");
const saveButton = getElement<HTMLButtonElement>("save");
const scanButton = getElement<HTMLButtonElement>("scan");
const protectButton = getElement<HTMLButtonElement>("protect");
const reviewDetailsButton = getElement<HTMLButtonElement>("reviewDetails");
const maybeLaterButton = getElement<HTMLButtonElement>("maybeLater");
const settingsToggle = getElement<HTMLButtonElement>("settingsToggle");
const settingsPanel = getElement<HTMLElement>("settingsPanel");
const statePanel = getElement<HTMLElement>("statePanel");
const stateTitle = getElement<HTMLElement>("stateTitle");
const stateCopy = getElement<HTMLElement>("stateCopy");
const purchasePanel = getElement<HTMLElement>("purchase");
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
const productImageFrame = getElement<HTMLElement>("productImageFrame");
const productImage = getElement<HTMLImageElement>("productImage");
const reviewProductName = getElement<HTMLInputElement>("reviewProductName");
const reviewPrice = getElement<HTMLInputElement>("reviewPrice");
const reviewDate = getElement<HTMLInputElement>("reviewDate");
const reviewUrl = getElement<HTMLInputElement>("reviewUrl");
const saveReviewButton = getElement<HTMLButtonElement>("saveReview");

let capturedDraft: PurchaseDraft | null = null;
let currentState: PopupState = "detecting";

void chrome.storage.sync.get("apiBaseUrl").then((stored) => {
  apiInput.value = typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl : defaultApiBaseUrl;
});

void chrome.storage.sync.get("dashboardBaseUrl").then((stored) => {
  const baseUrl =
    typeof stored.dashboardBaseUrl === "string"
      ? stored.dashboardBaseUrl
      : defaultDashboardBaseUrl;
  dashboardLink.href = `${baseUrl.replace(/\/$/, "")}/dashboard`;
});

void refreshOpportunityStatus();
void scanActiveTab();

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
    renderState("detected", "Settings saved.", "Tracer will use this API URL for local testing.");
    if (capturedDraft) {
      purchasePanel.dataset.visible = "true";
    }
  });
});

scanButton.addEventListener("click", () => {
  void scanActiveTab();
});

maybeLaterButton.addEventListener("click", () => {
  window.close();
});

settingsToggle.addEventListener("click", () => {
  const isVisible = settingsPanel.dataset.visible === "true";
  settingsPanel.dataset.visible = String(!isVisible);
  settingsToggle.setAttribute("aria-expanded", String(!isVisible));
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
    renderState("detected", "Purchase found.", "Review it once, then protect it.");
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
  renderCapturedPurchase(capturedDraft);
  renderState("detected", "Details updated.", "Tracer will use these fields to protect the purchase.");
  reviewPanel.dataset.visible = "false";
  reviewDetailsButton.setAttribute("aria-expanded", "false");
});

protectButton.addEventListener("click", () => {
  if (!capturedDraft) {
    renderState(
      "empty",
      "No purchase detected.",
      "Open an order confirmation page and Tracer will look for the details.",
    );
    return;
  }

  protectButton.disabled = true;
  protectButton.dataset.loading = "true";
  protectButton.textContent = "Protecting...";
  renderState("detected", "Saving protection.", "Tracer is sending the captured purchase fields.");

  chrome.runtime.sendMessage(
    {
      type: "AFTERBUY_PROTECT_PURCHASE",
      purchaseDraft: capturedDraft,
    },
    (response?: ProtectMessageResponse) => {
      protectButton.dataset.loading = "false";

      if (response?.ok) {
        const accepted = response.response.accepted.length;
        const rejected = response.response.rejected.length;
        const duplicate = response.response.accepted.some((item) => item.status === "duplicate");

        if (accepted === 0 && rejected > 0) {
          protectButton.disabled = false;
          protectButton.textContent = "Try again";
          renderState(
            "error",
            "Protection needs review.",
            response.response.rejected[0]?.reason ?? "Tracer could not protect this purchase yet.",
          );
          return;
        }

        protectButton.textContent = duplicate ? "Already protected" : "Purchase protected";
        reviewDetailsButton.disabled = true;
        renderState(
          duplicate ? "duplicate" : "protected",
          duplicate ? "Already protected." : "Purchase protected.",
          duplicate
            ? "Tracer already has this purchase in your dashboard."
            : "Tracer will watch this purchase and alert you when action is worth taking.",
        );
        void refreshOpportunityStatus();
        return;
      }

      protectButton.disabled = false;
      protectButton.textContent = "Try again";
      renderState("error", "Could not protect this purchase.", response?.error ?? "Try again shortly.");
    },
  );
});

async function scanActiveTab(): Promise<void> {
  capturedDraft = null;
  renderState("detecting", "Checking this purchase...", "Tracer is looking for reliable order details on this tab.");
  purchasePanel.dataset.visible = "false";
  reviewPanel.dataset.visible = "false";
  scanButton.disabled = true;
  protectButton.disabled = true;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect purchase";
  reviewDetailsButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !isScannableTabUrl(tab.url)) {
      renderState(
        "empty",
        "No purchase detected.",
        "Open a store order confirmation page and Tracer will check it automatically.",
      );
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["genericCapture.js"],
    });

    const response = await sendScanMessage(tab.id);

    if (!response.ok || !response.draft) {
      renderState(
        "empty",
        "No purchase detected.",
        response.error ?? "Tracer could not find enough order details on this page.",
      );
      return;
    }

    capturedDraft = response.draft;
    renderCapturedPurchase(response.draft, response.summary);
    renderState("detected", "Purchase found.", "Review it once, then protect it.");
  } catch (error) {
    capturedDraft = null;
    purchasePanel.dataset.visible = "false";
    renderState("error", "Scan failed.", error instanceof Error ? error.message : "Unable to scan this page.");
  } finally {
    scanButton.disabled = false;
  }
}

function renderCapturedPurchase(draft: PurchaseDraft, summary?: ScanResponse["summary"]): void {
  const primaryItem = draft.lineItems[0];
  const total = sumLineItemTotals(draft.lineItems);
  const itemCount = draft.lineItems.length;

  purchasePanel.dataset.visible = "true";
  productName.textContent = primaryItem?.productName ?? summary?.productName ?? "Detected purchase";
  itemSubtitle.textContent = buildSubtitle(draft, itemCount, total);
  totalPaid.textContent = total ? formatMoney(total) : summary?.totalDisplay ?? "Needs review";
  retailerLabel.textContent = draft.retailerName || summary?.retailerName || "Store";
  purchaseDate.textContent = formatDisplayDate(draft.purchasedAt);
  matchStatus.textContent = buildMatchLabel(draft, primaryItem);
  matchStatus.dataset.quality = buildMatchQuality(draft, primaryItem);
  renderProductUrl(primaryItem?.productUrl);
  renderPolicyWindow(draft);
  renderProductImage(primaryItem);

  protectButton.disabled = false;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect purchase";
  reviewDetailsButton.disabled = false;
}

function renderState(state: PopupState, title: string, copy: string): void {
  currentState = state;
  statePanel.dataset.state = state;
  statePanel.dataset.visible = String(["detecting", "empty", "review", "error"].includes(state));
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
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

function renderProductImage(item: PurchaseLineItemDraft | undefined): void {
  if (!item?.imageUrl) {
    productImageFrame.dataset.hasImage = "false";
    productImage.removeAttribute("src");
    productImage.alt = "";
    return;
  }

  productImageFrame.dataset.hasImage = "true";
  productImage.src = item.imageUrl;
  productImage.alt = item.productName;
}

function renderPolicyWindow(draft: PurchaseDraft): void {
  const policy = defaultPolicyRegistry.findPolicyForRetailer(draft.retailerId, draft.purchasedAt);

  if (!policy) {
    windowLabel.textContent = "Monitoring";
    windowValue.textContent = "Price tracking";
    return;
  }

  windowLabel.textContent = "Protection window";
  windowValue.textContent = `${formatShortDate(draft.purchasedAt)} - ${formatShortDate(
    addCalendarDays(draft.purchasedAt, policy.eligibilityWindowDays),
  )}`;
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

function refreshOpportunityStatus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRACER_SYNC_OPPORTUNITIES" }, (response?: SyncMessageResponse) => {
      if (
        response?.ok &&
        response.response.openOpportunityCount > 0 &&
        !capturedDraft &&
        currentState !== "detecting"
      ) {
        renderState(
          "empty",
          "Opportunity waiting.",
          `${response.response.openOpportunityCount} pay back opportunity${
            response.response.openOpportunityCount === 1 ? "" : "ies"
          } waiting in your dashboard.`,
        );
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

function buildSubtitle(draft: PurchaseDraft, itemCount: number, total: Money | null): string {
  const count = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const host = draft.storeHost || draft.retailerName;

  if (itemCount > 1 && total) {
    return `${count} from ${host}`;
  }

  return host;
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
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function isScannableTabUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value.startsWith("https://") || value.startsWith("http://localhost:");
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
