# Character sprites

The sector and combat renderers use layered LPC artwork in the existing PixiJS
scene lifecycle. Character creation and profile attribute management preview the
same appearance recipe. Body style is independent of gender; existing characters
derive their initial style from gender until the player selects one.

Sector actors and idle/walk previews share compact standing, idle and movement atlases.
Combat also loads its ready stance and attack poses. Authored idle and combat cycles
retain LPC's two-pose `[0, 0, 1]` breathing sequence. Each actor has an independent
phase and chooses a new cycle duration between 1.6 and 3.6 seconds on each breath.
Its layers share one phase; walking and attacks retain their authored speed.

An outfit uses the combat stance only when every visible profile supplies it.
Other outfits use a complete authored idle when available, or retain their aligned
neutral pose with planted feet. No equipment is hidden to satisfy a missing stance,
and idle never translates the whole character. Reduced motion holds the first pose.
Hidden/offscreen scenes suspend their existing frame loop;
characters do not create individual animation timers. Sector actors outside a padded viewport do not acquire texture
leases; moving the viewport into their area installs them from the latest snapshot,
and departing actors release their resources through their existing render scope.

Travel actors show a clickable, texture-free neutral body while artwork loads.
Completed artwork replaces it atomically; failed atlas and portrait requests leave
the neutral body usable. Texture URLs and in-flight loads are shared between actors.
The texture cache's 16 MiB limit covers idle entries; active texture memory depends
on the distinct visible appearances. Releasing a scope prevents late installation
but does not cancel shared image downloads.

Movement atlases remove shared transparent margins and store identical poses once.
Their clips retain every authored step and its timing. A logical crop restores each
layer's full-size origin through Pixi's native `orig`/`trim`, with an extruded pixel
around each stored frame. Texture sources own frame views shared across actors;
disposing one actor releases its lease without destroying another actor's views.
GPU unload keeps those views valid for context restoration; source eviction destroys them.

## Appearance and content

`app/src/libs/lpc/appearance.ts` resolves saved skin, eye and hair colours, all
creation traits, worn equipment and selected item variants. Equipment replaces
the corresponding base clothing. Unequipping, consuming or breaking equipment
restores that clothing. Non-wearable items explicitly resolve to `NONE`.

The Items page's Equipped header opens an on-demand appearance preview without
expanding the equipment layout. It uses the current inventory query, including
selected variants, so equipment actions and loadout changes update the displayed
look. Closing the preview releases its renderer and texture leases.

Creation starts from curated, fully editable trait presets. The body selector can follow the gender-derived default or keep an explicit build; profile editing can restore the default.

Skin, eye and hair palettes save directly from their selectors and do not count
toward the trait limit. Hair styles, face shapes and beard styles are mutually
exclusive within each group. The shared attribute resolver displays deterministic
choices for conflicting saved rows; selecting or removing a group replaces or
clears its old choices. Bald hides scalp hair while retaining the hair palette for beards.

Item and variant rows store their LPC silhouette, palette and independent cloth, metal, wood and trim overrides. Each unset variant
field and material channel inherits the corresponding item field. Unconfigured items are hidden, and
an unset item palette uses gray. Names, descriptions and item IDs do not select
artwork. The staff editors browse searchable, categorized static thumbnails, offer palettes supplied for both builds, and preview saved fields and inheritance for both
body styles. Animation coverage distinguishes authored poses from held-pose fallbacks. Select Hidden on character to explicitly suppress an equipment layer.
Designs can replace several base garments together and hide covered hair, beards or other traits; cloaks, jewellery and partial
leg armour and waist skirts remain layered over the base clothing.

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
The complete movement catalogue stays within a 128 MiB RGBA texture-pixel budget;
only the distinct artwork used by visible characters is leased at runtime.
Running the game needs neither Python nor the upstream generator. The import script
consumes artwork and attribution metadata from a pinned revision and stages
content-addressed PNG atlases in the external `/tmp/tnr-lpc-publication/` directory.
Atlas dimensions stay within WebGL 1's guaranteed 2048px texture size.
Movement packing reconstructs every logical frame and verifies all visible RGBA
pixels and alpha values before writing an atlas. Recolouring replaces exact authored
RGB values and retains each pixel's original alpha, including partially transparent edges.

From the repository root:

```sh
python3 -m venv /tmp/tnr-lpc-import-env
/tmp/tnr-lpc-import-env/bin/pip install Pillow==12.2.0 numpy==2.5.5
git clone --filter=blob:none --sparse https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator /tmp/tnr-lpc-source
git -C /tmp/tnr-lpc-source checkout 86160e7507d6841259cff624a51a63c1d4847ee3
git -C /tmp/tnr-lpc-source sparse-checkout set sheet_definitions palette_definitions
/tmp/tnr-lpc-import-env/bin/python app/scripts/import-lpc-assets.py /tmp/tnr-lpc-source
make bun run scripts/upload-lpc-assets.ts /tmp/tnr-lpc-publication
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

Material planes partition authored source pixels before recolouring, preserving alpha and allowing independent palettes without multiplying colour combinations. Profile checkpoints in the external publication directory resume unchanged imports.

To add artwork, update `profiles.json` and the shared equipment validator when
introducing a new silhouette, then import again. The script selects only required
source blobs and removes obsolete staged PNGs. Keep its `REVISION` synchronized
with the checked-out upstream revision when deliberately upgrading the source.

The journaled appearance migrations configure audited items and variants without
rewriting player inventory. The adult customization migration upgrades design
settings to version 2, refreshes unchanged published designs and adds the expanded
library. Its item and variant corrections require the inspected ID, name, portrait,
revision and appearance fields to match. Staff edits remain intact; editors can
configure skipped or subsequently authored content through the same controls.

The LPC editor accepts the generator's v2 JSON recipe or URL. Exact definition IDs (and URL selection groups) match published library artwork; unsupported or ambiguous selections and palettes are listed before the editor applies the draft. Source credits are retained. Standard PNG imports preserve breathing rows and omit wholly transparent reserved animation rows.

## Distribution and validation

`/credits`, linked in the footer, attributes the selected upstream assets, records
recolouring and repacking, and links each source and chosen licence.
The catalogue's UploadThing credits URL carries downloadable attribution. Sprite files
and credits remain publicly accessible for web and native players through immutable,
versioned UploadThing URLs.

Apply journaled migrations, including the adult customization migration, before
deploying code that reads their columns and version 2 design settings. Character
attributes continue to supply the base appearance. New artwork is published and
byte-verified before a manifest or migration references it.

Tests under `app/tests/libs/lpc/` validate creation choices, mappings, attribution,
published asset URLs and frame bounds. The publication command validates lossless
compression, transparency and downloaded content hashes for every atlas. Rendering tests cover repeated attacks,
cue deduplication, cancellation and texture ownership. The database suite in
`app/tests/queries/lpc.mysql.test.ts` verifies sector and profile snapshots and the
atomic guard against body edits during combat. Run SQL tests only against an
explicitly configured throwaway database as described in `AGENTS.md`.
