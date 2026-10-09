# Price status display correction — 9 October 2026

## Cause

The API correctly distinguishes a failed check (`unable_to_check`) from a verified out-of-stock observation (`unavailable`). It retains the observed price separately from availability. The popup mapped both statuses to “Unable to check”, but the detail view applied red styling only to the failed-check status. This produced the reported green label beside £35 and the unavailable-stock note.

## Changes in 0.1.5

- Protected list and detail views show “Out of stock” for verified out-of-stock observations. Both out-of-stock and failed-check statuses use the existing red status styling.
- A prior local verification can no longer override a later failure or stock status with “Price checked”.
- Local store checks retain the extracted availability, including in pending purchase storage. Older stored price checks remain compatible; absent availability defaults to unknown.
- A failed refresh uses the normal detail renderer, clearing prior price-drop styling and shimmer, preserving the last verified amount and date, and marking it “Last checked price”. The failed status is also retained in the popup dashboard cache. Reopening a failed item retries the check.
- Price amounts, receipt totals, fetching, matching, notifications, permissions and browser tab behaviour are unchanged.

## Review and build evidence

- Reviewed the API serializer: `unavailable` is produced from `out_of_stock`, independently of the observed price. No API or extractor change is needed for this display issue.
- Reviewed protected list, detail, local fallback, pending persistence, cached failure and saved-item status paths. Saved-item check failures already use red styling.
- Extension TypeScript check passed.
- Development and production release builds passed, including their bundled JavaScript syntax checks. Both builds use the production API and website endpoints.
- The initial implementation pass did not run automated tests or installed-browser runtime checks.

## Final release check

The subsequent user-requested release review passes **243 tests in 15 files**, all workspace type checks, lint, all workspace builds, and the production extension build. New popup regression coverage verifies out-of-stock prices, red failure states, retained-price labelling, clearing earlier price-drop styling, retrying failed checks, and persisting local availability across pending purchase storage and list refresh.

The isolated monitoring workflow passes: one price-drop event and notification, no duplicate events on repeat, no checks after pause or clearing. The live API health endpoint returns `{"ok":true,"service":"tracer-api"}`.

The ZIP contains 21 files, unchanged permissions, HTTPS-only release host permissions, production service endpoints, and no source maps, TypeScript sources or environment files. Its entries match the release directory and its CRC check passes. Evidence is recorded in `output/submission-review/price-status-package-validation.json`. These checks do not guarantee every retailer's future page structure or Google approval.

Prepared package: `output/submission-review/tracer-0.1.5-submission.zip`. Reload the unpacked extension to use the local build. The public Chrome Web Store version does not change until this package is uploaded and published through the Store update process.
