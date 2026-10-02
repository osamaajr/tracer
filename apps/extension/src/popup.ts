import { normalizeSavedUrl, productImageIdentity, type SavedProduct, type SavedItem } from "@tracer/core";
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
} from "@tracer/core";
import {
  getPendingPurchases,
  queuePendingPurchase,
  samePurchaseDraft,
  setPendingPurchases,
  type PendingProtectedPurchase,
} from "./pendingPurchases";
import { defaultApiBaseUrl, defaultDashboardBaseUrl, defaultUserId } from "./config";

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
    pendingSync?: boolean;
  }>;
  rejected: Array<{
    productName: string;
    reason: string;
  }>;
  pendingSync?: boolean;
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
  pendingSync?: boolean;
  purchase: (Pick<PurchaseRecord, "id" | "pricePaid" | "productName"> & {
    pricePaidDisplay?: string;
  }) | null;
}

interface DashboardPurchase extends PurchaseRecord {
  imageUrl?: string | null;
  currentPriceDisplay?: string | null;
  lastCheckedAt?: string | null;
  monitoringStatus?: "watching" | "price_dropped" | "monitoring_paused" | "unable_to_check" | "unavailable";
  savingDisplay?: string | null;
  savingPercentageBps?: number | null;
  priceDropDetectedAt?: string | null;
  pendingSync?: boolean;
  pendingDraftId?: string;
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
  | "watchlist"
  | "detecting"
  | "detected"
  | "protected"
  | "duplicate"
  | "empty"
  | "incomplete"
  | "review"
  | "items"
  | "detail"
  | "settings";

const popupModuleStartedAt = performance.now();
const startupTraceEnabled = import.meta.env.MODE !== "production" || import.meta.env.VITE_TRACER_STARTUP_TRACE === true;
const startupStages: Array<{ name: string; start: number; end: number }> = [];
let startupUsableLogged = false;
function traceStartupStage(name: string, start: number, end = performance.now()): void {
  if (!startupTraceEnabled) return;
  startupStages.push({ name, start, end });
  console.debug(`[Tracer startup] ${name}: ${(end - start).toFixed(1)}ms (+${(end - popupModuleStartedAt).toFixed(1)}ms)`);
}
traceStartupStage("popup module loaded", popupModuleStartedAt, popupModuleStartedAt);
function markPopupUsable(state: PopupState): void {
  if (!startupTraceEnabled || startupUsableLogged || state === "detecting") return;
  startupUsableLogged = true;
  const at = performance.now();
  traceStartupStage("popup usable", popupModuleStartedAt, at);
  console.groupCollapsed("[Tracer startup] trace");
  console.table(startupStages.map(({ name, start, end }) => ({
    stage: name,
    durationMs: Number((end - start).toFixed(1)),
    elapsedMs: Number((end - popupModuleStartedAt).toFixed(1)),
  })));
  console.groupEnd();
}

if (startupTraceEnabled && typeof requestAnimationFrame === "function") {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    traceStartupStage("first visible shell", popupModuleStartedAt);
  }));
}

const scanTimeoutMs = 1_000;
// Page capture runs inside another tab and can be delayed by cold script
// injection, consent overlays, or a storefront that is still hydrating.
const pageCaptureTimeoutMs = 4_000;
const pageDetectionRetryDelaysMs = [300, 800];
const cacheLookupTimeoutMs = 200;
const startWithDetectedPreview = import.meta.env.MODE === "preview";

const app = getElement<HTMLElement>("app");
const confetti = getElement<HTMLElement>("confetti");
const watchlistConfetti = getElement<HTMLElement>("watchlistConfetti");
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
const detailImageWrap = getElement<HTMLElement>("detailImageWrap");
const detailImage = getElement<HTMLImageElement>("detailImage");
const detailRetailerText = getElement<HTMLElement>("detailRetailerText");
const detailStatus = getElement<HTMLElement>("detailStatus");
const deleteItem = getElement<HTMLButtonElement>("deleteItem");
const detailPriceCard = getElement<HTMLElement>("detailPriceCard");
const detailPaid = getElement<HTMLElement>("detailPaid");
const detailPaidDate = getElement<HTMLElement>("detailPaidDate");
const detailCurrentPrice = getElement<HTMLElement>("detailCurrentPrice");
const detailPriceNote = getElement<HTMLElement>("detailPriceNote");
const detailAlertsSwitch = getElement<HTMLButtonElement>("detailAlertsSwitch");
const detailProductAction = getElement<HTMLAnchorElement>("detailProductAction");
const detailProductCopy = getElement<HTMLElement>("detailProductCopy");
const detailMonitoringInsight = getElement<HTMLElement>("detailMonitoringInsight");
const detailMonitoringState = getElement<HTMLElement>("detailMonitoringState");
const priceDropAlertsToggle = getElement<HTMLButtonElement>("priceDropAlertsToggle");
const monitoringToggle = getElement<HTMLButtonElement>("monitoringToggle");
const clearProtectedPurchases = getElement<HTMLButtonElement>("clearProtectedPurchases");
const clearPurchasesPill = getElement<HTMLElement>("clearPurchasesPill");
const clearConfirmation = getElement<HTMLElement>("clearConfirmation");
const clearConfirmationMessage = getElement<HTMLElement>("clearConfirmationMessage");
const cancelClearPurchases = getElement<HTMLButtonElement>("cancelClearPurchases");
const confirmClearPurchases = getElement<HTMLButtonElement>("confirmClearPurchases");
const clearSavedItems = getElement<HTMLButtonElement>("clearSavedItems");
const clearSavedPill = getElement<HTMLElement>("clearSavedPill");
const clearSavedConfirmation = getElement<HTMLElement>("clearSavedConfirmation");
const clearSavedConfirmationMessage = getElement<HTMLElement>("clearSavedConfirmationMessage");
const cancelClearSaved = getElement<HTMLButtonElement>("cancelClearSaved");
const confirmClearSaved = getElement<HTMLButtonElement>("confirmClearSaved");
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
const summaryStatus = getElement<HTMLElement>("summaryStatus");
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
let settingsReturnSegment: "protected" | "saved" = "protected";
let selectedPurchaseId: string | null = null;
let detailRenderId = 0;
const activePriceChecks = new Map<string, Promise<DashboardData>>();
let itemsLoadRunId = 0;
let activeScanRunId = 0;
let dashboardCache: DashboardData | null = null;
let confettiPopulated = false;
let tracerUserIdPromise: Promise<string> | null = null;
let monitoringEnabled = true;
let protectedItemCount = 0;
let savedItemCount = 0;

