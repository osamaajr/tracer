import {
  FixturePriceFetcher,
  gbp,
  type PriceFetcher,
  type ProductPriceSnapshot,
} from "@afterbuy/core";

const johnLewisHeadphonesDrop: ProductPriceSnapshot = {
  retailerId: "john-lewis",
  productUrl:
    "https://www.johnlewis.com/sony-wh-1000xm6-wireless-bluetooth-noise-cancelling-headphones-black/p1122334",
  productName:
    "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones, Black",
  externalProductId: "p1122334",
  sku: "JL-SNY-XM6-BLK",
  observedAt: "2026-09-01T08:00:00.000Z",
  price: gbp(31_900),
  availability: "in_stock",
};

export function createDevFixturePriceFetcher(now: string = new Date().toISOString()): PriceFetcher {
  return new FixturePriceFetcher([
    {
      ...johnLewisHeadphonesDrop,
      observedAt: now,
    },
  ]);
}
