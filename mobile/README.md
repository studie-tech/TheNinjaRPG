# TheNinja-RPG native shells

Capacitor 8 wrappers around the live site for iOS and Android. The game itself stays in
`app/` — this directory holds the native projects, the bundled entry point, the plugins we
author and the release tooling.

## How the shell loads the game

The WebView boots into `www/index.html`, which is bundled in the binary. That page paints
immediately, checks `/api/healthcheck`, and only then navigates to the production origin.

`server.url` is deliberately not used. Pointing the WebView straight at production leaves a
blank screen on a cold launch with no connectivity, and Ionic documents remote-origin
loading as a development feature that can attract store rejections.
`server.allowNavigation` keeps the hand-off inside the WebView so the Capacitor bridge
survives it. Android's `TNRRemoteBridge` exports the installed Capacitor runtime and registered
plugins at document start on the same trusted remote origins as native messaging. Capacitor
itself handles the bundled origin and older WebViews' HTML injection. The shell uses the
upstream JavaScript exporter, with one shared list for registering and exporting local plugins.
Keep the navigation allowlist restricted to the configured game and verified Clerk hosts;
never add third-party or wildcard hosts.

The origin lives in one place: `TNR_ORIGIN`. `origin.mjs` validates it as a bare HTTPS
origin and normalizes an optional trailing slash, host casing and the default port.
Credentials, wildcards, paths, queries and fragments are rejected. `bun run sync` writes the
normalized origin into `www/config.js`, and `capacitor.config.ts` uses the same configuration for the
navigation allowlist. Override it for staging with `TNR_ORIGIN=https://staging... bun run sync`.

## Native session refresh

Clerk session refresh must stay inside the WebView so it can update the session cookies.
Production shells allow exactly `www.theninja-rpg.com` and the verified Clerk Frontend API
host `clerk.theninja-rpg.com`. This also trusts Clerk-hosted pages with the native bridge;
other subdomains remain outside the allowlist. Custom `TNR_ORIGIN` builds allow only their
configured host.

Keep `NATIVE_CLERK_PROXY_ENABLED` unset or false with the existing Clerk domain configuration.
The registered domain is `theninja-rpg.com`, so Clerk rejects a proxy on `www.theninja-rpg.com`:
a production proxy must match the exact registered origin. The optional `/__clerk/` transport
requires a matching, verified Clerk proxy registration before enabling the flag.

After changing the allowlist, sync and rebuild both shells. Verify email sign-in, an
authenticated cold restart after session expiry, and browser OAuth return on both platforms.

## Talking to the web app

The web bundle does not depend on `@capacitor/*`. Plugins are installed here, where
`cap sync` needs them to build the native projects; the site calls them through the
`window.Capacitor` bridge the shell injects, behind `app/src/libs/native/`. That is the only
place in `app/src` allowed to touch the bridge, enforced by a biome rule.

Adding a plugin means two steps: install it here, and add a wrapper in
`app/src/libs/native/` so call sites stay platform-agnostic.

## What is here

**iOS** (`ios/App/`)

| Path | What it is |
| --- | --- |
| `App/Plugins/` | `TNRWidgetSync`, `TNRAudioSession`, `TNRLiveActivity`, `TNRAppleAuth` |
| `TNRShared/` | Snapshot and `ActivityAttributes` models, compiled into both targets |
| `TNRWidgets/` | WidgetKit widgets and the Live Activity presentation |
| `App/App.entitlements` | Push, App Groups, associated domains, Sign in with Apple |

**Android** (`android/app/src/main/java/com/theninjarpg/app/`)

| File | What it is |
| --- | --- |
| `TNRWidgetSyncPlugin` | Writes the snapshot and redraws the widget |
| `TNRAudioSessionPlugin` / `TNRAudioService` | `mediaPlayback` foreground service and `MediaSession` |
| `TNRLiveUpdatesPlugin` | The Live Activity counterpart: an ongoing progress notification |
| `TNRNotificationChannels` | One channel per `PUSH_CATEGORIES` entry |
| `TNRStatusWidget` | RemoteViews home screen widget |
| `TNROAuthBrowserPlugin` | Per-open OAuth browser sessions, browser-only launch intents and retired callback isolation |

Android OAuth uses a fresh instance of Capacitor's browser implementation for each open,
retiring the previous instance's callbacks. The upstream browser controller retains its
ActivityResult and pre-Android-14 PiP handling. Sessionless intents explicitly target an
installed external browser so verified game links cannot open the shell recursively.
The plugin exports the same `Browser` interface, so web callers and iOS remain compatible.

The Android widget uses RemoteViews rather than Glance on purpose: Glance would pull
Compose and the Kotlin toolchain into a project that needs neither, and a progress bar is
all this widget draws.

## First-time setup

```bash
cd mobile
bun install
bundle config set --local path vendor/bundle
bundle install
cp .env.example .env       # fill in TNR_APP_ID at minimum
bun run sync
```

`ios/` and `android/` are already generated and committed — they carry entitlements,
`Info.plist`, the manifest and Gradle config, which are part of the app rather than build
output. Do not regenerate them with `cap add`; that would discard every capability
configured on top of the template.

The iOS run, open and release commands apply `TNR_APP_ID` to the Xcode targets and their
shared App Group automatically. To apply it without launching Xcode:

```bash
bun run configure:ios
```

`scripts/configure-xcode.rb` applies the widget extension target, entitlements and build
settings, and validates the result by reopening the project. It is idempotent.

## Running

