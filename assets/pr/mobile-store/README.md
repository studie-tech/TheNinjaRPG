# Store marketing assets

Store artwork and English listing copy live in this directory. Native captures live
in `assets/screenshots/mobile-store/`, grouped by platform and screen size.

| Asset | Dimensions | Purpose |
| --- | --- | --- |
| `play-feature-graphic.png` | 1024 × 500 | Google Play promotional artwork |
| `play-icon.png` | 512 × 512 | Google Play icon, derived from the native icon |
| `assets/screenshots/mobile-store/ios-6.9/` | 1320 × 2868 | iPhone screenshots |
| `assets/screenshots/mobile-store/ipad-13/` | 2752 × 2064 | iPad landscape screenshots |
| `assets/screenshots/mobile-store/android-phone/` | 1080 × 2400 | Android phone screenshots |
| `listing.en-US.json` | Text | English Google Play listing copy |

Apple's app icon comes from the native asset catalog in the uploaded build.
`feature-graphic-concept.png` is the source concept for the promotional artwork;
it is not a gameplay screenshot.

Each platform has eight screenshots, ordered for the store gallery: combat, village,
jutsu, world map, sector, profile, private chat and an alternate village. The iPhone
set features Tsukimori and Hyorin; iPad features Hyorin and Akasumi; Android features
Akikaze and Horizon. Chat uses a private sample conversation between capture accounts.

Capture screenshots from the native shells using disposable accounts. Keep gameplay
captures authentic and compare them with the signed release candidate before store
submission. The checked-in captures use development fixtures in simulator/debug
builds; they do not establish release-candidate validation.

Keep console status, release checklists and QA evidence outside the repository.
Never include test credentials, login tickets, private keys or account records.
