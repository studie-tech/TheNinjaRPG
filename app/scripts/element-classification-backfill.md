# Element classification backfill

Classification is a Content decision, independent of an effect's target elements.
Every item and jutsu needs an explicit mapping, including `[]` for unrestricted
content. Do not derive this mapping from combat effects.

Export the current catalog IDs into this shape:

```json
{"jutsus":[{"id":"jutsu-id"}],"items":[{"id":"item-id"}]}
```

Content's mapping uses the same collections with an `elements` array on every row:

```json
{"jutsus":[{"id":"jutsu-id","elements":["Fire","Water"]}],"items":[{"id":"item-id","elements":[]}]}
```

From `app/`, generate the backfill without connecting to a database:

```sh
bun scripts/element-classification-backfill.ts --mapping mapping.json --catalog catalog.json --output backfill.sql
```

The generator rejects unknown or duplicate IDs, incomplete mappings, invalid
elements, and `None` combined with real elements. It refuses to overwrite an
existing output file.

For deployment, freeze content edits, export fresh catalog IDs, validate the
mapping, apply the schema migration and the reviewed backfill, and only then
start application instances using classification-based eligibility. Empty schema
defaults are not a substitute for the backfill: starting the application first
would remove existing elemental restrictions. Retire pre-deployment battles
before this switch; their snapshots have no classification. The generator never
updates combat effects or grants items. Backups created after the migration
include classification automatically. The restore endpoint rejects backups from
before the migration; create a fresh backup after applying the curated mapping.
