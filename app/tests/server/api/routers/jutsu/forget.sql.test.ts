import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { jutsu, userData, userJutsu, userQueue } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertJutsus, insertUsers, jutsuRow } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "forget-owner";
const otherId = "forget-other";

const ownedIds = async () =>
  (await (await getTestDatabase()).query.userJutsu.findMany())
    .map((row) => row.id)
    .sort();

const queueTraining = () =>
  getTestDatabase().then((db) =>
    db.insert(userQueue).values({
      id: "queued-strike",
      userId,
      kind: "JUTSU",
      position: 0,
      jutsuId: "strike",
    }),
  );

describeWithDatabase("jutsu forget", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userJutsu, jutsu, userData);
    await insertUsers([
      { userId, username: "ForgetOwner", status: "AWAKE" },
      { userId: otherId, username: "ForgetOther", status: "AWAKE" },
    ]);
    await insertJutsus([jutsuRow("strike"), jutsuRow("guard")]);
    await (await getTestDatabase()).insert(userJutsu).values([
      { id: "owned-strike", userId, jutsuId: "strike" },
      { id: "owned-guard", userId, jutsuId: "guard" },
      { id: "other-strike", userId: otherId, jutsuId: "strike" },
    ]);
  });

  it("forgets the caller's jutsu with a single statement", async () => {
    const api = await callerFor(jutsuRouter, userId);
    const measured = await recordQueries(() => api.forget({ id: "owned-guard" }));
    expect(measured.result).toMatchObject({
      success: true,
      message: "Jutsu forgotten",
    });
    expect(measured.statements.filter((sql) => /\bUserJutsu\b/.test(sql))).toHaveLength(
      1,
    );
    expect(await ownedIds()).toEqual(["other-strike", "owned-strike"]);
  });

  it("keeps a jutsu whose training is queued", async () => {
    await queueTraining();
    const api = await callerFor(jutsuRouter, userId);
    expect(await api.forget({ id: "owned-strike" })).toMatchObject({
      success: false,
      message: "Cancel queued training of this jutsu before forgetting it",
    });
    expect(await ownedIds()).toEqual(["other-strike", "owned-guard", "owned-strike"]);
  });

  it("keeps a jutsu whose training is queued after the request arrives", async () => {
    const db = await getTestDatabase();
    const queueFirst = beforeStatements(db, userJutsu, [queueTraining], {
      operations: ["delete"],
    });
    const api = callerForDatabase(jutsuRouter, userId, queueFirst);
    expect(await api.forget({ id: "owned-strike" })).toMatchObject({
      success: false,
      message: "Cancel queued training of this jutsu before forgetting it",
    });
    expect(await ownedIds()).toEqual(["other-strike", "owned-guard", "owned-strike"]);
  });

  it("does not forget another player's jutsu", async () => {
    const api = await callerFor(jutsuRouter, userId);
    expect(await api.forget({ id: "other-strike" })).toMatchObject({
      success: false,
      message: "Could not find jutsu to delete",
    });
    expect(
      await (await getTestDatabase()).query.userJutsu.findFirst({
        where: eq(userJutsu.id, "other-strike"),
      }),
    ).toBeDefined();
  });
});
