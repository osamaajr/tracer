import { createId } from "../domain/ids";
import type {
  AfterBuyRepository,
  LatestObservation,
  OpportunityCreateInput,
  OpportunityRecord,
  OpportunityStatus,
  PriceObservationCreateInput,
  PriceObservationRecord,
  ProductRecord,
  ProductUpsertInput,
  PurchaseCreateInput,
  PurchaseFingerprint,
  PurchaseRecord,
} from "../domain/types";

export class InMemoryAfterBuyRepository implements AfterBuyRepository {
  private readonly products: ProductRecord[] = [];
  private readonly purchases: PurchaseRecord[] = [];
  private readonly observations: PriceObservationRecord[] = [];
  private readonly opportunities: OpportunityRecord[] = [];

  async upsertProduct(input: ProductUpsertInput): Promise<ProductRecord> {
    const existing = this.products.find((product) => {
      const sameRetailer = product.retailerId === input.retailerId;
      const sameExternalId =
        input.externalProductId && product.externalProductId === input.externalProductId;
      const sameUrl = product.canonicalUrl === input.canonicalUrl;

      return sameRetailer && (sameExternalId || sameUrl);
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
    return this.products.filter((product) => product.monitoringStatus === "active");
  }

  async recordPriceObservation(
    input: PriceObservationCreateInput,
  ): Promise<PriceObservationRecord> {
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
      }
    }

    return observation;
  }

  async listActivePurchasesForProduct(productId: string): Promise<PurchaseRecord[]> {
    return this.purchases.filter(
      (purchase) => purchase.productId === productId && purchase.protectionStatus === "active",
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
}
