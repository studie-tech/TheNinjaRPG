# Store marketing assets

Store artwork and English listing copy live in this directory. Native captures live
in `assets/screenshots/mobile-store/`, grouped by platform and screen size.

| Asset | Dimensions | Purpose |
| --- | --- | --- |
| `play-feature-graphic.png` | 1024 × 500 | Google Play promotional artwork |
| `play-icon.png` | 512 × 512 | Google Play icon, derived from the native icon |
| `assets/screenshots/mobile-store/ios-6.9/` | 1320 × 2868 | iPhone screenshots |
| `assets/screenshots/mobile-store/ipad-13/` | 2064 × 2752 | iPad portrait screenshots |
| `assets/screenshots/mobile-store/android-phone/` | 1080 × 2400 | Android phone screenshots |
| `assets/screenshots/mobile-store/android-tablet/` | 1600 × 2560 | 10-inch Android tablet portrait screenshots |
| `assets/screenshots/mobile-store/android-tablet-7-inch/` | 1600 × 2560 | 7-inch Android tablet portrait screenshots |
| `listing.en-US.json` | Text | English Google Play listing copy |

Apple's app icon comes from the native asset catalog in the uploaded build.
`feature-graphic-concept.png` is the source concept for the promotional artwork;
it is not a gameplay screenshot.

The Android phone set has eight screenshots: combat, Akikaze village, jutsu, sector,
world map, profile, Global Tavern and Horizon village. Both Android tablet sets
use the same seven portrait captures, omitting the alternate village. Their artwork
shows Akikaze, Tsukimori and Horizon.

The Apple sets each have eight screenshots: combat, village, jutsu, world map,
sector, profile, private chat and an alternate village. The iPhone set features
Tsukimori and Hyorin; iPad features Tsukimori, Hyorin and Akasumi.

Capture screenshots from the native shells. Keep gameplay captures authentic and
compare them with the signed release candidate before store submission. Gameplay
captures use disposable development fixtures; the Android Global Tavern images
show the public feed in the Play internal-testing app. Apple chat images use a
private sample conversation between capture accounts. Screenshots alone do not
establish release-candidate validation.

Keep console status, release checklists and QA evidence outside the repository.
Never include test credentials, login tickets, private keys or account records.
