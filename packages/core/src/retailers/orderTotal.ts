import { parsePrice } from "../domain/money";
import type { Money } from "../domain/types";

const amountPattern = /(?:(?:£|\$|€|\b(?:GBP|USD|EUR)\b)\s*\d[\d.,]*|\d[\d.,]*\s*\b(?:GBP|USD|EUR)\b)/gi;
const finalTotalLabel = /^(?:grand total|total paid|amount paid|amount charged|order total|total charged|total)\b/i;
const excludedTotalLabel = /^(?:total (?:savings?|discounts?|tax(?:es)?|shipping|delivery|items?|before)|subtotal)\b/i;

/** Only an explicitly labelled final charge is safe to present as the amount paid. */
export function extractOrderTotalPaid(
  document: Document,
  currency: string,
  structuredOrder?: Record<string, unknown> | null,
): Money | null {
  const candidates: Array<{ amount: Money; priority: number; position: number }> = [];
  let position = 0;
  for (const row of Array.from(document.querySelectorAll("tr, [role='row']"))) {
    const cells = Array.from(row.children).filter((child) =>
      ["td", "th"].includes(child.tagName.toLowerCase()) ||
      ["cell", "rowheader"].includes(child.getAttribute("role") ?? ""),
    );
    if (cells.length < 2) continue;
    const label = (cells[0]?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!finalTotalLabel.test(label) || excludedTotalLabel.test(label)) continue;
    if (/^total\b/i.test(label) && !/^(?:total paid|total charged|total due)\b/i.test(label) &&
      !isInTotalSummary(row)) continue;
    const amounts = (cells.at(-1)?.textContent ?? "").match(amountPattern) ?? [];
    if (amounts.length !== 1) continue;
    const parsed = parsePrice(amounts[0], currency);
    if (parsed && parsed.amountMinor > 0 && parsed.currency === currency) {
      candidates.push({ amount: parsed, priority: 5, position: position++ });
    }
  }
  for (const element of Array.from(document.querySelectorAll(
    "[data-tracer-order-total], [data-order-total], [data-testid*='total' i], [data-test*='total' i], p, li, tr, dl, footer, div, span",
  ))) {
    const explicit = element.getAttribute("data-tracer-order-total") ?? element.getAttribute("data-order-total");
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const isExplicit = explicit !== null;
    if (!isExplicit && (!finalTotalLabel.test(text) || excludedTotalLabel.test(text))) continue;
    if (!isExplicit && /^total\b/i.test(text) && !/^(?:total paid|total charged)\b/i.test(text) &&
      !isInTotalSummary(element)) continue;
    const matches = text.match(amountPattern) ?? [];
    // A container with several prices may include a subtotal or savings after
    // the actual total. Never infer a charge from that combined text.
    if (!isExplicit && matches.length !== 1) continue;
    const parsed = parsePrice(explicit || matches[0], currency);
    if (!parsed || parsed.currency !== currency) continue;
    const priority = isExplicit ? 4 : /^(?:grand total|total paid|amount paid|amount charged|total charged)/i.test(text) ? 3 : 2;
    candidates.push({ amount: parsed, priority, position: position++ });
  }
  candidates.sort((left, right) => right.priority - left.priority || right.position - left.position);
  if (candidates[0]) return candidates[0].amount;

  if (structuredOrder) {
    for (const value of [structuredOrder.totalPrice, structuredOrder.amountPaid, structuredOrder.price]) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      const parsed = parsePrice(value, currency);
      if (parsed && parsed.currency === currency) return parsed;
    }
  }
  return null;
}

function isInTotalSummary(element: Element): boolean {
  for (let parent: Element | null = element; parent && parent.tagName.toLowerCase() !== "body"; parent = parent.parentElement) {
    const marker = [parent.getAttribute("aria-label"), parent.id, parent.getAttribute("class")]
      .filter(Boolean).join(" ");
    if (/\b(?:order[-\s]?total|grand[-\s]?total|summary|totals?)\b/i.test(marker)) return true;
  }
  return false;
}
