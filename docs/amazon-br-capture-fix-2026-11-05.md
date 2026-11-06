# Amazon Brasil save capture — 5 November 2026

## Investigation and plan

Reproduced missing save candidates on the reported Amazon Brasil product pages B0H3WHDZK2 and B0H4HYLQ71. Both use short `/dp/ASIN` links whose canonical URLs add an SEO product name. The generic extractor rejects that pathname mismatch. Neither page supplies usable Product JSON-LD or OpenGraph product metadata. Their multiple headings and Portuguese input purchase controls also fail the English generic DOM evidence checks. Their main prices use Brazilian grouping/decimal separators and the R$ symbol, which the generic money parser would otherwise interpret as USD.

Plan: add an Amazon Brasil adapter for this product layout, identify products by matching ASINs, read only the main offer and stock regions, add the main image to the existing delayed image scan, and leave generic retailer guards, purchase extraction, storage, notifications and UI unchanged. Keep structured-data capture for other layouts and countries. No website source, layout, permission or endpoint changes.

## Implementation and accuracy

- The adapter is selected only for the exact Amazon Brasil hosts and the main product DOM. It accepts short, SEO and gp/product routes only when the requested and canonical ASINs match. Selected-product and main-price widget ASINs must also agree when supplied. Hidden/stale product content, non-product routes and unsafe URLs remain rejected.
- The title comes from the main product title, rather than the first H1. Known main purchase controls and main offer regions establish product evidence; a verified Portuguese sold-out state works without a buy control or price.
- BRL requires an explicit R$ symbol and a valid localized monetary amount. Accessibility labels, offscreen price text and split whole/fraction markup are supported. Conflicting main amounts omit the price; strike prices, installment amounts, delivery, warranties and ads are not scanned as offers.
- The captured price is Amazon's main displayed cash/Pix/NuPay offer on these pages, which may differ from the installment total or a buyer's checkout total. This change concerns saved product pages, not paid purchase totals.
- Stock is read only from the main availability region. “Em estoque” is in stock; “Atualmente indisponível”, “Não disponível”, “Fora de estoque” and “Esgotado” are out of stock. A shipping estimate without explicit availability remains unknown.
- Main images use the existing image ranking and delayed message flow. Other retailer image selection remains unchanged.

## Verification and review

- 332 tests in 20 files pass, including 23 new regressions for both reported products, alternate ASINs/routes, identity mismatches, listings, hidden data, conflicting prices, currency, stock, capture messages/images and direct monitoring. Eleven initial core cases failed before the implementation. The integration tests caught and drove the delayed-image fix.
- All workspace type checks, lint and builds pass. The existing monitoring fixture still produces one event and one notification, no repeats, no paused checks and no checks after clearing.
- Ran the actual production watchlist capture and saved-monitoring bundles against complete public product DOM captures from both reported pages. Capture returns the matching product/ASIN, delayed product image and BRL price; monitoring returns the same amount. B0H3WHDZK2 displayed R$5.898,63 and unknown stock (shipping estimate); B0H4HYLQ71 displayed R$5.822,45 and “Em estoque”. Browser mutations and network requests are forbidden in that capture harness. Direct-price integration tests likewise prohibit tab changes.
- Reviewed canonical/ASIN identity checks, main-offer scoping, localized price parsing, stock precedence and unchanged generic paths. Reduced public product fixtures are committed; full DOM captures and account screenshots stay local. This is captured-DOM and production-bundle verification, not an exhaustive installed-extension test on every Amazon product or every possible layout. Retailer challenges, failed requests and the existing response size limit can still prevent background checks; no bypass or new browser tabs were added.
- Tests/builds ran in a fresh locked-dependency checkout because the original iCloud-backed workspace's Git metadata can stall. Only the requested sources, tests, version and release evidence are included in the commit.

## Release

The dashboard confirmed **Published — public**, package version **0.1.8**, on 5 November. That previous release is already available to users. Version 0.1.9 contains the Amazon Brasil fix and uses the same production endpoints and permissions. The verified package is `output/submission-review/tracer-0.1.9-submission.zip`; its checksum and verification evidence are recorded in `output/submission-review/amazon-br-validation-0.1.9.json`.

Version 0.1.9 was uploaded and submitted successfully on 5 November. The dashboard confirmed the draft package version 0.1.9 and unchanged permissions, then displayed “Your extension was submitted for review” and **Pending review**. Automatic publication was enabled in the submission dialog. The currently published package remains 0.1.8 while Google reviews 0.1.9. A Store-installed copy updates automatically after publication, subject to Chrome's update checks and activation lifecycle. An uploaded draft or pending review does not update public users. Locally loaded unpacked copies require their own rebuilt files and Reload.

## Publication verified — 6 November 2026

The public Chrome Web Store listing now shows **version 0.1.9**, with its updated date displayed as 5 November. The Amazon Brasil update has been approved and published. Re-ran all 332 tests in 20 files, workspace type checks, lint and the monitoring fixture on 6 November; all passed. The submission ZIP still matches its recorded SHA-256, CRC, version and 21-file count. This is regression and package verification, not a claim that every retailer page can always be checked.
