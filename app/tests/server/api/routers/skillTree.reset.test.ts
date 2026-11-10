import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, userData, userSkill } from "@/drizzle/schema";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { insertUsers } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "skill-resetter";

const reset = async () =>
  callerForDatabase(
    skillTreeRouter,
    userId,
    await getTestDatabase(),
  ).resetSkillPoints();

describeWithDatabase("skill point reset messages", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userSkill, userData);
  });

  it("names no supporter tier for the reset every account gets", async () => {
    await insertUsers([{ userId, username: "Resetter", federalStatus: "NONE" }]);
    expect((await reset()).message).toBe(
      "Skill points reset! (Free monthly allowance)",
    );
    const [log] = await (await getTestDatabase())
      .select()
      .from(actionLog)
      .where(eq(actionLog.userId, userId));
    expect(log?.relatedMsg).toBe("Free monthly allowance");
  });

  it("names the supporter tier when it made the reset free", async () => {
    await insertUsers([{ userId, username: "Resetter", federalStatus: "GOLD" }]);
    expect((await reset()).message).toBe(
      "Skill points reset! (Free monthly allowance)",
    );
    expect((await reset()).message).toBe(
      "Skill points reset! (Free for GOLD supporter)",
    );
  });

  it("mentions nothing free for a paid reset", async () => {
    await insertUsers([
      { userId, username: "Resetter", federalStatus: "NONE", reputationPoints: 100 },
    ]);
    await reset();
    expect((await reset()).message).toBe("Skill points reset!");
  });
});
