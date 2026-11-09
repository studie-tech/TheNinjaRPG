import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ANBU_ESPIONAGE_POINTS_COST,
  ANBU_ESPIONAGE_PRESTIGE_COST,
} from "@/drizzle/constants";
import { anbuSquad, userData, village, villageStructure } from "@/drizzle/schema";
import { anbuRouter } from "@/server/api/routers/anbu";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const input = { villageId: "target-village", anbuId: "squad" };

describeWithDatabase("ANBU espionage charges", () => {
  beforeEach(async () => {
    await resetTables(anbuSquad, userData, village, villageStructure);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home-village", name: "Home", kageId: "home-kage", sector: 1 },
      { id: "target-village", name: "Target", kageId: "target-kage", sector: 2 },
    ]);
    await db.insert(anbuSquad).values({
      id: "squad",
      image: "/squad.webp",
      name: "Squad",
      villageId: "home-village",
      kageOrderId: "kage-order",
      leaderOrderId: "leader-order",
      points: ANBU_ESPIONAGE_POINTS_COST,
    });
    await insertUsers([
      {
        userId: "spy",
        username: "spy",
        villageId: "home-village",
        anbuId: "squad",
        villagePrestige: ANBU_ESPIONAGE_PRESTIGE_COST,
      },
    ]);
    // Fail every roll so no report is built; the charge applies either way
    vi.spyOn(Math, "random").mockReturnValue(0.999);
  });
  afterEach(() => vi.restoreAllMocks());

  it("charges once and rejects the second of two concurrent missions", async () => {
    const db = await getTestDatabase();
    const messages: string[] = [];
    // Hold every charge write of the first mission until a second mission has finished
    let second: Promise<void> | undefined;
    const runSecond = () =>
      (second ??= (async () => {
        messages.push(
          (await (await callerFor(anbuRouter, "spy")).performEspionage(input)).message,
        );
      })());
    const raced = beforeStatements(
      beforeStatements(db, userData, [runSecond]),
      anbuSquad,
      [runSecond],
    );
    messages.unshift(
      (await callerForDatabase(anbuRouter, "spy", raced).performEspionage(input))
        .message,
    );
    const [spy, squad] = await Promise.all([
      db.query.userData.findFirst({ where: eq(userData.userId, "spy") }),
      db.query.anbuSquad.findFirst({ where: eq(anbuSquad.id, "squad") }),
    ]);
    expect({ prestige: spy?.villagePrestige, points: squad?.points, messages }).toEqual(
      {
        prestige: 0,
        points: 0,
        messages: [
          "Not enough village prestige or squad points",
          "Espionage mission failed",
        ],
      },
    );
  });
});
