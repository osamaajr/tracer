# Tracer

Tracer is a post-purchase shopping assistant that can protect purchases from any public HTTPS store page with reliable order data. It captures structured purchase facts locally, stores the product identity, watches later prices, and surfaces policy-backed claim opportunities only when a verified retailer policy supports them.

John Lewis is the first retailer-specific policy adapter. Generic stores can now be captured and monitored without pretending every price drop is automatically claimable.

## What is in this repo

- `apps/web` - Vite React public site and dashboard preview for any-store capture.
- `apps/api` - Fastify API for protected purchases, dashboard data, opportunity actions, extension sync, and monitoring.
- `apps/extension` - Chrome Manifest V3 extension with an any-store order prompt, active-tab scanner, scheduled sync, and Chrome notifications.
- `packages/core` - shared domain model, generic and retailer-specific extraction, URL safety, policy evaluation, monitoring use case, and tests.
- `packages/db` - PostgreSQL/Drizzle schema and the first SQL migration.

## Prerequisites

- Node.js 26+
- npm 11+
- PostgreSQL for production-like persistence
- Chrome for loading the unpacked extension

## Setup

```sh
npm install
cp .env.example .env
```

Local development works with the file-backed dev store in `.afterbuy-data/dev-store.json`. PostgreSQL is represented by the schema and migration in `packages/db`; wire a real repository once `DATABASE_URL` is available.

To apply the initial PostgreSQL migration:

```sh
npm run migrate -w @afterbuy/db
```

## Development

Run the API and web app together:

```sh
npm run dev
```

Useful individual commands:

```sh
npm run dev:api
npm run dev:web
npm run dev -w @afterbuy/extension
```

The API defaults to `http://localhost:4000`. The web app defaults to `http://localhost:5173`.

To load the extension locally:

1. Build it with `npm run build -w @afterbuy/extension`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load `apps/extension/dist` as an unpacked extension.

The popup can scan the active HTTPS tab for generic order data. The content script also runs on HTTPS pages and shows an automatic prompt only when the order can be confidently parsed.

## Demo Flows

The John Lewis fixture represents Sony headphones bought for `£349`. The dev monitoring fetcher observes the same product at `£319`, creating a `£30` potential Price Promise opportunity when the purchase is still within 7 days.

```sh
curl -X POST http://localhost:4000/api/purchases/protect \
  -H "content-type: application/json" \
  -H "x-afterbuy-user-id: dev-user-afterbuy" \
  --data @packages/core/fixtures/john-lewis/protect-purchase-request.json

curl -X POST http://localhost:4000/api/dev/run-monitoring \
  -H "x-afterbuy-user-id: dev-user-afterbuy"

curl http://localhost:4000/api/dashboard \
  -H "x-afterbuy-user-id: dev-user-afterbuy"

curl http://localhost:4000/api/extension/sync \
  -H "x-afterbuy-user-id: dev-user-afterbuy"
```

The generic fixture represents an arbitrary `shop.example.com` order. It can be protected and listed on the dashboard, but it will not create a claim opportunity until a verified policy exists for that store.

```sh
curl -X POST http://localhost:4000/api/purchases/protect \
  -H "content-type: application/json" \
  -H "x-afterbuy-user-id: dev-user-afterbuy" \
  --data @packages/core/fixtures/generic-store/protect-purchase-request.json
```

## Quality Checks

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

## Current Boundaries

- Any-store capture supports public HTTPS order pages with reliable schema.org order data or clear order-confirmation DOM structure.
- Verified policy-backed opportunities are implemented for John Lewis only.
- Generic stores are accepted for tracking, but claim guidance is intentionally withheld until a retailer policy is added.
- Real order pages are represented by fixtures because private checkout pages are unavailable in tests.
- Local API auth uses a development user header. Production auth is documented in `docs/architecture.md` but not wired yet.
- Local persistence uses a JSON file store. PostgreSQL schema/migrations are present; a Drizzle repository is the next persistence step.
- Monitoring has a live HTML fetcher for public product pages plus a fixture fetcher for deterministic dev/test flows.
