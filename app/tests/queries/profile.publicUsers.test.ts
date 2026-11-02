import { beforeEach, expect, it } from "bun:test";
import { userData } from "@/drizzle/schema";
import { listPublicUserRows } from "@/queries/profile";
import { getPublicUsersSchema } from "@/validators/user";
import { insertUsers } from "../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../setup/testDatabase";

describeWithDatabase("public user ordering", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "ai-a", username: "AiA", isAi: true, level: 30 },
      { userId: "ai-b", username: "AiB", isAi: true, level: 5 },
      { userId: "ai-c", username: "AiC", isAi: true, level: 12 },
    ]);
  });

  it("lists the weakest characters first", async () => {
    const input = getPublicUsersSchema.parse({ limit: 10, orderBy: "Weakest", isAi: true });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.level)).toEqual([5, 12, 30]);
  });
});
