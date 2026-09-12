# Mobile emulator smoke test — 2026-09-12

Scope: production-connected debug shells, signed out. This is not acceptance of
authenticated gameplay, purchases or notification delivery. Nothing was uploaded to
TestFlight or Play, and no public release was performed.

## Results

| Check | Result |
| --- | --- |
| iOS build and install | Passed on TNR-iPhone17, iOS 26.5 simulator |
| Android build and install | Passed on TNR-Pixel emulator |
| iOS cold launch | Reaches live landing page |
| Android cold launch | Reaches live landing page after correcting emulator DNS |
| Android connection failure | Shows branded No connection screen with Try again; no blank screen |
| iOS login navigation | Native provider buttons and email form render |
| iOS Google OAuth handoff | Opens accounts.google.com in system browser with keyboard |
| iOS OAuth cancellation | Returns to app and re-enables provider buttons |
| iOS safe areas | Initial header overlapped status bar/Dynamic Island; fixed locally and verified after rebuild/reinstall/fresh launch |
| iOS rotation | Phone remains portrait-oriented when simulator rotates |
| Android app-link verification | Not verified; OS reports domain state 1024 |
| Android explicit link intent | OS delivered /login intent to app, but landing page remained; needs investigation |

No native crash was observed in these smoke tests. Android logs contain a Capacitor
safe-area CSS injection error at startup (`document` element not ready) and TikTok
pixel warnings. These remain untriaged; a successful landing page is not evidence
that every bridge feature works.

## Fix made

`mobile/ios/App/App/SceneDelegate.swift` now wraps the WKWebView in a container and
constrains its viewport to the native safe-area guide. Scroll insets alone did not
protect the live site's positioned header on initial launch. Xcode simulator build
passed after the change; portrait landing and login layouts were inspected.

Login and signup now use Clerk style overrides instead of Tailwind `hidden` for
the embedded social buttons and divider. Clerk's generated display rules overrode
the utility class, exposing duplicate providers. Both pages were refreshed and
visually checked in the iPhone simulator against the local server: only the native
provider buttons remain, and signup still shows its email field. The development
Clerk sign-in screen did not show an email field, so production email login has not
been reverified with this patch. TypeScript and scoped Biome checks passed.

After PR #1533 merged as `36c5873b7`, the tnr Vercel deployment reported success.
Restored the production-connected iPhone simulator bundle and reopened both pages:
login has one provider list and its email field; signup has one provider list and
email/password fields. Android was restarted against production, but its auth
screens have not yet been visually rechecked. No store release was performed.

## Environment

Android's default emulator DNS and a public DNS fallback failed on this machine's
network. Restarting with the host's working DNS servers resolved the game hostname
and allowed the app to load. This was a local emulator setting, not an application
or production network change. No host VPN settings were changed.

Screenshots are saved outside Git at:
`/Users/mathiasgruber/.cache/theninjarpg/qa-2026-09-12/`.
Useful files: `ios-launch.png` (before fix), `ios-safe-area.png` (after fix),
`ios-login.png`, `android-launch.png` (connection failure), and
`android-network-fixed.png` (successful launch).

## Remaining test gates

- Dedicated test accounts and a repeatable authenticated native login flow.
- Session persistence, account switching, combat, map performance and keyboard behavior.
- Android back navigation, app-link routing and OAuth return; iOS universal-link routing.
- Push opt-outs, token renewal, foreground/background delivery on both platforms.
- Widget snapshots and clearing, Live Activities and Android progress notifications.
- Store sandbox consumables, duplicate receipts, restoration and subscription changes.
- Physical-device checks for signing, actual APNs/FCM delivery, audio, haptics and performance.

Complete account deletion, disclosures, store products, remaining credentials and
signed beta distribution remain release blockers; see `StoreSubmission.md`.


## Authenticated native QA follow-up

Dedicated development test accounts were created on 2026-09-12 and used in both
emulators. The 21-screenshot evidence bundle and complete coverage matrix are saved
locally at `~/.cache/theninjarpg/native-qa-2026-09-12/evidence/index.html`.
This path is operator-local; screenshots and account credentials are not in Git.

Confirmed: session persistence, iOS Status/Village/Quest widgets, hospital native
countdown and early recovery cleanup on both platforms, OS notification permissions,
combat notification opt-out, iOS injected notification rendering/tap routing,
Android browser OAuth handoff/cancellation, and sign-out device deregistration.
iOS widgets visibly clear on logout; Android native snapshot storage is empty.

Android countdown startup initially failed because Capacitor getDouble rejected
whole-number epoch timestamps stored as Long. Accepting valid Number values fixes
this. Three JUnit regression tests and debug assembly passed, and the rebuilt app
rendered the ongoing hospital notification and removed it after healing.

Purchases and real push delivery remain blocked by development configuration.
iOS notification injection does not verify APNs transport. Native Apple sign-in
opens the system prompt but requires an Apple account. Android widget placement,
complete provider callbacks, physical haptics/audio, app links, reconnect, update
wall and full account switching/deletion remain unverified. Only hospital Live
Activities are currently integrated; training/war plugin kinds are not evidence
of working application flows. No public release or store upload was performed.

The temporary QA page mounted the actual DeviceSettings and NativeStore components;
it was removed after testing. Emulator-only configurations point to the local
server /profile route; repository production origins were restored. Both test
accounts were signed out. The Mac locked before the remaining visual checks.
