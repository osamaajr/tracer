# Extension refresh

Restore point before the refresh: `1c6f009` (Landing B and extension checkpoint).

The popup uses Landing B’s bundled wordmark and serif font, sky-to-pearl background, rounded controls, and solid card surfaces. Existing DOM hooks and purchase actions are preserved. The popup scrolls within Chrome’s height limit and respects reduced motion.

## Verification

- Extension TypeScript and production build pass.
- Monitoring integration script passes: capture/protect, price reduction, one notification, repeat suppression, pause, and clearing purchases.
- Added regression coverage for duplicate event IDs within one notification sync.
- Full Vitest and popup regression runs were started, but did not complete during this refresh; do not report those as passed.

## Release gaps

- Monitoring requires the API service configured by the extension. The default is a local development service, not a hosted production service.
- Known retailer policy eligibility is evaluated; arbitrary return-window deadline reminders are not implemented. The landing-page return-reminder example is not evidence of that capability.
- Retailer extraction and price fetching cannot guarantee all websites: blocked pages, ambiguous prices, unsupported markup, and missing purchase details require fallback states.
- Chrome runtime visual testing and real notification permission/OS behavior still require verification with the unpacked extension.

The extension has detecting, idle, incomplete, error/retry, review, detected, protected, duplicate, empty/list, detail, settings, and clear-confirmation states. These states should be included in the release smoke test; existence alone does not prove every runtime transition.
