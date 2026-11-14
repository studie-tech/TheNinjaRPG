import { beforeEach, expect, it } from "bun:test";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { insertUsers } from "./factories";
import { aroundStatements, beforeStatements } from "./statements";
import { describeWithDatabase, getTestDatabase, resetTables } from "./testDatabase";

it.each(["injected", "compensation"] as const)(
  "retries a deadlocked %s write without repeating the injected race",
  async (victim) => {
    const attempts = { injected: 0, compensation: 0 };
    const database = {
      update: () => {
        let values: { battleId?: string | null } = {};
        const builder = {
          set: (next: typeof values) => {
            values = next;
            return builder;
          },
          where: () => builder,
          then: (
            resolve: (result: { rowsAffected: number }) => unknown,
            reject: (error: unknown) => unknown,
          ) =>
            Promise.resolve()
              .then(() => {
                const kind = values.battleId ? "injected" : "compensation";
                attempts[kind] += 1;
                if (kind === victim && attempts[kind] === 1)
                  throw new DrizzleQueryError(
                    "update UserData set battleId = ?",
                    [values.battleId],
                    new Error("Deadlock found when trying to get lock"),
                  );
                return { rowsAffected: 1 };
              })
              .then(resolve, reject),
        };
        return builder;
      },
    } as unknown as DrizzleClient;
    const retrying = aroundStatements(database, userData, (run) =>
      retryOnDeadlock(run),
    );
    let injections = 0;
    const raced = beforeStatements(retrying, userData, [
      async () => {
        injections += 1;
        await retrying
          .update(userData)
          .set({ battleId: "later-battle" })
          .where(eq(userData.userId, "actor"));
      },
    ]);
    const result = await raced
      .update(userData)
      .set({ battleId: null })
      .where(eq(userData.userId, "actor"));
    expect(result.rowsAffected).toBe(1);
    expect(injections).toBe(1);
    expect(attempts).toEqual({
      injected: victim === "injected" ? 2 : 1,
      compensation: victim === "compensation" ? 2 : 1,
    });
  },
);

/** A client that counts each statement against UserData through `layers` nested hooks. */
const counted = async (layers: number) => {
  const fired = Array<number>(layers).fill(0);
  let client = await getTestDatabase();
  for (const layer of fired.keys()) {
    client = aroundStatements(client, userData, (run) => {
      fired[layer]! += 1;
      return run();
    });
  }
  return { client, fired };
};

describeWithDatabase("aroundStatements", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([{ userId: "user", username: "user", money: 0 }]);
  });

  const update = (client: Awaited<ReturnType<typeof getTestDatabase>>) =>
    client
      .update(userData)
      .set({ money: 1 })
      .where(eq(userData.userId, "user"))
      .limit(1);

  it("fires each nested hook once and sends the statement once", async () => {
    const { client, fired } = await counted(2);
    const result = await update(client);
    expect(fired).toEqual([1, 1]);
    expect(result.rowsAffected).toBe(1);
  });

  it.each([
    [
      "catch",
      (statement: ReturnType<typeof update>) => statement.catch(() => undefined),
    ],
    [
      "finally",
      (statement: ReturnType<typeof update>) => statement.finally(() => undefined),
    ],
    ["execute", (statement: ReturnType<typeof update>) => statement.execute()],
  ])("runs the hook for a statement settled through %s", async (_label, settle) => {
    const { client, fired } = await counted(1);
    await settle(update(client));
    expect(fired).toEqual([1]);
  });
});
