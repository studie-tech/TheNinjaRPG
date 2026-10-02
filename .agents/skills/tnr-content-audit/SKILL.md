---
name: tnr-content-audit
description: Audit TheNinja-RPG game content (jutsu, items, bloodlines, quests, badges, AI characters, assets) for grammar, balance, sound, animation, visual and consistency gaps, and write suggestions for the staff content review desk. Inspect scene and character art, validate generated cutouts, and refine or reopen agent proposals. Use for the scheduled CI audit or whenever asked to "audit content", "find content gaps", "suggest content fixes", "review jutsu balance", "check item descriptions".
---

# TNR content audit

You read a snapshot of the game's content and propose concrete improvements. Content staff
review every suggestion in `/manual/review`; approving one saves it exactly like the manual
editor would. Aim for suggestions a busy editor approves in seconds: specific, correct, and
explained. There is no quota to fill: fewer good suggestions beat many weak ones.

## Input: the snapshot

`GET /api/content-review/snapshot?focus=<focus>` returns one JSON document. In CI it is already
downloaded to `audit/snapshot.json`.

- `focus`: this run's theme (`grammar`, `balance`, `sound`, `animation`, `visual`, `consistency`,
  `new_content`). Stay on it.
- `entities[]`: visible content for the focus. Each has `type`, `id`, `v` (its version), `fields`
  (the editable fields that matter for the focus) and, where known, `casts30d`, `winRate30d`
  (0 to 1, decided battles only) and `owners`. Visual audits also get `placeholderImage` and
  `imageSharedBy`.
- `examples`: one full editable record per type, to copy the shape of new content from.
- `assets[]`: the library for this focus (`id`, `name`, `type`, `image`, `url`, `v`,
  `frames`, `speed`, `usedBy`). Scene focuses include `SCENE_CHARACTER` and
  `SCENE_BACKGROUND`; inspect their pixels, not just their names. Include an asset
  in `basis` as `GAME_ASSET` with its `v` when your choice relies on it.
- `openSuggestions[]`: every suggestion still waiting for review, however old.
- `recentlyRejected[]`, `recentlyOutdated[]`, `recentlyApplied[]`: what was decided in the last
  10 days, with reject reasons and notes.
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

1. Read `openSuggestions`, `recentlyRejected`, `recentlyOutdated` and `recentlyApplied` first.
   The server refuses a change to an entity that already has an open suggestion, the exact
   change a reviewer rejected, a change that leaves the entity as it already is, and new content
   named like an existing entity or a new entity in `openSuggestions`. Do not reword a rejected
   idea either unless its entity changed since, and do not undo or redo a recent applied change.
   An outdated suggestion's entity was edited after it was made: suggest it again only if the
   entity's current `fields` still need it.
2. One proposal per entity. Put every fix to that entity in the same proposal.
3. Spread the run across its focus: entities of different types, ranks and elements, and
   different kinds of fix. A few varied proposals are worth more than many that repeat one fix
   on similar entities.
4. Keep combat text placeholders exactly as they are: `%user`, `%target`, `%user_subject`,
   `%target_posessive` and the rest.
5. Only link asset ids that exist in `assets[]`. Prefer assets similar content already uses.
6. Balance: change at most two numbers per proposal, by at most 20%, and compare against content
   of the same rank and type. Show the comparison in the rationale.
