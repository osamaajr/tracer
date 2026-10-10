import { parsePrice } from "../domain/money";
import type { Money } from "../domain/types";
import { receiptPriceText } from "./receiptText";

const amountPattern = /(?:(?:-\s*)?(?:£|\$|€|\b(?:GBP|USD|EUR)\b)\s*-?\s*\d[\d.,]*|-?\d[\d.,]*\s*\b(?:GBP|USD|EUR)\b)/gi;
const finalTotalLabel = /^(?:grand total|total paid|amount paid|amount charged|order total|total charged|total)\s*[:–]?\s*(?:\([A-Z]{3}\))?\s*:?\s*$/i;
const genericTotalLabel = /^total\s*[:–]?\s*(?:\([A-Z]{3}\))?\s*:?\s*$/i;

/** Only an explicitly labelled final charge is safe to present as the amount paid. */
export function extractOrderTotalPaid(
  document: Document,
  currency: string,
  structuredOrder?: Record<string, unknown> | null,
): Money | null {
  const candidates: Array<{ amount: Money; priority: number }> = [];
  const add = (value: string | number | undefined, label: string, explicit = false) => {
    const parsed = parsePrice(value, currency);
    if (parsed && parsed.currency === currency) {
      candidates.push({ amount: parsed, priority: explicit ? 4 : genericTotalLabel.test(label) ? 2 : 3 });
    }
  };
  for (const row of Array.from(document.querySelectorAll("tr, [role='row']"))) {
    if (row.closest("[hidden], [aria-hidden='true']")) continue;
    const cells = Array.from(row.children).filter((child) =>
      ["td", "th"].includes(child.tagName.toLowerCase()) ||
      ["cell", "rowheader"].includes(child.getAttribute("role") ?? ""),
    );
    if (cells.length < 2) continue;
    const label = receiptPriceText(cells[0]!);
    if (!finalTotalLabel.test(label)) continue;
    if (genericTotalLabel.test(label) && !isInTotalSummary(row)) continue;
    const amounts = receiptPriceText(cells.at(-1)!).match(amountPattern) ?? [];
    if (amounts.length !== 1) continue;
    add(amounts[0], label);
  }
  for (const element of Array.from(document.querySelectorAll(
    "[data-tracer-order-total], [data-order-total], [data-testid*='total' i], [data-test*='total' i], p, li, tr, dl, footer, div, span",
  ))) {
    const explicit = element.getAttribute("data-tracer-order-total") ?? element.getAttribute("data-order-total");
    if (element.closest("[hidden], [aria-hidden='true'], script, style, template")) continue;
    const text = receiptPriceText(element);
    const isExplicit = explicit !== null;
    const matches = Array.from(text.matchAll(amountPattern));
    // A container with several prices may include a subtotal or savings after
    // the actual total. Never infer a charge from that combined text.
    if ((!isExplicit || !explicit.trim()) && matches.length !== 1) continue;
    // Require the amount immediately after the complete label. In particular,
    // "Order total is inclusive of £3.66 in VAT" describes tax, not a charge.
    const label = text.slice(0, matches[0]?.index ?? text.length).trim();
    if (!isExplicit && !finalTotalLabel.test(label)) continue;
    if (!isExplicit && genericTotalLabel.test(label) && !isInTotalSummary(element)) continue;
    add(explicit?.trim() || matches[0]?.[0], label, isExplicit);
  }
  candidates.sort((left, right) => right.priority - left.priority);
  const strongest = candidates[0];
  if (strongest) {
    const peers = candidates.filter((candidate) => candidate.priority === strongest.priority);
    return peers.every((candidate) => candidate.amount.amountMinor === strongest.amount.amountMinor)
      ? strongest.amount : null;
  }

  if (structuredOrder) {
    if (typeof structuredOrder.priceCurrency === "string" && structuredOrder.priceCurrency.trim().toUpperCase() !== currency) return null;
    for (const value of [structuredOrder.amountPaid, structuredOrder.totalPrice, structuredOrder.price]) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      const parsed = parsePrice(value, currency);
      if (parsed && parsed.currency === currency) return parsed;
    }
  }
  return null;
}

function isInTotalSummary(element: Element): boolean {
  if (element.closest("[data-tracer-line-item], [class*='order-item' i], [class*='line-item' i]")) return false;
  for (let parent: Element | null = element; parent && parent.tagName.toLowerCase() !== "body"; parent = parent.parentElement) {
    const marker = [parent.getAttribute("aria-label"), parent.id, parent.getAttribute("class")]
      .filter(Boolean).join(" ");
    if (/\b(?:order[-\s]?total|grand[-\s]?total|summary|totals?)\b/i.test(marker)) return true;
    if (Array.from(parent.children).some((child) =>
      child.matches("h1, h2, h3, h4, [role='heading']") &&
      /^(?:(?:order|payment|purchase|receipt)\s+summary|order\s+totals?)$/i.test(receiptPriceText(child)),
    )) return true;
  }
  return false;
}
