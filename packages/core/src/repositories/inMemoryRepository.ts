import { createId } from "../domain/ids";
import type {
  ActivityEventCreateInput,
  ActivityEventRecord,
  ActivityEventWriteResult,
  AfterBuyRepository,
  LatestObservation,
  OpportunityCreateInput,
  OpportunityRecord,
  OpportunityStatus,
  OpportunityUpdateInput,
  PriceObservationCreateInput,
  PriceObservationRecord,
  ProductRecord,
  ProductUpsertInput,
  PurchaseCreateInput,
  PurchaseDetailsUpdateInput,
  PurchaseFingerprint,
  PurchaseRecord,
  UserMonitoringPreference,
} from "../domain/types";

export class InMemoryAfterBuyRepository implements AfterBuyRepository {
  private readonly products: ProductRecord[] = [];
  private readonly purchases: PurchaseRecord[] = [];
  private readonly observations: PriceObservationRecord[] = [];
  private readonly opportunities: OpportunityRecord[] = [];
  private readonly activityEvents: ActivityEventRecord[] = [];
  private readonly monitoringPreferences = new Map<string, UserMonitoringPreference>();

  async upsertProduct(input: ProductUpsertInput): Promise<ProductRecord> {
    const existing = this.products.find((product) => {
      const sameRetailer = product.retailerId === input.retailerId;
      if (!sameRetailer) return false;
      const sameExternalId =
        input.externalProductId && product.externalProductId === input.externalProductId;
      const sameSku = input.sku && product.sku === input.sku;
      const sameUrl = product.canonicalUrl === input.canonicalUrl;

      if (input.externalProductId && product.externalProductId) return Boolean(sameExternalId);
      if (input.sku && product.sku) return Boolean(sameSku);
      return sameUrl;
    });

    if (existing) {
      existing.name = input.name;
      existing.retailerName = input.retailerName;
      existing.storeHost = input.storeHost;
      existing.canonicalUrl = input.canonicalUrl;
      if (input.externalProductId) {
        existing.externalProductId = input.externalProductId;
      }
      if (input.sku) {
        existing.sku = input.sku;
      }
      if (input.imageUrl) {
        existing.imageUrl = input.imageUrl;
      }

      return existing;
    }

    const product: ProductRecord = {
      id: createId("prod"),
      retailerId: input.retailerId,
      retailerName: input.retailerName,
      storeHost: input.storeHost,
      name: input.name,
      canonicalUrl: input.canonicalUrl,
      firstSeenAt: input.seenAt,
      monitoringStatus: "active",
    };

    if (input.externalProductId) {
      product.externalProductId = input.externalProductId;
    }
    if (input.sku) {
      product.sku = input.sku;
    }
    if (input.imageUrl) {
      product.imageUrl = input.imageUrl;
    }

    this.products.push(product);
    return product;
  }

  async createPurchase(input: PurchaseCreateInput): Promise<PurchaseRecord> {
    const purchase: PurchaseRecord = {
      id: createId("pur"),
      protectionStatus: "active",
      ...input,
    };

    this.purchases.push(purchase);
    return purchase;
  }

  async findPurchaseByFingerprint(
    fingerprint: PurchaseFingerprint,
  ): Promise<PurchaseRecord | null> {
    return (
      this.purchases.find((purchase) => {
        const sameCore =
          purchase.userId === fingerprint.userId &&
          purchase.retailerId === fingerprint.retailerId &&
          purchase.productId === fingerprint.productId &&
          purchase.purchasedAt === fingerprint.purchasedAt;

        if (!sameCore) {
          return false;
        }

        if (fingerprint.orderReference) {
          return purchase.orderReference === fingerprint.orderReference;
        }

        return !purchase.orderReference;
      }) ?? null
    );
  }

