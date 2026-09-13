# Native UX review

Reviewed 13 September 2026. This is a presentation and navigation pass; it does not enable purchases, deletion processing or public release.

## App navigation and account management

Native settings shortcuts explicitly dismiss both settings popover variants before navigating, including when the destination is already open. App settings has its own native-only `/settings/device` page, keeping long lists of notification preferences out of the small game settings overlay. The shortcut is hidden when signed out or running on the website.

Device controls use the game's panel palette and buttons, with larger action targets, labelled notification rows, saving indicators, error recovery and separate widget/account sections. Notification permission is refreshed when returning from system Settings. Widget instructions are specific to iPhone and Android; they do not imply live or immediate widget refreshes.

The deletion page separates consequences, subscription management and account identity. External subscription actions use labelled buttons with an external-window indicator. Confirmation retains both acknowledgements, the exact phrase, identity binding and reverification. The input prevents iPhone automatic zoom; long actions wrap and the dialog can scroll. Ordinary website requests still receive 404. The deletion worker remains disabled by default.

## Authentication and store

Native sign-in uses the existing provider logos, Apple black/white treatment and larger controls. Native Clerk styling removes the repeated header and white card treatment without removing email forms, factor challenges, errors or legal/branding content. The existing website authentication behavior and native provider routing are preserved.

The store uses consistent panels, readable catalogue names in recovery/history, local store prices and an explicit unavailable-price state. Monthly renewal wording, platform-specific subscription management, purchase restore explanation and legal links accompany subscriptions. Existing purchase reconciliation, identity guards and checkout locks are preserved. Failed catalogue requests have a retry action; unavailable purchases have a clear explanation.

## System surfaces

- iOS Status, Quest and Village widgets use a shared parchment background with a dark-mode variant. Signed-out guidance explains how to start. System typography and status colors remain recognizable.
- Live Activities use the same background and adaptive foregrounds, including readable Dynamic Island icons. The OS owns their placement and lifecycle.
- Android Status widgets use parchment, a warm border and slightly larger stat labels.
- The bundled offline screen keeps the launch artwork and logo, with a parchment panel, a visible keyboard focus state and a 44px retry control.
- Haptics, background audio, notification delivery, OAuth sheets and purchase sheets retain their existing bridge behavior. OS-owned permission/authentication/payment sheets are not reskinned.

## Validation and limits

- 45 targeted tests pass across deletion confirmation, native navigation, purchase recovery/settlement and native lifecycle. Navigation tests open a real Radix popover and verify that either native destination closes it.
- TypeScript and targeted Biome checks pass. Repository lint completes with existing warnings.
- iOS Simulator and Android Debug builds pass. Android uses Android Studio's bundled JDK; the host JDK 26 fails the Android SDK image transform.
- Actual iPhone screenshots cover App settings, widget setup guidance, the deletion page, native sign-in and the unavailable store state. The signed-in test account was preserved; no deletion or purchase was submitted.
- The local store is not configured, so populated catalogue/payment-sheet visual QA remains pending on a configured sandbox build. Modified widget/Live Activity binaries compile, but their new system-surface appearance still needs installed-device visual QA. Push delivery and Apple identity revocation still require their separate integration tests.
