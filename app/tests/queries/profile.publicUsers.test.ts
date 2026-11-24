import { beforeEach, expect, it } from "bun:test";
import { userData } from "@/drizzle/schema";
import { listPublicUserRows } from "@/queries/profile";
import { getPublicUsersSchema } from "@/validators/user";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

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
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Weakest",
      isAi: true,
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.level)).toEqual([5, 12, 30]);
  });
});

describeWithDatabase("public user filters", () => {
  beforeEach(async () => {
    await resetTables(userData);
    const now = Date.now();
    await insertUsers([
      {
        userId: "lvl-24",
        username: "Lvl24",
        level: 24,
        updatedAt: new Date(now - 40 * 60_000),
      },
      {
        userId: "lvl-25",
        username: "Lvl25",
        level: 25,
        updatedAt: new Date(now - 10 * 60_000),
      },
      {
        userId: "lvl-35",
        username: "Lvl35",
        level: 35,
        updatedAt: new Date(now - 40 * 60_000),
      },
      {
        userId: "lvl-36",
        username: "Lvl36",
        level: 36,
        updatedAt: new Date(now - 10 * 60_000),
      },
    ]);
  });

  it("keeps characters within the level range", async () => {
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Weakest",
      minLevel: 25,
      maxLevel: 35,
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.level)).toEqual([25, 35]);
  });

  it("keeps characters active within the window", async () => {
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Weakest",
      activeWithinMinutes: 30,
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual(["lvl-25", "lvl-36"]);
  });
});

describeWithDatabase("public user staff tab", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "player", username: "Player", role: "USER", tavernMessages: 900 },
      { userId: "mod", username: "Mod", role: "MODERATOR", tavernMessages: 40 },
      { userId: "owner", username: "Owner", role: "OWNER", tavernMessages: 70 },
      { userId: "coder", username: "Coder", role: "CODER", tavernMessages: 10 },
    ]);
  });

  it("lists every non-player role by tavern messages", async () => {
    const input = getPublicUsersSchema.parse({ limit: 10, orderBy: "Staff" });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual(["owner", "mod", "coder"]);
  });
});

describeWithDatabase("public user substring search", () => {
  beforeEach(async () => {
    await resetTables(userData);
    const now = Date.now();
    await insertUsers([
      {
        userId: "old-match",
        username: "OldKakashi",
        lastIp: "10.0.12.34",
        updatedAt: new Date(now - 60 * 60_000),
      },
      {
        userId: "new-match",
        username: "NewKakashi",
        lastIp: "10.0.12.35",
        updatedAt: new Date(now - 5 * 60_000),
      },
      {
        userId: "other",
        username: "Gaara",
        lastIp: "172.16.0.1",
        updatedAt: new Date(now - 60_000),
      },
      {
        userId: "ai-match",
        username: "AiKakashi",
        isAi: true,
        lastIp: "10.0.12.36",
        updatedAt: new Date(now),
      },
    ]);
  });

  it("lists players whose username contains the term, most recently active first", async () => {
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Online",
      username: "kash",
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual(["new-match", "old-match"]);
  });

  it("lists players whose last IP contains the term, most recently active first", async () => {
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Online",
      ip: "0.12.3",
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual(["new-match", "old-match"]);
  });
});

describeWithDatabase("public user occupation filter", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "gatherer", username: "Gatherer", occupation: "GATHERING", level: 10 },
      { userId: "crafter-a", username: "CrafterA", occupation: "CRAFTING", level: 20 },
      { userId: "crafter-b", username: "CrafterB", occupation: "CRAFTING", level: 5 },
      { userId: "jobless", username: "Jobless", occupation: null, level: 30 },
    ]);
  });

  it("keeps only players with the occupation, in the requested order", async () => {
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Strongest",
      occupation: "CRAFTING",
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual(["crafter-a", "crafter-b"]);
  });

  it("combines with the other filters", async () => {
    const input = getPublicUsersSchema.parse({
      limit: 10,
      orderBy: "Strongest",
      occupation: "CRAFTING",
      username: "rB",
    });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual(["crafter-b"]);
  });

  it("lists everyone, including players without an occupation, when unset", async () => {
    const input = getPublicUsersSchema.parse({ limit: 10, orderBy: "Strongest" });
    const rows = await listPublicUserRows(await getTestDatabase(), input, 0);
    expect(rows.map((row) => row.userId)).toEqual([
      "jobless",
      "crafter-a",
      "gatherer",
      "crafter-b",
    ]);
  });
});
