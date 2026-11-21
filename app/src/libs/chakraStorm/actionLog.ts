/**
 * The compact text form of a Chakra Storm action log, sent with a claim. Entries are
 * separated by ";" and each is `<ticks since the previous entry><code>`: `m<direction>`
 * walks (`m-1` stands still), `p<index>` picks a card, `r` rerolls, `s` skips and `q`
 * gives up. A run that walks with a joystick changes direction often, so the deltas keep
 * a full fifteen-minute log to tens of kilobytes.
 */
import type { CsAction } from "@/libs/chakraStorm/sim";

/** Encode a log of `[tick, action]` entries in tick order. */
export const encodeCsActions = (log: readonly [number, CsAction][]) => {
  let previous = 0;
  return log
    .map(([tick, action]) => {
      const delta = tick - previous;
      previous = tick;
      return `${delta}${actionCode(action)}`;
    })
    .join(";");
};

/**
 * Decode a log, or null when it is malformed, runs backwards in time or holds more than
 * `maxActions` entries. Whether each action applies is the replay's to decide.
 */
export const decodeCsActions = (
  text: string,
  maxActions: number,
): [number, CsAction][] | null => {
  if (text === "") return [];
  const entries = text.split(";");
  if (entries.length > maxActions) return null;
  const log: [number, CsAction][] = [];
  let tick = 0;
  for (const entry of entries) {
    const match = /^(\d{1,6})(m-?\d{1,2}|p\d|r|s|q)$/.exec(entry);
    if (!match?.[1] || !match[2]) return null;
    tick += Number(match[1]);
    const code = match[2];
    const action: CsAction =
      code[0] === "m"
        ? ["move", Number(code.slice(1))]
        : code[0] === "p"
          ? ["pick", Number(code.slice(1))]
          : code === "r"
            ? ["reroll"]
            : code === "s"
              ? ["skip"]
              : ["quit"];
    log.push([tick, action]);
  }
  return log;
};

const actionCode = (action: CsAction) => {
  switch (action[0]) {
    case "move":
      return `m${action[1]}`;
    case "pick":
      return `p${action[1]}`;
    case "reroll":
      return "r";
    case "skip":
      return "s";
    case "quit":
      return "q";
  }
};