  async listProductsForMonitoring(): Promise<ProductRecord[]> {
    const activeProductIds = new Set(
      this.purchases
        .filter(
          (purchase) =>
            purchase.protectionStatus === "active" &&
            this.isMonitoringEnabled(purchase.userId),
        )
        .map((purchase) => purchase.productId),
    );
    return this.products.filter((product) => activeProductIds.has(product.id));
  }

  async listProductsByIds(productIds: string[]): Promise<ProductRecord[]> {
    const ids = new Set(productIds);
    return this.products.filter((product) => ids.has(product.id));
  }

  async getMonitoringPreference(userId: string): Promise<UserMonitoringPreference> {
    return this.monitoringPreferences.get(userId) ?? {
      userId,
      enabled: true,
      updatedAt: new Date(0).toISOString(),
    };
  }

  async setMonitoringEnabled(
    userId: string,
    enabled: boolean,
    updatedAt: string,
  ): Promise<UserMonitoringPreference> {
    const preference = { userId, enabled, updatedAt };
    this.monitoringPreferences.set(userId, preference);
    return preference;
  }

  async recordPriceObservation(
    input: PriceObservationCreateInput,
  ): Promise<PriceObservationRecord> {
    const existing = this.observations.find(
      (observation) =>
        observation.productId === input.productId &&
        observation.observedAt === input.observedAt &&
        observation.price.amountMinor === input.price.amountMinor &&
        observation.price.currency === input.price.currency &&
        observation.availability === input.availability &&
        observation.sourceUrl === input.sourceUrl,
    );

    if (existing) {
      return existing;
    }

    const observation: PriceObservationRecord = {
      id: createId("obs"),
      ...input,
    };

    this.observations.push(observation);

    const product = this.products.find((candidate) => candidate.id === input.productId);
    if (product) {
      product.lastCheckedAt = input.observedAt;
      if (input.availability === "out_of_stock") {
        product.monitoringStatus = "unavailable";
      } else {
        product.monitoringStatus = "active";
      }
    }

    return observation;
  }

