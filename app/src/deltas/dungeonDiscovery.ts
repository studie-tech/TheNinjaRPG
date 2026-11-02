import type { RouterOutputs } from "@/app/_trpc/client";

type Availability = RouterOutputs["coop"]["dungeon"]["getAvailable"];

/** Hide expired entrances without trusting an older response to extend their lifetime. */
export const getVisibleDungeonEntrances = (
  available: Availability | undefined,
  sector: number,
  now: number,
) =>
  available?.filter(
    ({ content }) =>
      !content.hidden &&
      content.sector === sector &&
      (!content.expiresAt || new Date(content.expiresAt).getTime() > now),
  );
