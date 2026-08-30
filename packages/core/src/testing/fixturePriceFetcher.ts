import type { PriceFetcher, ProductPriceSnapshot, ProductRecord } from "../domain/types";

export class FixturePriceFetcher implements PriceFetcher {
  private readonly snapshotsByKey: Map<string, ProductPriceSnapshot>;

  constructor(snapshots: ProductPriceSnapshot[]) {
    this.snapshotsByKey = new Map(
      snapshots.flatMap((snapshot) => {
        const keys = [`${snapshot.retailerId}:${snapshot.productUrl}`];

        if (snapshot.externalProductId) {
          keys.push(`${snapshot.retailerId}:${snapshot.externalProductId}`);
        }

        return keys.map((key) => [key, snapshot]);
      }),
    );
  }

  async fetchCurrentPrice(product: ProductRecord): Promise<ProductPriceSnapshot> {
    const snapshot =
      (product.externalProductId &&
        this.snapshotsByKey.get(`${product.retailerId}:${product.externalProductId}`)) ||
      this.snapshotsByKey.get(`${product.retailerId}:${product.canonicalUrl}`);

    if (!snapshot) {
      throw new Error(`No fixture price snapshot for ${product.name}`);
    }

    return snapshot;
  }
}
