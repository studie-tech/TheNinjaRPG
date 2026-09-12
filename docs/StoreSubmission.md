# Mobile release preparation

Audit date: 2026-09-12. Initial baseline: main `1e0618ffa`; native foundation PR #1477 is merged.
For the latest saved console settings, screenshots and outstanding declarations, see
`docs/StoreConsoleAudit.md`. Earlier audit observations below are not a fresh deployment check.
This checklist distinguishes source implementation from verified device behavior.

## Account and deployment audit

- Apple developer team: `MX8NV56ULD` (Studie-Tech ApS); membership active.
- Registered main App ID: `com.theninjarpg.app`, with App Groups, Associated Domains,
  Push Notifications and Sign in with Apple. In-App Purchase is enabled by default.
- Registered widget App ID: `com.theninjarpg.app.widgets`, with App Groups enabled.
- Registered shared container: `group.com.theninjarpg.app`, assigned to the main app
  and widget extension.
- Created TheNinja-RPG in App Store Connect, app ID `6811351173`, English (US), SKU
  `theninjarpg-ios`. Saved description, promotional text, keywords, marketing URL,
  copyright, subtitle, Games / Roleplaying / Strategy categories and manual release.
  No build or review submission has been uploaded.
- Apple Paid Apps agreement is active through 2027-08-30 following the account holder's
  update. The business page still requests bank holder address/type. Recheck final EU
  trader verification status before review.
- Google has a removed legacy listing, `com.ST.TNRmobile`. Policy removal dates to
  August 2018; the console gives no specific violation. Decide whether to restore it
  or create a fresh `com.theninjarpg.app` listing. A fresh listing still needs policy compliance.
- Google payouts are on hold pending identity verification. The payments page also
  requests Ireland tax information; the account holder must resolve these.
- Vercel `the-ninja-rpg/tnr` production is Ready at the baseline commit. All mobile
  variables below were absent at audit; no shared variables are linked. Saved production
  config values `APNS_TEAM_ID=MX8NV56ULD`, `APNS_BUNDLE_ID=com.theninjarpg.app`, and
  `APNS_USE_SANDBOX=false`, plus Production Secret values `APNS_KEY_ID` and
  `APNS_PRIVATE_KEY`. A new deployment is still needed to apply them. Remaining
  mobile variables are absent. Secret values were not revealed.
- Production `/api/healthcheck` responds 200 with `Access-Control-Allow-Origin:
  https://localhost`. Both association endpoints respond 404 until configured.
- Apple APNs key `CC2JQW2JU7` (TNR Production Push) is registered for Production,
  topic `com.theninjarpg.app`, and backed up with private filesystem permissions outside
  Git. Imported into Vercel as Production secrets and verified present.
- Firebase project `theninja-rpg` is on the no-cost Spark plan, with Cloud Messaging V1
  enabled. Android app `com.theninjarpg.app` is registered and its downloaded config
  installed in the ignored native project. Dedicated server credentials remain pending.
- RevenueCat onboarding is complete for project `2f919f80` (TheNinja-RPG), category
  Games and framework Capacitor. The owner confirmed email verification. Entitlement
  `federal` (Federal Status, `entle04e329c97`) is created without products attached.
  Apple integration `appa77c2771cd` is saved for `com.theninjarpg.app` and reports
  Valid credentials. Approved Apple key
  `TNR RevenueCat Purchases` (`VT6FKH34J9`) is created and backed up outside Git
  with private file permissions. Issuer: `69a6de76-8e7b-47e3-e053-5b8c7c11a4d1`.
  The key was uploaded after the owner enabled Chrome file uploads. Apple production
  and sandbox server-notification URLs both point to this RevenueCat integration.
  Purchase delivery still needs end-to-end sandbox testing. Product auto-import
  requires a separate App Store Connect API key, which is not yet configured.
  This is separate from the APNs key. No sample products or test-store SDK keys
  have been configured in the production application.

## Configuration dependencies

Set these on the deployment that the binary actually loads. Public variables require
a new web build. Keep signing keys out of Git; never use placeholder secrets.

