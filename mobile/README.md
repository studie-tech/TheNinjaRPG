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

Source artwork lives in `app/public/icons/`. The maskable variants are inset to the 80%
safe zone Android crops to, and `icon-180x180.png` is flattened because iOS renders
transparent corners black. The launcher and splash assets in the native projects come from
the 1024px source via `@capacitor/assets`.

## Not verified yet

None of the native code has been compiled or run — it was written on a machine with no
Xcode and no Android SDK. Swift is syntax-checked with `swiftc -parse`, every plist passes
`plutil -lint`, all XML parses, and the Xcode project round-trips through the `xcodeproj`
gem. That catches syntax and structure, not types or linking. Expect to fix compile errors
on the first real build.
