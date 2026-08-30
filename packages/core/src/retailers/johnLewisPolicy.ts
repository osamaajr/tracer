import type { RetailerPolicy } from "../domain/types";

export const johnLewisPricePromisePolicy: RetailerPolicy = {
  id: "john-lewis-price-promise-2024-10-15",
  retailerId: "john-lewis",
  version: "2024-10-15",
  effectiveFrom: "2024-10-15",
  lastVerifiedAt: "2026-08-30",
  eligibilityWindowDays: 7,
  windowStartsAt: "order_placed",
  ownRetailerPriceDropsQualify: true,
  competitorPriceDropsQualify: true,
  claimRoute: {
    label: "Request a Price Promise refund",
    url: "https://www.johnlewis.com/customer-services/prices-and-payment/price-promise/request",
  },
  sourceUrls: [
    "https://www.johnlewis.com/customer-services/prices-and-payment/prices-at-john-lewis",
    "https://www.johnlewis.com/customer-services/prices-and-payment/price-promise",
    "https://www.johnlewis.com/customer-services/prices-and-payment/price-promise/request",
  ],
  consumerSummary:
    "John Lewis says eligible purchases can be price matched against its own lower prices and listed competitors within 7 days of placing the order, subject to the Price Promise terms.",
  evidenceRequirements: [
    "Original order details or receipt",
    "Evidence of the lower price that John Lewis can verify",
    "Confirmation that the lower-price item is identical and in stock",
  ],
  exclusions: [
    "Third-party marketplace sellers",
    "Reduced-to-clear or final-reduction prices",
    "Multi-buy offers",
    "Member-only prices",
    "Flash sales",
    "Voucher, discount-code, exclusive, trade, or obvious-error prices",
    "Selected services, concessions, and excluded product categories",
  ],
};
