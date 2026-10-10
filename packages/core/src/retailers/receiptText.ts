/** Price text excludes previous prices and hidden copies of receipt amounts. */
export function receiptPriceText(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (isExcluded(node)) return "";
  }
  return readSubtree(element).replace(/\s+/g, " ").trim();
}

function readSubtree(element: Element): string {
  if (isExcluded(element)) return "";
  return Array.from(element.childNodes).map((node) => node.nodeType === 1
    ? readSubtree(node as Element) : node.textContent ?? "").join(" ");
}

function isExcluded(element: Element): boolean {
  return element.matches("s, del, strike, script, style, template, [hidden], [aria-hidden='true']") ||
    /(?:text-decoration(?:-line)?\s*:[^;]*line-through|display\s*:\s*none|visibility\s*:\s*hidden)/i.test(element.getAttribute("style") ?? "") ||
    /(?:old|original|was|compare[-_ ]?at)[-_ ]*price|price[-_ ]*(?:old|original|was|compare[-_ ]?at)/i.test(element.getAttribute("class") ?? "");
}