  async findLatestObservationForProduct(
    productId: string,
  ): Promise<PriceObservationRecord | null> {
    return (
      this.observations
        .filter((observation) => observation.productId === productId)
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0] ?? null
    );
  }

  async listActivePurchasesForProduct(productId: string): Promise<PurchaseRecord[]> {
    return this.purchases.filter(
      (purchase) =>
        purchase.productId === productId &&
        purchase.protectionStatus === "active" &&
        this.isMonitoringEnabled(purchase.userId),
    );
  }

  async findOpenOpportunityForPurchase(
    purchaseId: string,
  ): Promise<OpportunityRecord | null> {
    return (
      this.opportunities.find(
        (opportunity) =>
          opportunity.purchaseId === purchaseId &&
          (opportunity.status === "open" || opportunity.status === "viewed"),
      ) ?? null
    );
  }

  async createOpportunity(input: OpportunityCreateInput): Promise<OpportunityRecord> {
    const opportunity: OpportunityRecord = {
      id: createId("opp"),
      status: "open",
      ...input,
    };

    this.opportunities.push(opportunity);
    return opportunity;
  }

  async updateOpportunity(input: OpportunityUpdateInput): Promise<OpportunityRecord | null> {
    const opportunity =
      this.opportunities.find(
        (candidate) => candidate.id === input.opportunityId && candidate.userId === input.userId,
      ) ?? null;

    if (!opportunity) {
      return null;
    }

    opportunity.priceObservationId = input.priceObservationId;
    opportunity.currentPrice = input.currentPrice;
    opportunity.potentialSaving = input.potentialSaving;
    opportunity.title = input.title;
    opportunity.guidance = input.guidance;
    opportunity.claimUrl = input.claimUrl;
    opportunity.claimBy = input.claimBy;
    opportunity.statusUpdatedAt = input.statusUpdatedAt;

    return opportunity;
  }

  async findOpportunityByIdForUser(
    opportunityId: string,
    userId: string,
  ): Promise<OpportunityRecord | null> {
    return (
      this.opportunities.find(
        (opportunity) => opportunity.id === opportunityId && opportunity.userId === userId,
      ) ?? null
    );
  }

  async updateOpportunityStatus(
    opportunityId: string,
    userId: string,
    status: OpportunityStatus,
    statusUpdatedAt: string,
  ): Promise<OpportunityRecord | null> {
    const opportunity = this.opportunities.find(
      (candidate) => candidate.id === opportunityId && candidate.userId === userId,
    );

    if (!opportunity) {
      return null;
    }

    opportunity.status = status;
    opportunity.statusUpdatedAt = statusUpdatedAt;
    return opportunity;
  }

  async listPurchasesForUser(userId: string): Promise<PurchaseRecord[]> {
    return this.purchases.filter((purchase) => purchase.userId === userId);
  }

  async updatePurchaseDetailsForUser(
    purchaseId: string,
    userId: string,
    input: PurchaseDetailsUpdateInput,
  ): Promise<PurchaseRecord | null> {
    const purchase = this.purchases.find(
      (candidate) => candidate.id === purchaseId && candidate.userId === userId,
    );

    if (!purchase) {
      return null;
    }

    purchase.pricePaid = input.pricePaid;
    purchase.quantity = input.quantity;
    purchase.productName = input.productName;
    purchase.productUrl = input.productUrl;
    purchase.captureMethod = input.captureMethod;
    purchase.captureConfidence = input.captureConfidence;
    return purchase;
  }

  async deletePurchaseForUser(purchaseId: string, userId: string): Promise<boolean> {
    const purchaseIndex = this.purchases.findIndex(
      (purchase) => purchase.id === purchaseId && purchase.userId === userId,
    );

    if (purchaseIndex === -1) {
      return false;
    }

    const [purchase] = this.purchases.splice(purchaseIndex, 1);
    if (!purchase) {
      return false;
    }

    removeMatching(this.opportunities, (opportunity) => opportunity.purchaseId === purchaseId);
    removeMatching(this.activityEvents, (event) => event.purchaseId === purchaseId);

    if (!this.purchases.some((candidate) => candidate.productId === purchase.productId)) {
      removeMatching(this.products, (product) => product.id === purchase.productId);
      removeMatching(this.observations, (observation) => observation.productId === purchase.productId);
    }

    return true;
  }

  async listOpportunitiesForUser(userId: string): Promise<OpportunityRecord[]> {
    return this.opportunities.filter((opportunity) => opportunity.userId === userId);
  }

  async listLatestObservationsByProductIds(productIds: string[]): Promise<LatestObservation[]> {
    return productIds.flatMap((productId) => {
      const latest = this.observations
        .filter((observation) => observation.productId === productId)
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];

      return latest ? [{ productId, observation: latest }] : [];
    });
  }

  async recordActivityEvent(
    input: ActivityEventCreateInput,
  ): Promise<ActivityEventWriteResult> {
    if (input.dedupeKey) {
      const existing = this.activityEvents.find(
        (event) => event.dedupeKey === input.dedupeKey,
      );

      if (existing) {
        return { event: existing, created: false };
      }
    }

    const event: ActivityEventRecord = {
      id: createId("evt"),
      ...input,
      metadata: input.metadata ?? {},
    };

    this.activityEvents.push(event);
    return { event, created: true };
  }

  async listActivityEventsForPurchases(
    purchaseIds: string[],
    limitPerPurchase = 10,
  ): Promise<ActivityEventRecord[]> {
    return purchaseIds.flatMap((purchaseId) =>
      this.activityEvents
        .filter((event) => event.purchaseId === purchaseId)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, limitPerPurchase),
    );
  }

  private isMonitoringEnabled(userId: string): boolean {
    return this.monitoringPreferences.get(userId)?.enabled !== false;
  }
}

function removeMatching<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && predicate(item)) {
      items.splice(index, 1);
    }
  }
}
