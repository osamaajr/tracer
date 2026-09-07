import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import {
  findProtectedPurchaseForDraft,
  formatMoney,
  protectPurchase,
  runPriceMonitoringCycle,
  updateOpportunityStatus,
  validatePurchaseDraft,
  type AfterBuyRepository,
  type ActivityEventRecord,
  type Money,
  type OpportunityRecord,
  type PriceFetcher,
  type PurchaseDraft,
  type PurchaseLineItemDraft,
  firstUsableProductImage,
} from "@afterbuy/core";
import { requireAuthenticatedUser } from "./auth";
import { type ApiConfig, loadConfig } from "./config";
import { createDevFixturePriceFetcher } from "./devFixturePriceFetcher";
import { HttpPriceFetcher } from "./httpPriceFetcher";
import { FileAfterBuyRepository } from "./repositories/fileAfterBuyRepository";

export interface CreateServerOptions {
  config?: ApiConfig;
  repository?: AfterBuyRepository;
  priceFetcher?: PriceFetcher;
}

const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const lineItemSchema = z.object({
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  pricePaid: moneySchema,
  productUrlConfidence: z.enum(["high", "medium", "low"]).optional(),
  productUrl: z.string().url().optional(),
  externalProductId: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  imageUrl: z.preprocess(
    (value) => (typeof value === "string" ? firstUsableProductImage(value) ?? undefined : undefined),
    z.string().url().optional(),
  ),
});

const purchaseDraftSchema = z.object({
  retailerId: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,90}$/),
  retailerName: z.string().min(1),
  storeHost: z.string().regex(/^[a-z0-9.-]+$/i),
  sourceUrl: z.string().url(),
  purchasedAt: z.string().datetime(),
  captureMethod: z.enum(["retailer_adapter", "generic_schema_org", "generic_dom"]),
  captureConfidence: z.enum(["high", "medium", "low"]),
  orderReference: z.string().min(1).optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

const protectPurchaseRequestSchema = z.object({
  purchaseDraft: purchaseDraftSchema,
});

const opportunityParamsSchema = z.object({
  opportunityId: z.string().min(1),
});

const devMonitoringQuerySchema = z.object({
  fixture: z.enum(["paid", "dropped"]).optional(),
});

type OpportunityRouteRequest = FastifyRequest<{
  Params: {
    opportunityId: string;
  };
}>;

