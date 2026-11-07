import type { LetterRank } from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";

export const availableJutsuLetterRanks = (userrank: UserRank): LetterRank[] => {
  switch (userrank) {
    case "STUDENT":
      return ["D"];
    case "GENIN":
      return ["D", "C"];
    case "CHUNIN":
      return ["D", "C", "B", "A"];
    case "JONIN":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELDER":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELITE JONIN":
      return ["D", "C", "B", "A", "S", "H"];
  }
  return ["D"];
};

export const availableQuestLetterRanks = (userrank: UserRank): LetterRank[] => {
  switch (userrank) {
    case "STUDENT":
      return ["D"];
    case "GENIN":
      return ["D", "C"];
    case "CHUNIN":
      return ["D", "C", "B"];
    case "JONIN":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELDER":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELITE JONIN":
      return ["D", "C", "B", "A", "S", "H"];
  }
  return ["D"];
};

export const hasRequiredLevel = (userLevel: number, requiredLevel: number) => {
  return userLevel >= requiredLevel;
};

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

export const availableRanks = (letterRank?: LetterRank | UserRank): UserRank[] => {
  switch (letterRank) {
    case "D":
      return ["STUDENT"];
    case "C":
      return ["STUDENT", "GENIN"];
    case "B":
      return ["STUDENT", "GENIN", "CHUNIN"];
    case "A":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER"];
    case "S":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
    case "STUDENT":
      return ["STUDENT"];
    case "GENIN":
      return ["STUDENT", "GENIN"];
    case "CHUNIN":
      return ["STUDENT", "GENIN", "CHUNIN"];
    case "JONIN":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN"];
    case "ELDER":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER"];
    case "ELITE JONIN":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
    default:
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
  }
};
