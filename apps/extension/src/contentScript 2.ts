import { extractPurchaseFromDocument, type PurchaseDraft } from "@afterbuy/core";
import { extractPurchaseFromPage } from "./genericCapture";
import { populateConfetti } from "./confetti";

const rootId = "afterbuy-protect-root";
const draft = extractPurchaseFromDocument(document, window.location.href)
  ?? extractPurchaseFromPage(document, window.location.href);
if (draft) renderProtectPrompt(draft);

function renderProtectPrompt(purchaseDraft: PurchaseDraft): void {
  if (document.getElementById(rootId)) return;
  const root = document.createElement("div");
  root.id = rootId;
  document.documentElement.append(root);
  const shadow = root.attachShadow({ mode: "open" });
  // All markup here is static; purchase data is assigned with textContent below.
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel { position: fixed; top: 18px; right: 18px; width: 320px; max-width: calc(100vw - 24px); padding: 16px; border: 1px solid #eeece7; border-radius: 12px; background: #fffefd; color: #191916; font: 13px/1.4 Arial,sans-serif; box-shadow: 0 12px 40px #28251b18; z-index: 2147483647; }
      header { height: 32px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; margin-bottom: 15px; }
      .brand { display: flex; align-items: center; gap: 7px; font-size: 21px; font-weight: 750; letter-spacing: -.9px; }
      .brand svg { width: 24px; height: 24px; }
      button { cursor: pointer; font: inherit; }
      .settings { border: 0; background: transparent; padding: 4px; color: #777c7c; display: flex; }
      .settings svg { width: 17px; height: 17px; }
      .card { padding: 18px 10px 10px; text-align: center; position: relative; }
      .tick { display: flex; justify-content: center; align-items: center; border-radius: 50%; background: #edf5e9; color: #367432; width: 62px; height: 62px; margin: 0 auto 15px; box-shadow: inset 0 0 0 1px #e4efdf; }
      .tick svg { width: 32px; height: 32px; }
      h2 { font: 400 27px/1.12 Georgia,serif; letter-spacing: -.75px; margin: 0; }
      .product { font-size: 13px; line-height: 1.35; margin: 7px auto 0; max-width: 245px; overflow-wrap: anywhere; }
      .copy { border-top: 1px solid #eceae5; margin: 20px 0 16px; padding-top: 14px; color: #71777b; font-size: 13px; line-height: 1.45; }
      .primary { width: 100%; min-height: 46px; padding: 11px 6px; border: 0; border-radius: 8px; background: #181b17; color: white; font-weight: 600; box-shadow: 0 3px 8px #00000018; }
      .primary:disabled { opacity: .6; cursor: wait; }
      button:focus-visible { outline: 2px solid #367432; outline-offset: 3px; }
      .menu { display: grid; gap: 8px; padding-top: 12px; } .menu[hidden] { display: none; }
      .menu button { background: #f6f5f1; padding: 9px; border: 0; border-radius: 6px; }
      .confetti { display: none; position: absolute; inset: 16px 0 auto; pointer-events: none; }
      .celebrate .confetti { display: block; }
      .confetti i { position: absolute; left: 50%; top: 28px; width: 5px; height: 8px; background: var(--tone); border-radius: 1px; animation: burst 1300ms ease-out both; }
      @keyframes burst { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 65% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--tx),var(--ty)) rotate(calc(var(--r) + 230deg)); } }
      @media (prefers-reduced-motion: reduce) { .confetti { display: none !important; } }
    </style>
    <section class="panel" aria-label="Tracer purchase protection">
      <header><span class="brand"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="m2 9 6-3 7 19Z" fill="#191916"/><path d="m9 5 8-2-1 22Z" fill="#090b09"/><path d="m19 6 7 4-9 15Z" fill="#292c28"/></svg>tracer</span>
        <button class="settings" aria-label="Settings" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h5l1-3 3-2v-3l2-2-2-4-3-1-1-3Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11.5" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
      </header>
      <div class="card" aria-live="polite">
        <div class="confetti" aria-hidden="true"></div>
        <span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12.4 4 4L18.4 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <h2>Purchase found</h2><p class="product"></p>
        <p class="copy">Ready to protect this purchase<br>and start monitoring.</p>
        <button class="primary">Protect this purchase</button>
      </div>
      <div class="menu" hidden><button class="dashboard">Go to dashboard</button><button class="dismiss">Dismiss this card</button></div>
    </section>`;
  const find = <T extends HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
  const card = find(".card");
  const heading = find("h2");
  const copy = find(".copy");
  const button = find<HTMLButtonElement>(".primary");
  find(".product").textContent = purchaseDraft.lineItems[0]?.productName ?? `${purchaseDraft.retailerName} purchase`;
  populateConfetti(find(".confetti"));
  let protectedPurchase = false;
  async function openDashboard(): Promise<void> {
    const stored = await chrome.storage.sync.get("dashboardBaseUrl");
    const url = typeof stored.dashboardBaseUrl === "string" ? stored.dashboardBaseUrl : "http://127.0.0.1:5173";
    window.open(`${url.replace(/\/$/, "")}/dashboard`, "_blank", "noopener,noreferrer");
  }
  find(".settings").addEventListener("click", () => {
    const menu = find(".menu");
    menu.hidden = !menu.hidden;
    find(".settings").setAttribute("aria-expanded", String(!menu.hidden));
  });
  find(".dismiss").addEventListener("click", () => root.remove());
  find(".dashboard").addEventListener("click", () => { void openDashboard(); });
  button.addEventListener("click", () => {
    if (protectedPurchase) { void openDashboard(); return; }
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Protecting...";
    chrome.runtime.sendMessage({ type: "AFTERBUY_PROTECT_PURCHASE", purchaseDraft }, (result?: {
      ok: boolean; error?: string; response?: { accepted: Array<{ status: string }>; rejected: Array<{ reason: string }> };
    }) => {
      const runtimeError = chrome.runtime.lastError;
      button.disabled = false;
      const accepted = result?.response?.accepted ?? [];
      if (runtimeError || !result?.ok || accepted.length === 0) {
        copy.textContent = runtimeError?.message ?? result?.error ?? result?.response?.rejected[0]?.reason ?? "Could not protect this purchase. Please try again.";
        button.textContent = "Try again";
        return;
      }
      protectedPurchase = true;
      const newlyProtected = accepted.some(item => item.status === "created");
      heading.textContent = newlyProtected ? "Purchase protected" : "Already protected";
      copy.textContent = "We’re now watching for price drops. We’ll let you know when it changes.";
      button.textContent = "Go to dashboard";
      if (newlyProtected) {
        card.classList.add("celebrate");
        window.setTimeout(() => card.classList.remove("celebrate"), 1500);
      }
    });
  });
}
