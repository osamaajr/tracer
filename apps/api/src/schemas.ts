import { firstUsableProductImage } from "@afterbuy/core";
import { z } from "zod";

export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const lineItemSchema = z.object({
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

export const purchaseDraftSchema = z.object({
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

export const protectPurchaseRequestSchema = z.object({
  purchaseDraft: purchaseDraftSchema,
});

export const opportunityParamsSchema = z.object({
  opportunityId: z.string().min(1),
});

export const purchaseParamsSchema = z.object({
  purchaseId: z.string().min(1),
});

export const devMonitoringQuerySchema = z.object({
  fixture: z.enum(["paid", "dropped"]).optional(),
});

export const monitoringSettingsSchema = z.object({
  enabled: z.boolean(),
});
