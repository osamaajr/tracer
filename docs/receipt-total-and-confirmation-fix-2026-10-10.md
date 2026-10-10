# Receipt total and confirmation layout — 10 October 2026

## Investigation and plan

The supplied receipt shows an £18.00 sale item, £3.99 delivery, and a final £21.99 total. Its note says “Order total is inclusive of £3.66 in VAT.” The previous parser accepted any text starting with “Order total”, then selected the last candidate of equal strength. A regression using this receipt structure reproduced an incorrect **£3.66** order total. A bare Total row also required a summary class or attribute, missing summaries identified by a heading alone.

The protected screen inherited `overflow-y: auto` on a fixed 590px frame. The confirmation used independent content heights and spacing, and focusing its CTA could scroll the frame. Before the layout fix, a Chrome preview at 380×590 measured a 616px scroll height inside the 590px frame.

Plan: reproduce the failures first; require a final charge label directly paired with its amount; recognize summary headings; reject equally strong conflicting totals; exclude previous and hidden price text; keep item prices independent of the complete order charge; fit active confirmation screens to their available height; verify the capture, protection and popup paths, then build and push.

## Implementation

- Final-charge labels must be complete and immediately precede their amount. VAT explanation, savings, partial totals and amounts due are excluded. Generic Total rows need summary context, recognized through existing markers or a direct summary heading.
- Equally strong conflicting totals return no verified order total rather than selecting whichever occurs last. Explicit numeric total attributes and single-amount total markers remain supported. Negative charges retain their sign and are rejected by the money parser; structured totals must use the expected currency.
- Shared receipt price text skips semantic crossed-out prices, old-price markers and hidden copies, preserving separation between adjacent labels and amounts. Generic DOM, Shopify and content-script fallback price extraction use it. Ordinary regular prices and quantity-aware line totals remain supported.
- Detected, protected and already-protected screens use a bounded flex layout with a fixed header and actions anchored within the frame. Product names use a three-line visual limit while retaining their full DOM text. The receipt height and spacing leave room for long names and offline messages. CTA focus uses `preventScroll`. The existing review form and item lists retain their scrolling.
- Extension version is **0.1.6**. Development and release builds use the production API and website URLs. Permissions are unchanged.

## Review and evidence

- The initial final-total regressions failed before the correction, including the £3.66 VAT reproduction. They pass after the correction.
- **271 tests in 17 files pass**, including capture-to-popup total propagation, preserving the £18.00 item price separately from £21.99, focus options, hidden/old price ordering, summary headings, currency and ambiguity safeguards, and correcting an existing protection without creating a duplicate purchase.
- All workspace type checks and lint pass. All workspace builds and the final extension development/release builds pass, including generated JavaScript syntax checks. `git diff --check` passes.
- The isolated monitoring workflow passes with one price-drop event, one notification, no repeat events, no paused checks and no checks after clearing.
- Chrome layout previews at 380×590 cover protected, protected with long name and offline copy, detected with long name, and duplicate with long name and offline copy. Each measured `main.clientHeight = main.scrollHeight = 590`, `main.scrollTop = 0`, and a header top at 20px. Final actions remained within the viewport; only the active purchase screen was displayed.
- Reviewed extraction fallbacks, unit and line totals, existing protection correction, popup rendering, active screen selectors, review-form scrolling, version files and release permissions.

## Release and limitations

Prepared `output/submission-review/tracer-0.1.6-submission.zip`. Its 21 entries match the release directory, pass ZIP CRC validation, use HTTPS-only host permissions and contain no source maps, TypeScript sources or environment files. Validation is recorded in `output/submission-review/receipt-total-package-validation-0.1.6.json`.

The original order tab was no longer available during inspection, so the price reproduction uses an anonymized receipt layout based on the screenshot. The later Mac lock prevented saving a final preview screenshot, reloading the installed extension and checking the actual order again. The browser viewport reset also could not be confirmed after that interruption. The prepared build has not been uploaded to the Store; 0.1.5 was last confirmed pending review on 9 October. A GitHub push does not update the installed/public extension. No claim is made that every future retailer layout is supported.
