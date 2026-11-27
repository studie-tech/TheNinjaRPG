# Shuriken Siege

Shuriken Siege is TheNinja-RPG's tower defense game, built as a standalone HTML5 game for
web game portals. It plays exactly like `/towerDefense`, without an account:

- Progress stays on the player's device. Scrolls, best wave and Guard Hall levels are in
  `localStorage` under `shurikenSiege:progress`, and an unfinished run under
  `shurikenSiege:run` resumes after a reload. The YouTube build keeps progress in
  YouTube's cloud save instead (see [YouTube Playables](#youtube-playables)).
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
`dist/shuriken-siege/shuriken-siege-web-2026-11-18.zip`. Upload the zip. A build with
its own `SOURCE` (letters and digits) adds it to the name
(`shuriken-siege-web_itch-2026-11-18.zip`), and a
build replaces only the folders and zips of its own targets, so the other targets and
source variants already in `dist/shuriken-siege/` stay.

The build takes these options:

- `TARGETS=web,plain`: only these targets (default: all).
- `SOURCE=itch`: the `utm_source` in back-links (default: the target's name). Build the
  `web` target once per linking portal with its own source.
- `VERSION=1.2.0`: the version in the zip names and the page (default: today's date).
- `GD_GAME_ID=<id>`: the 32-character game ID GameDistribution assigns when the game is
  created in its developer portal. The `gamedistribution` target needs it, so a full
  build without it skips that target.

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

A zip is about 27 MB and 270 files, inside every portal's limits, and Shuriken Siege loads
its lobby before any enemy art.

## Targets

| Target | Links back | SDK | Use for |
| --- | --- | --- | --- |
| `web` | yes | none | itch.io, Newgrounds, our own site |
| `plain` | no | none | Game Jolt, Y8 and other portals that forbid outgoing links |
| `poki` | no | Poki SDK v2 | Poki |
| `gamedistribution` | no | GameDistribution HTML5 SDK | GameDistribution and the sites it syndicates to |
| `gamepix` | no | GamePix SDK v3 | GamePix and the sites it distributes to |
| `youtube` | no | YouTube Playables SDK v1 | YouTube Playables |

The Poki build loads Poki's SDK and reports:

- loading finished
- gameplay start and stop: a pause, the perk draft, the results and the Guard Hall all
  stop it
- a commercial break before each new run, with game audio held during the ad

The GameDistribution build sets `GD_OPTIONS` with its game ID before loading the SDK, and
asks for an ad (`gdsdk.showAd()`) before each new run, always after the player pressed
start. The SDK pauses the game around every ad, the preroll included, through its
`SDK_GAME_PAUSE` and `SDK_GAME_START` events: the game holds its audio and freezes the run
until the ad ends.

The GamePix build sets `GamePixConfig = { lifecycle: "manual" }` and loads the GamePix SDK
before any game code, because GamePix syncs `localStorage` only for a page that loaded its
SDK first. Progress and unfinished runs stay under the same `localStorage` keys. The game:

- reports loading progress with `lifecycle.loading()` while its data loads, and
  `lifecycle.loaded()` once it has rendered, which lets the GamePix Player show it
- sends `lifecycle.gameStart()` once, when the first run starts
- asks for an interstitial (`ads.interstitial()`) before each new run, always after the
  player pressed start
- holds the run and its audio on the SDK's `pause` event and releases them on `resume`.
  GamePix sends these around its own ads and Player overlays.

If an SDK fails to load, for example because of an ad blocker, the game plays without it.

### YouTube Playables

The `youtube` build loads the Playables SDK as the page's first script, before any game
code, and follows the Playables rules:

- `firstFrameReady()` once the page's loading screen is on screen, and `gameReady()`
  once the Guard Hall is ready to play, never during loading or the splash.
- Progress is read with `loadData()` before anything is written, and saved only with
  `saveData()`, which keeps the same progress format as `localStorage`. A failed read is
  tried again; if it keeps failing, the visit plays with its progress in memory and never
  overwrites the cloud save it could not read. Unfinished runs are
  not kept, so a reload starts in the Guard Hall; the run's scrolls are banked when it ends.
- `onPause` and `onResume` hold the run and audio and take the arena down, so nothing
  renders while YouTube has paused the game.
- YouTube owns the sound and the frame: the game follows `isAudioEnabled()` and
  `onAudioEnabledChange`, and shows neither its mute nor its full-screen button.
- The best wave goes to `sendScore()` when the game opens and after each run.
- An interstitial (`requestInterstitialAd()`) is requested before each new run.
- The build checks that every file name uses only letters, digits, `_`, `-` and `.`.

Outside YouTube the SDK does nothing, and the build plays like `plain` with local progress.

The shared renderer still reads `document.hidden` to skip drawing in background tabs. It
never listens for visibility changes, but a Playables reviewer may ask about it.

## Testing a build

Serve the folder and open it:

```bash
python3 -m http.server 18765 --directory dist/shuriken-siege/shuriken-siege-web-2026-11-18
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
Served locally, the GamePix SDK stands in for its Player: open the `gamepix` build with
`?gpx_inspector=1` to see the loading, start, ad, pause and resume events it receives, and
to send it a pause or resume.

## Publishing

| Portal | Where | Upload | Notes |
| --- | --- | --- | --- |
| itch.io | Dashboard, new project, "HTML" kind | `web` zip, "This file will be played in the browser", embed in a 16:9 frame with full-screen allowed | If itch.io asks about generative AI, declare the AI-generated artwork. |
| Newgrounds | Portal, submit game, HTML5 | `web` zip | New games go through a community vote. |
| Poki | Apply on Poki for Developers | `poki` zip once invited | Poki prefers web exclusivity. Review their thumbnails and the Inspector before submitting. |
| Game Jolt | Add game, browser build | `plain` zip | No links to other versions of the game. |
| GameDistribution | Developer portal, add game | `gamedistribution` zip, built with the game ID from that page | Their QA tool checks the preroll ad and the pause events before the game is distributed. |
| GamePix | my.gamepix.com, Create New Game | `gamepix` zip, under Build > Upload a build | Tick "SDK integration" under Info. Icon 256x256, cover 1360x850. Preview the build in the GamePix Player before submitting it for review. |
| YouTube Playables | Apply through the Playables partner program | `youtube` zip, in YouTube's Playables test suite first | Covers and icons must not show TheNinja-RPG links or other platforms' branding. A YouTube partner manager approves each release. |

Covers and thumbnails: each portal asks for its own sizes. Start them from
`SHURIKEN_SIEGE_LOGO_URL` and the stage art in `TD_STAGE_IMAGE_URLS`.

## Releasing an update

Rebuild after changes to the tower defense game, its art or the enemy roster. The build
always snapshots the current live roster and media.

1. Merge the game change. The build uses the checked-out code and the live data, so deploy
   first if the change touches the roster or assets.
2. Run `make shuriken-siege VERSION=<next version> GD_GAME_ID=<id>`, and build `web` again
   with each linking portal's `SOURCE`.
3. Test the build as above.
4. Upload each zip as a new version on its portal. itch.io and Newgrounds replace the file
   in place. Poki, GameDistribution, GamePix and YouTube review a new version
   before it goes live.

Players keep their progress across versions: the storage keys and the progress format
stay the same, in `localStorage` and in YouTube's cloud save. A saved run
from an older version resumes by replay; if the rules changed, it resumes at the wave it
reached.
