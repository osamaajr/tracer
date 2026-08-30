import type { PurchaseDraft } from "@afterbuy/core";

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

const apiInput = document.getElementById("apiBaseUrl") as HTMLInputElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const scanButton = document.getElementById("scan") as HTMLButtonElement;
const protectButton = document.getElementById("protect") as HTMLButtonElement;
const maybeLaterButton = document.getElementById("maybeLater") as HTMLButtonElement;
const statusMessage = document.getElementById("status") as HTMLParagraphElement;
const purchasePanel = document.getElementById("purchase") as HTMLElement;
const dashboardLink = document.getElementById("dashboardLink") as HTMLAnchorElement;
const retailerLabel = document.getElementById("retailer") as HTMLSpanElement;
const confidenceLabel = document.getElementById("confidence") as HTMLSpanElement;
const productName = document.getElementById("productName") as HTMLElement;
const totalPaid = document.getElementById("totalPaid") as HTMLSpanElement;
const itemCount = document.getElementById("itemCount") as HTMLSpanElement;

let capturedDraft: PurchaseDraft | null = null;

void chrome.storage.sync.get("apiBaseUrl").then((stored) => {
  apiInput.value =
    typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl : "http://127.0.0.1:4000";
});

void chrome.storage.sync.get("dashboardBaseUrl").then((stored) => {
  const baseUrl =
    typeof stored.dashboardBaseUrl === "string"
      ? stored.dashboardBaseUrl
      : "http://127.0.0.1:5173";
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
    statusMessage.textContent = "Use a local development URL or an HTTPS API URL.";
    return;
  }

  void chrome.storage.sync.set({ apiBaseUrl: value }).then(() => {
    statusMessage.textContent = "Tracer API URL saved.";
  });
});

scanButton.addEventListener("click", () => {
  void scanActiveTab();
});

maybeLaterButton.addEventListener("click", () => {
  window.close();
});

protectButton.addEventListener("click", () => {
  if (!capturedDraft) {
    statusMessage.textContent =
      "No purchase is ready yet. Open an order confirmation page and try again.";
    return;
  }

  protectButton.disabled = true;
  protectButton.textContent = "Protecting...";
  statusMessage.textContent = "Sending structured purchase fields to Tracer.";

  chrome.runtime.sendMessage(
    {
      type: "AFTERBUY_PROTECT_PURCHASE",
      purchaseDraft: capturedDraft,
    },
    (response: { ok: boolean; error?: string }) => {
      if (response?.ok) {
        protectButton.textContent = "Protected";
        statusMessage.textContent = "Tracer will watch this purchase.";
        void refreshOpportunityStatus();
        return;
      }

      protectButton.disabled = false;
      protectButton.textContent = "Try again";
      statusMessage.textContent = response?.error ?? "Tracer could not protect this purchase.";
    },
  );
});

async function scanActiveTab(): Promise<void> {
  scanButton.disabled = true;
  protectButton.disabled = true;
  statusMessage.textContent = "Checking this tab for an order...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url?.startsWith("https://")) {
      throw new Error("Open an HTTPS store order confirmation page to protect it.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["genericCapture.js"],
    });

    const response = await sendScanMessage(tab.id);

    if (!response.ok || !response.draft || !response.summary) {
      throw new Error(response.error ?? "No order confirmation data found on this page.");
    }

    capturedDraft = response.draft;
    renderCapturedPurchase(response.summary);
    statusMessage.textContent = "Purchase found. Review the details and protect it.";
  } catch (error) {
    capturedDraft = null;
    purchasePanel.dataset.visible = "false";
    protectButton.disabled = true;
    protectButton.textContent = "Protect this purchase";
    statusMessage.textContent =
      error instanceof Error ? error.message : "Unable to scan this page.";
  } finally {
    scanButton.disabled = false;
  }
}

function renderCapturedPurchase(summary: NonNullable<ScanResponse["summary"]>): void {
  purchasePanel.dataset.visible = "true";
  retailerLabel.textContent = summary.retailerName;
  confidenceLabel.textContent = `${summary.confidence} confidence`;
  productName.textContent = summary.productName;
  totalPaid.textContent = summary.totalDisplay;
  itemCount.textContent = `${summary.itemCount} item${summary.itemCount === 1 ? "" : "s"}`;
  protectButton.disabled = false;
  protectButton.textContent = "Protect this purchase";
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
    chrome.runtime.sendMessage(
      { type: "TRACER_SYNC_OPPORTUNITIES" },
      (
        response?:
          | {
              ok: true;
              response: {
                protectedPurchaseCount: number;
                openOpportunityCount: number;
              };
            }
          | { ok: false; error?: string },
      ) => {
        if (response?.ok && response.response.openOpportunityCount > 0 && !capturedDraft) {
          statusMessage.textContent = `${response.response.openOpportunityCount} pay back opportunity waiting in your dashboard.`;
        }

        resolve();
      },
    );
  });
}
