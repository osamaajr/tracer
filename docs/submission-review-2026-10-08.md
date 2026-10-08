# Chrome Web Store submission review — 8 October 2026

## Decision

**Do not submit the currently uploaded 0.1.1 package yet.** The corrected 0.1.2 package and website changes are prepared locally. The dashboard and live website have not been changed during this audit. Google’s final validation and review decision remain outstanding.

## Required before submission

| Finding | Prepared correction | Remaining action |
| --- | --- | --- |
| Automatic purchase detection sent a newly captured order to the API before the user clicked Protect, contrary to the privacy wording. | Match existing protections locally using the authenticated dashboard. Only previously protected orders can upload a corrected total automatically. Strip receipt query strings, fragments and URL credentials before purchase uploads. Add a disclosure beside Protect. | Upload the new 0.1.2 ZIP. |
| A delayed price refresh could overwrite an error when removing a protected purchase failed. | Invalidate the old detail render before removal; added regression coverage for successful and failed delayed checks. | Included in 0.1.2. |
| Live privacy wording omitted the Limited Use affirmation and installation authentication token, and did not identify current infrastructure providers. | Updated privacy draft describes token authentication, IP/request diagnostics, Vercel, Neon, Chrome, and Limited Use restrictions. | Review the operational commitments and deploy the website changes. |
| Listing description contained development jargon and promised claim links that the extension does not display. Landing copy promised return reminders that are not implemented. | Prepared consumer listing copy and corrected local landing copy to describe available price monitoring. | Apply listing copy and deploy website changes. |
| Dashboard does not declare Authentication information, although the extension uses a random installation token to authenticate API access. HTTPS justification refers to local HTTP development permissions absent from the uploaded release. | Prepared corrected data declaration and HTTPS justification. | Update the privacy fields; developer must confirm that declarations accurately describe operations. |
| Reviewer instructions are empty. | Prepared instructions within the 500-character limit; no login required. | Fill the dashboard field. Purchase protection still needs a completed retailer order page controlled by the reviewer; a separate public test receipt has not been deployed. |
| Small promotional tile is absent. | Prepared an opaque RGB 440×280 PNG using the existing Tracer wordmark. | Upload the tile. Google’s [image guidance](https://developer.chrome.com/docs/webstore/images) lists this asset as required; dashboard submission validation has not been triggered. |

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

- Draft, uploaded version 0.1.1, public distribution, free, all regions, Shopping category, English UK, mature content off.
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

External changes remain pending: website deployment, new package upload, listing/privacy/test field changes and promotional tile upload. Submission for review remains the user’s next decision after those changes are verified.
