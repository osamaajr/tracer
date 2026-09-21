import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createId,
  type ActivityEventCreateInput,
  type ActivityEventRecord,
  type ActivityEventWriteResult,
  type AfterBuyRepository,
  type LatestObservation,
  type OpportunityCreateInput,
  type OpportunityRecord,
  type OpportunityStatus,
  type OpportunityUpdateInput,
  type PriceObservationCreateInput,
  type PriceObservationRecord,
  type ProductRecord,
  type ProductUpsertInput,
  type PurchaseCreateInput,
  type PurchaseDetailsUpdateInput,
  type PurchaseFingerprint,
  type PurchaseRecord,
  type UserMonitoringPreference,
} from "@afterbuy/core";

interface StoreState {
  products: ProductRecord[];
  purchases: PurchaseRecord[];
  observations: PriceObservationRecord[];
  opportunities: OpportunityRecord[];
  activityEvents: ActivityEventRecord[];
  monitoringPreferences: UserMonitoringPreference[];
}

const emptyStore: StoreState = {
  products: [],
  purchases: [],
  observations: [],
  opportunities: [],
  activityEvents: [],
  monitoringPreferences: [],
};

export class FileAfterBuyRepository implements AfterBuyRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async upsertProduct(input: ProductUpsertInput): Promise<ProductRecord> {
    return this.mutate((state) => {
      const existing = state.products.find((product) => {
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
        existing.monitoringStatus = "active";
        if (input.externalProductId) {
          existing.externalProductId = input.externalProductId;
        }
        if (input.sku) {
          existing.sku = input.sku;
        }
        if (input.imageUrl) {
          existing.imageUrl = input.imageUrl;
        }

        return clone(existing);
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

      state.products.push(product);
      return clone(product);
    });
  }

  async createPurchase(input: PurchaseCreateInput): Promise<PurchaseRecord> {
    return this.mutate((state) => {
      const purchase: PurchaseRecord = {
        id: createId("pur"),
        protectionStatus: "active",
        ...input,
      };

      state.purchases.push(purchase);
      return clone(purchase);
    });
  }

  async findPurchaseByFingerprint(
    fingerprint: PurchaseFingerprint,
  ): Promise<PurchaseRecord | null> {
    const state = await this.read();
    const purchase =
      state.purchases.find((candidate) => {
        const sameCore =
          candidate.userId === fingerprint.userId &&
          candidate.retailerId === fingerprint.retailerId &&
          candidate.productId === fingerprint.productId &&
          candidate.purchasedAt === fingerprint.purchasedAt;

        if (!sameCore) {
          return false;
        }

        if (fingerprint.orderReference) {
          return candidate.orderReference === fingerprint.orderReference;
        }

        return !candidate.orderReference;
      }) ?? null;

    return clone(purchase);
  }

  async listProductsForMonitoring(): Promise<ProductRecord[]> {
    const state = await this.read();
    const activeProductIds = new Set(
      state.purchases
        .filter(
          (purchase) =>
            purchase.protectionStatus === "active" &&
            isMonitoringEnabled(state, purchase.userId),
        )
        .map((purchase) => purchase.productId),
    );
    return clone(state.products.filter((product) => activeProductIds.has(product.id)));
  }

  async listProductsByIds(productIds: string[]): Promise<ProductRecord[]> {
    const state = await this.read();
    const ids = new Set(productIds);
    return clone(state.products.filter((product) => ids.has(product.id)));
  }

  async getMonitoringPreference(userId: string): Promise<UserMonitoringPreference> {
    const state = await this.read();
    return clone(
      state.monitoringPreferences.find((preference) => preference.userId === userId) ?? {
        userId,
        enabled: true,
        updatedAt: new Date(0).toISOString(),
      },
    );
  }

  async setMonitoringEnabled(
    userId: string,
    enabled: boolean,
    updatedAt: string,
  ): Promise<UserMonitoringPreference> {
    return this.mutate((state) => {
      const existing = state.monitoringPreferences.find(
        (preference) => preference.userId === userId,
      );
      if (existing) {
        existing.enabled = enabled;
        existing.updatedAt = updatedAt;
        return clone(existing);
      }

      const preference = { userId, enabled, updatedAt };
      state.monitoringPreferences.push(preference);
      return clone(preference);
    });
  }

  async recordPriceObservation(
    input: PriceObservationCreateInput,
  ): Promise<PriceObservationRecord> {
    return this.mutate((state) => {
      const existing = state.observations.find(
        (observation) =>
          observation.productId === input.productId &&
          observation.observedAt === input.observedAt &&
          observation.price.amountMinor === input.price.amountMinor &&
          observation.price.currency === input.price.currency &&
          observation.availability === input.availability &&
          observation.sourceUrl === input.sourceUrl,
      );

      if (existing) {
        return clone(existing);
      }

      const observation: PriceObservationRecord = {
        id: createId("obs"),
        ...input,
      };

      state.observations.push(observation);

      const product = state.products.find((candidate) => candidate.id === input.productId);
      if (product) {
        product.lastCheckedAt = input.observedAt;
        if (input.availability === "out_of_stock") {
          product.monitoringStatus = "unavailable";
        } else {
          product.monitoringStatus = "active";
        }
      }

      return clone(observation);
    });
  }

  async findLatestObservationForProduct(
    productId: string,
  ): Promise<PriceObservationRecord | null> {
    const state = await this.read();
    const observation =
      state.observations
        .filter((candidate) => candidate.productId === productId)
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0] ?? null;

    return clone(observation);
  }

