# Shuriken Siege

Shuriken Siege is TheNinja-RPG's tower defense game, built as a standalone HTML5 game for
web game portals. It plays exactly like `/towerDefense`, without an account:

- Progress stays on the player's device. Scrolls, best wave and Guard Hall levels are in
  `localStorage` under `shurikenSiege:progress`, and an unfinished run under
  `shurikenSiege:run` resumes after a reload.
- A splash introduces the title, credits TheNinja-RPG, and moves on to the Guard Hall.
- Builds for portals that allow links invite players to TheNinja-RPG. Those links carry
  `utm_source=<source>&utm_medium=game&utm_campaign=shuriken-siege`, so each portal's
  visits show up separately.

The game code is the app's own (`src/layout/TowerDefense*`, `src/libs/towerDefense`,
`src/hooks/useTowerDefenseSession.ts`). `src/standalone/shurikenSiege/` adds:

- the shell: splash, Guard Hall and stage
- local progress
- portal adapters
- small shims for the app modules a portal page cannot use: Next.js links and images,
  app toasts, the tRPC character catalog, and Sentry

## Building

From the repository root:

```bash
make shuriken-siege
```

This writes one folder and one zip per target to `dist/shuriken-siege/`, for example
`dist/shuriken-siege/shuriken-siege-web-2026-11-18.zip`. Upload the zip.

The build takes these options:

- `TARGETS=web,plain`: only these targets (default: all).
- `SOURCE=itch`: the `utm_source` in back-links (default: the target's name). Build the
  `web` target once per linking portal with its own source.
- `VERSION=1.2.0`: the version in the zip names and the page (default: today's date).

The build:

1. Snapshots the enemy roster, sounds and character catalog from the live game's public
   API (`https://www.theninja-rpg.com`). Pass `--api` to the script to use another server.
2. Collects every media file the arena can load and downloads it into the zip:
   - enemy sheets
   - the hero's character layers
   - every terrain look and decoration for 400 arena seeds, with their baked shadows
   - effects, sounds, stage art and logos

   Portals then serve the whole game from their own CDN; Poki, for one, blocks outside
   requests entirely. Downloads are cached in `~/.cache/shuriken-siege`.
3. Bundles the game with Bun, builds its CSS with Tailwind, and writes `index.html`,
   `data.json`, `main.js`, `app.css` and `assets/`.

A zip is about 27 MB and 270 files, inside every portal's limits. CrazyGames allows 250 MB,
1,500 files and a 50 MB first download, or 20 MB to feature on mobile; Shuriken Siege
loads its lobby before any enemy art.

## Targets

| Target | Links back | SDK | Use for |
| --- | --- | --- | --- |
| `web` | yes | none | itch.io, Newgrounds, Armor Games, our own site |
| `plain` | no | none | Game Jolt, Y8 and other portals that forbid outgoing links |
| `crazygames` | no | CrazyGames SDK v3 | CrazyGames |
| `poki` | no | Poki SDK v2 | Poki |

The CrazyGames and Poki builds load their portal's SDK and report:

- loading finished
- gameplay start and stop: a pause, the perk draft, the results and the Guard Hall all
  stop it
- a commercial break before each new run, with game audio held during the ad

If the SDK fails to load, for example because of an ad blocker, the game plays without it.

## Testing a build

Serve the folder and open it:

```bash
python3 -m http.server 18765 --directory dist/shuriken-siege/web
```

Then play at `http://127.0.0.1:18765/`. Check:

- the splash
- buying a Guard Hall level
- a run started, retreated and banked
- a reload keeps the scrolls and best wave, and resumes an unfinished run

To confirm a build needs no outside server, play it with requests to other hosts blocked,
using the browser's request blocking or DevTools. Media missing from a build shows up as
`[shuriken-siege] unbundled media` debug lines in the console.

Every portal also has its own preview or QA tool, which runs the zip as players will see it.

## Publishing

| Portal | Where | Upload | Notes |
| --- | --- | --- | --- |
| itch.io | Dashboard, new project, "HTML" kind | `web` zip, "This file will be played in the browser", embed in a 16:9 frame with full-screen allowed | If itch.io asks about generative AI, declare the AI-generated artwork. |
| Newgrounds | Portal, submit game, HTML5 | `web` zip | New games go through a community vote. |
| Armor Games | Email mygame@armorgames.com | Link to the `web` build or zip, with how to play | State that the artwork is AI-generated and which tools made it. |
| CrazyGames | Developer portal, submit game | `crazygames` zip, landscape, desktop and mobile | Basic Launch first. Full Launch also asks for SDK ads and CrazyGames account progress, which this build does not do yet. |
| Poki | Apply on Poki for Developers | `poki` zip once invited | Poki prefers web exclusivity. Review their thumbnails and the Inspector before submitting. |
| Game Jolt | Add game, browser build | `plain` zip | No links to other versions of the game. |

Covers and thumbnails: each portal asks for its own sizes. Start them from
`SHURIKEN_SIEGE_LOGO_URL` and the stage art in `TD_STAGE_IMAGE_URLS`.

## Releasing an update

Rebuild after changes to the tower defense game, its art or the enemy roster. The build
always snapshots the current live roster and media.

1. Merge the game change. The build uses the checked-out code and the live data, so deploy
   first if the change touches the roster or assets.
2. Run `make shuriken-siege VERSION=<next version>`, and build `web` again with each linking
   portal's `SOURCE`.
3. Test the build as above.
4. Upload each zip as a new version on its portal. itch.io and Newgrounds replace the file
   in place. CrazyGames and Poki review a new version before it goes live.

Players keep their progress across versions: the storage keys stay the same. A saved run
from an older version resumes by replay; if the rules changed, it resumes at the wave it
reached.
