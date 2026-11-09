import { describe, expect, it } from "bun:test";
import { UserRanks } from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import {
  availableJutsuLetterRanks,
  availableQuestLetterRanks,
  availableRanks,
  hasRequiredLevel,
  hasRequiredRank,
} from "@/libs/rank";

const met = (requiredRank?: UserRank) =>
  UserRanks.filter((rank) => hasRequiredRank(rank, requiredRank));

describe("hasRequiredRank", () => {
  it("compares along the shinobi progression", () => {
    expect(met("GENIN")).toEqual(["GENIN", "CHUNIN", "JONIN", "ELITE JONIN", "ELDER"]);
    expect(met("CHUNIN")).toEqual(["CHUNIN", "JONIN", "ELITE JONIN", "ELDER"]);
    expect(met("JONIN")).toEqual(["JONIN", "ELITE JONIN", "ELDER"]);
    expect(met("ELDER")).toEqual(["ELITE JONIN", "ELDER"]);
    expect(met("ELITE JONIN")).toEqual(["ELITE JONIN"]);
  });

  it("lets every rank meet a student or missing requirement", () => {
    expect(met("STUDENT")).toEqual([...UserRanks]);
    expect(met(undefined)).toEqual([...UserRanks]);
  });

  it("never meets a NONE requirement, and needs a user rank", () => {
    expect(met("NONE")).toEqual([]);
    expect(hasRequiredRank(undefined, undefined)).toBe(false);
    expect(hasRequiredRank(undefined, "STUDENT")).toBe(false);
  });
});

describe("letter ranks", () => {
  const all = ["D", "C", "B", "A", "S", "H"];

  it.each([
    ["STUDENT", ["D"], ["D"]],
    ["GENIN", ["D", "C"], ["D", "C"]],
    ["CHUNIN", ["D", "C", "B", "A"], ["D", "C", "B"]],
    ["JONIN", all, all],
    ["ELDER", all, all],
    ["ELITE JONIN", all, all],
    ["NONE", ["D"], ["D"]],
  ] as [UserRank, string[], string[]][])(
    "opens %s to its jutsu and quests",
    (rank, jutsu, quests) => {
      expect(availableJutsuLetterRanks(rank)).toEqual(jutsu as typeof all & never);
      expect(availableQuestLetterRanks(rank)).toEqual(quests as typeof all & never);
    },
  );
});

describe("availableRanks", () => {
  const upToJonin = ["STUDENT", "GENIN", "CHUNIN", "JONIN"];
  const upToElder = [...upToJonin, "ELDER"];
  const everyRank = [...upToElder, "ELITE JONIN"];

  it.each([
    ["D", ["STUDENT"]],
    ["STUDENT", ["STUDENT"]],
    ["C", ["STUDENT", "GENIN"]],
    ["GENIN", ["STUDENT", "GENIN"]],
    ["B", ["STUDENT", "GENIN", "CHUNIN"]],
    ["CHUNIN", ["STUDENT", "GENIN", "CHUNIN"]],
    ["JONIN", upToJonin],
    ["A", upToElder],
    ["ELDER", upToElder],
    ["S", everyRank],
    ["ELITE JONIN", everyRank],
    ["H", everyRank],
    ["NONE", everyRank],
    [undefined, everyRank],
  ] as const)("maps %s to its user ranks", (rank, ranks) => {
    expect(availableRanks(rank)).toEqual([...ranks] as UserRank[]);
  });
});

it("meets a level at or above the requirement", () => {
  expect(hasRequiredLevel(10, 10)).toBe(true);
  expect(hasRequiredLevel(9, 10)).toBe(false);
});