  async listActivePurchasesForProduct(productId: string): Promise<PurchaseRecord[]> {
    const state = await this.read();
    return clone(
      state.purchases.filter(
        (purchase) =>
          purchase.productId === productId &&
          purchase.protectionStatus === "active" &&
          isMonitoringEnabled(state, purchase.userId),
      ),
    );
  }

  async findOpenOpportunityForPurchase(
    purchaseId: string,
  ): Promise<OpportunityRecord | null> {
    const state = await this.read();
    const opportunity =
      state.opportunities.find(
        (candidate) =>
          candidate.purchaseId === purchaseId &&
          (candidate.status === "open" || candidate.status === "viewed"),
      ) ?? null;

    return clone(opportunity);
  }

  async createOpportunity(input: OpportunityCreateInput): Promise<OpportunityRecord> {
    return this.mutate((state) => {
      const opportunity: OpportunityRecord = {
        id: createId("opp"),
        status: "open",
        ...input,
      };

      state.opportunities.push(opportunity);
      return clone(opportunity);
    });
  }

  async updateOpportunity(input: OpportunityUpdateInput): Promise<OpportunityRecord | null> {
    return this.mutate((state) => {
      const opportunity =
        state.opportunities.find(
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

      return clone(opportunity);
    });
  }

  async findOpportunityByIdForUser(
    opportunityId: string,
    userId: string,
  ): Promise<OpportunityRecord | null> {
    const state = await this.read();
    const opportunity =
      state.opportunities.find(
        (candidate) => candidate.id === opportunityId && candidate.userId === userId,
      ) ?? null;

    return clone(opportunity);
  }

  async updateOpportunityStatus(
    opportunityId: string,
    userId: string,
    status: OpportunityStatus,
    statusUpdatedAt: string,
  ): Promise<OpportunityRecord | null> {
    return this.mutate((state) => {
      const opportunity =
        state.opportunities.find(
          (candidate) => candidate.id === opportunityId && candidate.userId === userId,
        ) ?? null;

      if (!opportunity) {
        return null;
      }

      opportunity.status = status;
      opportunity.statusUpdatedAt = statusUpdatedAt;
      return clone(opportunity);
    });
  }

  async listPurchasesForUser(userId: string): Promise<PurchaseRecord[]> {
    const state = await this.read();
    return clone(state.purchases.filter((purchase) => purchase.userId === userId));
  }

  async updatePurchaseDetailsForUser(
    purchaseId: string,
    userId: string,
    input: PurchaseDetailsUpdateInput,
  ): Promise<PurchaseRecord | null> {
    return this.mutate((state) => {
      const purchase =
        state.purchases.find(
          (candidate) => candidate.id === purchaseId && candidate.userId === userId,
        ) ?? null;

      if (!purchase) {
        return null;
      }

      purchase.pricePaid = input.pricePaid;
      purchase.quantity = input.quantity;
      purchase.productName = input.productName;
      purchase.productUrl = input.productUrl;
      purchase.captureMethod = input.captureMethod;
      purchase.captureConfidence = input.captureConfidence;
      return clone(purchase);
    });
  }

  async deletePurchaseForUser(purchaseId: string, userId: string): Promise<boolean> {
    return this.mutate((state) => {
      const purchaseIndex = state.purchases.findIndex(
        (purchase) => purchase.id === purchaseId && purchase.userId === userId,
      );

      if (purchaseIndex === -1) {
        return false;
      }

      const [purchase] = state.purchases.splice(purchaseIndex, 1);
      if (!purchase) {
        return false;
      }

      state.opportunities = state.opportunities.filter(
        (opportunity) => opportunity.purchaseId !== purchaseId,
      );
      state.activityEvents = state.activityEvents.filter(
        (event) => event.purchaseId !== purchaseId,
      );

      if (!state.purchases.some((candidate) => candidate.productId === purchase.productId)) {
        state.products = state.products.filter((product) => product.id !== purchase.productId);
        state.observations = state.observations.filter(
          (observation) => observation.productId !== purchase.productId,
        );
      }

      return true;
    });
  }

  async listOpportunitiesForUser(userId: string): Promise<OpportunityRecord[]> {
    const state = await this.read();
    return clone(
      state.opportunities.filter((opportunity) => opportunity.userId === userId),
    );
  }

  async listLatestObservationsByProductIds(productIds: string[]): Promise<LatestObservation[]> {
    const state = await this.read();

    return productIds.flatMap((productId) => {
      const observation = state.observations
        .filter((candidate) => candidate.productId === productId)
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];

      return observation ? [{ productId, observation: clone(observation) }] : [];
    });
  }

