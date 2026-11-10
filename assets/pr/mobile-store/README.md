# Store marketing assets

Store artwork and English listing copy live in this directory. Gameplay screenshots
are hosted on UploadThing through BunnyCDN. Their download URLs, filenames, ordering,
dimensions, MIME types and SHA-256 checksums live in
[`assets/screenshots/mobile-store/manifest.json`](../../screenshots/mobile-store/manifest.json).
Download each group's files to a directory outside the repository before uploading
them to the corresponding store listing. Use the original URLs without image
optimizer parameters to preserve the listed dimensions and checksums.

| Asset or screenshot group | Dimensions | Purpose |
| --- | --- | --- |
| `play-feature-graphic.png` | 1024 × 500 | Google Play promotional artwork |
| `play-icon.png` | 512 × 512 | Google Play icon, derived from the native icon |
| `ios-6.9` | 1320 × 2868 | iPhone screenshots |
| `ipad-13` | 2064 × 2752 | iPad portrait screenshots |
| `android-phone` | 1080 × 2400 | Android phone screenshots |
| `android-tablet` | 1600 × 2560 | 10-inch Android tablet portrait screenshots |
| `android-tablet-7-inch` | 1600 × 2560 | 7-inch Android tablet portrait screenshots |
| `listing.en-US.json` | Text | English Google Play listing copy |

Apple's app icon comes from the native asset catalog in the uploaded build.
`feature-graphic-concept.png` is the source concept for the promotional artwork;
it is not a gameplay screenshot.

Each phone and Apple set has eight screenshots: combat, village, jutsu, travel,
world map, profile, private chat and an alternate village. Both Android tablet groups
share seven captures and omit the alternate village. The catalog preserves each
platform's screenshot order. Akikaze, Hyorin, Horizon and Akasumi appear across the
sets. The private conversation is staged between disposable capture accounts.

The catalog contains browser-rendered gameplay captures at the store image
dimensions. Phone combat uses small action icons and a closer camera; the equipped
team faces Wyrmspire Stormcrown and a Samurai Guard during a jutsu animation.
Compare captures with the signed native release candidate before store submission,
and capture from the native shells when their presentation differs. Screenshots
alone do not establish release-candidate validation.

Keep source captures, console status, release checklists and QA evidence outside the
repository. Never include test credentials, login tickets, private keys or account
records.