let savedProduct: SavedProduct | null = null;
let savedImageCandidates: string[] = [];
let savedImageIndex = 0;
let savedProductImagesReady = Promise.resolve();
let resolveSavedProductImages: (() => void) | null = null;
let activeProductTabId: number | null = null;
let activeProductPageUrl: string | null = null;
let pendingProductImages: { tabId: number; pageUrl: string; candidates: string[] } | null = null;
const savedImagePreloads = new Map<string, HTMLImageElement>();
const savedTab = getElement<HTMLButtonElement>('savedTab');
const protectedTab = getElement<HTMLButtonElement>('protectedTab');
const saveToTracer = getElement<HTMLButtonElement>('saveToTracer');
const watchFeedback = getElement<HTMLElement>('watchFeedback');
traceStartupStage("popup DOM bindings ready", popupModuleStartedAt);
savedTab.addEventListener('click', () => { void showSavedItems(); });
protectedTab.addEventListener('click', () => { void showProtectedItems(); });
getElement('viewSaved').addEventListener('click', () => { itemsReturnState = 'watchlist'; void showSavedItems(); });
getElement('continueBrowsing').addEventListener('click', () => window.close());
getElement('emptyContinueBrowsing').addEventListener('click', () => window.close());
saveToTracer.addEventListener('click', () => { void saveCurrentProduct(); });
chrome.runtime.onMessage?.addListener((message, sender) => {
  const senderTabId = sender.tab?.id;
  if (
    message?.type !== 'TRACER_PRODUCT_IMAGES_READY' ||
    activeProductTabId === null ||
    activeProductPageUrl === null ||
    senderTabId === undefined ||
    senderTabId !== activeProductTabId ||
    message.pageUrl !== activeProductPageUrl ||
    !Array.isArray(message.imageCandidates)
  ) return;

  const candidates = message.imageCandidates.filter((candidate: unknown): candidate is string => typeof candidate === 'string');
  if (startupTraceEnabled && typeof message.imageExtractionMs === 'number') {
    const deliveredAt = performance.now();
    traceStartupStage('image candidate extraction + ranking (content script)', deliveredAt - message.imageExtractionMs, deliveredAt);
  }
  pendingProductImages = { tabId: senderTabId, pageUrl: activeProductPageUrl, candidates };
  if (savedProduct) {
    applyRankedProductImages(candidates);
    resolveSavedProductImages?.();
    resolveSavedProductImages = null;
  }
});

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


const preferencesStartedAt = performance.now();
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
  setSwitchValue(detailAlertsSwitch, stored.priceDropAlertsEnabled !== false);
  syncDetailAlerts(stored.priceDropAlertsEnabled !== false);
  monitoringEnabled = stored.monitoringEnabled !== false;
  setSwitchValue(monitoringToggle, monitoringEnabled);
  traceStartupStage("settings read", preferencesStartedAt);
});

if (startWithDetectedPreview) {
  renderDetectedPreview();
  void refreshOpportunityStatus();
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
    apiInput.setAttribute("aria-invalid", "true");
    apiInput.focus();
    return;
  }

  apiInput.removeAttribute("aria-invalid");
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
detailAlertsSwitch.addEventListener("click", () => {
  void toggleSetting(detailAlertsSwitch, "priceDropAlertsEnabled");
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
clearSavedItems.addEventListener("click", showClearSavedConfirmation);
cancelClearSaved.addEventListener("click", () => {
  hideClearSavedConfirmation();
  clearSavedItems.focus();
});
clearSavedConfirmation.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmClearSaved.disabled) {
    hideClearSavedConfirmation();
    clearSavedItems.focus();
  }
});
confirmClearSaved.addEventListener("click", () => { void clearAllSavedItems(); });
deleteItem.addEventListener("click", () => { void deleteSelectedPurchase(); });

dashboardCta.addEventListener("click", openProtectedItems);
getElement<HTMLButtonElement>("successContinueBrowsing").addEventListener("click", () => window.close());
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
    renderState("review", "One detail needs attention.", reviewed.error);
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
  const draftToProtect = capturedDraft;

  chrome.runtime.sendMessage(
    {
      type: "TRACER_PROTECT_PURCHASE",
      purchaseDraft: draftToProtect,
    },
    (response?: ProtectMessageResponse) => {
      protectButton.dataset.loading = "false";

      if (response?.ok) {
        const accepted = response.response.accepted;
        const rejected = response.response.rejected;
        const protectedPurchase = accepted[0]?.purchase;
        const duplicate = accepted.some((item) => item.status === "duplicate");
        const pendingSync = response.response.pendingSync === true || accepted.some((item) => item.pendingSync);

        if (accepted.length === 0) {
          protectButton.disabled = false;
          protectButton.textContent = "Protect this purchase";
          reviewPanel.dataset.visible = "true";
          reviewDetailsButton.setAttribute("aria-expanded", "true");
          populateReviewForm(draftToProtect);
          renderState(
            "review",
            "Check these details.",
            rejected[0]?.reason ?? "Tracer could not protect this purchase yet.",
          );
          return;
        }

        protectedPurchaseId = protectedPurchase?.id ?? null;
        dashboardCache = null;
        renderProtectedPurchase({
          title: duplicate ? "Already protected" : pendingSync ? "Purchase saved" : "Purchase protected",
          newlyProtected: !duplicate && !pendingSync,
          pendingSync,
        });
        return;
      }

      void protectPurchaseOffline(draftToProtect);
    },
  );
});

