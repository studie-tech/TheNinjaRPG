# Store console readiness audit — 2026-09-12

Public release is not authorized. No app, build, purchase or announcement was released
or submitted for review during this audit. Apple remains **Prepare for Submission**;
TestFlight reports **No Builds**. This is a preparation record, not a claim of approval.

## Apple: saved and verified

| Area | Result |
| --- | --- |
| Identity and copy | TheNinja-RPG, English (US), subtitle, description, promotional text, keywords, copyright and marketing URL saved in the existing draft |
| Categories | Games, Roleplaying and Strategy |
| iPhone screenshots | Three 1320 × 2868 gameplay captures in the 6.9-inch slot; one widget capture in the 6.3-inch slot |
| iPad screenshots | One 2064 × 2752 village capture in the 13-inch slot |
| App price | Free, US base price $0.00 with Apple currency equivalents |
| Availability | 173 territories selected, excluding mainland China and Vietnam pending game-license requirements; no automatic addition of future territories |
| Regional rating restrictions | The questionnaire warns that Afghanistan and Morocco are unavailable; selected availability is not a guarantee of eligibility in every territory |
| Age ratings | Saved 13+ in 171 territories, 16+ in two, and 15+ in Korea; pre-OS-26 global rating 12+ with regional exceptions |
| Age suitability | https://www.theninja-rpg.com/rules |
| Additional platforms | Apple Silicon Mac and Vision Pro distribution disabled pending testing |
| Release control | Manual release; no preorder or public rollout scheduled |
| Privacy link | Existing public Termly privacy-policy URL saved; optional privacy-choices URL deliberately blank |
| TestFlight description | Beta description, marketing URL and privacy URL saved; no build or testers invited |

The age questionnaire reflects frequent fantasy violence, weapons and contests; UGC,
chat and social redistribution; infrequent profanity/horror/mature themes; no realistic
or graphic violence, sexual content, medical advice or real-money gambling. Randomized
virtual rewards were conservatively marked as loot boxes. Review that classification
against the final purchase catalogue before submission. Korea's console exposes an RCN
field and conditional rating requirements; do not assume the calculated rating alone
settles every regional licensing requirement.

## Apple: unfinished requirements

| Area | Remaining work |
| --- | --- |
| App icon | Existing 1024-pixel native asset is present in the project; store icon requires an uploaded build |
| Build and signing | Generate valid distribution profiles for the app and widget extension; upload and select a tested candidate |
| Review contact | Owner approved Mathias Gruber / contact@theninja-rpg.com; phone number is still missing |
| Review form | Support URL and notes entered in the original tab, but the incomplete contact form blocks saving; do not count them as persisted |
| Email fields | Apple email inputs did not retain the attempted entry; verify actual saved values when completing contact information |
| Review credentials | Provision a dedicated account on the backend loaded by the candidate, with clear login and purchase-testing instructions; development fixture accounts are not review credentials |
| TestFlight review | Sign-in is required. Credentials and contact information remain incomplete; checked sign-in draft cannot save without credentials. Feedback email did not persist |
| App Privacy | Data-type/purpose/linkage/tracking questionnaire remains incomplete; no privacy declaration published |
| Content rights | Not completed; confirm rights for all game art, music and user-uploaded content before attesting |
| Purchases | Five consumable drafts exist; availability, screenshots and review remain incomplete |
| Subscriptions | Federal Status group exists; Normal/Silver/Gold monthly USD prices still required before product configuration |
| Business | DSA verification is In Review; DAC7 Missing Info; bank account holder address/type requested |
| Business address | Console and website footer show different addresses; owner must establish the current legal address |

The existing February 2024 privacy policy needs review for the native SDKs, account
providers, push tokens and purchases. The linked Termly DSAR form displays the placeholder
“My Great New Website / App”; it is not a finished app-specific deletion experience.

## Apple: optional functionality reviewed

