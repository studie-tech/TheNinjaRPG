import type { LetterRank } from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";

/** List jutsu letter ranks unlocked by shinobi rank; Chunin includes A-rank jutsu. */
export const availableJutsuLetterRanks = (userrank: UserRank): LetterRank[] => {
  switch (userrank) {
    case "STUDENT":
      return ["D"];
    case "GENIN":
      return ["D", "C"];
    case "CHUNIN":
      return ["D", "C", "B", "A"];
    case "JONIN":
    case "ELDER":
    case "ELITE JONIN":
      return ["D", "C", "B", "A", "S", "H"];
  }
  return ["D"];
};

/** List quest letter ranks unlocked by shinobi rank; Chunin missions stop at B rank. */
export const availableQuestLetterRanks = (userrank: UserRank): LetterRank[] => {
  switch (userrank) {
    case "STUDENT":
      return ["D"];
    case "GENIN":
      return ["D", "C"];
    case "CHUNIN":
      return ["D", "C", "B"];
    case "JONIN":
    case "ELDER":
    case "ELITE JONIN":
      return ["D", "C", "B", "A", "S", "H"];
  }
  return ["D"];
};

/** Check whether the player meets an inclusive content-level requirement. */
export const hasRequiredLevel = (userLevel: number, requiredLevel: number) => {
  return userLevel >= requiredLevel;
};

/** Compares along the shinobi progression, which ranks Elder below Elite Jonin. */
export const hasRequiredRank = (userRank?: UserRank, requiredRank?: UserRank) => {
  if (!userRank) return false;
  if (!requiredRank) return true;
  switch (requiredRank) {
    case "STUDENT":
      return true;
    case "GENIN":
      return ["GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"].includes(userRank);
    case "CHUNIN":
      return ["CHUNIN", "JONIN", "ELDER", "ELITE JONIN"].includes(userRank);
    case "JONIN":
      return ["JONIN", "ELDER", "ELITE JONIN"].includes(userRank);
    case "ELDER":
      return ["ELDER", "ELITE JONIN"].includes(userRank);
    case "ELITE JONIN":
      return userRank === "ELITE JONIN";
  }
  return false;
};

/** Expand a letter or shinobi rank into its allowed progression range, defaulting to every rank. */
export const availableRanks = (letterRank?: LetterRank | UserRank): UserRank[] => {
  switch (letterRank) {
    case "D":
    case "STUDENT":
      return ["STUDENT"];
    case "C":
    case "GENIN":
      return ["STUDENT", "GENIN"];
    case "B":
    case "CHUNIN":
      return ["STUDENT", "GENIN", "CHUNIN"];
    case "JONIN":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN"];
    case "A":
    case "ELDER":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER"];
    case "S":
    case "ELITE JONIN":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
    default:
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
  }
};