async function scanActiveTab(): Promise<void> {
  const runId = ++activeScanRunId;
  const scanStartedAt = performance.now();
  activeProductTabId = null;
  activeProductPageUrl = null;
  pendingProductImages = null;
  savedProduct = null;
  savedImageCandidates = [];
  savedImageIndex = 0;
  savedProductImagesReady = Promise.resolve();
  resolveSavedProductImages = null;
  capturedDraft = null;
  protectedPurchaseId = null;
  renderState("detecting", "Finding your item...", "This usually takes a moment.\nHang tight.");
  reviewPanel.dataset.visible = "false";
  scanButton.disabled = true;
  protectButton.disabled = true;
  protectButton.dataset.loading = "false";
  protectButton.textContent = "Protect this purchase";
  reviewDetailsButton.disabled = true;

  try {
    const activeTabQueryStartedAt = performance.now();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    traceStartupStage("active tab query", activeTabQueryStartedAt);

    if (runId !== activeScanRunId) return;

    if (!tab?.id || !isScannableTabUrl(tab.url)) {
      renderState(
        "empty",
        "Nothing to save here",
        "Open Tracer on a product page to save it for later.",
      );
      return;
    }
    activeProductTabId = tab.id;
    activeProductPageUrl = tab.url ?? null;

    // Product routes do not need the order-confirmation extractor. Try the
    // lightweight save flow first so we avoid injecting the purchase bundle
    // and waking the background worker for an irrelevant scan.
    if (!isLikelyPurchaseTab(tab.url, tab.title) && isLikelyProductTab(tab.url, tab.title)) {
      const savedItemsStartedAt = performance.now();
      const savedItemsPromise = watchlistRequest<SavedItem[]>('LIST').catch(() => []);
      for (let attempt = 0; attempt <= pageDetectionRetryDelaysMs.length; attempt += 1) {
        if (attempt > 0) {
          const delayMs = pageDetectionRetryDelaysMs[attempt - 1]!;
          await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
          if (runId !== activeScanRunId) return;
        }
        const productScanStartedAt = performance.now();
        const productWasFound = await offerSaveProduct(
          tab.id,
          runId,
          attempt === 0,
          savedItemsPromise,
          savedItemsStartedAt,
        );
        traceStartupStage(attempt === 0 ? "product-first extraction + saved-state lookup" : `product extraction retry after ${pageDetectionRetryDelaysMs[attempt - 1]}ms`, productScanStartedAt);
        if (productWasFound) return;
      }
      renderState(
        "empty",
        "Nothing to save here",
        "Open Tracer on a product page to save it for later.",
      );
      return;
    }

    const cacheStartedAt = performance.now();
    const cachedResponse = isLikelyPurchaseTab(tab.url, tab.title)
      ? await getCachedPageScan(tab.id, tab.url ?? "")
      : null;
    if (isLikelyPurchaseTab(tab.url, tab.title)) {
      traceStartupStage("background scan cache lookup", cacheStartedAt);
    }
    let response = cachedResponse;
    if (cachedResponse) traceStartupStage("cached purchase scan", performance.now());
    if (!response) {
      const purchaseScanStartedAt = performance.now();
      response = await scanPurchasePage(tab.id);
      traceStartupStage("purchase scan (inject + content response)", purchaseScanStartedAt);
    }
    if (!response?.ok || !response.draft) {
      const productScanStartedAt = performance.now();
      const productWasFound = await offerSaveProduct(tab.id, runId);
      traceStartupStage("saved-product extraction + saved-state lookup", productScanStartedAt);
      if (productWasFound) return;
      if (response?.failureReason === "not_purchase_page") {
        renderState(
          "empty",
          "Nothing to save here",
          "Open Tracer on a product page to save it for later.",
        );
        return;
      }
      for (const delayMs of pageDetectionRetryDelaysMs) {
        if (runId !== activeScanRunId) return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        if (runId !== activeScanRunId) return;

        const retryStartedAt = performance.now();
        response = await scanPurchasePage(tab.id);
        traceStartupStage(`purchase scan retry after ${delayMs}ms`, retryStartedAt);
        if (response?.ok && response.draft) break;
        if (await offerSaveProduct(tab.id, runId)) return;
      }
    }

    if (!response?.ok || !response.draft) {
      if (runId !== activeScanRunId) return;
      renderState(
        "empty",
        "Nothing to save here",
        "Open Tracer on a product page to save it for later.",
      );
      return;
    }

    if (runId !== activeScanRunId) return;

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

      if (protectionStatus.pendingSync) {
        protectedOptions.pendingSync = true;
      }

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
      renderState(
        "incomplete",
        "We couldn’t read this page yet.",
        message ? "Refresh the order page, then scan again." : "Open the completed order page and scan again.",
      );
    }
  } finally {
    if (runId === activeScanRunId) {
      scanButton.disabled = false;
      void refreshOpportunityStatus();
    }
    traceStartupStage("startup detection path", scanStartedAt);
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

  productName.textContent = itemCount > 1
    ? `${itemCount} items in this order`
    : primaryItem?.productName ?? summary?.productName ?? "Detected purchase";
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
  title: "Purchase protected" | "Purchase saved" | "Already protected";
  newlyProtected: boolean;
  pendingSync?: boolean;
  pricePaidDisplay?: string;
}): void {
  const draft = capturedDraft;
  const primaryItem = draft?.lineItems[0];
  const total = draft ? sumLineItemTotals(draft.lineItems) : null;

  successTitle.textContent = options.title;
  successCopy.textContent =
    options.pendingSync
      ? "Saved on this device. Monitoring will start automatically when it’s back online."
      : options.title === "Already protected"
        ? "We’re already watching this purchase for price drops."
        : "We’re now watching for price drops. We’ll let you know when it changes.";
  summaryStatus.textContent = options.pendingSync ? "Watching" : "Monitoring active";
  app.dataset.celebrate = String(options.newlyProtected);
  summaryProductName.textContent = draft && draft.lineItems.length > 1
    ? `${draft.lineItems.length} items in this order`
    : primaryItem?.productName ?? "Protected purchase";
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
  app.dataset.retryable = "false";
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  stateCloseButton.textContent = "Maybe later";

  if (state !== "protected" && state !== "duplicate") {
    app.dataset.celebrate = "false";
  }
  if (startupTraceEnabled && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => markPopupUsable(state));
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

function getCachedPageScan(tabId: number, url: string): Promise<ScanResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: ScanResponse | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(response);
    };
    const timeoutId = window.setTimeout(() => finish(null), cacheLookupTimeoutMs);
    chrome.runtime.sendMessage(
      { type: "TRACER_GET_CACHED_PAGE_SCAN", tabId, url },
      (response?: CachedScanMessageResponse) => {
        void chrome.runtime.lastError;
        finish(response?.ok && response.response ? response.response : null);
      },
    );
  });
}

async function scanPurchasePage(tabId: number): Promise<ScanResponse | null> {
  try {
    await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["genericCapture.js", "watchlistCapture.js"],
      }),
      pageCaptureTimeoutMs,
      "Purchase scan timed out.",
    );

    return await withTimeout(
      new Promise<ScanResponse | null>((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "TRACER_SCAN_PAGE" }, (response?: ScanResponse) => {
          void chrome.runtime.lastError;
          resolve(response ?? null);
        });
      }),
      pageCaptureTimeoutMs,
      "Purchase scan timed out.",
    );
  } catch {
    return null;
  }
}

async function checkProtectionStatus(draft: PurchaseDraft): Promise<ProtectionStatusResponse | null> {
  const remote = await new Promise<ProtectionStatusResponse | null>((resolve) => {
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

  if (remote) {
    return remote;
  }

  const pending = (await getPendingPurchases()).find((purchase) => samePurchaseDraft(purchase.draft, draft));
  const primaryItem = pending?.draft.lineItems[0];
  return pending && primaryItem
    ? {
        protected: true,
        purchase: {
          id: pending.id,
          productName: primaryItem.productName,
          pricePaid: primaryItem.pricePaid,
          pricePaidDisplay: formatMoney(primaryItem.pricePaid),
        },
      }
    : { protected: false, purchase: null };
}

async function protectPurchaseOffline(draft: PurchaseDraft): Promise<void> {
  try {
    const { purchase, created } = await queuePendingPurchase(draft);

    protectedPurchaseId = purchase.id;
    dashboardCache = null;
    renderProtectedPurchase({
      title: created ? "Purchase saved" : "Already protected",
      newlyProtected: false,
      pendingSync: true,
    });
  } catch {
    protectButton.disabled = false;
    protectButton.textContent = "Protect this purchase";
    reviewPanel.dataset.visible = "true";
    reviewDetailsButton.setAttribute("aria-expanded", "true");
    populateReviewForm(draft);
    renderState(
      "review",
      "Keep this purchase ready.",
      "Tracer could not save to this browser yet. Check the details and try once more.",
    );
  }
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
  const protectedCount = new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({ type: "TRACER_SYNC_OPPORTUNITIES" }, (response?: SyncMessageResponse) => {
      if (response?.ok) {
        protectedItemCount = response.response.protectedPurchaseCount;
      }
      resolve();
    });
  });
  const savedCount = watchlistRequest<SavedItem[]>('LIST').then((items) => {
    savedItemCount = items.length;
  }).catch(() => undefined);
  return Promise.all([protectedCount, savedCount]).then(updateMenuItemsCount);
}

