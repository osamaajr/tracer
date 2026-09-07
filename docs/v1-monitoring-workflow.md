# V1 Monitoring Workflow

Tracer monitors a protected product once per cycle, then evaluates every active purchase that references that product.

```text
Product -> price fetcher -> validated PriceObservation
        -> price comparison -> policy evaluation
        -> Opportunity lifecycle + ActivityEvent records
        -> dashboard / extension sync
```

Products are the monitoring unit. Purchases retain the paid price, purchase date, and policy context used to evaluate the same observation. A price check can therefore update multiple purchases without creating one fetch job per purchase.

## Running monitoring

The API exposes an authenticated immediate check at `POST /api/monitoring/run`. In development, `POST /api/dev/run-monitoring?fixture=paid` or `?fixture=dropped` uses the saved John Lewis fixture through the same monitoring pipeline.

For scheduled execution, run the worker:

```sh
npm run monitor -w @afterbuy/api
```

The worker checks immediately and then every `AFTERBUY_MONITOR_INTERVAL_HOURS` hours, defaulting to 12. It uses the file-backed store selected by `AFTERBUY_DATA_FILE`; production can run the same command from cron or a managed scheduled process.

## Deterministic fixture flow

Use a clean data file for a repeatable local run:

```sh
AFTERBUY_DATA_FILE=/tmp/tracer-v1.json npm run dev:api
```

Then protect `packages/core/fixtures/john-lewis/protect-purchase-request.json`, run the paid fixture once, and run the dropped fixture once:

```sh
curl -X POST http://localhost:4000/api/purchases/protect \
  -H 'content-type: application/json' \
  -H 'x-afterbuy-user-id: dev-user-afterbuy' \
  --data @packages/core/fixtures/john-lewis/protect-purchase-request.json

curl -X POST 'http://localhost:4000/api/dev/run-monitoring?fixture=paid' \
  -H 'x-afterbuy-user-id: dev-user-afterbuy'

curl -X POST 'http://localhost:4000/api/dev/run-monitoring?fixture=dropped' \
  -H 'x-afterbuy-user-id: dev-user-afterbuy'

curl http://localhost:4000/api/dashboard \
  -H 'x-afterbuy-user-id: dev-user-afterbuy'
```

The paid run stores `£349.99`. The dropped run stores `£319.99`, creates one John Lewis policy-backed opportunity, and persists price-drop and opportunity-created activity. Repeating the dropped run reuses the same observation and does not create another opportunity or duplicate activity for the same price.

## Activity policy

The dashboard receives stored events, newest first. Meaningful changes such as purchase protection, price movement, availability changes, opportunity lifecycle changes, and monitoring errors are recorded. Routine unchanged checks are intentionally not added to the user-visible timeline; `lastCheckedAt` comes from the latest stored observation instead.

## Price sources and safety

Known retailer URLs use the retailer normalizer and adapter first. Other supported public HTTPS product URLs use structured product data. Redirects are validated at every hop, DNS targets resolving to local/private/link-local ranges are rejected, and observations are accepted only when the retailer, currency, price, timestamp, URL, and product identity pass validation.

## Product imagery

Product imagery is optional enhancement data. Capture prefers an image associated with the order line item, then JSON-LD `Product.image`, then `og:image`, while skipping malformed, data, favicon, tracking, sprite, and obvious logo assets. A missing or unusable image never rejects protection or monitoring.

The dashboard keeps a fixed thumbnail region and falls back to a local retailer asset when one exists, then a neutral shopping-bag tile. Saved remote images are referenced rather than copied into a new media service; the dashboard swaps to the fallback tile if a retailer URL later fails.
