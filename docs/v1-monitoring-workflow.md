# V1 Monitoring Workflow

Tracer monitors a protected product once per cycle, then evaluates every active purchase that references that product.

```text
Product -> price fetcher -> validated PriceObservation
        -> price comparison -> ActivityEvent records
        -> protected-items data / extension notification sync
```

Products are the monitoring unit. Purchases retain the paid price, purchase date, and policy context used to evaluate the same observation. A price check can therefore update multiple purchases without creating one fetch job per purchase.

## Running monitoring

In development, the API exposes an authenticated immediate live check at `POST /api/monitoring/run`. `POST /api/dev/run-monitoring?fixture=paid` or `?fixture=dropped` uses the Trail Pack fixture through the same monitoring pipeline. Both routes are disabled in production.

The API starts the scheduler automatically. A standalone worker is also available for deployments that run scheduled work separately:

```sh
npm run monitor -w @tracer/api
```

Use the standalone worker instead of the API-owned scheduler in such a deployment; do not run both against the same file-backed store.

The scheduler checks immediately and then every `TRACER_MONITOR_INTERVAL_HOURS` hours, defaulting to 12. The popup only reads saved state and never performs a retailer scan.

## Deterministic fixture flow

Run the complete in-process assertion flow with:

```sh
npm run verify:monitoring
```

This protects the £84.50 fixture, observes £84.50 then £69.50, verifies the £15/17.75% saving and one notification, repeats the same price to prove deduplication, disables monitoring to prove no fetch occurs, and clears the purchase to prove future cycles skip it.

Use a clean data file for a repeatable local run:

```sh
TRACER_DATA_FILE=/tmp/tracer-v1.json npm run dev:api
```

Then protect `packages/core/fixtures/generic-store/protect-purchase-request.json`, run the paid fixture once, and run the dropped fixture once:

```sh
curl -X POST http://localhost:4000/api/purchases/protect \
  -H 'content-type: application/json' \
  -H 'x-tracer-user-id: dev-user-tracer' \
  --data @packages/core/fixtures/generic-store/protect-purchase-request.json

curl -X POST 'http://localhost:4000/api/dev/run-monitoring?fixture=paid' \
  -H 'x-tracer-user-id: dev-user-tracer'

curl -X POST 'http://localhost:4000/api/dev/run-monitoring?fixture=dropped' \
  -H 'x-tracer-user-id: dev-user-tracer'

curl http://localhost:4000/api/dashboard \
  -H 'x-tracer-user-id: dev-user-tracer'
```

The paid run stores `£84.50`. The dropped run stores `£69.50`, calculates a `£15` saving (17.75%), and persists one real price-drop event. The protected item becomes `price_dropped`, extension sync exposes the event for one-time Chrome notification delivery, and repeating the dropped run creates no duplicate observation, event, or alert.

## Activity policy

The protected-items response receives stored events, newest first. Meaningful changes such as purchase protection, monitoring pause/resume, price movement, availability transitions, and monitoring errors are recorded. Routine unchanged checks are intentionally not added to activity; `lastCheckedAt` comes from the latest stored observation instead.

## Price sources and safety

Known retailer URLs use the retailer normalizer and adapter first. Other protected public HTTPS store URLs use structured product data and remain locked to their saved host. Tracking, affiliate, session, and fragment URL data is removed while variant parameters are retained. Redirects are validated at every hop, DNS targets resolving to local/private/link-local ranges are rejected, and observations are accepted only when retailer, currency, price, timestamp, URL, product identity, and sanity checks pass. Transient network, 429, and 5xx failures get one bounded retry with backoff.

## Product imagery

Product imagery is optional enhancement data. Capture prefers an image associated with the order line item, then JSON-LD `Product.image`, then `og:image`, while skipping malformed, data, favicon, tracking, sprite, and obvious logo assets. A missing or unusable image never rejects protection or monitoring.

The dashboard keeps a fixed thumbnail region and falls back to a local retailer asset when one exists, then a neutral shopping-bag tile. Saved remote images are referenced rather than copied into a new media service; the dashboard swaps to the fallback tile if a retailer URL later fails.
