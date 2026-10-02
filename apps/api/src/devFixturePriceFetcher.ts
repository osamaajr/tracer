import {
  FixturePriceFetcher,
  gbp,
  type PriceFetcher,
  type ProductPriceSnapshot,
} from "@tracer/core";

type DevFixturePriceVariant = "paid" | "dropped";

const trailPackFixture: ProductPriceSnapshot = {
  retailerId: "store_shop-example-com",
  retailerName: "Shop",
  storeHost: "shop.example.com",
  productUrl: "https://shop.example.com/products/trail-pack-24l-moss-green",
  productName: "Trail Pack 24L, Moss Green",
  externalProductId: "acme-pack-24-moss",
  sku: "TP24-MOSS",
  observedAt: "2026-09-01T08:00:00.000Z",
  price: gbp(8_450),
  availability: "in_stock",
};

export function createDevFixturePriceFetcher(
  _now: string = new Date().toISOString(),
  variant: DevFixturePriceVariant = "dropped",
): PriceFetcher {
  return new FixturePriceFetcher([
    {
      ...trailPackFixture,
      observedAt:
        variant === "paid"
          ? "2026-09-01T08:00:00.000Z"
          : "2026-09-02T08:00:00.000Z",
      price: variant === "paid" ? gbp(8_450) : gbp(6_950),
    },
  ]);
}
