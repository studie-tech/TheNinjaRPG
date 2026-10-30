# Character sprites

The sector and combat renderers use layered LPC artwork in the existing PixiJS
scene lifecycle. Character creation and profile attribute management preview the
same appearance recipe. Body style is independent of gender; existing characters
derive their initial style from gender until the player selects one.

Sector actors and idle/walk previews use compact movement atlases. Combat loads
the attack poses. Sector actors outside a padded viewport do not acquire texture
leases; moving the viewport into their area installs them from the latest snapshot,
and departing actors release their resources through their existing render scope.

## Appearance and content

`app/src/libs/lpc/appearance.ts` resolves saved skin, eye and hair colours, all
creation traits, worn equipment and selected item variants. Equipment replaces
the corresponding base clothing. Unequipping, consuming or breaking equipment
restores that clothing. Non-wearable items explicitly resolve to `NONE`.

Skin, eye and hair palettes save directly from their selectors and do not count
toward the trait limit. Hair styles, face shapes and beard styles are mutually
exclusive within each group. The shared attribute resolver displays deterministic
choices for conflicting saved rows; selecting or removing a group replaces or
clears its old choices. Bald hides scalp hair while retaining the hair palette for beards.

`content.json` contains ID-specific visual mappings for the item catalogue.
`inferItemProfile` and `inferItemColor` cover subsequently authored content by
slot, weapon family and name. These are visual interpretations using the supplied
LPC silhouettes, rather than reproductions of item portrait artwork. The item and
variant editors expose silhouette and palette overrides. Silhouettes resolve by
variant override, item override, catalogue mapping, then family inference. Palettes
resolve by variant override, variant name, item override, catalogue mapping, item
name, then grey. A variant name can supply its colour while inheriting the item's silhouette.

`profiles.json` selects upstream definitions for both supported bodies. Missing
LPC equivalents for fans, throwing stars, rings, bracelets, tattoos and scars use
original pixel details aligned to the authored head or hand poses. LPC poses that
are absent on a particular layer hold its available pose; an authored attack pose
replaces that layer's held weapon sheets. Forward and reverse weapon slashes are
alternatives. Weapons with no authored idle pose hold their initial attack pose
while resting or walking. Mercenary and ANBU anonymity uses uniform
recipes without identifiable hair or equipment. Existing AI portrait artwork is
preserved.

Sector queries load appearance inputs with the existing snapshot and return only
the resolved public recipe. Battle initiation captures the base appearance and
item-instance visual lookup in battle state. Action processing recomposes worn
equipment in memory and records deduplicated animation cues. It performs no sprite
queries during an action. Public battle state exposes the appearance and cue,
without the internal equipment lookup.

Body-style changes use a single guarded update that excludes banned accounts and
characters in combat. The router checks the affected row count and treats an
unchanged saved style as a successful no-op. This keeps the guard atomic without
opening a transaction or locking an account row between separate reads and writes.

## Rebuilding artwork

The published frame catalogue is checked in; sprite binaries are stored in UploadThing.
Running the game needs neither Python nor the upstream generator. The import script
consumes artwork and attribution metadata from a pinned revision and stages
content-addressed PNG atlases in the gitignored `app/scripts/.artifacts/lpc/` directory.
Atlas dimensions stay within WebGL 1's guaranteed 2048px texture size.

From the repository root:

```sh
python3 -m venv /tmp/tnr-lpc-import-env
/tmp/tnr-lpc-import-env/bin/pip install Pillow==12.2.0
git clone --filter=blob:none --sparse https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator /tmp/tnr-lpc-source
git -C /tmp/tnr-lpc-source checkout 86160e7507d6841259cff624a51a63c1d4847ee3
git -C /tmp/tnr-lpc-source sparse-checkout set sheet_definitions palette_definitions
/tmp/tnr-lpc-import-env/bin/python app/scripts/import-lpc-assets.py /tmp/tnr-lpc-source
make bun run scripts/upload-lpc-assets.ts
```

The publisher uses the configured UploadThing token. It compares optimized PNGs with
lossless WebP (`exact: true`, maximum compression effort), retains the smaller file,
and verifies every decoded RGBA pixel, dimensions and alpha channel. Each upload has
an immutable content-hash custom ID. Publication verifies the downloaded bytes from
every served URL before writing the runtime catalogue and downloadable credits URL.
A local checkpoint resumes interrupted uploads without replacing published assets.
Sprite textures use raw UploadThing file keys through the existing Bunny CDN host
rewrite without resize or optimizer parameters. Extension-bearing aliases can trigger
automatic resizing, which changes packed frame coordinates. Publication verifies
Bunny's delivered bytes, preserving frame coordinates and pixel colours. No sprite binaries
are served by Next.js or committed to the repository.

To add artwork, update `profiles.json` and the shared equipment validator when
introducing a new silhouette, then import again. The script selects only required
source blobs and removes obsolete staged PNGs. Keep its `REVISION` synchronized
with the checked-out upstream revision when deliberately upgrading the source.

To refresh catalogue mappings, supply a JSON array with `id`, `name`, `slot`,
`itemType` and `weaponType` to `app/scripts/map-lpc-content.ts` using Bun. Review the
generated mappings; preserve deliberate ID-specific choices or place durable staff
overrides on the corresponding item. Variant overrides remain in the database.

## Distribution and validation

`/credits`, linked in the footer, attributes the selected upstream assets, records
recolouring and repacking, and links each source and chosen licence.
The catalogue's UploadThing credits URL carries downloadable attribution. Sprite files
and credits remain publicly accessible for web and native players through immutable,
versioned UploadThing URLs.

The [LPC migration](../app/drizzle/migrations/0129_superb_polaris.sql) adds nullable
item and variant overrides plus the player's body choice. Apply the journaled
migrations through this migration before deploying code that selects these columns.
Existing rows use the catalogue and attribute defaults without a content backfill.

Tests under `app/tests/libs/lpc/` validate creation choices, mappings, attribution,
published asset URLs and frame bounds. The publication command validates lossless
compression, transparency and downloaded content hashes for every atlas. Rendering tests cover repeated attacks,
cue deduplication, cancellation and texture ownership. The database suite in
`app/tests/queries/lpc.mysql.test.ts` verifies sector and profile snapshots and the
atomic guard against body edits during combat. Run SQL tests only against an
explicitly configured throwaway database as described in `AGENTS.md`.