function updateMenuItemsCount(): void {
  menuItemsCount.textContent = `(${protectedItemCount + savedItemCount})`;
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
    settingsReturnSegment = currentState === "items" && savedTab.getAttribute("aria-pressed") === "true"
      ? "saved"
      : "protected";
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

  if (returnState === "items" && settingsReturnSegment === "saved") {
    void showSavedItems();
    return;
  }

  if (returnState === "items" && dashboardCache) {
    renderProtectedItems(dashboardCache, itemsLoadRunId);
  }

  if (returnState === "detail" && dashboardCache && selectedPurchaseId) {
    const purchase = dashboardCache.purchases.find((item) => item.id === selectedPurchaseId);
    if (purchase) {
      const opportunity = dashboardCache.opportunities.find((item) => item.purchaseId === purchase.id);
      showItemDetail(purchase, opportunity);
    }
  }

  if (returnState === "detecting") {
    void scanActiveTab();
  }
}

function setSwitchValue(toggle: HTMLButtonElement, enabled: boolean): void {
  toggle.setAttribute("aria-checked", String(enabled));
}

function syncDetailAlerts(enabled: boolean): void {
  setSwitchValue(detailAlertsSwitch, enabled);
}

async function toggleSetting(
  toggle: HTMLButtonElement,
  key: "priceDropAlertsEnabled" | "monitoringEnabled",
): Promise<void> {
  const previous = toggle.getAttribute("aria-checked") === "true";
  const next = !previous;
  setSwitchValue(toggle, next);
  if (key === "priceDropAlertsEnabled") {
    setSwitchValue(priceDropAlertsToggle, next);
    setSwitchValue(detailAlertsSwitch, next);
    syncDetailAlerts(next);
  }

  try {
    await chrome.storage.sync.set({ [key]: next });
    if (key === "monitoringEnabled") {
      monitoringEnabled = next;
      void persistMonitoringSetting(next).catch(() => undefined);
      if (currentState === 'items' && savedTab.getAttribute('aria-pressed') === 'true') {
        void showSavedItems();
      }
    }
  } catch {
    setSwitchValue(toggle, previous);
    if (key === "priceDropAlertsEnabled") {
      setSwitchValue(priceDropAlertsToggle, previous);
      setSwitchValue(detailAlertsSwitch, previous);
      syncDetailAlerts(previous);
    }
  }
}