  async recordActivityEvent(
    input: ActivityEventCreateInput,
  ): Promise<ActivityEventWriteResult> {
    return this.mutate((state) => {
      if (input.dedupeKey) {
        const existing = state.activityEvents.find(
          (event) => event.dedupeKey === input.dedupeKey,
        );

        if (existing) {
          return { event: clone(existing), created: false };
        }
      }

      const event: ActivityEventRecord = {
        id: createId("evt"),
        ...input,
        metadata: input.metadata ?? {},
      };

      state.activityEvents.push(event);
      return { event: clone(event), created: true };
    });
  }

  async listActivityEventsForPurchases(
    purchaseIds: string[],
    limitPerPurchase = 10,
  ): Promise<ActivityEventRecord[]> {
    const state = await this.read();

    return clone(
      purchaseIds.flatMap((purchaseId) =>
        state.activityEvents
          .filter((event) => event.purchaseId === purchaseId)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
          .slice(0, limitPerPurchase),
      ),
    );
  }

  private async mutate<T>(mutator: (state: StoreState) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const state = await this.read();
      const result = mutator(state);
      await this.write(state);
      return result;
    });

    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  private async read(): Promise<StoreState> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as StoreState;

      return {
        products: parsed.products ?? [],
        purchases: parsed.purchases ?? [],
        observations: parsed.observations ?? [],
        opportunities: parsed.opportunities ?? [],
        activityEvents: parsed.activityEvents ?? [],
        monitoringPreferences: parsed.monitoringPreferences ?? [],
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return clone(emptyStore);
      }

      throw error;
    }
  }

  private async write(state: StoreState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function clone<T>(value: T): T {
  if (value === null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isMonitoringEnabled(state: StoreState, userId: string): boolean {
  return state.monitoringPreferences.find(
    (preference) => preference.userId === userId,
  )?.enabled !== false;
}
