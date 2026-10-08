# Saved-item monitoring tab fix — 8 October 2026

## Cause

The six-hour saved-item alarm used `chrome.tabs.create({active:false})` for every saved product, with two checks running concurrently. Inactive tabs still appear in Chrome's tab strip. An interrupted worker or a redirected page could also leave a tab behind. Cleanup did not prevent the initial disruption.

## Version 0.1.3

- Replace tab creation with bounded HTTPS requests and a packaged HTML parser (`linkedom/worker`). Reuse the existing product, sale-price and Zara application-data extractors. Retailer JavaScript is never executed from a fetched response.
- Reject unrelated products, conflicting identifiers/currencies, non-product pages, unsafe or product-changing redirects, empty/oversized responses and invalid prices. Requests retain the saved product's variant query parameters.
- If direct extraction fails, read only a matching, already loaded product tab. An isolated, read-only capture returns metadata without registering popup listeners, changing the document, scanning images, navigating or activating the tab. Recheck its URL before accepting the result.
- Preserve saved data, alert preferences, six-hour scheduling, two concurrent checks, single-flight monitoring, baseline/drop calculations, duplicate alert suppression, retryable notifications, and protected-purchase behavior.
- Preserve valid stored prices after unavailable checks. Stores that block requests or expose data only after JavaScript runs need a matching product tab already open for the fallback. Such failures never create a replacement tab or fabricate a price.
- Keep narrow migration cleanup for the exact `#tracer-internal-price-monitor` marker from older versions. Ordinary tabs are never closed by this cleanup.
- Update only the privacy sentence and permission justification describing the old background-tab mechanism. No additional permissions.

## Verification

- Full suite: 213 tests passed; workspace type checks and lint passed.
- Tests cover batch/concurrent/repeated checks, pause/protected/unavailable modes, failures, removed items, baseline establishment, alert delivery failure, duplicates/recovery, DOM sale prices, Zara, variant/SKU mismatch, wrong products/currency, unsafe redirects, size limits, existing-tab navigation and timeouts.
- `node scripts/verify-saved-monitor-no-tabs.mjs` executes the actual release background bundle with browser mutations forbidden. The alarm checked eight items and delivered eight distinct alerts with zero browser mutations. Repeated checks produced no duplicate alerts; offline checks retained prices. Startup and stale restored alarms did not run the watchlist immediately.
- The same script executes the bundled existing-tab capture without Chrome message/listener APIs and confirms the price and unchanged document.
- Existing protected-purchase workflow verification passed (one alert, zero duplicate events, zero paused checks).
- Live HTTP probes returned Seven Gates £35 and Buchan £102. H&M returned HTTP 403 in the independent Node probe; UNIQLO returned HTML without extractable product price. These were treated as unavailable, not incorrect prices. This probe did not reuse the user's Chrome cookies or execute store scripts.
- Dev and customer release builds passed. Customer package uses the production API/dashboard and HTTPS-only host access.
- ZIP compared byte-for-byte with the previous 0.1.2 ZIP: only background.js, manifest.json (version), and the new savedMonitoringCapture.js differ. Popup, styling, manual capture, purchase checker and all other assets are identical.
- Chrome's existing unpacked installation (`ejkflmhmochgmojiikdpnkkjbmjknpfo`, apps/extension/dist) reloaded as 0.1.3. The saved list still contains five items. Installation ID, storage, and permissions were retained.

## Distribution

Prepared: output/submission-review/tracer-0.1.3-submission.zip.
Validation: output/submission-review/tab-free-monitor-validation.json.

The Chrome Web Store currently shows the previously uploaded draft as **Pending review**. The 0.1.3 package has not replaced it: replacing a pending package requires cancelling its review and submitting the corrected package again. User approval is needed before cancelling that pending review. No automatic submission or publication was performed.
