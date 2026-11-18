# Meta website acquisition tracking

Set `NEXT_PUBLIC_META_PIXEL_ID=4625815744371142` in the game's **Production**
environment to enable the `TheNinja-RPG — Website` dataset. Leave it unset in
Development and Preview. This public ID is not an access token. Environment changes
take effect in the next production build; merging code or setting the variable does
not publish an ad.

The web shell loads the Meta SDK only after the shared consent API reports explicit
marketing consent. Native shells remain excluded, including native user agents served
cached web markup. Consent withdrawal revokes the pixel and discards pending events.
No noscript beacon runs before consent. Ad blockers can prevent measurement without
affecting gameplay.

| Event | Trigger | Use |
| --- | --- | --- |
| `PageView` | Consented initial page and public-path navigation | Landing-page measurement and website-visitor exclusions |
| `CompleteRegistration` | Confirmed character creation receipt | New-player acquisition conversion |
| `TutorialComplete` (custom) | Confirmed tutorial reward receipt | Quality of acquired players |
| `ExistingPlayer` (custom) | Loaded game character | Existing-player exclusion audiences |

Receipts deduplicate conversions within the page. They stay in browser memory; Meta
receives random event IDs rather than account IDs, character names, emails or form
values as custom parameters. The Pixel SDK itself receives the normal browser/device
and page URL/referrer data and can use its first-party `_fbp`/`_fbc` cookies after
consent. Automatic configuration, history tracking, automatic advanced matching and
automatic inferred events must remain disabled. Do not also install this pixel in GTM
or an event setup tool, which would duplicate events or bypass the consent guard.

The dataset belongs to portfolio `4635490573369945`, is connected to website ad account
`1695857622092865`, and allows traffic from `theninja-rpg.com` and its subdomains.
Conversions API is not part of this browser integration.

Before publishing acquisition ads, verify `PageView` and `CompleteRegistration` in
Events Manager Test Events using a consenting browser, then verify that declining or
withdrawing marketing consent stops events. Check the cookie declaration and privacy
information include Meta and its first-party cookies. Keep the campaign unpublished
until the code and production environment are deployed and live events are verified.

Use a website-visitor custom audience with 180-day retention and a Page/ad engagement
audience with 365-day retention as **exclusions**, leaving custom audience inclusions
empty. `CompleteRegistration`, `TutorialComplete` and `ExistingPlayer` can also form
player exclusion audiences once their events have arrived. A new pixel cannot recover
historical Google Analytics visitors, identify every existing player, or guarantee a
person has never clicked before; consent choices, browser changes and Meta matching
limit coverage. Keep any customer-list upload as a separately approved integration.

Use `utm_source=facebook`, `utm_medium=paid_social` and a stable `utm_campaign` on ad
links for the existing website/GA attribution. Once registration volume supports it,
evaluate conversion optimization against `CompleteRegistration` rather than treating
landing-page views as acquired players.
