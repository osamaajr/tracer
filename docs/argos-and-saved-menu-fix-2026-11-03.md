# Argos detection and Saved menu default — 3 November 2026

## Investigation and plan

Reproduced the failure on Argos product 3100110 (HoMedics Novo Mini Massage Gun). Its public product data supplies the correct name, SKU, image and £29.99 offer. The extractor rejected the page because it did not recognise the main **Add to trolley** control, whose accessible markup also introduces repeated whitespace. Review and question sorting, combined with recommendation links, then incorrectly counted as product-list evidence.

The menu's **Your items** action explicitly opened Protected. Plan: recognise the real purchase control, distinguish review/Q&A sorting from product sorting, open Saved from that menu entry, and retain the separate Protected buttons and navigation behaviour. Keep layout, purchase capture, storage and notification behaviour intact.

## Changes

- Purchase-control matching recognises trolley and flexible whitespace alongside the existing bag, basket and cart labels. Recommendation-card controls still cannot establish the main product.
- Controls labelled exactly “sort reviews”, “sort questions” or “sort answers” do not establish product-list evidence. Real product sorting, explicit collection/search metadata, stale canonical URLs and unrelated recommendations retain their rejection checks.
- Your items opens Saved, closes the menu and invalidates a pending scan. Protected remains selectable, purchase-specific buttons still open Protected, and Back restores the previous screen.
- Version 0.1.8 is consistent across the manifest, package and lockfile. Production build endpoints and permissions are unchanged. No layout/CSS changes were made.

## Verification and review

- **309 tests in 19 files pass**, including 12 added regressions for both fixes. Seven regressions failed before the implementation. All workspace type checks, lint and builds pass.
- Checked complete main-product DOM captures from two live Argos pages: product 3100110 at £29.99 and product 8203809 (Neo G Airflow Knee Support — Medium) at £14.50. The old extractor rejected both; the updated extractor returns their matching identities and prices.
- Verified the saved-price checker with an Argos fixture, no tab mutations, and the existing open-product fallback after a simulated HTTP 403 using each captured product result. An unauthenticated direct request to Argos returned 403 during investigation. This fix does not bypass retailer blocking or claim every background request will succeed; stock stays unknown when postcode-specific availability has not been established.
- The monitoring fixture still reports one price-drop event and one notification, zero repeat events, zero paused checks and zero checks after clearing.
- Tests and builds ran in an isolated copy of the repository with freshly installed locked dependencies because the workspace has a history of filesystem stalls. Compared the changed sources with the working folder. The reduced committed fixture contains public product evidence; full page captures and browser/account screenshots remain local.
- Reviewed the category guards, source identity checks, recommendation exclusions, asynchronous scan cancellation, Saved/Protected separation and customer package contents. Automated checks and captured DOM verification do not constitute an exhaustive installed-extension test against every retailer.

## Release

The verified customer ZIP is `output/submission-review/tracer-0.1.8-submission.zip`. Its checksum, 21 files, CRC, unchanged permissions and test evidence are recorded in `output/submission-review/argos-and-saved-menu-validation-0.1.8.json`. Local `release` and `dist` receive this production build, with the previous directories preserved in temporary backups.

The older approved 0.1.7 was published on 3 November after the user's explicit authorisation. The dashboard confirmed **Published — public** and published package version 0.1.7. Version 0.1.8 was then uploaded and submitted successfully on 3 November. Google confirmed the submission and the dashboard shows **Pending review**. Automatic publication is enabled, so the update will release after approval; 0.1.8 is not confirmed public yet. Both GitHub-triggered Vercel deployments succeeded and the API health check returns OK.

Google twice rejected submission because its homepage connection check timed out, although both advertised website IPs returned HTTP 200. The Store homepage link was changed to the existing `https://tracercart.com/` address, which redirects to the same `https://www.tracercart.com/` website. Google accepted submission with that equivalent address. No website or DNS changes were needed.
