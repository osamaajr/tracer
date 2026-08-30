import { parseHTML } from "linkedom";
import {
  extractGenericProductFromDocument,
  extractJohnLewisProductFromDocument,
  type PriceFetcher,
  type ProductPriceSnapshot,
  type ProductRecord,
} from "@afterbuy/core";

const maxHtmlBytes = 2_000_000;
const requestTimeoutMs = 10_000;

export class HttpPriceFetcher implements PriceFetcher {
  async fetchCurrentPrice(product: ProductRecord): Promise<ProductPriceSnapshot> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(product.canonicalUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent":
            "TracerPriceMonitor/0.1 (+https://tracer.local; price-drop monitoring)",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Product page returned ${response.status}`);
      }

      const html = (await response.text()).slice(0, maxHtmlBytes);
      const document = parseHTML(html).document;
      const observedAt = new Date().toISOString();
      const snapshot =
        extractJohnLewisProductFromDocument(document, product.canonicalUrl, observedAt) ??
        extractGenericProductFromDocument(document, product.canonicalUrl, observedAt);

      if (!snapshot) {
        throw new Error("No product price could be extracted");
      }

      return {
        ...snapshot,
        retailerId: product.retailerId,
        retailerName: snapshot.retailerName ?? product.retailerName,
        storeHost: snapshot.storeHost ?? product.storeHost,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
