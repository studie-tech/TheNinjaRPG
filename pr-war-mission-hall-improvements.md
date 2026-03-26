## What was implemented

Improved the **War Mission** section of the Mission Hall: the war mission icon now always shows in the mission grid (grayed out when unavailable), the active war quest logbook is surfaced in Mission Hall so players can collect rewards without navigating away, and the daily War counter is always visible alongside the other counters.

### What the changes do

- **War mission icon always visible** — moved the war mission picker into the shared 3-column mission grid, after the PvP icon. It shows colored when a war mission can be accepted, and grayscale (like S-rank) when not.
- **New war mission image** — replaced the shrine CDN image with the dedicated `War_mission.webp` asset; added `IMG_MISSION_WAR` constant in `constants.ts`.
- **Grayscale conditions** — icon is grayed out when: village not in active war, player already has an active war quest, daily limit reached, or no missions available at player's rank.
- **Active war quest logbook in Mission Hall** — when a player has an active war quest, its `LogbookEntry` is now rendered in the Mission Hall (alongside any active regular quest logbook). This allows collecting rewards without leaving the page, which also unblocks the war mission icon so the next mission can be accepted.
- **War daily counter always shown** — `War [X / 5]` now appears in the daily counter line unconditionally, matching the behavior of Errands, Missions, Medical, and PvP counters.
- **Empty popover feedback** — added `emptyContent` prop to `MissionPicker` so clicking a disabled war icon with no missions available shows a contextual message ("Your village is not currently at war.", "Complete your active war mission first.", etc.) instead of a blank popover.

### Root cause of the "missing icon after completing a mission" bug

The war quest `LogbookEntry` was not rendered in the Mission Hall. When a player completed their war quest objectives elsewhere and returned to the Mission Hall, `currentWarQuest` still had `endAt = null` because `checkRewards` had never been called from the Mission Hall UI — there was nowhere to trigger it. With `currentWarQuest` populated, the war mission picker was hidden. A hard refresh would re-fetch stale data only if `checkRewards` had been triggered from another page.

### Guard conditions

| Guard | Purpose |
|---|---|
| `!isInActiveWar` (client) | Grays out icon and shows "not at war" message in popover |
| `!!currentWarQuest` (client) | Grays out icon and shows "complete active mission first" in popover |
| `warMissionsLeft <= 0` (client) | Grays out icon and shows daily limit message in popover |
| `availableWarMissions.length === 0` (client) | Grays out icon when no missions match player rank |
| Village/war/limit/active-quest checks (`startQuest`, server) | All client-side states are re-validated server-side — accepting a war mission through any means will be rejected if conditions aren't met |

### Files changed

- `app/drizzle/constants.ts` — added `IMG_MISSION_WAR`
- `app/src/layout/MissionHall.tsx` — war icon always in grid, war logbook shown, counter always shown, `WAR_SHRINE_IMAGE` import removed
- `app/src/layout/MissionPicker.tsx` — added `emptyContent` prop rendered when `missions.length === 0`
- `app/public/War_mission.webp` — new asset (copied from `assets/missions/`)

## Why

Players needed to navigate away from the Mission Hall to complete an active war quest, which was non-obvious and broke the acceptance flow for the next war mission. The icon disappearing on acceptance gave the false impression that war missions were unavailable rather than simply locked behind an active one.

## Guardrails

- All war mission acceptance conditions are enforced server-side in `startQuest` regardless of UI state
- `currentWarTracker` is checked before rendering the war logbook — no render if tracker data is missing
- `emptyContent` only renders when `missions.length === 0` — no change to the normal two-step picker flow

## Breaking changes

None.

## License

By making this pull request, I confirm that I have the right to waive copyright and related rights to my contribution, and agree that all copyright and related rights in my contributions are waived, and I acknowledge that the Studie-Tech ApS organization has the copyright to use and modify my contribution for perpetuity.
