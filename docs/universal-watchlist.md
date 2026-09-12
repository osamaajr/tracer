# Universal Watchlist

Tracer now supports a lightweight pre-purchase save flow alongside the existing protected-purchase flow. No API schema or database migration is needed.

## Storage and identity

`SavedProduct` / `SavedItem` are separate domain types. The background service worker owns `WatchlistRepository`, which uses `chrome.storage.local` under `tracerWatchlistV1`. Saved items persist through popup closure, navigation, browser restart, and service worker restart. They are local to this browser profile, not synced to an account or other devices.

The repository serializes writes so concurrent save/remove/convert operations cannot overwrite each other. Duplicate saves use the normalized canonical URL. Existing URL helpers strip fragments and known tracking parameters, preserve meaningful generic-store query parameters, and apply retailer-specific John Lewis normalization.

Saved entries retain their name, retailer, canonical URL, original optional price/image, optional product ID/SKU, and saved timestamp. No purchase date, quantity, policy, or monitoring record is invented.

## Extraction and UI

Manual toolbar opens are save-first: Tracer runs product extraction and shows either Save to Tracer or Nothing to save here. Automatic order-confirmation opens use the background worker's cached verified purchase and retain the protection flow. No polling or page-wide observer is added. JSON-LD Product data (including graph/mainEntity), product OpenGraph metadata, product-scoped microdata, and a conservative product-route/add-to-cart control fallback provide product evidence. Arbitrary first prices, price ranges, ambiguous product lists, and unknown currencies are omitted. Missing optional data does not prevent saving. Unsupported and unsafe URLs, non-product routes, and cross-store canonical URLs are rejected.

The new screen offers Save to Tracer, a confirmation or Already saved state, View saved items, and Continue browsing. Your items has Saved and Protected buttons. Saved cards offer Open item and Remove, and label prices as a saved snapshot. Existing settings and protected cards remain in place.

## Becoming protected

After successful protection, the API's accepted purchase records are reconciled with Saved. Matching is scoped to the retailer hostname and uses product ID, SKU, then canonical URL; conflicting stronger IDs prevent a URL-only match. Only accepted lines transition. A linked entry is retained with `status: protected`, `protectionId`, and `protectedAt`, preserving its original metadata while removing it from the Saved list. The existing Protected list remains backed by the existing purchase repository.

Queued offline purchases keep their Saved entry until the server accepts protection. The existing sync path performs reconciliation after acceptance. Watchlist write failures cannot turn successful protection into a failed purchase request. Reconciliation is best-effort; extraction differences or a failed local write can leave an item in Saved, where it can be removed independently.

Removing a Saved item does not delete purchases, price observations, activity, notification history, or archived conversion metadata. Clearing protected purchases does not clear the watchlist.

## Monitoring and scope

Only existing protected purchases enter the monitoring and notification pipeline. Saved prices are a snapshot; Saved does not promise price refreshes, price alerts, stock alerts, or variant tracking. Saving is a pre-purchase convenience and does not mark a purchase as protected. No folders, tags, notes, price targets, variant selectors, social sharing, or checkout features were added. Broad compatibility is best-effort, not guaranteed for every store.

## Local verification

1. Run `npm run build` and load/reload `apps/extension/dist` as an unpacked extension in Chrome. Run `npm run dev` for the existing API and landing page.
2. Open a real public HTTPS product page with JSON-LD Product or product metadata, open Tracer, and choose Save to Tracer. Confirm it offers View saved items without claiming protection or monitoring.
3. Open Your items → Saved. Close/reopen the popup and browser; the item should remain. Open the product again and save it: Already saved should appear, with one row.
4. Check a product with no reliable price/image: the product should still save when its name and product URL can be established. Ordinary articles and cart/order pages must not offer the pre-purchase save flow.
5. Switch between Saved and Protected. Remove a Saved entry and confirm that existing protected purchases and activity remain.
6. For a purchase you actually made, open its order confirmation and use the existing Protect flow. A matching Saved entry moves out of Saved only after acceptance. With the API offline, the existing pending-protection flow remains; the Saved entry stays until sync succeeds.
7. Run `npm test` for deterministic extraction, repository reload, concurrent duplicate prevention, conversion, popup flow, API, and monitoring coverage without buying anything. Run `npm run typecheck` and `npm run lint`.
8. Run `node scripts/preview-extension-states.mjs`, then open `/extension-states/` on the local web server to inspect watchlist, saved confirmation, duplicate, saved-list, and empty-list visual states alongside the original screens.