async function persistMonitoringSetting(enabled: boolean): Promise<void> {
  const userId = await getTracerUserId();
  const response = await withTimeout(
    fetch(`${apiBaseUrl}/api/settings/monitoring`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-tracer-user-id": userId,
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
  let clearedLocalPurchases = false;

  try {
    await preferencesReady;
    const userId = await getTracerUserId();
    const pendingPurchases = await getPendingPurchases();
    if (pendingPurchases.length > 0) {
      await setPendingPurchases([]);
      clearedLocalPurchases = true;
      if (dashboardCache) {
        dashboardCache = {
          ...dashboardCache,
          purchases: dashboardCache.purchases.filter((item) => !item.pendingDraftId),
        };
      }
    }
    let data = dashboardCache;

    if (!data) {
      const response = await withTimeout(
        fetch(`${apiBaseUrl}/api/dashboard`, {
          headers: { "x-tracer-user-id": userId },
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

    // Pending offline protections live only in local storage. They are
    // represented in the dashboard cache with a synthetic id and must not be
    // sent to the API as DELETE requests.
    for (const purchase of data.purchases.filter((item) => !item.pendingDraftId)) {
      const response = await withTimeout(
        fetch(`${apiBaseUrl}/api/purchases/${encodeURIComponent(purchase.id)}`, {
          method: "DELETE",
          headers: { "x-tracer-user-id": userId },
        }),
        5_000,
        "Delete request timed out.",
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Delete request returned ${response.status}`);
      }
    }

    dashboardCache = { purchases: [], opportunities: [] };
    protectedItemCount = 0;
    updateMenuItemsCount();
    itemsCount.textContent = "0 items";
    renderItemsMessage("No protected purchases", "Items you protect will appear here.", true, "Refresh");
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
    dashboardCache = null;
    clearConfirmationMessage.textContent = clearedLocalPurchases
      ? "Local purchases cleared. Reconnect to clear server purchases."
      : "Couldn’t reach or update your purchases. Check the server connection, then retry.";
    clearConfirmationMessage.dataset.error = "true";
    confirmClearPurchases.disabled = false;
  } finally {
    clearProtectedPurchases.disabled = false;
    confirmClearPurchases.disabled = false;
    cancelClearPurchases.disabled = false;
    clearProtectedPurchases.setAttribute("aria-busy", "false");
  }
}

function showClearSavedConfirmation(): void {
  clearSavedConfirmationMessage.textContent = "This can’t be undone.";
  clearSavedConfirmationMessage.dataset.error = "false";
  clearSavedPill.dataset.confirming = "true";
  clearSavedItems.setAttribute("aria-expanded", "true");
  clearSavedItems.inert = true;
  clearSavedConfirmation.inert = false;
  confirmClearSaved.focus();
}

function hideClearSavedConfirmation(): void {
  clearSavedPill.dataset.confirming = "false";
  clearSavedItems.setAttribute("aria-expanded", "false");
  clearSavedItems.inert = false;
  clearSavedConfirmation.inert = true;
  confirmClearSaved.disabled = false;
  cancelClearSaved.disabled = false;
  clearSavedItems.disabled = false;
  clearSavedConfirmationMessage.dataset.error = "false";
}

async function clearAllSavedItems(): Promise<void> {
  if (clearSavedItems.disabled || confirmClearSaved.disabled) return;
  clearSavedItems.disabled = true;
  confirmClearSaved.disabled = true;
  cancelClearSaved.disabled = true;
  clearSavedItems.setAttribute("aria-busy", "true");
  try {
    await watchlistRequest<void>('CLEAR');
    savedItemCount = 0;
    updateMenuItemsCount();
    if (savedProduct && settingsReturnState === 'watchlist') {
      getElement('watchHeading').textContent = 'Save for later.';
      saveToTracer.textContent = 'Save to Tracer';
      saveToTracer.dataset.status = 'ready';
      saveToTracer.disabled = false;
      watchFeedback.textContent = '';
      renderSavedProduct(getElement('watchProduct'), savedProduct, true);
    }
    hideClearSavedConfirmation();
  } catch (error) {
    console.error("Tracer could not clear saved items", error);
    clearSavedConfirmationMessage.textContent = "Couldn’t clear saved items. Try again.";
    clearSavedConfirmationMessage.dataset.error = "true";
    confirmClearSaved.disabled = false;
    cancelClearSaved.disabled = false;
  } finally {
    clearSavedItems.disabled = false;
    clearSavedItems.setAttribute("aria-busy", "false");
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
  setItemsSegment(false);
  const loadRunId = ++itemsLoadRunId;
  selectedPurchaseId = null;
  renderState("items", "Protected purchases", "");
  if (dashboardCache && !options.force) {
    renderProtectedItems(dashboardCache, loadRunId);
    return;
  }

  renderItemsLoading(options.force ? "Refreshing purchases…" : "Loading purchases…");
  try {
    await preferencesReady;
    const [userId, pendingPurchases] = await Promise.all([getTracerUserId(), getPendingPurchases()]);
    const response = await withTimeout(
      fetch(`${apiBaseUrl}/api/dashboard`, { headers: { "x-tracer-user-id": userId } }),
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
    dashboardCache = mergePendingDashboard({
      purchases: raw.purchases ?? [],
      opportunities: raw.opportunities ?? [],
    }, pendingPurchases);
    renderProtectedItems(dashboardCache, loadRunId);
  } catch {
    if (loadRunId !== itemsLoadRunId || currentState !== "items") {
      return;
    }
    const pendingPurchases = await getPendingPurchases();
    if (pendingPurchases.length > 0) {
      dashboardCache = mergePendingDashboard({ purchases: [], opportunities: [] }, pendingPurchases);
      renderProtectedItems(dashboardCache, loadRunId);
      return;
    }
    itemsCount.textContent = "0 items";
    renderItemsMessage("No purchases saved offline", "Reconnect to check synced items.", true);
  }
}

function mergePendingDashboard(data: DashboardData, pending: PendingProtectedPurchase[]): DashboardData {
  const remoteKeys = new Set(data.purchases.map((purchase) => `${purchase.retailerId}|${purchase.orderReference ?? ""}|${purchase.purchasedAt}|${purchase.productName.trim().toLowerCase()}`));
  const localPurchases = pending.flatMap((pendingPurchase) => pendingPurchase.draft.lineItems.map((item, index) => {
    const purchase: DashboardPurchase = {
      id: index === 0 ? pendingPurchase.id : `${pendingPurchase.id}_${index}`,
      userId: defaultUserId,
      retailerId: pendingPurchase.draft.retailerId,
      retailerName: pendingPurchase.draft.retailerName,
      storeHost: pendingPurchase.draft.storeHost,
      productId: `${pendingPurchase.id}_product_${index}`,
      productName: item.productName,
      productUrl: item.productUrl ?? pendingPurchase.draft.sourceUrl,
      pricePaid: item.pricePaid,
      quantity: item.quantity,
      purchasedAt: pendingPurchase.draft.purchasedAt,
      sourceUrl: pendingPurchase.draft.sourceUrl,
      createdAt: pendingPurchase.queuedAt,
      protectionStatus: "active",
      captureMethod: pendingPurchase.draft.captureMethod,
      captureConfidence: pendingPurchase.draft.captureConfidence,
      currentPriceDisplay: null,
      monitoringStatus: "watching",
      pendingSync: true,
      pendingDraftId: pendingPurchase.id,
    };
    if (pendingPurchase.draft.orderReference) purchase.orderReference = pendingPurchase.draft.orderReference;
    if (item.externalProductId) purchase.externalProductId = item.externalProductId;
    if (item.imageUrl) purchase.imageUrl = item.imageUrl;
    return purchase;
  })).filter((purchase) => !remoteKeys.has(`${purchase.retailerId}|${purchase.orderReference ?? ""}|${purchase.purchasedAt}|${purchase.productName.trim().toLowerCase()}`));

  return {
    purchases: [...localPurchases, ...data.purchases],
    opportunities: data.opportunities,
  };
}

function renderProtectedItems(data: DashboardData, loadRunId: number): void {
  if (loadRunId !== itemsLoadRunId || currentState !== "items") {
    return;
  }

  const { purchases, opportunities } = data;
  protectedItemCount = purchases.length;
  itemsCount.textContent = `${purchases.length} item${purchases.length === 1 ? "" : "s"}`;
  updateMenuItemsCount();

  if (purchases.length === 0) {
    renderItemsMessage("No protected purchases", "Items you protect will appear here.", true, "Refresh");
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
    const monitoringPaused = !monitoringEnabled;
    const priceDropped = !monitoringPaused && purchase.monitoringStatus === "price_dropped";
    const savingDisplay = purchase.savingDisplay ?? opportunity?.potentialSavingDisplay ?? "";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "item-row";
    row.dataset.alert = String(priceDropped);
    row.dataset.error = String(
      !monitoringPaused &&
      (purchase.monitoringStatus === "unable_to_check" || purchase.monitoringStatus === "unavailable"),
    );
    row.dataset.paused = String(monitoringPaused);
    row.dataset.hasImage = String(Boolean(purchase.imageUrl));

    if (purchase.imageUrl) {
      const image = document.createElement("img");
      image.src = purchase.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.setAttribute("loading", "lazy");
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        row.dataset.hasImage = "false";
      });
      row.append(image);
    }

    const copy = document.createElement("span");
    copy.className = "item-row-copy";
    const name = document.createElement("strong");
    name.textContent = purchase.productName;
    const status = document.createElement("span");
    status.className = "item-row-status";
    status.textContent = monitoringPaused ? "● Paused" : monitoringStatusLabel(purchase.monitoringStatus);
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

function renderItemsMessage(
  title: string,
  copy: string,
  retry = false,
  buttonLabel = "Try again",
): void {
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
    retryButton.className = "items-refresh";
    retryButton.setAttribute(
      "aria-label",
      buttonLabel === "Refresh" ? "Refresh protected purchases" : "Try loading purchases again",
    );
    retryButton.title = buttonLabel;
    retryButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${buttonLabel}</span>
    `;
    retryButton.addEventListener("click", () => { void showProtectedItems({ force: true }); });
    message.append(retryButton);
  }

  itemsList.replaceChildren(message);
}

function renderItemsLoading(label: string): void {
  const loading = document.createElement("div");
  loading.className = "items-loading";
  loading.setAttribute("role", "status");

  const spinner = document.createElement("span");
  spinner.className = "items-loading-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  copy.textContent = label;
  loading.append(spinner, copy);
  itemsList.replaceChildren(loading);
}

function showItemDetail(purchase: DashboardPurchase, opportunity?: DashboardOpportunity, checkMissingPrice = true): void {
  const renderId = ++detailRenderId;
  detailCurrentPrice.dataset.checking = "false";
  detailCurrentPrice.setAttribute("aria-busy", "false");
  selectedPurchaseId = purchase.id;
  renderState("detail", purchase.productName, "");
  detailName.textContent = purchase.productName;
  detailImageWrap.hidden = !purchase.imageUrl;
  if (purchase.imageUrl) {
    detailImage.alt = `${purchase.productName} product image`;
    detailImage.onerror = () => {
      detailImageWrap.hidden = true;
    };
    detailImage.src = purchase.imageUrl;
  } else {
    detailImage.onerror = null;
    detailImage.removeAttribute("src");
    detailImage.alt = "";
  }

  const storeName = purchase.retailerName || purchase.storeHost;
  const productUrl = safeProductUrl(purchase.productUrl);
  detailRetailerText.hidden = false;
  detailRetailerText.textContent = storeName;
  detailProductAction.hidden = !productUrl;
  if (productUrl) {
    detailProductAction.href = productUrl;
    detailProductAction.setAttribute("aria-label", `Open product page at ${storeName}`);
    detailProductCopy.textContent = `Open on ${storeName}`;
  } else {
    detailProductAction.removeAttribute("href");
  }
  syncDetailAlerts(priceDropAlertsToggle.getAttribute("aria-checked") !== "false");

  const monitoringPaused = !monitoringEnabled;
  const priceDropped = !monitoringPaused && purchase.monitoringStatus === "price_dropped";
  const savingDisplay = purchase.savingDisplay ?? opportunity?.potentialSavingDisplay ?? "";
  detailStatus.dataset.alert = String(priceDropped);
  detailStatus.dataset.error = String(!monitoringPaused && purchase.monitoringStatus === "unable_to_check");
  detailStatus.dataset.paused = String(monitoringPaused);
  detailStatus.textContent = monitoringPaused
    ? "● Paused"
    : priceDropped
    ? `● Price dropped by ${savingDisplay}`
    : monitoringStatusLabel(purchase.monitoringStatus);
  deleteItem.disabled = false;
  detailPaid.textContent = formatMoney(purchase.pricePaid);
  detailPaidDate.textContent = `Ordered ${formatShortDate(purchase.purchasedAt)}`;
  detailPriceCard.dataset.alert = String(priceDropped);
  detailPriceCard.dataset.error = String(
    !monitoringPaused && (purchase.monitoringStatus === "unable_to_check" || purchase.monitoringStatus === "unavailable"),
  );

  const hasCurrentPrice = Boolean(purchase.currentPriceDisplay);
  detailCurrentPrice.textContent = monitoringPaused
    ? "Paused"
    : purchase.monitoringStatus === "unable_to_check"
    ? "Unable to check"
    : purchase.monitoringStatus === "unavailable"
    ? "Unavailable"
    : purchase.currentPriceDisplay ?? "—";
  detailPriceNote.textContent = monitoringPaused
    ? "Price monitoring is paused."
    : priceDropped && savingDisplay
    ? `${savingDisplay} less than you paid`
    : purchase.monitoringStatus === "unable_to_check"
    ? "We’ll try checking again automatically."
    : purchase.monitoringStatus === "unavailable"
    ? "This item is currently unavailable."
    : hasCurrentPrice
    ? "No price drop found since purchase."
    : purchase.lastCheckedAt
    ? `Last checked ${formatShortDate(purchase.lastCheckedAt)}`
    : purchase.pendingSync ? "Connect to sync this purchase before checking." : "No current price available yet.";
  detailMonitoringInsight.textContent = monitoringPaused
    ? "Monitoring is paused."
    : purchase.monitoringStatus === "unavailable"
    ? "The store currently reports this item unavailable."
    : purchase.monitoringStatus === "unable_to_check"
    ? `Unable to check${purchase.lastCheckedAt ? ` · Last attempt ${formatShortDate(purchase.lastCheckedAt)}` : ""}; Tracer will retry.`
    : purchase.lastCheckedAt
    ? `Last checked ${formatShortDate(purchase.lastCheckedAt)}`
    : "Waiting for the first price check";
  detailMonitoringState.textContent = monitoringPaused
    ? "Paused"
    : purchase.monitoringStatus === "unavailable"
    ? "Unavailable"
    : purchase.monitoringStatus === "unable_to_check"
    ? "Retrying"
    : "Automatic";

  if (checkMissingPrice && !hasCurrentPrice && !monitoringPaused && !purchase.pendingSync
    && (!purchase.monitoringStatus || purchase.monitoringStatus === "watching")) {
    void checkDetailPrice(purchase, renderId);
  }
}

async function checkDetailPrice(purchase: DashboardPurchase, renderId: number): Promise<void> {
  detailCurrentPrice.textContent = "Checking";
  detailCurrentPrice.dataset.checking = "true";
  detailCurrentPrice.setAttribute("aria-busy", "true");
  detailPriceNote.textContent = "Checking the store’s latest price…";
  detailMonitoringState.textContent = "Checking";
  const isCurrent = () => currentState === "detail" && selectedPurchaseId === purchase.id && detailRenderId === renderId;
  try {
    let check = activePriceChecks.get(purchase.id);
    if (!check) {
      check = (async () => {
        const userId = await getTracerUserId();
        const headers = { "x-tracer-user-id": userId };
        const signal = AbortSignal.timeout(15_000);
        const response = await fetch(`${apiBaseUrl}/api/purchases/${encodeURIComponent(purchase.id)}/check-price`, {
          method: "POST", headers, signal,
        });
        if (!response.ok) throw new Error("Price check failed");
        const dashboard = await fetch(`${apiBaseUrl}/api/dashboard`, { headers, signal });
        if (!dashboard.ok) throw new Error("Price refresh failed");
        return await dashboard.json() as DashboardData;
      })().finally(() => activePriceChecks.delete(purchase.id));
      activePriceChecks.set(purchase.id, check);
    }
    const data = await check;
    if (!isCurrent()) return;
    dashboardCache = data;
    const updated = data.purchases.find((item) => item.id === purchase.id);
    if (!updated?.currentPriceDisplay) throw new Error("Price unavailable");
    showItemDetail(updated, data.opportunities.find((item) => item.purchaseId === purchase.id), false);
  } catch {
    if (!isCurrent()) return;
    detailCurrentPrice.textContent = "Unable to check";
    detailPriceCard.dataset.error = "true";
    detailPriceNote.textContent = "Couldn’t get a price. Reopen this item to retry.";
    detailMonitoringState.textContent = "Unavailable";
  } finally {
    if (isCurrent()) {
      detailCurrentPrice.dataset.checking = "false";
      detailCurrentPrice.setAttribute("aria-busy", "false");
    }
  }
}

function safeProductUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
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
  const selectedPurchase = dashboardCache?.purchases.find((purchase) => purchase.id === purchaseId);
  deleteItem.disabled = true;
  deleteItem.dataset.loading = "true";
  deleteItem.setAttribute("aria-busy", "true");

  try {
    if (selectedPurchase?.pendingDraftId) {
      await removePendingPurchase(selectedPurchase.pendingDraftId);
      protectedPurchaseId = protectedPurchaseId === selectedPurchase.pendingDraftId ? null : protectedPurchaseId;
      selectedPurchaseId = null;
      dashboardCache = dashboardCache
        ? {
            purchases: dashboardCache.purchases.filter((purchase) => purchase.pendingDraftId !== selectedPurchase.pendingDraftId),
            opportunities: dashboardCache.opportunities,
          }
        : null;
      await showProtectedItems();
      return;
    }

    await preferencesReady;
    const userId = await getTracerUserId();
    const response = await withTimeout(
      fetch(`${apiBaseUrl}/api/purchases/${encodeURIComponent(purchaseId)}`, {
        method: "DELETE",
        headers: { "x-tracer-user-id": userId },
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

async function removePendingPurchase(pendingDraftId: string): Promise<void> {
  const pending = await getPendingPurchases();
  await setPendingPurchases(pending.filter((purchase) => purchase.id !== pendingDraftId));
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

function isLikelyProductTab(rawUrl: string | undefined, title: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return false;
    return /\/(?:products?|productpage(?:\.|\/)|dp\/|p\/)/i.test(url.pathname) ||
      /\bproduct\b/i.test(title ?? "");
  } catch {
    return false;
  }
}

function isLikelyPurchaseTab(rawUrl: string | undefined, title: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return (url.hostname.toLowerCase() === "shopify.com" &&
      /^\/\d+\/account\/orders\/[a-z0-9_-]+\/?$/i.test(url.pathname)) ||
      /(?:checkout|order|confirmation|thank[-_]?you)/i.test(url.pathname) ||
      /(?:order confirmation|thank you for your order|order #)/i.test(title ?? "");
  } catch {
    return /(?:order confirmation|thank you for your order|order #)/i.test(title ?? "");
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

function dedupeSavedImageCandidates(candidates: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    const identity = productImageIdentity(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(value);
  }
  return unique;
}

function applyRankedProductImages(candidates: string[]): void {
  if (!savedProduct) return;
  const selectedIdentity = savedProduct.imageUrl ? productImageIdentity(savedProduct.imageUrl) : null;
  savedImageCandidates = dedupeSavedImageCandidates([
    savedProduct.imageUrl,
    ...candidates,
  ]);
  preloadSavedImages(savedImageCandidates);
  if (!savedProduct.imageUrl && savedImageCandidates[0]) {
    savedProduct = { ...savedProduct, imageUrl: savedImageCandidates[0] };
  }
  const selectedIndex = selectedIdentity
    ? savedImageCandidates.findIndex((url) => productImageIdentity(url) === selectedIdentity)
    : -1;
  savedImageIndex = selectedIndex >= 0 ? selectedIndex : 0;

  // Keep the initial image visible while allowing the ranked alternatives to
  // appear as soon as they're ready. Never interrupt an in-flight save.
  if (
    currentState === 'watchlist' &&
    saveToTracer.dataset.status !== 'saving' &&
    saveToTracer.dataset.status !== 'saved'
  ) {
    renderSavedProduct(getElement('watchProduct'), savedProduct, !saveToTracer.disabled);
  }
}

function preloadSavedImages(candidates: string[]): void {
  for (const url of candidates) {
    if (savedImagePreloads.has(url)) continue;
    const image = document.createElement('img');
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.fetchPriority = 'low';
    image.src = url;
    savedImagePreloads.set(url, image);
  }
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing popup element: ${id}`);
  }

  return element as T;
}


async function watchlistRequest<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await chrome.runtime.sendMessage({type: `TRACER_WATCHLIST_${type}`, ...payload}) as {ok:boolean; result:T; error?:string};
  if (!response?.ok) throw new Error(response?.error || 'Saved items are unavailable. Please try again.');
  return response.result;
}

async function offerSaveProduct(
  tabId: number,
  runId: number,
  injectCapture = true,
  savedItemsPromise?: Promise<SavedItem[]>,
  savedItemsStartedAt?: number,
): Promise<boolean> {
  try {
    if (injectCapture) {
      const injectionStartedAt = performance.now();
      await withTimeout(
        chrome.scripting.executeScript({ target: { tabId }, files: ["watchlistCapture.js"] }),
        pageCaptureTimeoutMs,
        "Product scan timed out.",
      );
      traceStartupStage("watchlist content-script injection", injectionStartedAt);
    }
    const extractionStartedAt = performance.now();
    const response = await withTimeout(chrome.tabs.sendMessage(tabId, {type:'TRACER_EXTRACT_SAVED_PRODUCT'}), pageCaptureTimeoutMs, 'Product scan timed out.') as {
      product: SavedProduct | null;
      imageCandidates?: string[];
      imageCandidatesPending?: boolean;
    };
    traceStartupStage("product-content-script response", extractionStartedAt);
    if (runId !== activeScanRunId) return true;
    if (!response?.product) return false;
    savedProduct = response.product;
    savedImageCandidates = dedupeSavedImageCandidates([
      savedProduct.imageUrl,
      ...(response.imageCandidates ?? []),
    ]);
    preloadSavedImages(savedImageCandidates);
    savedImageIndex = Math.max(0, savedImageCandidates.indexOf(savedProduct.imageUrl ?? ''));
    if (!savedProduct.imageUrl && savedImageCandidates[0]) {
      savedProduct = { ...savedProduct, imageUrl: savedImageCandidates[0] };
    }
    if (
      pendingProductImages?.tabId === tabId &&
      pendingProductImages.pageUrl === activeProductPageUrl
    ) {
      applyRankedProductImages(pendingProductImages.candidates);
      pendingProductImages = null;
    } else if (response.imageCandidatesPending) {
      savedProductImagesReady = new Promise<void>((resolve) => {
        resolveSavedProductImages = resolve;
      });
    }
    const storageReadStartedAt = savedItemsStartedAt ?? performance.now();
    const savedItems = await (savedItemsPromise ?? watchlistRequest<SavedItem[]>('LIST').catch(() => []));
    traceStartupStage("saved-items storage read", storageReadStartedAt);
    if (runId !== activeScanRunId) return true;
    const savedLookupStartedAt = performance.now();
    const alreadySaved = savedItems.some((item) =>
      normalizeSavedUrl(item.canonicalUrl) === normalizeSavedUrl(savedProduct!.canonicalUrl)
    );
    traceStartupStage("saved-state lookup", savedLookupStartedAt);
    renderSavedProduct(getElement('watchProduct'), savedProduct, !alreadySaved);
    saveToTracer.disabled = alreadySaved;
    saveToTracer.textContent = alreadySaved ? 'Already saved' : 'Save to Tracer';
    saveToTracer.dataset.status = alreadySaved ? 'existing' : 'ready';
    getElement('watchHeading').textContent = alreadySaved ? 'Already saved.' : 'Save for later.';
    watchFeedback.textContent = '';
    renderState('watchlist', '', '');
    return true;
  } catch { return false; }
}

async function saveCurrentProduct(): Promise<void> {
  if (!savedProduct) return;
  saveToTracer.disabled = true;
  saveToTracer.textContent = 'Saving…';
  saveToTracer.dataset.status = 'saving';
  try {
    if (resolveSavedProductImages) {
      let timeoutId = 0;
      await Promise.race([
        savedProductImagesReady,
        new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, pageCaptureTimeoutMs);
        }),
      ]);
      window.clearTimeout(timeoutId);
    }
    const result = await watchlistRequest<{duplicate:boolean}>('SAVE', {product:savedProduct});
    if (!result.duplicate) {
      savedItemCount += 1;
      updateMenuItemsCount();
    }
    getElement('watchHeading').textContent = 'Saved.';
    renderSavedProduct(getElement('watchProduct'), savedProduct);
    saveToTracer.textContent = 'Saved';
    saveToTracer.dataset.status = 'saved';
    watchFeedback.textContent = 'Tracer is now watching this price. Find it in Your items → Saved.';
    populateConfetti(watchlistConfetti);
    app.dataset.celebrate = 'true';
    window.setTimeout(() => {
      app.dataset.celebrate = 'false';
    }, 1_800);
  } catch (error) {
    watchFeedback.textContent = error instanceof Error ? error.message : 'Could not save this item.';
    saveToTracer.disabled = false;
    saveToTracer.textContent = 'Try saving again';
    saveToTracer.dataset.status = 'ready';
  }
}

function setItemsSegment(saved: boolean): void {
  savedTab.setAttribute('aria-pressed', String(saved));
  protectedTab.setAttribute('aria-pressed', String(!saved));
}

function renderSavedProduct(
  container: HTMLElement,
  item: SavedProduct | SavedItem,
  showImagePicker = false,
): void {
  container.replaceChildren();
  container.dataset.hasImage = String(Boolean(item.imageUrl));
  if (item.imageUrl) {
    const image = document.createElement('img');
    image.src = item.imageUrl;
    image.dataset.candidateUrl = item.imageUrl;
    image.alt = '';
    image.loading = showImagePicker ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.fetchPriority = showImagePicker ? 'high' : 'auto';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      if (showImagePicker && savedProduct) {
        const failedUrl = image.dataset.candidateUrl ?? image.currentSrc ?? image.src;
        const failedIdentity = productImageIdentity(failedUrl);
        const failedIndex = savedImageCandidates.findIndex((url) => productImageIdentity(url) === failedIdentity);
        savedImageCandidates = savedImageCandidates.filter((url) => productImageIdentity(url) !== failedIdentity);
        savedImageIndex = savedImageCandidates.length
          ? Math.min(Math.max(0, failedIndex), savedImageCandidates.length - 1)
          : 0;
        const nextImage = savedImageCandidates[savedImageIndex];
        if (nextImage) {
          savedProduct = { ...savedProduct, imageUrl: nextImage };
          image.dataset.candidateUrl = nextImage;
          image.src = nextImage;
        } else {
          delete savedProduct.imageUrl;
          image.remove();
          container.dataset.hasImage = 'false';
        }
      } else {
        image.remove();
        container.dataset.hasImage = 'false';
      }
    });
    if (showImagePicker && savedImageCandidates.length > 1) {
      const picker = document.createElement('div');
      picker.className = 'saved-image-picker';
      const previous = createImageArrow('previous');
      const next = createImageArrow('next');
      previous.addEventListener('click', () => selectSavedImage(-1));
      next.addEventListener('click', () => selectSavedImage(1));
      picker.append(previous, image, next);
      container.append(picker);
    } else {
      container.append(image);
    }
  }
  const copy = document.createElement('div');
  copy.className = 'saved-copy';
  const title = document.createElement('strong');
  title.textContent = item.name;
  const retailer = document.createElement('p');
  retailer.textContent = item.retailer;
  copy.append(title, retailer);
  const displayPrice = 'currentPrice' in item && item.currentPrice
    ? item.currentPrice
    : item.savedPrice;
  if (displayPrice) {
    const price = document.createElement('p');
    price.className = 'saved-price';
    price.textContent = `${formatMoney(displayPrice)} · ${'currentPrice' in item && item.currentPrice ? 'current price' : 'price when saved'}`;
    copy.append(price);
  }
  if ('monitoringStatus' in item) {
    const status = document.createElement('p');
    status.className = 'saved-monitoring-status';
    const dropped = item.monitoringStatus === 'price_dropped' && item.priceDropAmount;
    const monitoringState = !monitoringEnabled
      ? 'off'
      : dropped
        ? 'alert'
        : item.monitoringStatus === 'watching'
          ? 'watching'
          : 'unavailable';
    status.dataset.state = monitoringState;
    status.textContent = monitoringState === 'off'
      ? '● Price watching is off'
      : dropped
      ? `● Price dropped ${formatMoney(item.priceDropAmount!)}${item.priceDropPercent ? ` (${item.priceDropPercent}%)` : ''}`
      : item.monitoringStatus === 'unavailable' ? '● Unable to check price' : '● Watching for price drops';
    copy.append(status);
  }
  container.append(copy);
}

function createImageArrow(direction: 'previous' | 'next'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `saved-image-arrow saved-image-arrow--${direction}`;
  button.setAttribute('aria-label', `${direction === 'previous' ? 'Previous' : 'Next'} product image`);
  button.innerHTML = `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="${direction === 'previous' ? 'm12 5-5 5 5 5' : 'm8 5 5 5-5 5'}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  return button;
}

function selectSavedImage(offset: -1 | 1): void {
  if (!savedProduct || savedImageCandidates.length < 2) return;
  savedImageIndex = (savedImageIndex + offset + savedImageCandidates.length) % savedImageCandidates.length;
  const selectedImage = savedImageCandidates[savedImageIndex];
  if (!selectedImage) return;
  savedProduct = { ...savedProduct, imageUrl: selectedImage };
  const image = getElement('watchProduct').querySelector<HTMLImageElement>('.saved-image-picker img');
  if (!image) {
    renderSavedProduct(getElement('watchProduct'), savedProduct, true);
    return;
  }
  image.dataset.candidateUrl = selectedImage;
  image.src = selectedImage;
}

async function showSavedItems(): Promise<void> {
  const runId = ++itemsLoadRunId;
  setItemsSegment(true);
  renderState('items', 'Your items', '');
  itemsList.replaceChildren();
  itemsCount.textContent = '…';
  try {
    const items = await watchlistRequest<SavedItem[]>('LIST');
    if (runId !== itemsLoadRunId || currentState !== 'items') return;
    savedItemCount = items.length;
    updateMenuItemsCount();
    itemsCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    if (!items.length) {
      renderItemsMessage('A place for your maybes.', 'Open Tracer on a product page and choose Save to Tracer.');
      return;
    }
    const orderedItems = [...items].sort((left, right) => {
      const alertDifference = Number(right.monitoringStatus === 'price_dropped') - Number(left.monitoringStatus === 'price_dropped');
      return alertDifference || right.savedAt.localeCompare(left.savedAt);
    });
    for (const item of orderedItems) {
      const row = document.createElement('article');
      row.className = 'saved-row';
      row.dataset.alert = String(item.monitoringStatus === 'price_dropped');
      renderSavedProduct(row, item);
      const footer = document.createElement('footer');
      const open = document.createElement('a');
      open.innerHTML = 'Open item <span class="open-item-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M9 2h5v5M8 8l6-6M13 9v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
      open.setAttribute('aria-label', 'Open item');
      open.href = item.canonicalUrl;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${item.name} from Saved`);
      remove.addEventListener('click', () => {
        remove.disabled = true;
        void watchlistRequest('REMOVE', {id:item.id}).then(() => showSavedItems()).catch(() => { remove.textContent = 'Retry removal'; remove.disabled = false; });
      });
      footer.append(open, remove);
      row.append(footer);
      itemsList.append(row);
    }
  } catch {
    if (runId !== itemsLoadRunId || currentState !== 'items') return;
    renderItemsMessage('Saved items unavailable', 'Select Saved to try again. Your protected purchases are separate.');
  }
}
