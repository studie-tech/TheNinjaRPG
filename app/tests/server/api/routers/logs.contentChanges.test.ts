import { describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { UserRole } from "@/drizzle/constants";
import { logsRouter } from "@/routers/logs";
import { resolverOf } from "../../../setup/testDatabase";

type ContentChanges = ReturnType<typeof logsRouter.createCaller>["getContentChanges"];
type Input = Parameters<ContentChanges>[0];
type Entry = Awaited<ReturnType<ContentChanges>>["data"][number];
type Label = { id: string; name: string };
type Query = { where: SQL };

const entry = (changes: string[] = []): Entry => ({
  userId: "author",
  user: { username: "Author" },
  createdAt: new Date(0),
  changes,
  relatedId: "content",
  relatedMsg: "Updated content",
  relatedImage: null,
});

const setup = (
  options: {
    role?: UserRole;
    userId?: string | null;
    targetExists?: boolean;
    entries?: Entry[];
    bloodlines?: Label[];
    villages?: Label[];
  } = {},
) => {
  const findUser = vi.fn(
    async (_query: Query) =>
      ({
        userId: "author",
        role: "USER" as UserRole,
      }) as { userId: string; role: UserRole } | undefined,
  );
  findUser.mockResolvedValueOnce({ userId: "viewer", role: options.role ?? "USER" });
  if (options.targetExists === false) findUser.mockResolvedValueOnce(undefined);
  const findEntries = vi.fn(async (_query: Query) => options.entries ?? [entry()]);
  const findBloodlines = vi.fn(async (_query: Query) => options.bloodlines ?? []);
  const findVillages = vi.fn(async (_query: Query) => options.villages ?? []);
  const drizzle = {
    query: {
      userData: { findFirst: findUser },
      actionLog: { findMany: findEntries },
      bloodline: { findMany: findBloodlines },
      village: { findMany: findVillages },
    },
  };
  // Query planning and masking use the real resolver and fetchUser with a local database stub.
  const resolver = resolverOf(logsRouter.getContentChanges);
  const query = (input: Partial<Input> = {}) =>
    resolver({
      ctx: {
        drizzle,
        userId: options.userId === undefined ? "viewer" : options.userId,
      },
      input: { logtype: "jutsu", limit: 50, ...input },
    });
  return { query, findUser, findEntries, findBloodlines, findVillages };
};

const params = (query: Query) => new MySqlDialect().sqlToQuery(query.where).params;

describe("logs.getContentChanges", () => {
  it.each([undefined, ""])(
    "skips the target lookup for username %p and still masks authors",
    async (username) => {
      const { query, findUser, findBloodlines, findVillages } = setup();

      const result = await query({ username });

      expect(findUser).toHaveBeenCalledTimes(1);
      expect(params(findUser.mock.calls[0]![0])).toEqual(["viewer"]);
      expect(result.data[0]).toMatchObject({
        userId: "staff",
        user: { username: "staff" },
      });
      expect(findBloodlines).not.toHaveBeenCalled();
      expect(findVillages).not.toHaveBeenCalled();
    },
  );

  it("keeps staff author identities without a username filter", async () => {
    const { query, findUser } = setup({ role: "CONTENT-ADMIN" });

    expect((await query()).data[0]).toMatchObject({
      userId: "author",
      user: { username: "Author" },
    });
    expect(findUser).toHaveBeenCalledTimes(1);
  });

  it.each(["CONTENT-ADMIN", "USER"] as const)(
    "preserves username filter permissions for %s",
    async (role) => {
      const { query, findUser, findEntries } = setup({ role });

      const result = await query({ username: "Auth" });

      expect(findUser).toHaveBeenCalledTimes(2);
      expect(params(findUser.mock.calls[1]![0])).toEqual(["%Auth%"]);
      expect(params(findEntries.mock.calls[0]![0])).toEqual(
        role === "CONTENT-ADMIN" ? ["jutsu", "author"] : ["jutsu"],
      );
      expect(result.data[0]?.userId).toBe(
        role === "CONTENT-ADMIN" ? "author" : "staff",
      );
    },
  );

  it("keeps the existing unfiltered result when the target is missing", async () => {
    const { query, findEntries } = setup({
      role: "CONTENT-ADMIN",
      targetExists: false,
    });

    expect((await query({ username: "Missing" })).data).toHaveLength(1);
    expect(params(findEntries.mock.calls[0]![0])).toEqual(["jutsu"]);
  });

  it("skips user lookups and masks authors for anonymous browsing", async () => {
    const { query, findUser, findEntries } = setup({ userId: null });

    const result = await query({ username: "Auth" });

    expect(findUser).not.toHaveBeenCalled();
    expect(params(findEntries.mock.calls[0]![0])).toEqual(["jutsu"]);
    expect(result.data[0]).toMatchObject({
      userId: "staff",
      user: { username: "staff" },
    });
  });

  it("skips label lookups on empty pages and ends pagination", async () => {
    const { query, findBloodlines, findVillages } = setup({ entries: [] });

    expect(await query()).toEqual({ data: [], nextCursor: null });
    expect(findBloodlines).not.toHaveBeenCalled();
    expect(findVillages).not.toHaveBeenCalled();
  });

  it.each(["bloodline", "village"] as const)(
    "only resolves referenced %s labels",
    async (kind) => {
      const change = `{"${kind}Id":"reference"}`;
      const { query, findBloodlines, findVillages } = setup({
        entries: [entry([change])],
        bloodlines: [{ id: "reference", name: "Name" }],
        villages: [{ id: "reference", name: "Name" }],
      });

      expect((await query()).data[0]?.changes).toEqual([
        change.replace("reference", "reference - Name"),
      ]);
      expect(findBloodlines).toHaveBeenCalledTimes(kind === "bloodline" ? 1 : 0);
      expect(findVillages).toHaveBeenCalledTimes(kind === "village" ? 1 : 0);
    },
  );

  it("deduplicates label lookups while enriching every entry and preserving pagination", async () => {
    const changes = ['{"bloodlineId":"bloodline-1"}', '{"villageId":"village-1"}'];
    const { query, findBloodlines, findVillages } = setup({
      entries: [entry(changes), entry(changes)],
      bloodlines: [{ id: "bloodline-1", name: "Bloodline" }],
      villages: [{ id: "village-1", name: "Village" }],
    });

    const result = await query({ limit: 2 });

    expect(findBloodlines).toHaveBeenCalledTimes(1);
    expect(findVillages).toHaveBeenCalledTimes(1);
    expect(params(findBloodlines.mock.calls[0]![0])).toEqual(["bloodline-1"]);
    expect(params(findVillages.mock.calls[0]![0])).toEqual(["village-1"]);
    expect(result.data.map((row) => row.changes)).toEqual([
      [
        '{"bloodlineId":"bloodline-1 - Bloodline"}',
        '{"villageId":"village-1 - Village"}',
      ],
      [
        '{"bloodlineId":"bloodline-1 - Bloodline"}',
        '{"villageId":"village-1 - Village"}',
      ],
    ]);
    expect(result.nextCursor).toBe(1);
  });
});