export async function createAfterBuyServer(
  options: CreateServerOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const repository =
    options.repository ?? new FileAfterBuyRepository(config.dataFile);
  const configuredPriceFetcher = options.priceFetcher;
  const livePriceFetcher = configuredPriceFetcher ?? new HttpPriceFetcher();
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
          },
  });

  await app.register(cors, {
    origin: [/^chrome-extension:\/\//, /^http:\/\/localhost:\d+$/],
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (
      message === "Authentication required" ||
      message === "Extension token authentication is not configured"
    ) {
      return reply.code(401).send({
        error: "authentication_required",
        message,
      });
    }

    app.log.error(error);
    return reply.code(500).send({ error: "internal_server_error" });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "afterbuy-api",
  }));

  app.post("/api/purchases/protect", async (request, reply) => {
    const user = requireAuthenticatedUser(request, config);
    const parsed = protectPurchaseRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const purchaseDraft = toPurchaseDraft(parsed.data.purchaseDraft);
    const validationErrors = validatePurchaseDraft(purchaseDraft);
    if (validationErrors.length > 0) {
      return reply.code(422).send({
        error: "unsupported_purchase",
        details: validationErrors,
      });
    }

    const result = await protectPurchase(repository, {
      userId: user.id,
      draft: purchaseDraft,
    });

    const statusCode = result.accepted.length > 0 ? 201 : 422;
    return reply.code(statusCode).send({
      userId: user.id,
      ...result,
    });
  });

  app.post("/api/purchases/protection-status", async (request, reply) => {
    const user = requireAuthenticatedUser(request, config);
    const parsed = protectPurchaseRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const purchaseDraft = toPurchaseDraft(parsed.data.purchaseDraft);
    const validationErrors = validatePurchaseDraft(purchaseDraft);
    if (validationErrors.length > 0) {
      return reply.code(422).send({
        error: "unsupported_purchase",
        details: validationErrors,
      });
    }

    const result = await findProtectedPurchaseForDraft(repository, {
      userId: user.id,
      draft: purchaseDraft,
    });

    return {
      userId: user.id,
      ...result,
      purchase: result.purchase
        ? {
            ...result.purchase,
            pricePaidDisplay: formatMoney(result.purchase.pricePaid),
          }
        : null,
    };
  });

  app.get("/api/dashboard", async (request) => {
    const user = requireAuthenticatedUser(request, config);
    const purchases = await repository.listPurchasesForUser(user.id);
    const products = await repository.listProductsForMonitoring(new Date().toISOString());
    const opportunities = await repository.listOpportunitiesForUser(user.id);
    const latestObservations = await repository.listLatestObservationsByProductIds(
      purchases.map((purchase) => purchase.productId),
    );
    const activityEvents = await repository.listActivityEventsForPurchases(
      purchases.map((purchase) => purchase.id),
      8,
    );
    const latestByProductId = new Map(
      latestObservations.map((latest) => [latest.productId, latest.observation]),
    );
    const productById = new Map(products.map((product) => [product.id, product]));
    const activityByPurchaseId = new Map<string, ActivityEventRecord[]>();
    for (const event of activityEvents) {
      const current = activityByPurchaseId.get(event.purchaseId) ?? [];
      current.push(event);
      activityByPurchaseId.set(event.purchaseId, current);
    }

    return {
      userId: user.id,
      purchases: purchases.map((purchase) => {
        const latest = latestByProductId.get(purchase.productId);
        const product = productById.get(purchase.productId);
        const purchaseActivity = activityByPurchaseId.get(purchase.id) ?? [];

        return {
          ...purchase,
          imageUrl: product?.imageUrl ?? null,
          retailerName: purchase.retailerName || purchase.retailerId,
          pricePaidDisplay: formatMoney(purchase.pricePaid),
          currentPrice: latest?.price ?? null,
          currentPriceDisplay: latest ? formatMoney(latest.price) : null,
          lastCheckedAt: latest?.observedAt ?? null,
          recentActivity: purchaseActivity
            .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
            .map((event) => serializeActivityEvent(event, purchase.retailerName)),
        };
      }),
      opportunities: opportunities.map(serializeOpportunity),
    };
  });

  app.get("/api/extension/sync", async (request) => {
    const user = requireAuthenticatedUser(request, config);
    const purchases = await repository.listPurchasesForUser(user.id);
    const opportunities = await repository.listOpportunitiesForUser(user.id);
    const actionableOpportunities = opportunities.filter((opportunity) =>
      isActionableOpportunityStatus(opportunity.status),
    );

    return {
      userId: user.id,
      generatedAt: new Date().toISOString(),
      protectedPurchaseCount: purchases.length,
      openOpportunityCount: actionableOpportunities.length,
      opportunities: actionableOpportunities.map(serializeOpportunity),
    };
  });

  app.post<{ Params: { opportunityId: string } }>(
    "/api/opportunities/:opportunityId/viewed",
    async (request, reply) => {
      return updateOpportunityFromRoute(request, reply, "viewed");
    },
  );

  app.post<{ Params: { opportunityId: string } }>(
    "/api/opportunities/:opportunityId/claim-clicked",
    async (request, reply) => {
      return updateOpportunityFromRoute(request, reply, "claim_clicked");
    },
  );

  app.post<{ Params: { opportunityId: string } }>(
    "/api/opportunities/:opportunityId/dismiss",
    async (request, reply) => {
      return updateOpportunityFromRoute(request, reply, "dismissed");
    },
  );

  app.post("/api/monitoring/run", async (request) => {
    const user = requireAuthenticatedUser(request, config);
    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: livePriceFetcher,
    });

    return {
      userId: user.id,
      summary,
    };
  });

  app.post("/api/dev/run-monitoring", async (request, reply) => {
    if (!config.enableDevEndpoints) {
      return reply.code(404).send({ error: "not_found" });
    }

    const parsed = devMonitoringQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const fixture = parsed.data.fixture ?? "dropped";
    const now =
      fixture === "paid"
        ? "2026-09-01T08:00:00.000Z"
        : "2026-09-02T08:00:00.000Z";
    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher:
        configuredPriceFetcher ??
        createDevFixturePriceFetcher(now, fixture),
      now,
    });

    return { summary };
  });

  return app;

  async function updateOpportunityFromRoute(
    request: OpportunityRouteRequest,
    reply: FastifyReply,
    status: "viewed" | "claim_clicked" | "dismissed",
  ) {
    const user = requireAuthenticatedUser(request, config);
    const parsed = opportunityParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const result = await updateOpportunityStatus({
      repository,
      userId: user.id,
      opportunityId: parsed.data.opportunityId,
      status,
    });

    if (!result.opportunity) {
      return reply.code(404).send({ error: "opportunity_not_found" });
    }

    return {
      opportunity: serializeOpportunity(result.opportunity),
      changed: result.changed,
    };
  }
}

function toPurchaseDraft(input: z.infer<typeof purchaseDraftSchema>): PurchaseDraft {
  const draft: PurchaseDraft = {
    retailerId: input.retailerId,
    retailerName: input.retailerName,
    storeHost: input.storeHost,
    sourceUrl: input.sourceUrl,
    purchasedAt: input.purchasedAt,
    lineItems: input.lineItems.map(toPurchaseLineItemDraft),
    captureMethod: input.captureMethod,
    captureConfidence: input.captureConfidence,
  };

  if (input.orderReference) {
    draft.orderReference = input.orderReference;
  }

  return draft;
}

