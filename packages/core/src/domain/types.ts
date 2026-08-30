export type RetailerId = string;

export type CurrencyCode = string;

export type CaptureMethod =
  | "retailer_adapter"
  | "generic_schema_org"
  | "generic_dom";

export type CaptureConfidence = "high" | "medium" | "low";

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export interface PurchaseLineItemDraft {
  productName: string;
  quantity: number;
  pricePaid: Money;
  productUrlConfidence?: CaptureConfidence;
  productUrl?: string;
  externalProductId?: string;
  sku?: string;
  imageUrl?: string;
}

export interface PurchaseDraft {
  retailerId: RetailerId;
  retailerName: string;
  storeHost: string;
  sourceUrl: string;
  purchasedAt: string;
  lineItems: PurchaseLineItemDraft[];
  captureMethod: CaptureMethod;
  captureConfidence: CaptureConfidence;
  orderReference?: string;
}

export interface ProductRecord {
  id: string;
  retailerId: RetailerId;
  retailerName: string;
  storeHost: string;
  name: string;
  canonicalUrl: string;
  externalProductId?: string;
  sku?: string;
  imageUrl?: string;
  firstSeenAt: string;
  lastCheckedAt?: string;
  monitoringStatus: "active" | "paused" | "unavailable";
}

export interface PurchaseRecord {
  id: string;
  userId: string;
  retailerId: RetailerId;
  retailerName: string;
  storeHost: string;
  productId: string;
  productName: string;
  productUrl: string;
  pricePaid: Money;
  quantity: number;
  purchasedAt: string;
  sourceUrl: string;
  createdAt: string;
  protectionStatus: "active" | "rejected" | "expired";
  captureMethod: CaptureMethod;
  captureConfidence: CaptureConfidence;
  orderReference?: string;
  externalProductId?: string;
}

export interface PriceObservationRecord {
  id: string;
  productId: string;
  retailerId: RetailerId;
  observedAt: string;
  price: Money;
  sourceUrl: string;
  availability: "in_stock" | "out_of_stock" | "unknown";
}

export interface ClaimRoute {
  label: string;
  url: string;
}

export interface RetailerPolicy {
  id: string;
  retailerId: RetailerId;
  version: string;
  effectiveFrom: string;
  lastVerifiedAt: string;
  eligibilityWindowDays: number;
  windowStartsAt: "order_placed";
  ownRetailerPriceDropsQualify: boolean;
  competitorPriceDropsQualify: boolean;
  claimRoute: ClaimRoute;
  sourceUrls: string[];
  consumerSummary: string;
  evidenceRequirements: string[];
  exclusions: string[];
}

export type OpportunityStatus =
  | "open"
  | "viewed"
  | "claim_clicked"
  | "dismissed"
  | "expired";

export interface OpportunityRecord {
  id: string;
  userId: string;
  retailerId: RetailerId;
  purchaseId: string;
  productId: string;
  priceObservationId: string;
  policyId: string;
  createdAt: string;
  claimBy: string;
  originalPrice: Money;
  currentPrice: Money;
  potentialSaving: Money;
  status: OpportunityStatus;
  statusUpdatedAt?: string;
  title: string;
  guidance: string;
  claimUrl: string;
}

export interface ProductPriceSnapshot {
  retailerId: RetailerId;
  retailerName?: string;
  storeHost?: string;
  productUrl: string;
  productName: string;
  price: Money;
  observedAt: string;
  availability: "in_stock" | "out_of_stock" | "unknown";
  externalProductId?: string;
  sku?: string;
  imageUrl?: string;
}

export interface ProductUpsertInput {
  retailerId: RetailerId;
  retailerName: string;
  storeHost: string;
  name: string;
  canonicalUrl: string;
  seenAt: string;
  externalProductId?: string;
  sku?: string;
  imageUrl?: string;
}

export interface PurchaseCreateInput {
  userId: string;
  retailerId: RetailerId;
  retailerName: string;
  storeHost: string;
  productId: string;
  productName: string;
  productUrl: string;
  pricePaid: Money;
  quantity: number;
  purchasedAt: string;
  sourceUrl: string;
  createdAt: string;
  captureMethod: CaptureMethod;
  captureConfidence: CaptureConfidence;
  orderReference?: string;
  externalProductId?: string;
}

export interface PriceObservationCreateInput {
  productId: string;
  retailerId: RetailerId;
  observedAt: string;
  price: Money;
  sourceUrl: string;
  availability: "in_stock" | "out_of_stock" | "unknown";
}

export interface OpportunityCreateInput {
  userId: string;
  retailerId: RetailerId;
  purchaseId: string;
  productId: string;
  priceObservationId: string;
  policyId: string;
  createdAt: string;
  claimBy: string;
  originalPrice: Money;
  currentPrice: Money;
  potentialSaving: Money;
  title: string;
  guidance: string;
  claimUrl: string;
}

export interface PurchaseFingerprint {
  userId: string;
  retailerId: RetailerId;
  productId: string;
  purchasedAt: string;
  orderReference?: string;
}

export interface LatestObservation {
  productId: string;
  observation: PriceObservationRecord;
}

export interface AfterBuyRepository {
  upsertProduct(input: ProductUpsertInput): Promise<ProductRecord>;
  createPurchase(input: PurchaseCreateInput): Promise<PurchaseRecord>;
  findPurchaseByFingerprint(
    fingerprint: PurchaseFingerprint,
  ): Promise<PurchaseRecord | null>;
  listProductsForMonitoring(now: string): Promise<ProductRecord[]>;
  recordPriceObservation(
    input: PriceObservationCreateInput,
  ): Promise<PriceObservationRecord>;
  listActivePurchasesForProduct(productId: string): Promise<PurchaseRecord[]>;
  findOpenOpportunityForPurchase(
    purchaseId: string,
  ): Promise<OpportunityRecord | null>;
  createOpportunity(input: OpportunityCreateInput): Promise<OpportunityRecord>;
  findOpportunityByIdForUser(
    opportunityId: string,
    userId: string,
  ): Promise<OpportunityRecord | null>;
  updateOpportunityStatus(
    opportunityId: string,
    userId: string,
    status: OpportunityStatus,
    statusUpdatedAt: string,
  ): Promise<OpportunityRecord | null>;
  listPurchasesForUser(userId: string): Promise<PurchaseRecord[]>;
  listOpportunitiesForUser(userId: string): Promise<OpportunityRecord[]>;
  listLatestObservationsByProductIds(
    productIds: string[],
  ): Promise<LatestObservation[]>;
}

export interface PriceFetcher {
  fetchCurrentPrice(product: ProductRecord): Promise<ProductPriceSnapshot>;
}
