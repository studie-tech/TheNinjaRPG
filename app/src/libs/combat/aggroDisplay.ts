import { stillInBattle } from "./actions";
import { wantsHumanActionSet } from "./turn";
import type { ReturnedUserState } from "./types";

/** Compare a side's threat only when an active opposing NPC can act on it. */
export const getAggroDisplay = (users: ReturnedUserState[]) => {
  const active = users.filter(
    (user) => !user.hidden && !user.leftBattle && stillInBattle(user),
  );
  const npcSides = new Set(
    active.filter((user) => !wantsHumanActionSet(user)).map((user) => user.direction),
  );
  const threatened = active.filter((user) =>
    npcSides.has(user.direction === "left" ? "right" : "left"),
  );
  const highest = { left: 0, right: 0 };
  for (const user of threatened) {
    highest[user.direction] = Math.max(highest[user.direction], user.enmity ?? 0);
  }
  return new Map(
    threatened.map((user) => {
      const enmity = user.enmity ?? 0;
      const maximum = highest[user.direction];
      return [
        user.userId,
        {
          enmity,
          ratio: maximum > 0 ? enmity / maximum : 0,
          isHighest: maximum > 0 && enmity === maximum,
        },
      ];
    }),
  );
};

export type AggroDisplay = ReturnType<typeof getAggroDisplay>;
