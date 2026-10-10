import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractOrderTotalPaid, extractPurchaseFromDocument, findProtectedPurchaseForDraft, gbp, InMemoryTracerRepository, protectPurchase } from "../index";

function receipt(html: string): Document {
  return parseHTML(`<html><head><title>Order confirmation</title></head><body><main>${html}</main></body></html>`).document;
}

describe("receipt final charge", () => {
  it("does not mistake the VAT-included note for the order total", () => {
    const document = receipt(`
      <section class="order-summary">
        <div><span>Subtotal</span><span>£18.00</span></div>
        <div><span>Delivery</span><span>£3.99</span></div>
        <div><strong>Total</strong><strong>£21.99</strong></div>
        <p>Order total is inclusive of £3.66 in VAT.</p>
      </section>`);
    expect(extractOrderTotalPaid(document, "GBP")).toEqual(gbp(2199));
  });

  it("recognizes a summary heading without relying on retailer classes", () => {
    const document = receipt(`
      <section><h2>Order Summary</h2><div>
        <div><span>Subtotal</span><span>£18.00</span></div>
        <div><span>Delivery</span><span>£3.99</span></div>
        <div><strong>Total</strong><strong>£21.99</strong></div>
        <p>Order total is inclusive of £3.66 in VAT.</p>
      </div></section>`);
    expect(extractOrderTotalPaid(document, "GBP")).toEqual(gbp(2199));
  });

  it.each([
    "Order total is inclusive of £3.66 in VAT.",
    "Total savings £2.00",
    "Total before discounts £20.00",
    "Total excluding delivery £18.00",
    "Total tax £3.66",
    "Total due £21.99",
  ])("does not report an explanatory or unpaid amount as paid: %s", (text) => {
    expect(extractOrderTotalPaid(receipt(`<section class="order-summary"><p>${text}</p></section>`), "GBP")).toBeNull();
  });

  it("fails closed when equally strong final charges disagree", () => {
    expect(extractOrderTotalPaid(receipt(`<section class="order-summary"><p>Total £21.99</p><p>Total £18.00</p></section>`), "GBP")).toBeNull();
  });

  it("accepts repeated agreeing totals and preserves shipping, discounts and fees", () => {
    expect(extractOrderTotalPaid(receipt(`<section class="order-summary">
      <p>Subtotal £40.00</p><p>Discount -£5.00</p><p>Delivery £3.99</p><p>Fee £1.00</p>
      <p>Total £39.99</p><p>Total £39.99</p><p>Total savings £5.00</p>
    </section>`), "GBP")).toEqual(gbp(3999));
  });

  it("reads numeric total attributes and empty markers containing one amount", () => {
    expect(extractOrderTotalPaid(receipt('<div data-order-total="21.99"></div>'), "GBP")).toEqual(gbp(2199));
    expect(extractOrderTotalPaid(receipt('<div data-order-total><span>£21.99</span></div>'), "GBP")).toEqual(gbp(2199));
    expect(extractOrderTotalPaid(receipt('<div data-order-total>Subtotal £18.00 Total £21.99</div>'), "GBP")).toBeNull();
  });

  it("keeps the sale item price separate from the complete charge on a confirmation", () => {
    const document = receipt(`
      <h1>Thank you for your order</h1>
      <article class="order-item">
        <a href="/en-gb/shop/graphic-beanie"><h2>Graphic Beanie</h2></a>
        <p>Qty 1</p><span class="old-price"><s>£20.00</s></span><span class="sale-price">£18.00</span>
      </article>
      <section class="order-summary">
        <div><span>Subtotal</span><span>£18.00</span></div>
        <div><span>Delivery</span><span>£3.99</span></div>
        <div><strong>Total</strong><strong>£21.99</strong></div>
        <p>Order total is inclusive of £3.66 in VAT.</p>
      </section>`);
    const draft = extractPurchaseFromDocument(document, "https://urbanoutfitters.com/en-gb/checkout/order-confirmation");
    expect(draft?.lineItems[0]?.pricePaid).toEqual(gbp(1800));
    expect(draft?.orderTotalPaid).toEqual(gbp(2199));
  });

  it.each([
    '<s>£20.00</s>',
    '<span class="old-price">£20.00</span>',
    '<span style="text-decoration: line-through">£20.00</span>',
    '<span hidden><span class="price">£20.00</span></span>',
  ])("ignores a previous or hidden price even when it appears after the sale price: %s", (oldPrice) => {
    const draft = extractPurchaseFromDocument(receipt(`
      <h1>Thank you for your order</h1>
      <article class="order-item"><a href="/shop/beanie"><h2>Graphic Beanie</h2></a>
      <p>Qty 1</p><div class="price"><span class="sale-price">£18.00</span>${oldPrice}</div></article>
      <section class="order-summary"><p>Total £21.99</p></section>
    `), "https://example-shop.com/checkout/order-confirmation");
    expect(draft?.lineItems[0]?.pricePaid).toEqual(gbp(1800));
    expect(draft?.orderTotalPaid).toEqual(gbp(2199));
  });

  it("does not accept a line total as a final order charge", () => {
    expect(extractOrderTotalPaid(receipt(`<section class="order-summary"><article class="order-item"><p>Total £18.00</p></article></section>`), "GBP")).toBeNull();
  });

  it("ignores a hidden desktop copy that disagrees with the visible receipt", () => {
    expect(extractOrderTotalPaid(receipt(`<section class="order-summary"><p>Total £21.99</p><div hidden><p>Total £20.00</p></div></section>`), "GBP")).toEqual(gbp(2199));
  });

  it("only accepts a bare total in a summary even when the label includes currency", () => {
    expect(extractOrderTotalPaid(receipt('<p>Total (GBP): £18.00</p>'), "GBP")).toBeNull();
    expect(extractOrderTotalPaid(receipt('<section class="order-summary"><p>Total (GBP): £21.99</p></section>'), "GBP")).toEqual(gbp(2199));
  });

  it.each(["Total -£21.99", "Total £-21.99", "Total -21.99 GBP"])("rejects negative final charges instead of dropping their sign: %s", (text) => {
    expect(extractOrderTotalPaid(receipt(`<section class="order-summary"><p>${text}</p></section>`), "GBP")).toBeNull();
  });

  it("keeps final charges in the expected currency", () => {
    expect(extractOrderTotalPaid(receipt('<p>Amount paid €21.99</p>'), "GBP")).toBeNull();
    expect(extractOrderTotalPaid(receipt(''), "GBP", { price: 21.99, priceCurrency: "EUR" })).toBeNull();
  });

  it("keeps an ordinary undiscounted price and divides only a labelled line total", () => {
    const draft = extractPurchaseFromDocument(receipt(`
      <h1>Thank you for your order</h1><section class="order-items">
        <article class="order-item"><h2>Canvas Hat</h2><a href="/shop/hat">View product</a><span class="regular-price">£20.00</span></article>
        <article class="order-item"><h2>Graphic Beanie</h2><a href="/shop/beanie">View product</a><p>Qty 2</p>
          <span data-line-total><s>£40.00</s> £36.00</span></article>
      </section><section class="order-summary"><p>Total £59.99</p></section>
    `), "https://example-shop.com/checkout/order-confirmation");
    expect(draft?.lineItems.map((item) => [item.quantity, item.pricePaid.amountMinor])).toEqual([[1, 2000], [2, 1800]]);
    expect(draft?.orderTotalPaid).toEqual(gbp(5999));
  });

  it("uses the paid unit price in labelled receipt cells with crossed-out prices", () => {
    const draft = extractPurchaseFromDocument(receipt(`
      <h1>Thank you for your order</h1><article class="order-item"><h2>Graphic Beanie</h2><a href="/shop/beanie">View product</a>
        <p>Qty 2</p><div data-label="Unit price"><s>£20.00</s> £18.00</div><div data-line-total>£36.00</div>
      </article><section class="order-summary"><p>Total £39.99</p></section>
    `), "https://example-shop.com/checkout/order-confirmation");
    expect(draft?.lineItems[0]).toMatchObject({ quantity: 2, pricePaid: gbp(1800) });
  });

  it("corrects an already protected order's mistaken VAT total without creating another purchase", async () => {
    const draft = extractPurchaseFromDocument(receipt(`
      <h1>Thank you for your order</h1><p>Order number TEST-100</p>
      <time datetime="2026-10-10T00:00:00.000Z">10 October</time>
      <article class="order-item"><h2>Graphic Beanie</h2><a href="/shop/beanie">View product</a><span class="price">£18.00</span></article>
      <section class="order-summary"><p>Total £21.99</p><p>Order total is inclusive of £3.66 in VAT.</p></section>
    `), "https://example-shop.com/checkout/order-confirmation")!;
    const repository = new InMemoryTracerRepository();
    const initial = await protectPurchase(repository, { userId: "receipt-user", draft: { ...draft, orderTotalPaid: gbp(366) } });
    const result = await findProtectedPurchaseForDraft(repository, { userId: "receipt-user", draft });
    expect(result).toMatchObject({ protected: true, purchase: {
      id: initial.accepted[0]!.purchase.id,
      pricePaid: gbp(1800), orderTotalPaid: gbp(2199),
    } });
    expect(await repository.listPurchasesForUser("receipt-user")).toHaveLength(1);
  });
});
