# Character sprites

The sector and combat renderers use layered LPC artwork in the existing PixiJS
scene lifecycle. Character creation and profile attribute management preview the
same appearance recipe. Body style is independent of gender; existing characters
derive their initial style from gender until the player selects one.

## Appearance and content

`app/src/libs/lpc/appearance.ts` resolves saved skin, eye and hair colours, all
creation traits, worn equipment and selected item variants. Equipment replaces
the corresponding base clothing. Unequipping, consuming or breaking equipment
restores that clothing. Non-wearable items explicitly resolve to `NONE`.

`content.json` contains ID-specific visual mappings for the item catalogue.
`inferItemProfile` and `inferItemColor` cover subsequently authored content by
slot, weapon family and name. These are visual interpretations using the supplied
LPC silhouettes, rather than reproductions of item portrait artwork. The item and
variant editors expose silhouette and palette overrides. Resolution precedence is
variant override, item override, catalogue mapping, then family inference. A
variant name can supply its colour while inheriting the item's silhouette.

`profiles.json` selects upstream definitions for both supported bodies. Missing
LPC equivalents for fans, throwing stars, rings, bracelets, tattoos and scars use
original pixel details aligned to the authored head or hand poses. LPC poses that
are absent on a particular layer hold its available pose; an authored attack pose
replaces that layer's held weapon sheets. Mercenary and ANBU anonymity uses uniform
recipes without identifiable hair or equipment. Existing AI portrait artwork is
preserved.

Sector queries load appearance inputs with the existing snapshot and return only
the resolved public recipe. Battle initiation captures the base appearance and
item-instance visual lookup in battle state. Action processing recomposes worn
equipment in memory and records deduplicated animation cues. It performs no sprite
queries during an action. Public battle state exposes the appearance and cue,
without the internal equipment lookup.

## Rebuilding artwork

Generated PNGs and their frame catalogue are checked in, so running the game needs
neither Python nor the upstream generator. The generator's application code is not
bundled. The import script consumes artwork and attribution metadata from a pinned
revision and writes content-addressed atlases under `app/public/lpc/`.
Atlas dimensions stay within WebGL 1's guaranteed 2048px texture size.

From the repository root:

```sh
python3 -m venv /tmp/tnr-lpc-import-env
/tmp/tnr-lpc-import-env/bin/pip install Pillow==12.2.0
git clone --filter=blob:none --sparse https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator /tmp/tnr-lpc-source
git -C /tmp/tnr-lpc-source checkout 86160e7507d6841259cff624a51a63c1d4847ee3
git -C /tmp/tnr-lpc-source sparse-checkout set sheet_definitions palette_definitions
/tmp/tnr-lpc-import-env/bin/python app/scripts/import-lpc-assets.py /tmp/tnr-lpc-source
```

To add artwork, update `profiles.json` and the shared equipment validator when
introducing a new silhouette, then import again. The script selects only required
source blobs and removes obsolete generated PNGs. Keep its `REVISION` synchronized
with the checked-out upstream revision when deliberately upgrading the source.

To refresh catalogue mappings, supply a JSON array with `id`, `name`, `slot`,
`itemType` and `weaponType` to `app/scripts/map-lpc-content.ts` using Bun. Review the
generated mappings; preserve deliberate ID-specific choices or place durable staff
overrides on the corresponding item. Variant overrides remain in the database.

## Distribution and validation

`/credits`, linked in the footer, attributes the selected upstream assets, records
recolouring and repacking, and links each source and chosen licence.
`/lpc/credits.json` carries the downloadable attribution. Sprite files remain
publicly accessible for web and native players. Hashed PNG URLs use immutable
cache headers; the mutable credits file does not.

The migration adds nullable item and variant overrides plus the player's body
choice. Apply it before deploying code that selects these columns. Existing rows
use the catalogue and attribute defaults without a content backfill.

Tests under `app/tests/libs/lpc/` validate creation choices, mappings, attribution,
PNG transparency, hashes and frame bounds. Rendering tests cover repeated attacks,
cue deduplication, cancellation and texture ownership. The database suite in
`app/tests/queries/lpc.mysql.test.ts` verifies sector and profile snapshots and the
atomic guard against body edits during combat. Run SQL tests only against an
explicitly configured throwaway database as described in `AGENTS.md`.
