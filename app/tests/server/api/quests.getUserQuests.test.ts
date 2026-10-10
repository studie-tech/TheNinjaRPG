
import { afterEach, describe, expect, it, vi } from "bun:test";
import { questsRouter } from "@/routers/quests";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";

const makeCaller = (role: string) => {
  const findMany = vi.fn().mockResolvedValue([
    { id: "history-1", userId: "target", quest: { id: "quest-1" } },
    { id: "history-2", userId: "target", quest: null },
  ]);
  stubProfile("fetchUser", (async () => ({ userId: "viewer", role })) as never);
  const caller = questsRouter.createCaller({
    drizzle: { query: { questHistory: { findMany } } },
    userId: "viewer",
  } as never);
  return { caller, findMany };
};

describe("quests.getUserQuests", () => {
  afterEach(resetServerModuleStubs);

  it("returns nothing, without reading history, for a caller who cannot edit quests", async () => {
    const { caller, findMany } = makeCaller("USER");

    await expect(caller.getUserQuests({ userId: "target" })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns the target's quest history to a quest editor", async () => {
    const { caller, findMany } = makeCaller("CONTENT-ADMIN");

    const quests = await caller.getUserQuests({ userId: "target" });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(quests.map((q) => q.id)).toEqual(["history-1"]);
  });
});
