---
name: tnr-content-audit
description: Audit TheNinja-RPG game content (jutsu, items, bloodlines, quests, badges, AI characters, assets) for grammar, balance, sound, animation, visual and consistency gaps, and write suggestions for the staff content review desk. Use for the daily CI audit or whenever asked to "audit content", "find content gaps", "suggest content fixes", "review jutsu balance", "check item descriptions".
---

# TNR content audit

You read a snapshot of the game's content and propose a few concrete improvements. Content staff
review every suggestion in `/manual/review`; approving one saves it exactly like the manual
editor would. Aim for suggestions a busy editor approves in seconds: specific, correct, and
explained. Fewer good suggestions beat many weak ones.

## Input: the snapshot

`GET /api/content-review/snapshot?focus=<focus>` returns one JSON document. In CI it is already
downloaded to `audit/snapshot.json`.

- `focus`: today's theme (`grammar`, `balance`, `sound`, `animation`, `visual`, `consistency`,
  `new_content`). Stay on it.
- `maxEntries`: how many suggestions you may return. Never exceed it; zero means return none.
- `entities[]`: visible content for the focus. Each has `type`, `id`, `v` (its version), `fields`
  (the editable fields that matter for the focus) and, where known, `casts30d`, `winRate30d`
  (0 to 1, decided battles only) and `owners`. Visual audits also get `placeholderImage` and
  `imageSharedBy`.
- `examples`: one full editable record per type, to copy the shape of new content from.
- `assets[]`: the SFX and animation library (`id`, `name`, `type`, `frames`, `speed`, `usedBy`).
- `openSuggestions[]`, `recentlyRejected[]`, `recentlyOutdated[]`, `recentlyApplied[]`: what is
  already queued or decided in the last 10 days, with reject reasons and notes.
- `capabilities`: whether Epidemic Sound search and generation are available.
- `proposalSchema`: the JSON schema your answer must match.
- `visualCheckSchema`: the JSON schema of the battlefield check (see below).

## Output

Only one JSON object: `{ "proposals": [ ... ] }`. Each proposal:

- `title`: short and imperative, e.g. "Fix spelling in Water Prison's description".
- `category`: `GRAMMAR`, `BALANCE`, `SOUND`, `ANIMATION`, `VISUAL`, `CONSISTENCY` or
  `NEW_CONTENT`.
- `rationale`: what is wrong today, what changes, and the evidence (numbers for balance). Staff
  read this first.
- `confidence`: 0 to 100, or null.
- `usesUsageData`: true when the argument rests on `casts30d` / `winRate30d`; such suggestions
  expire after 14 days.
- `changes[]`: one per entity you change (at most 4 per proposal, normally 1):
  - `entityType`, `entityId` (null only for `CREATE`), `operation` (`UPDATE` or `CREATE`).
  - `set[]`: `{ "path": "description", "valueJson": "\"New text\"" }`. `path` is a top-level
    editable field or a dotted path into one, such as `effects.0.power` or
    `content.objectives.1.description`. `valueJson` is the new value encoded as JSON (a string
    needs its own quotes).
  - `media[]`: ask the server for sound, animation or image candidates:
    `{ "kind": "SFX", "path": "effects.0.appearSfx", "catalogIds": ["<asset id>"],
    "search": "short fiery whoosh with crackle", "generate": null }`. `catalogIds` must come
    from `assets[]`. `search` asks Epidemic Sound (sounds only) in plain words. `generate`
    describes a sound or image to generate. Leave the path out of `set` when you use `media`.
- `basis[]`: every entity you relied on, with the `v` you read:
  `{ "entityType": "JUTSU", "entityId": "...", "v": "a91f3c07d2b44e10" }`. Always include each
  entity you change. Include the peers a balance argument compares against (up to 25). When any
  of them is edited later, the suggestion leaves the queue automatically.

## Rules

1. Read `recentlyRejected` and `openSuggestions` first. Never repeat a rejected idea unless its
   entity changed since, and never target an entity that already has an open suggestion.
2. One proposal per entity. Put every fix to that entity in the same proposal.
3. Keep combat text placeholders exactly as they are: `%user`, `%target`, `%user_subject`,
   `%target_posessive` and the rest.
