import { beforeEach, describe, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { BasicElementName, COST_REROLL_ELEMENT } from "@/drizzle/constants";
import { actionLog, userData } from "@/drizzle/schema";
import { blackMarketRouter, getRolledElements } from "@/server/api/routers/blackmarket";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const USER_ID = "element-roller";
const minutes = (value: number) => new Date(Date.UTC(2026, 0, 1, 0, value));

const insertLogs = async (...logs: [minute: number, relatedMsg: string | null][]) =>
  (await getTestDatabase()).insert(actionLog).values(
    logs.map(([minute, relatedMsg], index) => ({
      id: `log-${index}`,
      userId: USER_ID,
      tableName: "elementRoll",
      changes: [],
      relatedMsg,
      createdAt: minutes(minute),
    })),
  );

const elementLogs = async () =>
  (await getTestDatabase())
    .select()
    .from(actionLog)
    .where(eq(actionLog.userId, USER_ID));

describeWithDatabase("element roll history", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData);
  });

  describe("getRolledElements", () => {
    const rolled = async () => getRolledElements(await getTestDatabase(), USER_ID);

    it("returns each type's elements once, in first-rolled order", async () => {
      await insertLogs(
        [1, "Primary: Fire"],
        [2, "Secondary: Water"],
        [3, "Primary: Wind"],
        [4, "Primary: Fire"],
      );
      expect(await rolled()).toEqual({
        primary: ["Fire", "Wind"],
        secondary: ["Water"],
      });
    });

    it("forgets rolls up to and including the latest reset of that type alone", async () => {
      await insertLogs(
        [1, "Primary: Fire"],
        [2, "Secondary: Water"],
        [3, "RESET: primary"],
        [3, "Primary: Earth"],
        [5, "RESET: primary"],
        [5, "Primary: Lightning"],
        [6, "Primary: Wind"],
      );
      expect(await rolled()).toEqual({ primary: ["Wind"], secondary: ["Water"] });
    });

    it("trims stored names and drops anything that is not an element", async () => {
      await insertLogs(
        [1, "Primary:  Fire "],
        [2, "Primary: Plasma"],
        [3, "Secondary: "],
        [4, null],
        [5, "primary: Water"],
        [6, "Other: Wind"],
      );
      expect(await rolled()).toEqual({ primary: ["Fire"], secondary: [] });
    });
  });

  describe("rerollElement", () => {
    const roller = {
      userId: USER_ID,
      username: "Roller",
      rank: "JONIN",
      reputationPoints: COST_REROLL_ELEMENT * 2,
    } as const;
    const saved = async () =>
      (await (
        await getTestDatabase()
      ).query.userData.findFirst({ where: eq(userData.userId, USER_ID) }))!;

    it("records the current elements once, then the new roll, and charges once", async () => {
      await insertUsers([
        { ...roller, primaryElement: "Fire", secondaryElement: "Water" },
      ]);
      const result = await (await callerFor(blackMarketRouter, USER_ID)).rerollElement({
        elementType: "secondary",
      });
      const user = await saved();
      expect(result).toMatchObject({
        success: true,
        message: "Element rerolled successfully. secondary element rerolled ",
      });
      expect(user.primaryElement).toBe("Fire");
      expect(["Fire", "Water"]).not.toContain(user.secondaryElement);
      expect(user.reputationPoints).toBe(COST_REROLL_ELEMENT);
      const messages = (await elementLogs()).map((log) => log.relatedMsg).sort();
      expect(messages).toEqual(
        [
          "Primary: Fire",
          `Secondary: ${user.secondaryElement}`,
          "Secondary: Water",
        ].sort(),
      );
    });

    it("resets the history once every basic element was rolled", async () => {
      await insertUsers([
        { ...roller, primaryElement: "Fire", secondaryElement: "Water" },
      ]);
      await insertLogs(
        ...BasicElementName.map((element, index): [number, string] => [
          index + 1,
          `Primary: ${element}`,
        ]),
      );
      vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        const result = await (
          await callerFor(blackMarketRouter, USER_ID)
        ).rerollElement({ elementType: "primary" });
        expect(result).toMatchObject({
          success: true,
          message: "Element rerolled successfully. primary element rerolled (reset)",
        });
      } finally {
        vi.restoreAllMocks();
      }
      const user = await saved();
      expect<unknown>(user.primaryElement).toBe(
        BasicElementName.find((element) => element !== "Water"),
      );
      const messages = (await elementLogs()).map((log) => log.relatedMsg);
      expect(messages.filter((message) => message === "RESET: primary")).toHaveLength(
        1,
      );
      expect(messages.filter((message) => message === "Secondary: Water")).toHaveLength(
        1,
      );
    });

    it("writes neither the reset nor the roll when the guarded charge loses", async () => {
      await insertUsers([
        {
          ...roller,
          primaryElement: "Fire",
          secondaryElement: "Water",
          reputationPoints: COST_REROLL_ELEMENT,
        },
      ]);
      await insertLogs(
        ...BasicElementName.map((element, index): [number, string] => [
          index + 1,
          `Primary: ${element}`,
        ]),
        [20, "Secondary: Water"],
      );
      const database = await getTestDatabase();
      const before = (await elementLogs()).length;
      const client = beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ reputationPoints: 0 })
            .where(eq(userData.userId, USER_ID));
        },
      ]);
      const result = await callerForDatabase(
        blackMarketRouter,
        USER_ID,
        client,
      ).rerollElement({ elementType: "primary" });
      expect(result).toEqual({
        success: false,
        message: "Your balance or elements changed. Please try again.",
      });
      expect(await elementLogs()).toHaveLength(before);
    });
  });
});
