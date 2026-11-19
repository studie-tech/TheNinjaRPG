# Meta website acquisition tracking

Website tracking uses the bundled consent manager. The current Meta disclosure must
be deployed and optional marketing must start denied before reporting is enabled.

## Configuration and rollout

1. Deploy the consent disclosure and confirm optional marketing starts denied.
2. Apply the additive `MetaConsent`/`MetaTracking` migration with the tracking release.
3. Set `NEXT_PUBLIC_META_PIXEL_ID=4625815744371142` in Production only. The public ID
   enables the browser integration; leave it unset in Preview and Development.
4. Create a direct Conversions API token for this dataset in Events Manager. Configure
   the server-only `META_CAPI_ACCESS_TOKEN` and explicitly set `META_CAPI_ENABLED=true`
   in Production to enable matching-data capture and server delivery. This is separate
   from the Page publishing token. Never expose it through `NEXT_PUBLIC_*`, GTM or the
   browser. Missing configuration leaves CAPI disabled.
5. Validate consented registration and tutorial events with a test account in Events
   Manager, including the browser/server deduplication diagnostics. Verify refusal,
   withdrawal, a blocked Pixel, and a returning existing player. Deployment and this
   live verification require a separate rollout; repository tests mock all Meta calls.

Keep ads unpublished until consent, production tracking and event matching are
verified. Merging, configuring or deploying tracking does not publish an ad. The
integration does not create, publish, or change campaigns.

The dataset belongs to portfolio `4635490573369945`, is connected to the dedicated
website ad account `1695857622092865`, and allows `theninja-rpg.com` and subdomains.
Automatic CAPI enrollment with Meta, automatic configuration, history tracking,
automatic advanced matching and inferred events must remain disabled. Do not install
this dataset again in GTM or an event setup tool.

The browser SDK makes at most two load attempts per document. A later eligible event
can trigger one retry after a failed load; every attempt checks current consent.

## Events and delivery

| Event | Source | Purpose |
| --- | --- | --- |
| `PageView` | Consented web Pixel on initial load and navigation | Landing-page measurement and visitor exclusions |
| `CompleteRegistration` | Confirmed character creation; Pixel plus CAPI | New-player acquisition |
| `TutorialComplete` (custom) | Persisted completed Genin exam; Pixel plus CAPI | Quality of acquired players |
| `ExistingPlayer` (custom) | Loaded character, web Pixel | Player exclusion audiences |

Each account has persistent, opaque UUIDs for registration and tutorial conversion.
The browser requests receipts verified against game records, then uses the exact
`eventID` that CAPI sends as `event_id`, with identical event names and dataset ID.
Raw account IDs, quest receipts, character names, email addresses and form values
are not sent to Meta by this integration. The Pixel also deduplicates effect replays
and repeated receipts within a document.

The authenticated `/api/meta-conversions` cron runs every five minutes, reads current
consent and confirmed records, sends through Graph API v24.0, and records successful
acknowledgments. Failures retain the same event ID and occurrence time for retry.
Both channels stop delivering conversions 47 hours after occurrence, inside Meta's
48-hour deduplication window. An outage lasting longer loses those measurements;
expired events are never re-timestamped or backfilled. This bounds duplicates after
an ambiguous response or a crash between delivery and acknowledgment.

Registration attribution is captured after the character insert succeeds, independently
of the browser receiving its response. Existing accounts do not acquire registration
receipts on sign-in. Tutorial events require a completed exam after the applicable
consent decision and a recorded web completion request. The registration and tutorial
capture reject native user agents; browser SDK loading
and conversion forwarding also remain off in native shells.

## Consent and data

Marketing consent must be explicit everywhere, including server reporting. Current
consent policy revision, browser identity and decision timestamp come from the bundled
manager. Unknown consent, older revisions, expired decisions and future timestamps
fail closed. CAPI does not bypass consent or browser identity restrictions.

After consent, a real landing `fbclid` can supply `fbc` when the Pixel is blocked;
no `fbc` is fabricated for organic traffic. Valid `_fbc` and `_fbp` cookies are used
verbatim. CAPI sends those matching identifiers, the captured browser user agent,
confirmed occurrence time, event ID, event name, website action source and canonical
website URL. It does not send a raw IP, email, account ID, or a full browsing URL.
Visitors without consented matching identifiers are skipped. The browser Pixel itself
receives normal request IP, page URL/referrer and browser/device information after
consent, even though these are not custom event parameters.

A first-party click fallback lasts up to 90 days without extending its original
lifetime on rerenders. Matching data expires after 90 inactive days, bounded by the
180-day consent lifetime. Decision tombstones survive for the consent lifetime so
an older in-flight grant cannot restore withdrawn consent. A denial wins equal
timestamps. Account switching cannot use another account's consent row.

Withdrawal immediately clears the local click fallback and pending Pixel events.
The server invalidates this browser's consent, and all linked account decisions when
signed in, then clears matching data. Current consent is checked when selecting queued events and immediately before
dispatch. Withdrawal and the external HTTP request cannot be atomic: a decision
committed after the final check can race a request already being dispatched. No
database lock is held across the HTTP call. A late browser receipt is also rejected after withdrawal or an account
switch. Failed synchronization retries on the next visit; a request already sent to
Meta cannot be recalled. Account deletion removes both tables' user-linked rows, and
staff identity changes preserve their associations and opaque event IDs.

## Acquisition audiences

Use a website-visitor custom audience with 180-day retention and a Page/ad engagement
audience with 365-day retention as exclusions, leaving custom audience inclusions
empty. Registration, tutorial and existing-player events can populate additional
player exclusions once received. A new dataset cannot recover historical Google
Analytics visitors or guarantee someone has never clicked or played; consent, browser
changes and Meta matching limit coverage. Customer-list uploads remain a separate
integration.

Use `utm_source=facebook`, `utm_medium=paid_social` and a stable `utm_campaign` for
website/GA attribution. Once registration volume supports it, assess optimization for
`CompleteRegistration` rather than using landing-page views as a player count.
