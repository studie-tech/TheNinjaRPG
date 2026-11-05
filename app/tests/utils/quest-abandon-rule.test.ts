import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QuestTypes, UserRoles } from "@/drizzle/constants";
import { canAbandonQuestType } from "@/utils/permissions";

const source = (path: string) =>
  readFileSync(join(import.meta.dirname, "../../src", path), "utf8");

const PLAYER_ABANDONABLE = [
  "mission",
  "crime",
  "event",
  "errand",
  "story",
  "hunting",
  "gathering",
  "medical",
  "battlepyramid",
  "pvp",
  "overworld",
  "mastery",
  "special",
  "war",
];

describe("quest abandon rule", () => {
  it.each(QuestTypes)("lets regular players abandon only the listed %s types", (type) => {
    expect(canAbandonQuestType("USER", type)).toBe(PLAYER_ABANDONABLE.includes(type));
  });

  it("keeps war quests abandonable and ANBU quests locked for regular players", () => {
    expect(canAbandonQuestType("USER", "war")).toBe(true);
    expect(canAbandonQuestType("USER", "anbu")).toBe(false);
  });

  it("lets every other role abandon any quest type", () => {
    for (const role of UserRoles.filter((entry) => entry !== "USER")) {
      expect(QuestTypes.every((type) => canAbandonQuestType(role, type))).toBe(true);
    }
  });

  it.each(["layout/Logbook.tsx", "server/api/routers/quests.ts"])(
    "keeps %s on the shared rule",
    (path) => {
      const code = source(path);
      expect(code).toContain("canAbandonQuestType(");
      expect(code).not.toContain("ABANDONABLE_QUEST_TYPES");
    },
  );
});