function toPurchaseLineItemDraft(
  input: z.infer<typeof lineItemSchema>,
): PurchaseLineItemDraft {
  const item: PurchaseLineItemDraft = {
    productName: input.productName,
    quantity: input.quantity,
    pricePaid: input.pricePaid,
  };

  if (input.productUrl) {
    item.productUrl = input.productUrl;
  }
  if (input.productUrlConfidence) {
    item.productUrlConfidence = input.productUrlConfidence;
  }
  if (input.externalProductId) {
    item.externalProductId = input.externalProductId;
  }
  if (input.sku) {
    item.sku = input.sku;
  }
  if (input.imageUrl) {
    item.imageUrl = input.imageUrl;
  }

  return item;
}

function serializeOpportunity(opportunity: OpportunityRecord) {
  return {
    ...opportunity,
    potentialSavingDisplay: formatMoney(opportunity.potentialSaving),
    originalPriceDisplay: formatMoney(opportunity.originalPrice),
    currentPriceDisplay: formatMoney(opportunity.currentPrice),
  };
}

function serializeActivityEvent(event: ActivityEventRecord, retailerName: string) {
  const currentPrice = readMoney(event.metadata.currentPrice);
  const potentialSaving = readMoney(event.metadata.potentialSaving);
  const change = readMoney(event.metadata.change);
  const claimBy =
    typeof event.metadata.claimBy === "string" ? event.metadata.claimBy : undefined;
  const formattedPrice = currentPrice ? formatMoney(currentPrice) : null;
  const formattedSaving = potentialSaving
    ? formatMoney(potentialSaving)
    : change
      ? formatMoney(change)
      : null;

  return {
    ...event,
    title: activityTitle(event.type),
    description: activityDescription({
      type: event.type,
      retailerName,
      formattedPrice,
      formattedSaving,
      claimBy,
      reason: typeof event.metadata.reason === "string" ? event.metadata.reason : undefined,
    }),
  };
}

function activityTitle(type: ActivityEventRecord["type"]): string {
  const titles: Record<ActivityEventRecord["type"], string> = {
    purchase_protected: "Purchase protected",
    price_observed: "Price unchanged",
    price_dropped: "Price dropped",
    price_increased: "Price increased",
    product_unavailable: "Temporarily unavailable",
    product_available_again: "Back in stock",
    policy_window_expired: "Protection window ended",
    opportunity_created: "Opportunity found",
    opportunity_updated: "Opportunity updated",
    opportunity_resolved: "Opportunity resolved",
    opportunity_expired: "Opportunity expired",
    monitoring_error: "Monitoring paused",
  };

  return titles[type];
}

function activityDescription(input: {
  type: ActivityEventRecord["type"];
  retailerName: string;
  formattedPrice: string | null;
  formattedSaving: string | null;
  claimBy: string | undefined;
  reason: string | undefined;
}): string {
  switch (input.type) {
    case "purchase_protected":
      return "We're now monitoring this item.";
    case "price_observed":
      return input.formattedPrice
        ? `Still ${input.formattedPrice} at ${input.retailerName}.`
        : `Checked at ${input.retailerName}.`;
    case "price_dropped":
      return input.formattedPrice
        ? `Now ${input.formattedPrice} at ${input.retailerName}.`
        : "The price moved lower.";
    case "price_increased":
      return input.formattedPrice
        ? `Now ${input.formattedPrice} at ${input.retailerName}.`
        : "The price moved higher.";
    case "product_unavailable":
      return `We could not confirm current availability at ${input.retailerName}.`;
    case "product_available_again":
      return `The item is available again at ${input.retailerName}.`;
    case "policy_window_expired":
      return "This purchase is outside the retailer protection window.";
    case "opportunity_created":
      return input.formattedSaving
        ? `${input.formattedSaving} potential saving found.`
        : "A claim opportunity is ready to review.";
    case "opportunity_updated":
      return input.formattedSaving
        ? `Updated to ${input.formattedSaving} potential saving.`
        : "The opportunity has been refreshed.";
    case "opportunity_resolved":
      return "The current price no longer creates a claim opportunity.";
    case "opportunity_expired":
      return input.claimBy
        ? `The claim window ended on ${input.claimBy}.`
        : "The claim window has ended.";
    case "monitoring_error":
      return input.reason ?? "The latest price check did not complete.";
  }
}

function readMoney(value: unknown): Money | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "number" &&
    typeof value.currency === "string"
  ) {
    return {
      amountMinor: value.amountMinor,
      currency: value.currency,
    };
  }

  return null;
}

function isActionableOpportunityStatus(status: OpportunityRecord["status"]): boolean {
  return status === "open" || status === "viewed";
}
