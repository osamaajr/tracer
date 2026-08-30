# AfterBuy Architecture

Last updated: 2026-08-30

## Product Slice

The current implementation proves an any-store capture pipeline with one verified policy adapter:

1. The Chrome extension can scan the active HTTPS tab for an order confirmation page.
2. Retailer-specific adapters run first for known stores such as John Lewis.
3. Generic extraction falls back to schema.org order data, then clear order-confirmation DOM structure.
4. The user explicitly confirms "Protect purchase".
5. The API validates the store host, source URL, product URL, capture method, confidence, and money fields.
6. The product is deduplicated by retailer/store identity and deterministic product identifier or canonical URL.
7. A monitoring cycle fetches the public product URL and records one price observation per product.
8. Policy evaluation creates an opportunity only when a verified policy exists, the observed price is lower, and the purchase is within the policy window.
9. The extension sync endpoint returns actionable opportunities for Chrome notifications.
10. The dashboard displays protected purchases from any store and lets the user claim-click or dismiss policy-backed opportunities.

## Stack Decisions

- Language: TypeScript across web, extension, API, and shared domain code.
- Package layout: npm workspaces. This keeps the repo small while separating runtime concerns.
- Web app: Vite + React. The landing page and early dashboard are client-rendered and do not need a heavier SSR framework yet.
- API: Fastify. It gives typed, testable HTTP boundaries without introducing a large framework.
- Domain: `packages/core`. Generic extraction, retailer adapters, policy evaluation, product matching, and monitoring live outside the API so they can be tested without servers or browsers.
- Database target: PostgreSQL with Drizzle schema definitions and SQL migrations. Local dev currently uses a file-backed repository so the first slice runs without requiring database credentials.
- Extension: Chrome Manifest V3 with Vite. The popup injects a one-shot generic scanner into the active tab, while the content script runs on HTTPS pages and only renders when the shared extractor finds a reliable order.
- Tests: Vitest with saved HTML fixtures. Tests do not depend on live retailer pages.
- Authentication direction: Clerk for the beta product, storing the Clerk subject in `users.external_auth_subject`. Clerk avoids custom password handling and has a realistic browser extension authentication path. Current local development uses an explicit dev user header behind non-production config.
- Jobs direction: start with a single monitoring worker use case and a manual API trigger. A production deployment can schedule product-level monitoring by retailer/store and product, then evaluate all active purchases for that product.

## Domain Model

- `User`: account owner. Keep only the external auth subject and optional email.
- `Retailer`: known retailer metadata for policy-aware stores.
- `RetailerPolicy`: versioned, verified policy facts and claim route.
- `Product`: store product identity and monitoring state. Many purchases can point to one product.
- `Purchase`: a user's protected line item from an order, including store host, capture method, and confidence.
- `PriceObservation`: current price snapshot for a product at a time.
- `Opportunity`: actionable potential saving created from a purchase, observation, and verified policy version. Status moves through `open`, `viewed`, `claim_clicked`, `dismissed`, or `expired`.

## Security And Privacy

- The extension extracts structured data locally and does not upload complete page HTML.
- Backend source and product URLs are normalised before any future fetching.
- Known retailers use host allowlists and product identifier checks.
- Generic stores must be public HTTPS hosts with product URLs on the same host as the order source.
- V1 does not store retailer credentials, payment card details, bank data, inbox data, or full page snapshots.
- Unsupported pages, private/local hosts, cross-store product URLs, and purchases without reliable product URLs fail closed.
- Purchase and opportunity reads are scoped by authenticated user ID.
- Opportunity copy avoids saying a retailer owes money; it points to the retailer's own eligibility process.

## Extraction Shape

Retailer-specific adapters run before generic extraction and can provide high-confidence parsing, product IDs, product price extraction, and policy data.

Generic extraction provides broad capture by:

- deriving a stable store ID from the public host,
- parsing schema.org `Order` and `Product` data when available,
- falling back to explicit order-confirmation DOM signals,
- carrying `captureMethod` and `captureConfidence`,
- requiring same-store product URLs before persistence.

This is intentionally not a generic policy engine. A generic store purchase may be tracked without creating a claim opportunity until a verified retailer policy is added.

## Incomplete By Design

- Clerk is selected but not integrated.
- PostgreSQL repository implementation is not yet wired; migrations are ready.
- Real scheduled backend jobs are not present yet.
- The live HTML fetcher covers public product pages. Private pages, heavy bot protection, client-only prices, and stores that hide prices from HTML will need retailer-specific adapters or browser-based fetching.
- Extension publishing and Chrome Web Store URL are placeholders.
