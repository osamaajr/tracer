import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createId,
  type AfterBuyRepository,
  type LatestObservation,
  type OpportunityCreateInput,
  type OpportunityRecord,
  type OpportunityStatus,
  type PriceObservationCreateInput,
  type PriceObservationRecord,
  type ProductRecord,
  type ProductUpsertInput,
  type PurchaseCreateInput,
  type PurchaseFingerprint,
  type PurchaseRecord,
} from "@afterbuy/core";

interface StoreState {
  products: ProductRecord[];
  purchases: PurchaseRecord[];
  observations: PriceObservationRecord[];
  opportunities: OpportunityRecord[];
}

const emptyStore: StoreState = {
  products: [],
  purchases: [],
  observations: [],
  opportunities: [],
};

export class FileAfterBuyRepository implements AfterBuyRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async upsertProduct(input: ProductUpsertInput): Promise<ProductRecord> {
    return this.mutate((state) => {
      const existing = state.products.find((product) => {
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
    return clone(state.products.filter((product) => product.monitoringStatus === "active"));
  }

  async recordPriceObservation(
    input: PriceObservationCreateInput,
  ): Promise<PriceObservationRecord> {
    return this.mutate((state) => {
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
        }
      }

      return clone(observation);
    });
  }

  async listActivePurchasesForProduct(productId: string): Promise<PurchaseRecord[]> {
    const state = await this.read();
    return clone(
      state.purchases.filter(
        (purchase) =>
          purchase.productId === productId && purchase.protectionStatus === "active",
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