4. Only link asset ids that exist in `assets[]`. Prefer assets similar content already uses.
5. Balance: change at most two numbers per proposal, by at most 20%, and compare against content
   of the same rank and type. Show the comparison in the rationale.
6. Never change prices, rewards, loot, shop availability, visibility (`hidden`) or crafting
   recipes. The server refuses those fields for the audit.
7. Do not invent facts about the game's lore or mechanics. If a fix depends on something you
   cannot see in the snapshot, skip it.
8. Write in the game's voice: plain English, second person for item and jutsu descriptions,
   no emoji.

## Focus guides

- **grammar**: spelling, agreement, punctuation and awkward phrasing in names, descriptions,
  battle descriptions and quest text. Keep meaning and length close to the original.
- **balance**: outliers inside the same rank and type: damage or cost far from peers, very high
  win rates with high usage, or content nobody uses. Prefer nudging the outlier toward the
  group's range.
- **sound**: jutsu and items whose appear or disappear sound does not fit their element or
  action (a fire attack with a generic hit, a heal with a slash). Use `media` with catalog ids
  and, when nothing fits, an Epidemic `search`.
- **animation**: effects using a generic animation where a fitting one exists in `assets[]`,
  and effects whose battlefield render shows a problem. Entity fields include each effect's
  `target` and the entity's `target`, which decide where combat draws it.
- **visual**: placeholder images or images shared by unrelated entities. Use `media` with
  `kind: "IMAGE"`, `path: "image"` and a `generate` prompt describing the subject.
- **consistency**: descriptions that contradict their effects (numbers, elements, targets), and
  naming that breaks the pattern of similar content.
- **new_content**: gaps such as a rank, element or village with little content. Draft one
  complete entity with `operation: "CREATE"`, copying the structure of `examples[type]`.

## Battlefield renders

Effects play out on a hex battlefield, so the audit judges them the way players see them. The
workflow draws content with the game's own combat renderer (`/manual/review/battlefield`, the same
preview staff get on every suggestion) and attaches the renders as images;
`audit/battlefield/index.json` lists the blocks on each image.

- A block is one asset or one entity. Each row is one version of it: frames of one cycle on a
  desktop field (`appearing`, `active`, `disappearing`), then the active frame on a phone field.
  The caster stands on the left, the target on the right, and ground effects sit on the tile
  between them, as combat places them.
- Hexes are 74 px wide on desktop and 40 px on a phone. Animations are always 50 px square and
  centred on their hex, so they cover about two thirds of a desktop hex and spill over a phone
  hex; static assets are stretched to the hex's box.
- Judge what a player notices: an effect meant to cover a tile (water, fire, smoke, ice, a trap)
  covers the hex instead of a corner of it; a hit reads at hex scale and stays centred on the
  fighter; nothing important is cut off, lost against the ground, blank or a broken frame.
- On `animation` days the most used animation and static assets come attached. Prefer
  candidates that look right in their render, and cite a render when it shows the problem you
  fix.
- After the audit, every suggestion that changes what an entity draws in battle is rendered as
  `current` plus one `suggested` row per candidate, and a second run looks at those renders
  with `audit/proposals.json`. It returns `{ "verdicts": [...] }` matching `visualCheckSchema`:
  one verdict per rendered suggestion (`index` is its position in `proposals`), `keep`,
  `rejectedAssetIds` for candidates that look wrong, and a one-line `reason`. Dropped
  suggestions and rejected candidates never reach staff.

## Running it locally

The audit routes authenticate with the cron secret. Against a local dev server (see the
`tnr-dev-server` skill), with `CRON_SECRET` from `app/.env`:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:$PORT/api/content-review/snapshot?focus=grammar" -o snapshot.json
# write proposals.json as described above, then:
jq '. + {agentName: "claude · local", focus: "grammar"}' proposals.json |
  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
    -H "content-type: application/json" --data @- \
    "http://localhost:$PORT/api/content-review/proposals" | jq -r .summary
```

The response lists accepted and refused suggestions with the reason for each refusal. The
scheduled run is `.github/workflows/content-audit.yml`.
