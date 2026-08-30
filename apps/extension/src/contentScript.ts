import {
  extractPurchaseFromDocument,
  formatMoney,
  type PurchaseDraft,
} from "@afterbuy/core";

const rootId = "afterbuy-protect-root";

const draft = extractPurchaseFromDocument(document, window.location.href);

if (draft) {
  renderProtectPrompt(draft);
}

function renderProtectPrompt(purchaseDraft: PurchaseDraft): void {
  if (document.getElementById(rootId)) {
    return;
  }

  const root = document.createElement("div");
  root.id = rootId;
  document.documentElement.append(root);

  const shadow = root.attachShadow({ mode: "open" });
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Tracer purchase protection");

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    section {
      background: #ffffff;
      border: 1px solid #e4e4df;
      border-radius: 8px;
      box-shadow: 0 20px 60px rgb(24 25 23 / 18%);
      color: #050505;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: min(380px, calc(100vw - 32px));
      padding: 18px;
      position: fixed;
      right: 18px;
      top: 18px;
      z-index: 2147483647;
    }

    .topline {
      align-items: center;
      display: flex;
      font-size: 0.82rem;
      font-weight: 800;
      gap: 10px;
      margin-bottom: 12px;
      text-transform: uppercase;
    }

    .mark {
      align-items: center;
      background: #050505;
      border-radius: 8px;
      color: white;
      display: inline-flex;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    h2,
    p {
      margin: 0;
    }

    h2 {
      font-size: 1.2rem;
      letter-spacing: 0;
      line-height: 1.2;
    }

    p {
      color: #64645f;
      line-height: 1.45;
      margin-top: 8px;
    }

    .product {
      background: #f7f7f4;
      border: 1px solid #e7e7e2;
      border-radius: 8px;
      margin-top: 14px;
      padding: 12px;
    }

    .product strong {
      display: block;
      line-height: 1.3;
    }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    button {
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-weight: 800;
      min-height: 40px;
      padding: 0 14px;
    }

    .protect {
      background: #050505;
      color: white;
      flex: 1;
    }

    .dismiss {
      background: transparent;
      color: #64645f;
    }

    .status {
      color: #050505;
      font-weight: 750;
    }

    @media (max-width: 520px) {
      section {
        left: 12px;
        right: 12px;
        top: 12px;
      }
    }
  `;

  const firstItem = purchaseDraft.lineItems[0];
  const product = document.createElement("div");
  product.className = "product";

  const title = document.createElement("strong");
  title.textContent = firstItem?.productName ?? `${purchaseDraft.retailerName} purchase`;

  const paid = document.createElement("span");
  paid.textContent = firstItem ? `You paid ${formatMoney(firstItem.pricePaid)}` : "";

  product.append(title, paid);

  const topLine = document.createElement("div");
  topLine.className = "topline";
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = "T";
  const label = document.createElement("span");
  label.textContent = "Tracer";
  topLine.append(mark, label);

  const heading = document.createElement("h2");
  heading.textContent = "Protect this purchase?";

  const body = document.createElement("p");
  body.textContent =
    "Tracer found this order and can watch the product price. Policy-aware alerts are available where retailer rules are verified.";

  const status = document.createElement("p");
  status.className = "status";

  const protectButton = document.createElement("button");
  protectButton.className = "protect";
  protectButton.type = "button";
  protectButton.textContent = "Protect purchase";

  const dismissButton = document.createElement("button");
  dismissButton.className = "dismiss";
  dismissButton.type = "button";
  dismissButton.textContent = "Not now";

  dismissButton.addEventListener("click", () => root.remove());
  protectButton.addEventListener("click", () => {
    protectButton.disabled = true;
    protectButton.textContent = "Protecting...";
    status.textContent = "";

    chrome.runtime.sendMessage(
      {
        type: "AFTERBUY_PROTECT_PURCHASE",
        purchaseDraft,
      },
      (response: { ok: boolean; error?: string }) => {
        if (response?.ok) {
          protectButton.textContent = "Protected";
          status.textContent = "Tracer will watch this product for useful drops.";
          return;
        }

        protectButton.disabled = false;
        protectButton.textContent = "Try again";
        status.textContent = response?.error ?? "Tracer could not protect this purchase.";
      },
    );
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(protectButton, dismissButton);

  panel.append(style, topLine, heading, body, product, actions, status);
  shadow.append(panel);
}
