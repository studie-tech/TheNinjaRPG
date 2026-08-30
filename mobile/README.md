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
survives it.

The origin lives in one place: `TNR_ORIGIN`. `bun run sync` writes it into `www/config.js`
and `capacitor.config.ts` reads it for the navigation allowlist.

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
| `TNRLiveUpdatesPlugin` | The `ProgressStyle` counterpart to Live Activities |
| `TNRNotificationChannels` | One channel per `PUSH_CATEGORIES` entry |
| `TNRStatusWidget` | RemoteViews home screen widget |

The Android widget uses RemoteViews rather than Glance on purpose: Glance would pull
Compose and the Kotlin toolchain into a project that needs neither, and a progress bar is
all this widget draws.

## First-time setup

```bash
cd mobile
bun install
cp .env.example .env       # fill in TNR_APP_ID at minimum
bun run sync
```

`ios/` and `android/` are already generated and committed — they carry entitlements,
`Info.plist`, the manifest and Gradle config, which are part of the app rather than build
output. Do not regenerate them with `cap add`; that would discard every capability
configured on top of the template.

After a Capacitor upgrade, or if the Xcode project is ever recreated:

```bash
gem install xcodeproj
bun run configure:ios
```

`scripts/configure-xcode.rb` applies the widget extension target, entitlements and build
settings, and validates the result by reopening the project. It is idempotent.

## Running

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

Account-level setup that cannot be scripted is listed in
[`docs/StoreSubmission.md`](../docs/StoreSubmission.md), together with the review material
both stores require.

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
  both orientations.

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

**Android** — **JDK 21**, not the latest. Gradle 8.14.3 supports up to Java 24, and JDK 26
fails at configuration time with `Unsupported class file major version 70`:

```bash
brew install --cask temurin@21
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
```

The SDK needs `platforms;android-36` to match `compileSdkVersion`, plus a system image for
the emulator. `avdmanager` resolves the SDK root from its own location rather than from
`ANDROID_HOME`, so the command-line tools have to live *inside* the SDK — a symlink is not
enough, because the launcher script resolves symlinks before deriving the root:

```bash
export ANDROID_HOME=~/Library/Android/sdk
cp -R "$(dirname "$(which sdkmanager)")/.." "$ANDROID_HOME/cmdline-tools/latest"
sdkmanager "platforms;android-36" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n TNR-Pixel -k "system-images;android-36;google_apis;arm64-v8a"
```

## Verified

Both shells build, install and launch:

- **iOS** — `xcodebuild ... -sdk iphonesimulator` succeeds with zero errors and zero
  warnings in our sources. The app installs with `TNRWidgets.appex` embedded and runs on
  an iPhone 17 / iOS 26.5 simulator.
- **Android** — `./gradlew assembleDebug` succeeds. The APK installs and launches on an
  API 36 emulator, the adaptive launcher icon renders, and `libsentry-android.so` loads,
  so native crash reporting is live.

On both, the bundled entry point paints immediately and the offline screen appears when
the connectivity preflight fails — which it currently does against production, because the
CORS header the preflight needs is part of this PR and is not deployed yet. Verified
locally against this branch:

```
access-control-allow-origin: https://localhost
```

with `capacitor://localhost` allowed, an arbitrary origin refused, and `OPTIONS` answering
204.

What is still unverified is everything that needs a signed build or a real account: push
delivery, Live Activities, in-app purchase, and Sign in with Apple. Stage 0's three device
checks in [`docs/StoreSubmission.md`](../docs/StoreSubmission.md) also still stand — the
offline cold launch is now covered, but Clerk session persistence across cold launches and
the three.js memory ceiling need a signed build against a reachable origin.
