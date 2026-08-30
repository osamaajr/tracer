CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  external_auth_subject text NOT NULL UNIQUE,
  email text,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS retailers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  host text,
  country_code text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS retailer_policies (
  id text PRIMARY KEY,
  retailer_id text NOT NULL REFERENCES retailers(id),
  version text NOT NULL,
  effective_from timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  policy_document jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS retailer_policies_retailer_version_idx
  ON retailer_policies(retailer_id, version);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  retailer_id text NOT NULL REFERENCES retailers(id),
  retailer_name text NOT NULL,
  store_host text NOT NULL,
  external_product_id text,
  sku text,
  name text NOT NULL,
  canonical_url text NOT NULL,
  image_url text,
  monitoring_status text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_checked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS products_retailer_external_product_idx
  ON products(retailer_id, external_product_id)
  WHERE external_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_retailer_canonical_url_idx
  ON products(retailer_id, canonical_url);

CREATE INDEX IF NOT EXISTS products_monitoring_status_idx
  ON products(monitoring_status);

CREATE TABLE IF NOT EXISTS purchases (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  retailer_id text NOT NULL REFERENCES retailers(id),
  retailer_name text NOT NULL,
  store_host text NOT NULL,
  product_id text NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  product_url text NOT NULL,
  price_paid_amount_minor integer NOT NULL,
  price_paid_currency text NOT NULL,
  quantity integer NOT NULL,
  purchased_at timestamptz NOT NULL,
  source_url text NOT NULL,
  order_reference text,
  external_product_id text,
  protection_status text NOT NULL,
  capture_method text NOT NULL,
  capture_confidence text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS purchases_user_retailer_order_product_idx
  ON purchases(user_id, retailer_id, order_reference, product_id)
  WHERE order_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS purchases_product_status_idx
  ON purchases(product_id, protection_status);

CREATE INDEX IF NOT EXISTS purchases_user_created_at_idx
  ON purchases(user_id, created_at);

CREATE TABLE IF NOT EXISTS price_observations (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  retailer_id text NOT NULL REFERENCES retailers(id),
  observed_at timestamptz NOT NULL,
  price_amount_minor integer NOT NULL,
  price_currency text NOT NULL,
  source_url text NOT NULL,
  availability text NOT NULL
);

CREATE INDEX IF NOT EXISTS price_observations_product_observed_at_idx
  ON price_observations(product_id, observed_at);

CREATE TABLE IF NOT EXISTS opportunities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  retailer_id text NOT NULL REFERENCES retailers(id),
  purchase_id text NOT NULL REFERENCES purchases(id),
  product_id text NOT NULL REFERENCES products(id),
  price_observation_id text NOT NULL REFERENCES price_observations(id),
  policy_id text NOT NULL REFERENCES retailer_policies(id),
  original_price_amount_minor integer NOT NULL,
  original_price_currency text NOT NULL,
  current_price_amount_minor integer NOT NULL,
  current_price_currency text NOT NULL,
  potential_saving_amount_minor integer NOT NULL,
  potential_saving_currency text NOT NULL,
  title text NOT NULL,
  guidance text NOT NULL,
  claim_url text NOT NULL,
  claim_by timestamptz NOT NULL,
  status text NOT NULL,
  status_updated_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS opportunities_user_status_idx
  ON opportunities(user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS opportunities_purchase_actionable_idx
  ON opportunities(purchase_id)
  WHERE status IN ('open', 'viewed');

INSERT INTO retailers (id, display_name, host, country_code, created_at)
VALUES ('john-lewis', 'John Lewis & Partners', 'www.johnlewis.com', 'GB', now())
ON CONFLICT (id) DO NOTHING;
