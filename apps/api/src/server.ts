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
  type TracerRepository,
  type ActivityEventRecord,
  type PriceFetcher,
  type PurchaseDraft,
  type PurchaseLineItemDraft,
} from "@tracer/core";
import { requireAuthenticatedUser } from "./auth";
import { type ApiConfig, loadConfig } from "./config";
import { createDevFixturePriceFetcher } from "./devFixturePriceFetcher";
import { HttpPriceFetcher } from "./httpPriceFetcher";
import { FileTracerRepository } from "./repositories/fileTracerRepository";
import {
  devMonitoringQuerySchema,
  lineItemSchema,
  monitoringSettingsSchema,
  opportunityParamsSchema,
  protectPurchaseRequestSchema,
  purchaseDraftSchema,
  purchaseParamsSchema,
} from "./schemas";
import {
  derivePurchaseMonitoringState,
  isActionableOpportunityStatus,
  readMoney,
  serializeActivityEvent,
  serializeOpportunity,
} from "./serializers";

export interface CreateServerOptions {
  config?: ApiConfig;
  repository?: TracerRepository;
  priceFetcher?: PriceFetcher;
}

type OpportunityRouteRequest = FastifyRequest<{
  Params: {
    opportunityId: string;
  };
}>;

export async function createTracerServer(
  options: CreateServerOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const repository =
    options.repository ?? new FileTracerRepository(config.dataFile);
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
    service: "tracer-api",
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
            pricePaidDisplay: formatMoney(result.purchase.orderTotalPaid ?? result.purchase.pricePaid),
          }
        : null,
    };
  });

  app.get("/api/settings", async (request) => {
    const user = requireAuthenticatedUser(request, config);
    const monitoring = await repository.getMonitoringPreference(user.id);
    return { userId: user.id, monitoringEnabled: monitoring.enabled };
  });

  app.put("/api/settings/monitoring", async (request, reply) => {
    const user = requireAuthenticatedUser(request, config);
    const parsed = monitoringSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const previous = await repository.getMonitoringPreference(user.id);
    const now = new Date().toISOString();
    const monitoring = await repository.setMonitoringEnabled(
      user.id,
      parsed.data.enabled,
      now,
    );

    if (previous.enabled !== monitoring.enabled) {
      const purchases = await repository.listPurchasesForUser(user.id);
      const type = monitoring.enabled ? "monitoring_resumed" : "monitoring_paused";
      for (const purchase of purchases.filter(
        (candidate) => candidate.protectionStatus === "active",
      )) {
        await repository.recordActivityEvent({
          userId: user.id,
          purchaseId: purchase.id,
          productId: purchase.productId,
          type,
          occurredAt: now,
          createdAt: now,
          metadata: {},
          dedupeKey: `${purchase.id}:${type}:${now}`,
        });
      }
    }

    return { userId: user.id, monitoringEnabled: monitoring.enabled };
  });

  app.get("/api/dashboard", async (request) => {
    const user = requireAuthenticatedUser(request, config);
    const purchases = await repository.listPurchasesForUser(user.id);
    const monitoring = await repository.getMonitoringPreference(user.id);
    const products = await repository.listProductsByIds(
      purchases.map((purchase) => purchase.productId),
    );
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
        const state = derivePurchaseMonitoringState({
          purchase,
          latest,
          activity: purchaseActivity,
          monitoringEnabled: monitoring.enabled,
        });

        return {
          ...purchase,
          imageUrl: product?.imageUrl ?? null,
          retailerName: purchase.retailerName || purchase.retailerId,
          pricePaidDisplay: formatMoney(purchase.pricePaid),
          orderTotalPaidDisplay: purchase.orderTotalPaid ? formatMoney(purchase.orderTotalPaid) : null,
          currentPrice: latest?.price ?? null,
          currentPriceDisplay: latest ? formatMoney(latest.price) : null,
          lastCheckedAt: latest?.observedAt ?? null,
          monitoringStatus: state.status,
          saving: state.saving,
          savingDisplay: state.saving ? formatMoney(state.saving) : null,
          savingPercentageBps: state.savingPercentageBps,
          priceDropDetectedAt: state.priceDropDetectedAt,
          recentActivity: purchaseActivity
            .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
            .map((event) => serializeActivityEvent(event, purchase.retailerName)),
        };
      }),
      opportunities: opportunities.map(serializeOpportunity),
    };
  });

  app.get<{ Params: { purchaseId: string } }>(
    "/api/purchases/:purchaseId/price-history",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, config);
      const { purchaseId } = purchaseParamsSchema.parse(request.params);
      const purchase = (await repository.listPurchasesForUser(user.id))
        .find((candidate) => candidate.id === purchaseId);
      if (!purchase) {
        return reply.code(404).send({ error: "Protected purchase not found" });
      }
      const observations = await repository.listPriceObservationsByProductIds(
        [purchase.productId],
        5_000,
      );
      return {
        observations: observations.map((observation) => ({
          observedAt: observation.observedAt,
          price: observation.price,
          availability: observation.availability,
        })),
      };
    },
  );

  app.delete<{ Params: { purchaseId: string } }>(
    "/api/purchases/:purchaseId",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, config);
      const parsed = purchaseParamsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }

      const deleted = await repository.deletePurchaseForUser(parsed.data.purchaseId, user.id);
      if (!deleted) {
        return reply.code(404).send({ error: "purchase_not_found" });
      }

      return reply.code(204).send();
    },
  );

  app.get("/api/extension/sync", async (request) => {
    const user = requireAuthenticatedUser(request, config);
    const purchases = await repository.listPurchasesForUser(user.id);
    const opportunities = await repository.listOpportunitiesForUser(user.id);
    const actionableOpportunities = opportunities.filter((opportunity) =>
      isActionableOpportunityStatus(opportunity.status),
    );
    const activity = await repository.listActivityEventsForPurchases(
      purchases.map((purchase) => purchase.id),
      100,
    );
    const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
    const priceDrops = activity.flatMap((event) => {
      if (event.type !== "price_dropped") {
        return [];
      }
      const purchase = purchaseById.get(event.purchaseId);
      const currentPrice = readMoney(event.metadata.currentPrice);
      const saving = readMoney(event.metadata.savingAgainstPaid);
      if (!purchase || !currentPrice || !saving || saving.amountMinor <= 0) {
        return [];
      }
      return [{
        eventId: event.id,
        purchaseId: purchase.id,
        productName: purchase.productName,
        currentPriceDisplay: formatMoney(currentPrice),
        savingDisplay: formatMoney(saving),
        detectedAt: event.occurredAt,
      }];
    });

    return {
      userId: user.id,
      generatedAt: new Date().toISOString(),
      protectedPurchaseCount: purchases.length,
      openOpportunityCount: actionableOpportunities.length,
      opportunities: actionableOpportunities.map(serializeOpportunity),
      priceDrops,
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

  const activePriceChecks = new Map<string, ReturnType<typeof runPriceMonitoringCycle>>();
  app.post<{ Params: { purchaseId: string } }>("/api/purchases/:purchaseId/check-price", async (request, reply) => {
    const user = requireAuthenticatedUser(request, config);
    const { purchaseId } = purchaseParamsSchema.parse(request.params);
    const purchase = (await repository.listPurchasesForUser(user.id)).find((item) => item.id === purchaseId);
    if (!purchase) return reply.code(404).send({ error: "Protected purchase not found" });
    const preference = await repository.getMonitoringPreference(user.id);
    if (!preference.enabled) return reply.code(409).send({ error: "monitoring_paused" });
    let check = activePriceChecks.get(purchase.productId);
    if (!check) {
      check = runPriceMonitoringCycle({ repository, priceFetcher: livePriceFetcher, productIds: [purchase.productId] })
        .finally(() => activePriceChecks.delete(purchase.productId));
      activePriceChecks.set(purchase.productId, check);
    }
    const summary = await check;
    if (!summary.checkedProducts || summary.failures.length) {
      return reply.code(502).send({ error: "price_check_unavailable" });
    }
    return { ok: true };
  });

  app.post("/api/monitoring/run", async (request, reply) => {
    if (!config.enableDevEndpoints) {
      return reply.code(404).send({ error: "not_found" });
    }
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
    const fixtureWasRequested = parsed.data.fixture !== undefined;
    const now =
      fixture === "paid"
        ? "2026-09-01T08:00:00.000Z"
        : "2026-09-02T08:00:00.000Z";
    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: fixtureWasRequested
        ? createDevFixturePriceFetcher(now, fixture)
        : configuredPriceFetcher ?? createDevFixturePriceFetcher(now, fixture),
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
  if (input.orderTotalPaid) {
    draft.orderTotalPaid = input.orderTotalPaid;
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
