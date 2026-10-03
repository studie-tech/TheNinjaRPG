# Stripe payments

The web points shop supports Stripe Checkout alongside PayPal. Native shells use the in-app store. Reputation purchases use the existing USD price/award curve and share the rolling 30-day purchase limit with PayPal. Monthly Federal Support costs USD 5 (NORMAL), USD 10 (SILVER), or USD 15 (GOLD). Adaptive Pricing is disabled so Checkout charges USD.

## Configuration and deployment

Apply the migration creating `StripeCheckout` and `StripePayment` before deploying application code. Federal reconciliation references these tables even when card checkout is disabled. Preserve both tables and their audit rows when rolling back application code.

Use a dedicated Stripe account and separate live and sandbox configurations. Create three active, fixed USD recurring prices with a one-month interval, quantity one, explicit inclusive tax behavior, and the exact amounts above. Configure these server-only variables:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Secret or restricted API key for the intended account/environment |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for that environment's webhook endpoint |
| `STRIPE_PRICE_NORMAL` | USD 5 monthly price ID |
| `STRIPE_PRICE_SILVER` | USD 10 monthly price ID |
| `STRIPE_PRICE_GOLD` | USD 15 monthly price ID |

Production checkout requires a live API key. Sandbox receipts cannot grant production reputation or Federal Support. Keep preview/development keys, price IDs, signing secrets and databases separate from production. A publishable key is unnecessary because the server redirects to hosted Checkout.

Configure a Stripe webhook endpoint at `https://<application-host>/api/webhooks/stripe`, using the API version supported by the installed Stripe SDK (`2026-09-30.endive` for Stripe 23). Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `invoice.paid`
- `charge.refunded`
- `charge.dispute.created`

The API key needs access to Checkout sessions (create/read/expire), prices (read), invoices (read), and subscriptions (read/update). Webhook requests must reach the application without deployment protection or an interactive login. Set `NEXT_PUBLIC_BASE_URL` to the environment's canonical application origin for return URLs.

Payout currency and schedule are Stripe account settings, independent of the USD prices. Configure monthly automatic payouts and a fixed DKK reserve in Stripe's bank/payout settings when using a DKK settlement bank account. Bank verification and business activation must be completed by the account holder.

## Tax

Checkout enables Stripe Tax for both reputation payments and Federal Support subscriptions and collects the payer's billing address, including for gifts. One-time purchases create a Stripe customer to retain the tax location. All displayed USD prices include applicable tax: tax does not increase the charged total or reduce the purchased reputation or Federal tier. Federal prices with exclusive or unspecified tax behavior are rejected.

Complete Stripe Tax settings in each environment before enabling checkout: business head-office address, a default product tax code appropriate to the digital game benefits, and active registrations matching the business's actual VAT/sales-tax registrations. Inline reputation products inherit the account's default product tax code; Federal products can have their own codes. Stripe calculates only for configured active registrations. A Danish domestic registration does not establish Union OSS registration; choose the EU small-seller option only when the business qualifies, considering sales through all providers.

Stripe retains the calculation and tax breakdown for reporting. The application retains the fixed gross USD amount in its receipt ledger and validates completed automatic tax calculations before delivery. Filing and remitting VAT remain the business's responsibility unless a separate filing service is configured. Stripe Tax configuration does not change PayPal or native-store tax handling.

## Delivery and Federal Support

Checkout terms and the buyer/recipient are persisted before contacting Stripe. A guarded buyer snapshot and reservation prevent concurrent Stripe checkouts from consuming the same remaining allowance. Retries reuse Stripe's idempotency key and the saved checkout. Returning through the cancellation URL expires the session before releasing its reservation; abandoned sessions reserve allowance for 25 hours.

Neither redirect parameters nor webhook payload amounts establish payment. Fulfillment verifies the webhook signature, retrieves authoritative Stripe state, and checks the saved USD amount, mode, identifiers and paid status. Reputation receipts use payment-intent IDs; subscription receipts use invoice IDs. A single guarded multi-table update commits the receipt claim and reputation credit together. Repeated or reordered delivery cannot credit a receipt twice; retries also repair interrupted Federal Support reconciliation.

Federal coverage follows the exact paid invoice period. Reconciliation retains the highest valid tier across Stripe, PayPal and native-store receipts. Failed renewal does not grant another period, and cancellation stops renewal while retaining already-paid coverage. Payers and recipients can cancel Stripe renewal from the Federal tab. Reputation upgrades require an owned, current paid period and atomically debit points once; the upgrade ends with that period, and the next renewal uses the original billed tier.

Character recreation settles pending retained receipts without redelivering points already spent. User-ID changes migrate Stripe checkout and receipt ownership alongside the other purchase ledgers.

## Operations and validation

Before activation, verify sandbox reputation checkout, all three subscription tiers, gifting, cancellation, first invoice and renewal delivery, duplicate webhook replay, and recovery after a failed response. Use a disposable SQL database for the purchase regression tests; the test harness truncates its configured tables. Never point it at production or a shared development database.

Watch Stripe webhook delivery failures and Sentry events tagged `source=stripeWebhook`. Fulfillment errors return HTTP 500 so Stripe can retry. Missing or invalid signatures are rejected before database work. The browser return page can retry an unresolved payment and exposes delivery status/history.

Refunds and disputes raise a Sentry warning for staff review. They do not automatically create negative balances or remove coverage from another provider. Review the Stripe event and retained payment receipt, determine whether rewards have been consumed, and resolve the account through staff procedures. Stripe's dashboard remains the source for financial refunds, disputes and payout administration.
