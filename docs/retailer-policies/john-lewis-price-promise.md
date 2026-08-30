# John Lewis Price Promise

Last verified: 2026-08-30

Sources:

- https://www.johnlewis.com/customer-services/prices-and-payment/prices-at-john-lewis
- https://www.johnlewis.com/customer-services/prices-and-payment/price-promise
- https://www.johnlewis.com/customer-services/prices-and-payment/price-promise/request

## V1 Interpretation

John Lewis says eligible purchases made in its shops, website, or app can be price matched within 7 days of placing the order. The window starts at order placement, not delivery or collection.

The policy includes John Lewis's own price reductions within 7 days and lower prices from its listed competitors, subject to terms.

For AfterBuy V1, we only monitor John Lewis's own product price for the exact product the user bought. We do not perform competitor-wide comparison yet.

## Eligibility Facts Stored In Code

- Retailer: John Lewis & Partners
- Policy version: `2024-10-15`
- Effective from: `2024-10-15`
- Window: 7 days
- Window starts: order placed
- Own-retailer price reductions: supported
- Competitor reductions: policy supports them, but AfterBuy V1 does not monitor competitor prices
- Claim route: https://www.johnlewis.com/customer-services/prices-and-payment/price-promise/request

## Consumer Copy Guardrails

AfterBuy should say:

- "potentially claimable"
- "may be eligible"
- "John Lewis will decide eligibility"
- "check the item is identical, in stock, and not excluded"

AfterBuy should not say:

- "John Lewis owes you"
- "guaranteed refund"
- "claim approved"

## Known Exclusions To Surface Later

- Third-party marketplace sellers
- Reduced-to-clear or final-reduction prices
- Multi-buy offers
- Member-only prices
- Flash sales
- Voucher, discount-code, exclusive, trade, or obvious-error prices
- Selected services, concessions, and excluded product categories
