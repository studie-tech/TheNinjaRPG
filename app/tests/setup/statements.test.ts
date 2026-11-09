import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { insertUsers } from "./factories";
import { aroundStatements } from "./statements";
import { describeWithDatabase, getTestDatabase, resetTables } from "./testDatabase";

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