| Feature | Vercel variables | Source |
| --- | --- | --- |
| iOS push | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_USE_SANDBOX` | Apple APNs key; team `MX8NV56ULD`; bundle `com.theninjarpg.app` |
| Android push | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | Firebase project and authorized FCM service account |
| Android App Links | `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_FINGERPRINTS` | Final package and actual signing certificate SHA-256 fingerprints |
| Store webhook | `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_IOS_APP_ID`, `REVENUECAT_ANDROID_APP_ID` | RevenueCat project and app configuration |
| Store client | `NEXT_PUBLIC_REVENUECAT_IOS_KEY`, `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` | RevenueCat public platform SDK keys |
| Sandbox rewards | `STORE_SANDBOX_USER_IDS` | Explicit test/review game user IDs, comma separated |

TestFlight uses production APNs: set `APNS_USE_SANDBOX=false` for that deployment.
Sandbox purchases and sandbox APNs are separate concepts. A debug-signed build uses
development APNs and must be tested with matching server configuration.

Apple association is derived from `APNS_TEAM_ID` and `APNS_BUNDLE_ID`. Android association
must include the Play app-signing certificate, not just the local upload certificate.

Local shell setup is documented in `mobile/.env.example` and `mobile/README.md`.
Firebase Android config belongs in `mobile/android/app/google-services.json` (ignored).
The shared group is assigned to both Apple identifiers; generate matching profiles.
Configure the Apple sign-in provider
in Clerk and validate the native token audience and system-browser return flow.

## Store products

Source of truth: `app/drizzle/constants.ts`; recheck before changing prices or rewards.

| Consumable ID (both stores) | USD base price | Reputation |
| --- | --- | --- |
| tnr_reps_tier1 | 4.99 | 8 |
| tnr_reps_tier2 | 9.99 | 20 |
| tnr_reps_tier3 | 19.99 | 49 |
| tnr_reps_tier4 | 49.99 | 164 |
| tnr_reps_tier5 | 99.99 | 407 |

All five Apple consumables have draft records, English (US) names/descriptions and
the above USD base-price schedules. Apple IDs in tier order: `6811356397`,
`6811356773`, `6811357013`, `6811357245`, `6811357665`. Availability and review
screenshots remain incomplete. No products have been submitted for review.

Apple subscriptions: `tnr_federal_normal`, `tnr_federal_silver`, `tnr_federal_gold` in
one subscription group. Android: subscription `tnr_federal` with `normal`, `silver`,
`gold` base plans. Match the live game’s Federal prices, as instructed by the owner. Verify exact amounts
and billing periods against the production PayPal plans before activating products.
Apple group `Federal Status` (`22379575`) is created with English (US) localization;
individual subscriptions await verification of the existing live-game PayPal plan
amounts and billing periods; the owner has approved matching those prices.
Map all subscriptions to RevenueCat entitlement `federal`; include supported products
in the current offering. Webhook: `https://www.theninja-rpg.com/api/webhooks/revenuecat`.
RevenueCat authorization must match `REVENUECAT_WEBHOOK_SECRET` exactly.

## Before a development release

Local verification on 2026-09-12: Capacitor sync and iOS project configuration pass.
Android `assembleDebug` passes with the downloaded Firebase config. Xcode's Debug
simulator build passes for the app and widget extension. These are compile checks,
not device acceptance tests or signed store uploads. No valid local iOS signing
identities were present at audit.

This machine uses Homebrew Ruby at `/opt/homebrew/opt/ruby/bin` and a user-writable
bundle cache at `~/.cache/theninjarpg/bundle`. For the setup command, export
`BUNDLE_PATH` to that directory and `APPLE_TEAM_ID=MX8NV56ULD` explicitly; the team
must appear on both targets after configuration. Android builds use the installed
Java 21 runtime and SDK under `~/Library/Android/sdk`.

- [ ] Signing certificates/profiles for both Apple targets, Android upload keystore,
  App Store Connect upload credentials and Play upload credentials are available.
- [ ] Firebase, APNs, RevenueCat and Clerk setup is complete for the chosen origin.
- [ ] Verify native database migrations are applied using the normal deployment process.
- [ ] Verify both HTTPS association endpoints return correct JSON without redirects.
- [ ] Build signed iOS and Android artifacts using the existing Fastlane lanes.
- [ ] Upload first Android AAB through Play Console if API upload is not yet available.
- [ ] TestFlight and Play internal testers can install and sign in.
- [ ] Test cold launch online/offline, reconnect, sign-out and account switching.
- [ ] Test Clerk session persistence after process termination and device restart.
- [ ] Test combat/map memory use on physical devices, including a lower-memory phone.
- [ ] Test push categories, opt-outs, foreground/background delivery and token renewal.
- [ ] Test widgets, hospital Live Activities and Android progress notifications.
- [ ] Test audio controls, haptics and deep links on physical devices.
- [ ] Test consumables, duplicate webhook delivery, subscription changes, cancellation,
  expiry and restoration with allowlisted sandbox users. Verify server-side grants.

## Before store review