| Feature | Decision and reason |
| --- | --- |
| In-App Events | Leave empty until an actual dated event is approved |
| Custom Product Pages | Use the primary listing first; add campaign variants when there is a concrete audience/campaign |
| Product Page Optimization | Defer experiments until a live baseline and sufficient traffic exist |
| Promo codes | None generated; no campaign or eligible approved purchase requiring them |
| Game Center | Leave unconfigured; the app uses its own game systems and has no implemented Game Center integration |
| Featuring nominations | Defer until a candidate and owner-selected release date exist |
| Accessibility labels | Do not claim untested VoiceOver, larger-text or contrast support; conduct feature-specific acceptance tests first |
| App Clips, iMessage, Watch | No implementation to list |
| Ratings/reviews | No live listing history to manage or reset |
| Xcode Cloud | Optional build service, not needed to use the existing Fastlane workflow |

## Google Play

The removed 2018 app is `com.ST.TNRmobile`. The new `com.theninjarpg.app` creation form
is prepared with TheNinja-RPG, English (US), Game, Free. **No new listing was created.**
The form requires certification that the app meets Developer Program Policies. The
known incomplete account-deletion flow prevents making that assertion truthfully.
A new package does not remove the obligation to address the legacy policy history.

Prepared assets: 512 × 512 icon, 1024 × 500 feature graphic, two 1080 × 2400 phone
screenshots and English listing copy. These have **not** been uploaded to Play.

After compliance is resolved, complete each of these console areas:

- Create the app with accurate policy, signing and export declarations.
- Main listing: upload prepared assets/copy; select Role Playing category and only
  available tags that accurately describe the actual game; set support details.
- App access: provide working reviewer credentials and unrestricted review instructions.
- Content rating: complete the IARC questionnaire from actual content and purchases.
- Target audience: select appropriate supported ages; do not position the game as a
  children's product while it has unrestricted player chat and the current content.
- Ads declaration: verify production tag configuration and actual rendered ads first.
- Data safety: map actual collection, service providers, purposes, optionality,
  retention and deletion; publish an app-specific external deletion request page.
- Permissions/app content: review foreground media service, notifications, special
  access, account creation and all declarations required by the uploaded manifest.
- Signing and integrity: configure upload key and Play App Signing; use the actual
  Play signing certificate for Android App Links and OAuth configuration.
- Internal testing: upload AAB, configure tester access and release notes; verify
  installation, sign-in, native integrations and billing before broader testing.
- Products: create consumables and Federal base plans, configure RevenueCat Android
  credentials/offerings/webhooks, and validate sandbox grants and restoration.
- Production access, countries, pricing and managed publishing: review requirements
  shown for this account; retain owner control over public availability.
- Payments: resolve the previously observed identity and Ireland tax requests.

Google pages behind app creation were not available for a complete per-field audit;
this list is pending work, not a claim that those sections have been configured.

## Engineering and disclosure gates

The current character-deletion flow leaves the Clerk identity intact and is blocked
for some account states. Implement and test full account deletion, including users
without characters and users restricted by moderation/clan membership. Preserve only
data with a justified retention requirement, explain it clearly, and ensure store
receipt handling cannot re-grant deleted rewards.

The source includes Clerk authentication, Sentry diagnostics, Google Tag Manager,
Vercel Speed Insights, uploads/messaging, IP/account association, device tokens and
RevenueCat purchase processing. Inspect deployed tag-manager behavior and processor
settings before declaring tracking or “no data collected.” A source-only inventory
cannot establish the final privacy answers.

Complete push credentials, RevenueCat configuration, sandbox allowlisting and domain
association, then test signed candidates on physical devices. The simulator QA report
is in PR #1534 (`docs/MobileEmulatorQA.md` once merged); that PR also contains the
Android countdown and iOS safe-area fixes used for these captures. The report does not
prove APNs/FCM transport, real purchases,
physical haptics or production account deletion.

## Owner input still needed

1. Reviewer telephone number, including country code.
2. Monthly USD prices for Normal, Silver and Gold Federal subscriptions.
3. Business verification details requested by Apple and Google, and the current legal
   address. Verification codes or identity documents must be supplied by the owner.
4. A release date only after candidate testing and review timing are understood.

## References

- Apple screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- Apple screenshot upload guidance: https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots
- Google preview assets: https://support.google.com/googleplay/android-developer/answer/9866151
- Apple review guidelines: https://developer.apple.com/app-store/review/guidelines/
