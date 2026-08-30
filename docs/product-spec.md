# Tracer Product Specification

Last updated: 2026-08-30

## Product Promise

Tracer is a Chrome extension that protects purchases after checkout. It captures structured order details from store confirmation pages, monitors public product pages for price drops, and alerts the user only when a verified retailer policy can support a pay back claim.

## Core User Flow

1. User checks out at a supported public HTTPS store.
2. Tracer detects a reliable order confirmation automatically or through the popup scanner.
3. User clicks "Protect purchase".
4. API validates the purchase, product URL, store host, money fields, and capture confidence.
5. Tracer stores the protected purchase and deduplicates repeat submissions.
6. Monitoring fetches the public product page and extracts the current price.
7. A verified retailer policy decides whether the price drop can become a claim opportunity.
8. Extension sync surfaces actionable opportunities as Chrome notifications.
9. Dashboard lets the user review, claim-click, or dismiss the opportunity.

## Current MVP Scope

- Any-store purchase capture from schema.org `Order` data or clear order-confirmation DOM.
- Retailer-specific John Lewis adapter and verified Price Promise policy.
- Generic product price extraction from schema.org `Product` data or common price selectors.
- File-backed local persistence with repository boundaries ready for Postgres.
- Fastify API for purchase protection, dashboard data, extension sync, opportunity actions, and monitoring.
- Chrome MV3 popup scanner, automatic HTTPS-page prompt, hourly opportunity sync, and notifications.
- React dashboard for protected purchases and actionable opportunity management.

## Store Support Model

Generic stores can be tracked when they expose reliable order and product data, but claim opportunities require a verified policy adapter. A new policy adapter should include:

- retailer ID, canonical host, and display name,
- policy version and verification date,
- claim window, claim route, and source URLs,
- evidence requirements and exclusions,
- product page extraction rules when generic extraction is not reliable,
- fixture pages for purchase extraction, product extraction, and policy evaluation tests.

## Production Readiness Gaps

- Replace dev header auth with a real extension/web auth flow.
- Wire the Postgres repository implementation behind the existing `AfterBuyRepository` interface.
- Add a scheduled backend worker for monitoring instead of relying on manual API triggers.
- Add rate limits, retry/backoff, and per-store monitoring cadence.
- Add policy admin tooling for verifying and retiring retailer policies.
- Add extension onboarding, account linking, and Chrome Web Store packaging metadata.
- Add observability for capture failures, fetch failures, and claim conversion.
