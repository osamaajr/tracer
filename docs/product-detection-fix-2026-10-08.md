# Premature product detection fix — 8 October 2026

## Cause and evidence

The user’s filtered Decathlon category page publishes JSON-LD `Product` named “Sunglasses”, with its own category URL and an `AggregateOffer` ranging from £6.99 to £178.90. It has a product grid, 338 results, sorting controls, and no main purchase control. The previous extractor accepted the Product type and URL without checking that this was an individual item.

## Changes

- Generic category/search routes, CollectionPage/SearchResultsPage, page mainEntity ItemList, and sorting with product links are excluded. Actual product detail controls and routes preserve pages with review sorting and recommendations.
- Category AggregateOffer data requires independent product detail evidence; OpenGraph alone requires a detail route or main purchase control. Quick-add controls and forms in unrelated cards cannot establish page identity.
- Stale cross-page canonical metadata and recommended product/offer URLs are rejected. The existing Shopify collection/product canonical form is preserved.
- Microdata recommendations are excluded from the main product extraction. ProductGroup variants are selected by the matching offer URL; supported current UnitPriceSpecification prices are read. Original list price specifications and unequal aggregate price ranges are not claimed as current prices.
- Capture responses retain the original page URL, discard results after navigation, and skip stale image scans. Popup rendering and saving recheck the tab URL and scan identity.

No Decathlon-specific runtime rule was added. Saved storage, purchase flows, extension design, permissions, notifications, and the previous tab-free monitoring implementation remain intact. Existing erroneously saved categories are not automatically deleted.

## Validation

- Full suite: **240 tests passed**, including 27 new cases since 0.1.3 covering category metadata, listing routes, sorting/quick-add, recommendations, variants, microdata, stale canonicals, capture/image navigation, and save navigation.
- Workspace typecheck and lint: passed.
- Development and production release builds: passed, version **0.1.4**.
- Actual packaged watchlistCapture.js and savedMonitoringCapture.js were run against captured DOM samples from the live category and Perf 100 light pages. Both reject the category, accept the actual product at **£14.99**, and leave page markup unchanged. Samples were capped by the browser read-only DOM interface at approximately 200 KB; the relevant metadata and main product controls were present.
- Repeatable packaged fixture check: `node scripts/verify-product-detection.mjs`.
- Tab-free monitoring harness: eight scheduled checks and eight alerts, no duplicate alerts, **zero browser mutations**, verified prices retained offline; startup and stale restored alarms do not run checks.
- Purchase monitoring harness: one event/notification, no repeated events, paused/cleared checks zero.
- Chrome live popup on the reloaded 0.1.4 build: category displays “Nothing to save here”; real product displays “Already saved” with Perf 100 light. Final route/mainEntity safeguards were added after this first browser check; a second reload was requested after the final build.

Proofs: `output/submission-review/category-detection-fixed-proof.png`, `genuine-product-detection-proof.png`, and `product-detection-validation.json`.

## Review package

`output/submission-review/tracer-0.1.4-submission.zip` contains 21 files from the verified release directory. Manifest permissions are unchanged and production host permissions remain HTTPS only. This package includes both the tab-opening fix and this product-detection fix.

SHA-256: `02fc8fc6472a02fd54558c4fe5c09dca4d31bc12e509d0f1a335da0b1dc91efe`

The existing Chrome Web Store review still refers to 0.1.2. No review cancellation, new upload, or submission was performed during this task; approval to replace the pending review remains outstanding.
