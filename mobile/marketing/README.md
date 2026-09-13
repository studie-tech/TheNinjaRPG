# Store marketing assets

Store artwork, screenshots and English listing copy live under `store/`.

| Asset | Dimensions | Purpose |
| --- | --- | --- |
| `store/play-feature-graphic.png` | 1024 × 500 | Google Play promotional artwork |
| `store/play-icon.png` | 512 × 512 | Google Play icon, derived from the native icon |
| `store/ios-6.9/` | 1320 × 2868 | iPhone screenshots |
| `store/ipad-13/` | 2064 × 2752 | iPad screenshots |
| `store/android-phone/` | 1080 × 2400 | Android phone screenshots |
| `store/listing.en-US.json` | Text | English Google Play listing copy |

Apple's app icon comes from the native asset catalog in the uploaded build.
`feature-graphic-concept.png` is the source concept for the promotional artwork;
it is not a gameplay screenshot.

Capture screenshots from the native shells using disposable accounts. Keep gameplay
captures authentic and compare them with the signed release candidate before store
submission. The checked-in captures use development fixtures in simulator/debug
builds; they do not establish release-candidate validation.

Keep console status, release checklists and QA evidence outside the repository.
Never include test credentials, login tickets, private keys or account records.
