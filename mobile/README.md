# TheNinja-RPG native shells

Capacitor 8 wrappers around the live site for iOS and Android. The game itself stays in
`app/` — this directory only holds the native projects, the bundled entry point and the
release tooling.

## How the shell loads the game

The WebView boots into `www/index.html`, which is bundled in the binary. That page paints
immediately, checks `/api/healthcheck`, and only then navigates to the production origin.

`server.url` is deliberately not used. Pointing the WebView straight at production leaves a
blank screen on a cold launch with no connectivity, and Ionic documents remote-origin
loading as a development feature that can attract store rejections. `server.allowNavigation`
keeps the hand-off inside the WebView so the Capacitor bridge survives it.

The origin lives in one place: `TNR_ORIGIN`. `bun run sync` writes it into `www/config.js`
and `capacitor.config.ts` reads it for the navigation allowlist.

## Talking to the web app

The web bundle does not depend on `@capacitor/*`. Plugins are installed here, where
`cap sync` needs them to build the native projects; the site calls them through the
`window.Capacitor` bridge the shell injects, behind `app/src/libs/native/`. That is the
only place in `app/src` allowed to touch the bridge, enforced by a biome rule.

Adding a plugin therefore means two steps: install it here, and add a wrapper in
`app/src/libs/native/` so call sites stay platform-agnostic.

## First-time setup

```bash
cd mobile
bun install
cp .env.example .env       # fill in TNR_APP_ID at minimum
bun run add:ios            # requires Xcode and CocoaPods
bun run add:android        # requires Android Studio and JDK 21
bun run sync
```

`ios/` and `android/` are generated, and are gitignored until they are first generated and
committed. Commit them once they exist — they carry entitlements, Info.plist and Gradle
config that are part of the app, not build output.

## Running

```bash
bun run run:ios            # or `bun run open:ios` to drive it from Xcode
bun run run:android
```

From the repository root, `make mobile-sync`, `make mobile-ios` and `make mobile-android`
wrap the same commands.

## Before the first build

Both platforms need account-level setup that cannot be scripted:

**Apple** — an App ID with Push Notifications, Sign in with Apple, App Groups and
Associated Domains capabilities; an APNs key (.p8) whose Key ID, Team ID and contents go
into the server's `APNS_*` variables; a Sign in with Apple key registered in Clerk. The
Team ID and bundle identifier must also be set on the server, or
`/.well-known/apple-app-site-association` 404s and Universal Links never verify.

**Google** — a Firebase project for FCM, its service account into the server's `FCM_*`
variables, and `google-services.json` into `android/app/`. Set `ANDROID_PACKAGE_NAME` and
`ANDROID_CERT_FINGERPRINTS` on the server — the latter needs both the upload key and the
Play App Signing key, or App Links fail to verify after the first Play release.

## Icons and splash screens

Source artwork lives in `app/public/icons/`. The maskable variants are inset to the 80%
safe zone Android crops to, and `icon-180x180.png` is flattened because iOS renders
transparent corners black. Regenerate them with `sharp` if the logo changes; the launcher
and splash assets in the native projects are produced from the 1024px source by
`@capacitor/assets`.

## Not yet here

The native projects themselves, the ActivityKit and WidgetKit extensions, the
`tnr-live-activity` / `tnr-audio-session` / `tnr-widget-sync` / `tnr-apple-auth` plugins,
and the Fastlane lanes. The web side of each already exists under `app/src/libs/native/`
and no-ops until its plugin is present, so they can land one at a time.