The iOS shell and home-screen widgets target iOS 15.4 and later. Live Activities are registered
only on iOS 16.2 and later. On iOS 15,
hospital widgets show the finish time rather than a running relative timer, and include
an expiry timeline entry so the old system cannot turn the countdown into a count-up.
Ordinary notifications, audio, Apple sign-in and purchases remain separate capabilities.
RevenueCat uses its StoreKit 1 fallback on iOS 15, so billing acceptance must identify
the OS and StoreKit path rather than treating all supported versions as equivalent.

The web bundle also targets Safari and iOS 15.4 through `app/package.json`'s Browserslist
configuration, so client chunks do not retain unsupported class static blocks.

```bash
bun run run:ios            # or `bun run open:ios` to drive it from Xcode
bun run run:android
```

From the repository root: `make mobile-sync`, `make mobile-ios`, `make mobile-android`,
`make mobile-configure`, `make mobile-beta`.

Requires Xcode with an iOS platform (`xcode-select -s /Applications/Xcode.app/Contents/Developer`),
and Android Studio with a JDK 21 toolchain.

## Releasing

```bash
bundle install
bundle exec fastlane ios beta       # TestFlight
bundle exec fastlane android beta   # Play internal track
```

Both lanes run `bun run sync` first, so a release can never ship a stale entry point.
Signing material comes from `.env`; nothing account-specific is committed.

## Before the first build

Account-level setup that cannot be scripted — the identifiers, capabilities and review
material both stores require — has to be done by hand in App Store Connect and the Play
Console before the first build will be accepted.

## Icons and splash screens

`assets/` holds the 1024px sources `@capacitor/assets` generates from; regenerate the
native sets with:

```bash
npx @capacitor/assets generate \
  --iconBackgroundColor '#F0C84C' --iconBackgroundColorDark '#F0C84C' \
  --splashBackgroundColor '#F0C84C' --splashBackgroundColorDark '#23180A'
```

The sources themselves are derived from `app/public/icons/icon-512x512.png`, cropped past
the rounded-rect stroke so the launcher's own mask does not sit inside a second border:

- `icon.png` — artwork at 78% on the tile colour, flattened. Both stores reject an app
  icon with transparency, and edge-to-edge artwork reads as cropped once iOS applies its
  corner mask.
- `icon-foreground.png` / `icon-background.png` — Android adaptive layers, foreground at
  66% because the launcher crops hard.
- `splash.png` / `splash-dark.png` — square at 2732 so one image covers every device in
  both orientations. The launch screen aspect-fills, so only the middle ~46% of the width
  survives on a tall phone: keep the wordmark inside that band or it will be cropped.

The generator's Android launcher output is not usable as-is, and running it overwrites
the corrections. After every run, restore:

- `mipmap-anydpi-v26/ic_launcher*.xml` — it points the background at a bitmap and insets
  both layers by 16.7%, which leaves the 18dp the system reserves on each side for
  parallax fully transparent, so a launcher animation shows a bite out of the icon. The
  background should be `@color/ic_launcher_background` and the foreground should not be
  inset, because the foreground below is already a full 108dp canvas.
- `mipmap-*/ic_launcher_foreground.png` — the generator emits the *whole tile*, character
  on an opaque yellow square, at the legacy launcher sizes. Two things go wrong: the
  square's edge shows as a pale outline drawn across the icon, and once inset the
  character covers only 41% of the tile where iOS shows 72%. It has to be the character
  alone on transparency, on a 108dp canvas (81/108/162/216/324/432 px), sized so its
  bounding circle sits just inside the 72dp the mask reveals.
- `mipmap-*/ic_launcher.png` and `ic_launcher_round.png` — the generator pads these by a
  flat 8px at every density, so the same icon covers 56% of the tile on ldpi and 92% on
  xxxhdpi. They should be the full tile masked to a rounded square and a circle, drawn
  edge to edge, so the geometry is identical at every density. These are only used below
  API 26, which `minSdkVersion 24` still admits.
- `mipmap-*/ic_launcher_background.png` — unused once the background layer is a colour.
- `mobile/icons/` and `www/manifest.json` — a PWA set this project does not use; the web
  app's icons and manifest live in `app/public/icons/` and `app/src/libs/pwaManifest.ts`.

On the web side, `app/public/icons/` also carries maskable variants inset to Android's 80%
safe zone, and a flattened `icon-180x180.png` because iOS renders transparent corners
black.

## Toolchain

Versions matter here; these are the ones both apps have actually been built with.

**iOS** — Xcode 26.6 with the iOS 26.5 SDK. The simulator runtime is a separate download:

```bash
xcodebuild -downloadPlatform iOS
```

If `xcrun simctl list runtimes` stays empty afterwards, check `xcrun simctl runtime list`
for an entry marked `Unusable - Duplicate`. A duplicate blocks the good image from
mounting, and deleting it removes the shared backing asset, so the fix is to delete every
iOS image and download once more.

**Android** — **JDK 21**, matching CI and the native Java compile target:

```bash
brew install --cask temurin@21
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
```

The SDK needs `platforms;android-37.0` to match `compileSdkVersion = 37`, plus a system image for
the emulator. `avdmanager` resolves the SDK root from its own location rather than from
`ANDROID_HOME`, so the command-line tools have to live *inside* the SDK — a symlink is not
enough, because the launcher script resolves symlinks before deriving the root:

```bash
export ANDROID_HOME=~/Library/Android/sdk
cp -R "$(dirname "$(which sdkmanager)")/.." "$ANDROID_HOME/cmdline-tools/latest"
sdkmanager "platforms;android-37.0" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n TNR-Pixel -k "system-images;android-36;google_apis;arm64-v8a"
```

## Device validation

Validate push delivery, Live Activities, in-app purchase, Sign in with Apple,
Clerk session persistence across cold launches, and WebView memory limits with
a signed build, real accounts, and a reachable origin.
