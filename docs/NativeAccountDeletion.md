# Permanent native account deletion

The native apps expose **Delete account permanently** in device settings and the shared
footer, including for signed-in users without a character. Ordinary browsers do not
render the link or page. The existing web character-deletion flow is unchanged.

The account is shared across platforms: a request made in a native app also removes
that account's website access. The native user-agent check selects the supported
surface; it is spoofable and is not an authentication boundary.

## Confirmation and identity

The flow presents an irreversible-loss explanation, subscription-management links,
a second confirmation dialog, two required acknowledgements and the exact phrase
`DELETE MY ACCOUNT`. It binds confirmation to the currently displayed Clerk identity
and prevents duplicate taps. The server independently checks every acknowledgement,
the identity binding and Clerk multi-factor reverification within five minutes.
Clerk falls back to available first factors for accounts without MFA. Email codes are
supported when enabled in the Clerk instance; no custom OTP store or mailer is added.
Cancelling verification does not queue deletion.

For Apple-linked iPhone accounts, the updated native plugin supplies a single-use
Apple authorization code. The server exchanges it, validates the signed ID token
against Apple's issuer/audience and the Clerk-linked Apple subject, and revokes the
refresh token. Tokens and codes are never saved in the queue. Android/older clients
can use an Apple access token held by Clerk; if none exists, the request fails before
queuing and requires the updated iPhone flow. This edge case needs acceptance testing
and a support path before the feature is enabled for all accounts.

## Execution

`POST /api/native/account-deletion` records an idempotent request against the authenticated
identity, returning 202 only after saving it. `/api/account-deletions` runs every five
minutes under `CRON_SECRET`, claims a bounded set of jobs with an expiring CAS lease,
and retries failed work. The phases are:

1. QUEUED: revoke any remaining Apple authorization and delete the Clerk identity.
   A Clerk 404 is success on retry. Verified-email reminder records are removed first.
2. IDENTITY_DELETED: wait five minutes for short-lived tokens/in-flight requests to
   drain, then clean processor and game data. Active auction escrow must settle through
   the normal auction worker first; deletion does not bypass balance/receipt guards.
3. COMPLETE: only after cleanup succeeds. Clear the temporary Apple-subject reference;
   retain the minimal queue record and the existing purchase tombstone for idempotency.

Client sign-out uses the existing NativeBridge cleanup for push binding, widgets,
purchase identity and Live Activities. Failed worker steps remain pending, back off
one hour and report to Sentry; the cron response is unsuccessful when a job fails.
The service does not cancel subscriptions or issue refunds. The confirmation explains
this and links to each billing provider's subscription controls.

Cleanup reuses the existing character cleanup and adds newer personal-data tables,
verified-email reminders, support content, owned upload records/storage, RevenueCat
customer deletion, clan departure and vacated role cleanup. Purchase/entitlement
ledgers remain for reconciliation and duplicate-grant protection. Shared authored game
assets, accounting/auction records, analytics provider retention, backups and legacy
untracked avatar/audio blobs require an explicit retention/erasure audit; this PR is
not a blanket assertion that the store privacy disclosures are complete.

## Enablement and validation

- Apply migration `0046_sudden_outlaw_kid.sql` through the normal migration workflow.
  It only creates the AccountDeletion queue and index. It was generated, not applied.
- Configure `CRON_SECRET`; verify cron delivery and failure alerts on the target deployment.
- Configure `APPLE_SIGN_IN_CLIENT_ID`, `APPLE_SIGN_IN_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`
  and `APPLE_SIGN_IN_PRIVATE_KEY` using a Sign in with Apple key, not APNs/IAP keys.
  The client ID must match the authorization source; the native iPhone code uses the
  app's bundle ID. Test any legacy Service ID tokens separately.
- Configure `REVENUECAT_SECRET_API_KEY` if RevenueCat SDKs are enabled. Verify deletion
  against a disposable sandbox customer and ensure retained receipts cannot re-grant.
- Enable Clerk email-code reverification or another supported factor for every login
  configuration; test password, social-only, Apple and MFA accounts.
- Test the queue on a throwaway database with disposable Clerk/processor identities,
  including no character, banned/silenced accounts, clan/ANBU leadership, active auctions,
  duplicate requests, expired verification and interrupted cleanup.
- Compare both native UIs on physical devices, including sign-out cleanup. iOS needs
  a newly built shell for the authorization-code addition.
- Resolve the retention/legacy media and Apple-on-Android cases above before setting
  `NATIVE_ACCOUNT_DELETION_ENABLED=true`. It defaults to false in the example environment.

Automated validation covers request authorization/confirmation, queue step ordering
and failure boundaries, Apple subject/signature/revocation guards, web UI exclusion,
confirmation reset, verification cancellation, duplicate taps and error feedback.
Real provider deletion and database cleanup were not executed against production.

Google Play still requires an external account-deletion request URL. Restricting this
interactive flow to native apps does not satisfy that separate listing requirement;
no public web deletion form is introduced in this PR.

## Federal console update accompanying this work

Production PayPal plan lookup on 2026-09-12 confirmed monthly USD prices of Normal
5.00, Silver 10.00 and Gold 15.00. Apple subscription drafts now have those exact US
base prices and Apple regional equivalents, one-month duration and English localization:

| Tier | Product ID | Apple ID | Group level |
| --- | --- | --- | --- |
| Gold | tnr_federal_gold | 6811402238 | 1 |
| Silver | tnr_federal_silver | 6811402982 | 2 |
| Normal | tnr_federal_normal | 6811403124 | 3 |

All remain Prepare for Submission, with no review submission or public release.
Google prices could not be entered because the new app's policy/terms creation gate
remains incomplete; no new Play listing or subscription was created.

## References

- https://clerk.com/docs/guides/secure/reverification
- https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens
- https://developer.apple.com/support/offering-account-deletion-in-your-app
- https://www.revenuecat.com/docs/api-v1/customers
- https://support.google.com/googleplay/android-developer/answer/13327111
