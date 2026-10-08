import { extractSavedProduct, extractZaraSavedProduct } from "@tracer/core";

/** Read-only capture in an existing tab's extension isolated world. */
export async function readSavedMonitoringProduct() {
  const standard = extractSavedProduct(document, location.href, { includeImage: false });
  if (standard?.savedPrice || !/(^|\.)zara\.com$/i.test(location.hostname)) return standard;
  try {
    const url = new URL(location.href);
    url.searchParams.set("ajax", "true");
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return standard;
    return extractZaraSavedProduct(await response.json(), location.href) ?? standard;
  } catch { return standard; }
}
