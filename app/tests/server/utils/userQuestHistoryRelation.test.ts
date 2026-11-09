import { describe, expect, it } from "bun:test";
import { Client } from "@planetscale/database";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import { UserRoles } from "@/drizzle/constants";
import * as schema from "@/drizzle/schema";
import { userData } from "@/drizzle/schema";
import { userQuestHistoryRelation } from "@/server/utils/achievementObjectives";
import { canPlayHiddenQuests } from "@/utils/permissions";

// Use production's subquery relation adapter without making a network request.
const database = drizzle(
  new Client({
    host: "unused.invalid",
    username: "unused",
    password: "unused",
    fetch: async () => {
      throw new Error("SQL generation must not access a network");
    },
  }),
  { schema },
);

describe("user quest history SQL", () => {
  it.each(["findFirst", "findMany"] as const)(
    "correlates %s visibility to the outer player's role",
    (method) => {
      const config = {
        columns: { userId: true },
        where: eq(userData.userId, "player"),
        with: { userQuests: userQuestHistoryRelation },
      } as const;
      const query = (
        method === "findFirst"
          ? database.query.userData.findFirst(config)
          : database.query.userData.findMany(config)
      ).toSQL();
      expect(query.sql).toContain("NOT EXISTS (SELECT 1 FROM Quest hidden_quest");
      expect(query.sql).toContain("hidden_quest.id = `userData_userQuests`.`questId`");
      expect(query.sql).toContain("hidden_quest.hidden = TRUE");
      expect(query.sql).toContain("`userData`.`role` in (");
      expect(query.sql).not.toContain("`userData_userQuests`.`role`");
      expect(query.sql).toContain("`userData_userQuests`.`isolated` = ?");
      expect(query.params).toContain("battlepyramid");
      expect(query.params).toContain("achievement");
      for (const role of UserRoles) {
        expect(query.params.includes(role)).toBe(canPlayHiddenQuests(role));
      }
      expect(query.sql.match(/from `UserData`/gi)).toHaveLength(1);
    },
  );
});
