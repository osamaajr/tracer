import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { gbp } from "@tracer/core";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("purchase capture final charge", () => {
  it("sends the final receipt total to the popup, without confusing it with VAT or the old price", async () => {
    vi.resetModules();
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const url = "https://urbanoutfitters.com/en-gb/checkout/order-confirmation";
    const document = parseHTML(`<html><head><title>Order Confirmation</title></head><body><main>
      <h1>Thank you for your order</h1><p>Order number TEST-100</p>
      <time datetime="2026-10-10T00:00:00.000Z">10 October 2026</time>
      <article class="order-item"><a href="/en-gb/shop/graphic-beanie"><h2>Graphic Beanie</h2></a>
        <p>Qty 1</p><span class="sale-price">£18.00</span><s class="price">£20.00</s>
      </article><section><h2>Order Summary</h2><div>
        <div><span>Subtotal</span><span>£18.00</span></div>
        <div><span>Delivery</span><span>£3.99</span></div>
        <div><strong>Total</strong><strong>£21.99</strong></div>
        <p>Order total is inclusive of £3.66 in VAT.</p>
      </div></section></main></body></html>`).document;
    let listener!: (message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean;
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { location: { href: url } });
    vi.stubGlobal("chrome", { runtime: { onMessage: {
      addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn(),
    } } });
    await import("../src/genericCapture");
    const respond = vi.fn();
    expect(listener({ type: "TRACER_SCAN_PAGE" }, {}, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      draft: expect.objectContaining({ orderTotalPaid: gbp(2199), lineItems: [expect.objectContaining({ pricePaid: gbp(1800) })] }),
      summary: expect.objectContaining({ totalDisplay: "£21.99" }),
    }));
  });
});
