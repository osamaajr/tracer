# Chrome Web Store submission review — 8 October 2026

## Later monitoring correction

The Store draft is now **Pending review**. A subsequent user report exposed saved-item monitoring opening browser tabs. That mechanism is removed in 0.1.3, built and installed locally, with 213 passing tests and package-level regression checks. The corrected ZIP is prepared, but has not replaced the pending 0.1.2 submission; cancellation requires user approval. See [the monitoring fix report](saved-monitor-tab-fix-2026-10-08.md).

## Decision

**The required corrections have now been applied.** Version 0.1.2 is uploaded to the existing Chrome Web Store draft. The privacy policy and corrected landing copy are live. Listing, privacy, reviewer instructions and the small promotional tile are saved. The draft remains unpublished and is now pending Google review; see the later 0.1.3 correction above.

## Findings and corrections

| Initial finding | Correction | Completion |
| --- | --- | --- |
| Automatic purchase detection sent a newly captured order to the API before the user clicked Protect, contrary to the privacy wording. | Match existing protections locally using the authenticated dashboard. Only previously protected orders can upload a corrected total automatically. Strip receipt query strings, fragments and URL credentials before purchase uploads. Add a disclosure beside Protect. | Uploaded 0.1.2 and compared the processed Store CRX with the reviewed release. |
| A delayed price refresh could overwrite an error when removing a protected purchase failed. | Invalidate the old detail render before removal; added regression coverage for successful and failed delayed checks. | Included in uploaded 0.1.2. |
| Live privacy wording omitted the Limited Use affirmation and installation authentication token, and did not identify current infrastructure providers. | Updated privacy draft describes token authentication, IP/request diagnostics, Vercel, Neon, Chrome, and Limited Use restrictions. | Deployed after user approval; verified the new wording on the public privacy page. |
| Listing description contained development jargon and promised claim links that the extension does not display. Landing copy promised return reminders that are not implemented. | Prepared consumer listing copy and corrected local landing copy to describe available price monitoring. | Listing saved and website deployed; both verified. |
| Dashboard does not declare Authentication information, although the extension uses a random installation token to authenticate API access. HTTPS justification refers to local HTTP development permissions absent from the uploaded release. | Prepared corrected data declaration and HTTPS justification. | Saved Authentication information, corrected purpose/HTTPS justification and precise price-alert justification; existing developer certifications were unchanged. |
| Reviewer instructions are empty. | Prepared instructions within the 500-character limit; no login required. | Saved 484-character instructions. Purchase protection still needs a completed retailer order page controlled by the reviewer; a separate public test receipt has not been deployed. |
| Small promotional tile is absent. | Prepared an opaque RGB 440×280 PNG using the existing Tracer wordmark. | Uploaded and saved the tile. Google’s [image guidance](https://developer.chrome.com/docs/webstore/images) lists this asset as required; dashboard submission validation has not been triggered. |

## Prepared artifacts

- `output/submission-review/tracer-0.1.2-submission.zip`
- `output/submission-review/package-validation.json`
- `output/submission-review/listing-description.txt`
- `output/submission-review/privacy-fields.txt`
- `output/submission-review/reviewer-instructions.txt`
- `output/submission-review/tracer-small-promo-440x280.png`
- `output/submission-review/protection-notice-preview.png`
- `output/submission-review/tests-final.json`

The privacy source is `apps/web/src/App.tsx`. Preview it at `http://127.0.0.1:5174/privacy` while the local development server is running. The server listens on loopback.

## Checks completed

### Package and implementation

- Downloaded and extracted the actual uploaded CRX for extension ID `dhefgfndmihnonnclclmmjmgnhidgokm`; version 0.1.1 matched the release bundles present before audit edits.
- Manifest V3; service worker module; bundled executable code; no remote executable scripts, eval, source maps, environment files or private keys found in the release package.
- Release host permission is HTTPS across retailer domains. Source development HTTP patterns are absent from release. Permissions are activeTab, alarms, notifications, scripting and storage; justifications were reviewed against implemented features.
- Manifest resource paths and icon dimensions were checked. New ZIP has manifest.json at its root and production service URLs. ZIP readback and all six JavaScript syntax checks passed.
- New 0.1.2 package validation and SHA-256 are recorded in package-validation.json.
- All **185 tests in 13 files passed**, including 10 protection-lookup privacy tests and regressions for removal errors during a delayed price check. Five original popup failures were stale expectations or test timer isolation; one exposed the actual removal race.
- Workspace type checks, lint, API build, web production build, extension release build and monitoring workflow verification passed.
- Monitoring verification observed one price-drop event/notification, no duplicate on repeat, and no monitoring after pause or clearing. This was an isolated fixture workflow, not production customer-data mutation.
- Visual preview of the new purchase disclosure fits within the 394×590 popup; its final action ends above the lower edge. This was a static layout preview, not an installed 0.1.2 Chrome session.

### Live services

- Homepage, Privacy, Terms and Contact returned HTTP 200 and were inspected in a browser. Names/email remain on Contact; legal pages use plain headers.
- API health returned 200 with the expected service response. The endpoint checks the configured database connection. This does not independently prove future cron execution or every persistence operation.
- Unauthenticated dashboard access and the development identity were rejected with 401. The cron route rejected requests without its secret. Chrome extension CORS preflight accepted the expected origin and token header.
- A read-only check through the actual product fetcher returned **£35 GBP** for Seven Gates variant **54776061722968**, with availability **out of stock**. Exact product URL: https://sevengatesjewellery.com/products/clover-bracelet-full-silver-charm-bracelet?variant=54776061722968 . This is the item price, separate from the screenshot’s £32.74 final order total.
- No real customer purchase was created, deleted or modified as part of the production checks. OS notification delivery and production purchase CRUD were not exercised.

### Dashboard

- Draft initially used version 0.1.1; replaced with verified 0.1.2. Public distribution, free, all regions, Shopping category, English UK, mature content off.
- Correct 128px logo and five screenshot slots populated. Screenshot thumbnails were inspected. Uploaded asset dimensions were not independently downloaded from the dashboard; source marketing/screenshot assets had been prepared to listing dimensions earlier.
- Homepage, support and privacy URLs point to live Tracer pages.
- Remote-code answer is No and agrees with the package. Existing Limited Use certifications were already checked by the developer and were not changed.
- Authentication fields for reviewers can remain blank because the extension has no account sign-in. Existing purchase pages may require the retailer’s own authentication.
- No submit button was pressed. No Google agreement was accepted or re-certified during the audit. Developer-account two-step settings were not independently inspected.

## Launch follow-up

The website’s Add to Chrome actions currently point to its own install section. Once the listing is approved and publicly available, set them to the verified Chrome Web Store URL and check the installation path. A public draft listing cannot yet provide an install flow.

Some real screenshots show a retailer order reference and URL plus an expired-link notice. Consider replacing those with a clean demonstration order view before broad publication. The visible URL flag is not evidence of a leaked authentication token.

Price capture depends on the retailer exposing reliable public data and matching variants. A successful check for this example does not establish support for every retailer. Google approval is not guaranteed by these checks.

## Policy references

- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies): disclosure, Limited Use, bundled code and permission requirements.
- [User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): explaining local and transmitted extension data.
- [Privacy dashboard fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy): single purpose and data disclosures.
- [Listing images](https://developer.chrome.com/docs/webstore/images): icon, screenshot and promotional image requirements.

External updates completed after user approval: GitHub main and codex/vercel-api-deployment pushed at 5f5121e; Vercel website and API deployments both succeeded; the production privacy page and API access guards were checked again. Version 0.1.2, listing/privacy fields, reviewer instructions and promotional tile are saved in the Store draft. Submission for review remains the user’s next action.

## Uploaded package verification

The downloaded 0.1.2 Store CRX has 19 assets byte-identical to the reviewed release. Its manifest matches apart from the normal Google update_url addition. Results are saved in output/submission-review/uploaded-crx-validation.json. No CRX was installed during this comparison.

## Product detection addendum — 0.1.4

The latest prepared package is `output/submission-review/tracer-0.1.4-submission.zip`. It includes the tab-free monitoring fix plus generic category/listing and stale navigation safeguards. The final suite passes 240 tests; packaged capture scripts reject the reported category and read the actual Decathlon product at £14.99. Details are in `docs/product-detection-fix-2026-10-08.md`. The pending Store review has not been cancelled or replaced.
