import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  externalAuthSubject: text("external_auth_subject").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const retailers = pgTable("retailers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  host: text("host"),
  countryCode: text("country_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const retailerPolicies = pgTable(
  "retailer_policies",
  {
    id: text("id").primaryKey(),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    version: text("version").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull(),
    policyDocument: jsonb("policy_document").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    retailerVersion: uniqueIndex("retailer_policies_retailer_version_idx").on(
      table.retailerId,
      table.version,
    ),
  }),
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    retailerName: text("retailer_name").notNull(),
    storeHost: text("store_host").notNull(),
    externalProductId: text("external_product_id"),
    sku: text("sku"),
    name: text("name").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    imageUrl: text("image_url"),
    monitoringStatus: text("monitoring_status").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  },
  (table) => ({
    retailerExternalProduct: uniqueIndex("products_retailer_external_product_idx").on(
      table.retailerId,
      table.externalProductId,
    ),
    retailerCanonicalUrl: uniqueIndex("products_retailer_canonical_url_idx").on(
      table.retailerId,
      table.canonicalUrl,
    ),
    monitoringStatus: index("products_monitoring_status_idx").on(table.monitoringStatus),
  }),
);

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    retailerName: text("retailer_name").notNull(),
    storeHost: text("store_host").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    productName: text("product_name").notNull(),
    productUrl: text("product_url").notNull(),
    pricePaidAmountMinor: integer("price_paid_amount_minor").notNull(),
    pricePaidCurrency: text("price_paid_currency").notNull(),
    quantity: integer("quantity").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    sourceUrl: text("source_url").notNull(),
    orderReference: text("order_reference"),
    externalProductId: text("external_product_id"),
    protectionStatus: text("protection_status").notNull(),
    captureMethod: text("capture_method").notNull(),
    captureConfidence: text("capture_confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userRetailerOrderProduct: uniqueIndex("purchases_user_retailer_order_product_idx").on(
      table.userId,
      table.retailerId,
      table.orderReference,
      table.productId,
    ),
    productStatus: index("purchases_product_status_idx").on(
      table.productId,
      table.protectionStatus,
    ),
    userCreatedAt: index("purchases_user_created_at_idx").on(table.userId, table.createdAt),
  }),
);

export const priceObservations = pgTable(
  "price_observations",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    priceAmountMinor: integer("price_amount_minor").notNull(),
    priceCurrency: text("price_currency").notNull(),
    sourceUrl: text("source_url").notNull(),
    availability: text("availability").notNull(),
  },
  (table) => ({
    productObservedAt: index("price_observations_product_observed_at_idx").on(
      table.productId,
      table.observedAt,
    ),
  }),
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    priceObservationId: text("price_observation_id")
      .notNull()
      .references(() => priceObservations.id),
    policyId: text("policy_id")
      .notNull()
      .references(() => retailerPolicies.id),
    originalPriceAmountMinor: integer("original_price_amount_minor").notNull(),
    originalPriceCurrency: text("original_price_currency").notNull(),
    currentPriceAmountMinor: integer("current_price_amount_minor").notNull(),
    currentPriceCurrency: text("current_price_currency").notNull(),
    potentialSavingAmountMinor: integer("potential_saving_amount_minor").notNull(),
    potentialSavingCurrency: text("potential_saving_currency").notNull(),
    title: text("title").notNull(),
    guidance: text("guidance").notNull(),
    claimUrl: text("claim_url").notNull(),
    claimBy: timestamp("claim_by", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userStatus: index("opportunities_user_status_idx").on(table.userId, table.status),
    purchaseActionable: uniqueIndex("opportunities_purchase_actionable_idx")
      .on(table.purchaseId)
      .where(sql`${table.status} IN ('open', 'viewed')`),
  }),
);
