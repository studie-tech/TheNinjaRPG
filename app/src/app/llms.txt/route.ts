import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/libs/seo";

export const dynamic = "force-static";

/** A concise directory of public game references for clients that support llms.txt. */
export function GET() {
  return new Response(
    `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

TheNinja-RPG is an English-language, anime-inspired multiplayer browser RPG set in Seichi. Players create a persistent ninja, train jutsu, join villages, complete missions and fight tactical, turn-based battles. The game is free to play with optional purchases. It runs in a browser on mobile and desktop without a download.

## Start playing

- [Play TheNinja-RPG](${SITE_URL}/): Game overview and account creation.
- [Getting started](${SITE_URL}/guide/getting-started): Beginner guide to creating and training a ninja.
- [Game guides](${SITE_URL}/guide): Guides to progression, combat and the world.
- [Rules](${SITE_URL}/rules): Community and gameplay rules.

## Game reference

- [Game manual](${SITE_URL}/manual): Public reference for game mechanics and content.
- [Jutsu](${SITE_URL}/manual/jutsu): Techniques available in the game.
- [Bloodlines](${SITE_URL}/manual/bloodline): Character bloodlines and their abilities.
- [Items](${SITE_URL}/manual/item): Equipment and items.
- [Combat](${SITE_URL}/manual/combat): Battle mechanics.
- [World](${SITE_URL}/guide/world): Seichi and travel.

## Community

- [News](${SITE_URL}/news): Official game updates.
- [Forum](${SITE_URL}/forum): Player discussions.
- [Help](${SITE_URL}/help): Support and common questions.

Game content and balance can change. Use the linked references for current details. Account-specific screens require sign-in; public guides and the manual are the references for general game information.
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