7. Never set or change an amount of reputation points or seichi silver, as a price
   (`repsCost`, `seichiSilverCost`) or as a reward (`reward_reputation`,
   `reward_seichi_silver`, in quests and in consumable items' effects). The server refuses
   those; every other field is open to suggestions.
8. Do not invent facts about the game's lore or mechanics. If a fix depends on something you
   cannot see in the snapshot, skip it.
9. Sound generation stays off unless the user explicitly requests it. Catalog selection and
   external sound searches are allowed; set SFX `generate` to null. Image generation is
   allowed when suitable inspected art is unavailable, subject to the visual checks below.
10. Write in the game's voice: plain English, second person for item and jutsu descriptions,
   no emoji. Rationales call candidates sound or image proposals and never name the service
   they come from.

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
  For quest casts, follow **Scene characters and generated art** below; scene slots hold
  asset ids and use indexed paths, rather than image URLs.
- **consistency**: descriptions that contradict their effects (numbers, elements, targets), and
  naming that breaks the pattern of similar content. Check quest cast and setting against
  the objective, dialogue, award and village context, using actual images.
- **new_content**: gaps such as a rank, element or village with little content. Draft one
  complete entity with `operation: "CREATE"`, copying the structure of `examples[type]`. Assets
  are never drafted; new sounds and images come through `media`.

## Scene characters and generated art

Before choosing a cast, read the whole quest: its description, objectives, dialogue,
quest type, village restrictions and reward. Describe the role the player meets and the
scene's tone. An award for service as kage suggests a dignified village representative or
elder; a dark unknown masked figure does not become appropriate simply because it is a
valid scene asset. Do not turn the player into their own quest giver, invent a named canon
character or assert an affiliation the evidence does not establish.

1. Inspect the current character and background images and plausible catalog alternatives
   with your image/vision tools. Scheduled runs attach labeled scene catalog sheets;
   `audit/battlefield/scene-index.json` maps labels to ids and marks unavailable images.
   Interactive runs can inspect the snapshot's image URLs or local cached originals.
   If pixels cannot be read, do not claim visual verification or choose by name alone.
2. Evaluate face visibility, apparent age, clothing, posture, expression, lighting and
   silhouette against the role, mood and setting. Check transparency, complete limbs,
   framing and readability at dialogue scale. Select the best fitting inspected candidate;
   never use Nameless Ninja or another generic fallback merely to satisfy validation.
   Cite the visible traits and scene evidence in the rationale. A plausible role is an
   editorial proposal, not proof of lore.
3. If no inspected catalog character fits, request new art through IMAGE media. Set the
   role, appearance, expression, clothes and calm dialogue pose explicitly. Request a
   single isolated full character in the game's pixel style, with transparent margins,
   no backdrop, props extending outside the frame, text, border or watermark. Example:
   ```json
   { "kind": "IMAGE", "path": "content.sceneCharacters.0", "catalogIds": [],
     "search": null, "generate": "A dignified elderly village representative, visible kind face, grey hair, modest formal robes, calm upright dialogue pose, full figure, retro pixel art, isolated on transparent background." }
   ```
   Objective casts use `content.objectives.<index>.sceneCharacters.<index>`. The slot must
   already exist or append directly at the next index; do not create array holes. If an
   array is absent, initialize it in `set` before using media. Never put a generated URL
   in `sceneCharacters`; approval creates a `SCENE_CHARACTER` asset and writes its id.
4. Generation happens on the submission server. It requests background removal and
   refuses empty cutouts or images with opaque corner backgrounds. These technical checks
   do not establish scene fit, good anatomy or clean edges. In an interactive run, GET the
   saved proposal, inspect every actual generated candidate, and open its quest scene in
   `/manual/review` using Current/Proposed and the objective selector. Inspect desktop and
   narrow layouts: head/hands/feet intact, no leftover scenery or halo, no unwanted text,
   readable face/clothes, correct role and mood, good scale/placement over the actual scene.
   Do not report a generation as validated just because its prompt or removeBg flag says so.
5. If the output fails, refine the same proposal to replace it and repeat the visual check.
   Inspect all alternatives staff may choose, not just the default. Record the inspected
   candidate and any remaining uncertainty in the rationale. Staff approval still controls
   the content write. Scheduled audits cannot inspect images generated later by the submit
   job: they must use already inspected catalog scene art or defer new scene generation to
   this interactive inspection/refinement workflow.

For delegated work, prepare shared evidence once: current full entity and version, relevant
feedback, complete catalog metadata with versions, labeled inspected images, scene context,
validator constraints and this skill. Dispatch policies must preserve scene-specific art
requirements and explicit user authorization for generation. Give each fresh subagent one content item and the
shared evidence locations. Each agent must inspect the relevant pixels itself and report
its evidence, candidate choice and validation result. Keep credentials with the submitting
coordinator; a subagent's inference is not a visual check.

## Refining and reopening agent suggestions

When the user requests updates to existing proposals, use the existing id. Do not submit
another proposal for the same target or automatically reopen staff rejections during a
scheduled audit. With the same cron authentication as submission:

- `GET /api/content-review/proposals/<id>` returns the saved proposal, `changes`, `basis`,
  `media`, staff feedback and `statusChangedAt` (the optimistic revision token).
- `PATCH /api/content-review/proposals/<id>` accepts a full replacement:
  ```json
  { "expectedStatusChangedAt": "<exact timestamp returned by GET>",
    "reactivate": false, "feedbackResponse": null, "proposal": { "title": "…", "category": "VISUAL", "rationale": "…",
      "confidence": 90, "usesUsageData": false, "changes": [], "basis": [] } }
  ```
  `proposal` is one complete object from the normal `proposals[]` output; fill in the
  abbreviated example above with all changes and basis entries. Optional `runUrl` and
  `focus` identify the revision run.
  Preserve all target entities and operations. Rebuild every intended change against fresh
  live content and versions; omitted fields/candidates are removed from the proposal.
  Do not blindly replay old `after` values or lose other intended fixes.
- For REJECTED or OUTDATED proposals, explicitly set `reactivate: true`. Read staff feedback
  and explain how the revision addresses it in `feedbackResponse` (required for rejection).
  The old decision metadata remains visible; this queues a revised draft for staff, without
  approving or applying it. STAFF, APPLIED and REVERTED proposals cannot be revised here.
- On HTTP 409, refetch the proposal and live basis and reassess the conflict. Never force a
  retry with a new token without checking the intervening decision. On validation refusal,
  correct the actual issue; do not remove safeguards or substitute a poor scene fit.
- To keep already inspected GENERATED/EPIDEMIC candidates, pass their GET `media[].id`
  values in optional `retainMediaIds`. Include matching media requests with the same target,
  kind and path, `catalogIds: []`, `search: null`, `generate: null`. Other candidates are
  removed. Retained candidates are not generated again; use this when recording a successful
  visual check in the rationale. Catalog candidates use their catalog ids as usual.
  When retaining media for multiple CREATE changes of the same entity type, preserve their
  relative order: their null entity ids are paired with the saved changes by occurrence.
- After POST/PATCH generation, GET and inspect the resulting media and composed scene as
  above. Request a fresh candidate through media to replace a failed generation. A catalog
  character can be retained by its inspected id; ordinary image fields can retain their URL.

## Battlefield renders

Effects play out on a hex battlefield, so the audit judges them the way players see them. The
workflow draws content with the game's own combat renderer (`/manual/review/battlefield`, the same
preview staff get on every suggestion) and attaches the renders as images;
`audit/battlefield/index.json` lists the blocks on each image.

- A block is one asset or one entity. Each row is one version of it: frames of one cycle on a
  desktop field (`appearing`, `active`, `disappearing`), then the active frame on a phone field.
  The caster stands on the left, the target on the right, and ground effects sit on the tile
  between them, as combat places them.
- On a player's screen, hexes are 74 px wide on desktop and 40 px on a phone. Animations are
  always 50 px square and centred on their hex, so they cover about two thirds of a desktop hex
  and spill over a phone hex; static assets are stretched to the hex's box. The renders draw
  everything at twice these sizes.
- Judge what a player notices: an effect meant to cover a tile (water, fire, smoke, ice, a trap)
  covers the hex instead of a corner of it; a hit reads at hex scale and stays centred on the
  fighter; nothing important is cut off, lost against the ground, blank or a broken frame.
- On `animation` runs the most used animation and static assets come attached. Prefer
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
