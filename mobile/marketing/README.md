# Store marketing assets

Final exports and authentic native captures are under `store/`. The status of each
store section is tracked in `docs/StoreConsoleAudit.md`; release dependencies and
product identifiers are in `docs/StoreSubmission.md`.

| Asset | Dimensions | Console status on 2026-09-12 |
| --- | --- | --- |
| `store/play-feature-graphic.png` | 1024 × 500 | Prepared; Google listing creation remains pending |
| `store/play-icon.png` | 512 × 512 | Prepared from the existing native icon |
| `store/ios-6.9/` (3 PNGs) | 1320 × 2868 | Uploaded to Apple iPhone 6.9-inch slot |
| `store/ipad-13/` (1 PNG) | 2064 × 2752 | Uploaded to Apple iPad 13-inch slot |
| `store/android-phone/` (2 PNGs) | 1080 × 2400 | Prepared; not uploaded |
| `store/listing.en-US.json` | Text | Google listing copy, within field length limits |

Apple also has one authentic iPhone 6.3-inch widget screenshot from the native QA
set. Its original is kept with the private QA evidence, outside this asset directory.
Apple's app icon is embedded in the native asset catalog and arrives with the build.

## Capture provenance

Captured on 2026-09-12 from the actual Capacitor shells using dedicated disposable
development accounts, not production player accounts. iPhone 17 Pro Max and iPad Pro
13-inch (M5) use iOS 26.5 Simulator; Android uses the API 36 Pixel emulator. The shells
loaded the development backend on local port 3100 with the native fixes in PR #1534. Accounts have level-50 fixture
characters; the jutsu screenshot uses eight existing published D-rank jutsu.

Screenshots are unmodified native captures. Only Next.js developer tooling was
hidden at capture time, matching its absence from production; those temporary web
configuration/CSS changes were restored afterwards. No gameplay UI was composited or
generatively edited. These images show simulator/debug builds, not a signed store
release candidate. Recheck them against the final candidate before submission.

The feature graphic is promotional artwork generated from the existing brand
concept, exported to Play's exact dimensions and visually inspected. It is not a
gameplay screenshot. The original `feature-graphic-concept.png` remains a concept.

No test credentials, login tickets, private keys, or account records belong here.