- [ ] App Privacy and Play Data safety match actual Clerk, Sentry, analytics, messaging,
  uploads, device tokens and purchase processing. Do not declare “no data collected”.
- [ ] Audit complete account deletion: the existing DeleteUserButton explicitly deletes
  a character after a two-day timer and leaves Clerk signed in. Do not claim this is
  full account deletion until the identity and personal-data behavior is verified.
  The server additionally blocks deletion for banned/silenced users and clan/ANBU
  members. Its cleanup removes game data and device tokens, but does not delete the
  Clerk identity. A separate full-account flow needs implementation and verification.
- [ ] Provide an accessible external account-deletion request URL for Google Play.
- [ ] Verify filtering, reporting, blocking and published support contact details for UGC.
- [ ] Complete age/content ratings using actual violence, chat and purchase behavior.
- [ ] Review Android foreground-service declarations and demonstrate the audio use case.
- [ ] Supply working review credentials and exact paths to purchases/native features.
- [ ] Capture authentic signed-app screenshots at the dimensions required by each console.
- [ ] Check privacy/support links while signed out. Review the existing Termly policy
  against the new native SDKs and data flows before using it in either listing.

Apple assesses useful functionality and completeness; counting native features does not
guarantee approval. Reference: https://developer.apple.com/app-store/review/guidelines/
Google disclosure guidance: https://support.google.com/googleplay/android-developer/answer/10787469

## Marketing copy draft

Name: TheNinja-RPG

Apple subtitle: Your ninja story starts here

Google short description: Train your ninja, master jutsu, and battle rivals in an online RPG.

Promotional text: Your village. Your rivals. Your story. Train your ninja, discover new jutsu, and make your mark in a persistent online world.

Description:

Your ninja story starts with a choice. What will you become?

Enter TheNinja-RPG, an online role-playing game built around character progression,
tactical battles and village life. Train your abilities, learn jutsu and develop a
fighting style of your own.

BUILD YOUR NINJA
Grow your character through training, missions and equipment. Experiment with jutsu
and loadouts as you prepare for your next challenge.

MAKE EVERY MOVE COUNT
Take on enemies and challenge other players in tactical combat. Your preparation and
choices shape each encounter.

FIND YOUR PLACE
Explore the world, join village life and meet other players. Build alliances and
rivalries as your character's story unfolds.

An internet connection and an account are required. Optional in-app purchases are available.

Keywords: ninja,rpg,roleplaying,online,tactical,battle,jutsu,village,missions,multiplayer

Screenshot sequence: character progression; jutsu/loadouts; tactical combat; village;
world exploration; verified native widget/Live Activity. Use real gameplay for screenshots.
Final inspected artwork and authentic simulator captures are now in
`mobile/marketing/store/`. Apple has five screenshots uploaded across three size slots;
Google assets are prepared but not uploaded. See the marketing README for provenance
and the console audit for exact counts. Recheck against the signed release candidate.

## Release schedule and control

Public release is not authorized. Keep Apple's manual release selection, use only
TestFlight and Google Play internal testing for beta distribution, and do not start
a production rollout or schedule automatic publication. Review submissions can be
prepared after the gates below pass; hold the approved app for the owner's launch decision.

The following durations are planning allowances, not store processing guarantees.
Choose the calendar launch date after the first signed builds pass device testing.

| Phase | Planning allowance | Exit gate |
| --- | --- | --- |
| Setup and compliance fixes | Until blockers are resolved | Signing, payments, push, purchases, account deletion and disclosures ready |
| Internal beta | At least 7 days after first working builds | Device test checklist passes; no unresolved crash, login or reward-delivery blockers |
| Review preparation | 2–3 working days | Authentic screenshots, metadata, reviewer account and purchase review material complete |
| Store review and corrections | Reserve at least 2 weeks | Both stores approve; leave extra time if a resubmission is needed |
| Launch readiness | 2 working days before chosen date | Support coverage, monitoring, rollback plan and owner go/no-go confirmed |
| Public launch | Owner-selected date only | Separate explicit release instruction |

Freeze the candidate binary and web behavior during review. If a web fix is necessary,
repeat the affected native checks because both shells load the production origin.
Prepare announcement copy and assets before launch, but do not publish announcements
or send messages without the owner's authorization. Keep the website usable if a
native rollout is paused, and record which backend deployment each beta build tested.

Federal pricing verified via production PayPal plans on 2026-09-12: Normal USD 5.00,
Silver USD 10.00, Gold USD 15.00; all active, recurring every one month, no trial cycle.
Console updates are in progress; this verification does not itself change store prices.
