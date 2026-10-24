# Saved-item stock and price checks — 24 October 2026

## Investigation and plan

The live ASOS page for [Bershka Zoo york x bershka beanie in denim blue](https://www.asos.com/bershka/bershka-zoo-york-x-bershka-beanie-in-denim-blue/prd/211870859) displayed £19.99, an OUT OF STOCK heading and schema.org `OutOfStock` in its offer. A listed price does not establish that a product is available.

Saved-product extraction did not return availability. The saved monitor evaluated only price changes, storage had no distinct sold-out state, and the list could only show watching, a drop, or a failed check. A failed request could also restore an older unavailable item to watching without verifying recovery. The six-hour scheduled check was the only automatic refresh path used by the list.

Plan:

1. Reproduce stock loss from the ASOS offer with fixtures, including unavailable products that omit a price.
2. Carry explicit availability through extraction, identity verification, monitoring and Chrome storage.
3. Keep sold-out products separate from failed checks; suppress unbuyable price-drop alerts and require positive stock evidence for recovery.
4. Refresh stale entries when Saved opens, display a red Out of stock label, and preserve the last verified price.
5. Review variants, ambiguous offers, request failures, notification delivery, pause behaviour and browser-tab safety; run the full checks and prepare a customer package.

## Implementation

- Saved products optionally carry `in_stock`, `out_of_stock` or `unknown` availability. Existing entries migrate naturally on their next successful check; their saved price and identity remain intact.
- Stock extraction reads the matched product's offers, product availability metadata, scoped microdata and explicit product stock labels. It recognises OutOfStock, SoldOut and Discontinued. Missing or unrecognised evidence stays unknown. Hidden stock labels and recommendation cards do not establish stock for the main product.
- For unselected variants, a product is sold out only when every relevant offer says so. An available offer prevents the whole product being marked sold out. A matched variant URL controls both stock and price and remains in the saved URL. The price selector excludes a cheaper sold-out size when other offers are available, and does not resolve conflicting equal-priority prices by taking the first offer.
- A matched sold-out product may be verified without a new price. Its previous price is retained. Redirect, identity, currency, size and timeout checks remain in place; failed HTTP requests are not stock evidence.
- Monitoring stores a distinct `out_of_stock` state, clears drop styling while sold out and suppresses discount notifications for it. Unknown stock and failed checks cannot establish restocking. Positive in-stock evidence resumes the normal price comparison. Notification delivery failures stay retryable without discarding the verified price-drop result.
- Failed price checks retain the previous price and last successful check time, showing Unable to check price instead of silently restoring watching. Sold-out items retain their last verified stock state through a failed check.
- Opening Saved immediately renders its cached list, then checks legacy entries and entries at least 15 minutes old. The background owns these requests and retains its two-worker limit and six-hour alarm. The completed refresh only rerenders an active Saved view. Paused monitoring skips checks. Checks never create, navigate or activate product tabs.
- The saved list gives stock priority over drop styling, uses a red Out of stock label, and labels retained prices as last checked where appropriate. Development price-drop overrides cannot override a sold-out state.

## Verification and review

- **297 tests in 18 files pass.** Coverage includes schema.org and DOM stock signals, hidden/recommended items, mixed and selected variants, prices belonging to unavailable sizes, pages without prices, storage reloads, stale-list refresh, stock recovery, HTTP/network/currency failures, notification deduplication and the popup label/state.
- Running the 16 new stock regressions against the previous extractor produced 16 failures. Restoring the implementation passes them.
- All workspace type checks, lint and builds pass. The monitoring fixture still records one price-drop event and one notification, with no repeat event, paused check or check after clearing.
- Tests and builds ran in a temporary checkout with the repository's locked dependencies because reads in the original working folder stalled. The changed source files were copied from the working folder; the extension/core base files matched the newer remote checkout. Unrelated website changes were not part of this fix.
- A Chrome preview of the popup test harness's rendered DOM using the actual popup CSS displayed `● Out of stock`, computed colour `rgb(155, 58, 50)` and `data-alert=false`. This checks the rendered label and styling; it is not an installed-extension test.
- Reviewed the capture-to-storage-to-popup path, explicit-stock requirements, variant price selection, prior notification markers, removed/protected entries, paused monitoring, navigation guards and unchanged permissions.

## Release

Version **0.1.7** is built with production HTTPS endpoints. The customer ZIP is `output/submission-review/tracer-0.1.7-submission.zip`; validation and its SHA-256 are recorded in `output/submission-review/saved-stock-validation-0.1.7.json`. Its entries match the release directory and pass ZIP CRC validation. The local `dist` and `release` directories receive the same customer build.

The installed extension must be reloaded or updated to use the fix. Availability remains dependent on retailer evidence: a blocked, ambiguous or unsupported page cannot establish live stock, and periodic checks do not guarantee instantaneous inventory updates.


## Store submission — 24 October 2026

Uploaded the verified 0.1.7 ZIP to the existing Tracer item. The dashboard showed draft version 0.1.7 with the existing permissions and published version 0.1.5. Google then confirmed “Your extension was submitted for review”, and the item status changed to **Pending review**.

Automatic publication is **off**. Automatic approval review rejected the submission while that setting was enabled because the current request authorised submission for review, not automatic public release. The review-only submission succeeded after disabling it. Following approval, publication requires a separate action. The public version remains 0.1.5 until the approved update is published.

## Readiness check — 24 October 2026

Google has accepted 0.1.7. The live dashboard shows **Ready to publish**, with draft version 0.1.7 and published version 0.1.5. It says to publish before 24 November 2026. Automatic publication remains off; a separate Publish action is still required.

Reverified the ZIP checksum, CRC, 21 release entries and version files. All 297 tests pass again. The production API health endpoint returns OK; the website, contact, privacy and terms routes return HTTP 200. The current landing-page sources also pass the TypeScript/Vite build. The earlier faint installation-instruction styling is included in this readiness commit.
