import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { battle } from "@/drizzle/schema";
import { updateBattle } from "@/libs/combat/database";
import { maskBattle } from "@/libs/combat/masking";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { makeCompleteBattle } from "../../setup/combat";

// Revealed definitions must survive a later request even after their caster despawns.
describeWithDatabase("persisted battle privacy", () => {
  beforeEach(async () => {
    await resetTables(battle);
  });

  it("persists revealed actions in the version claim while retaining server-only catalogs", async () => {
    const db = await getTestDatabase();
    const snapshot = makeCompleteBattle({
      id: "privacy-persistence",
      version: 1,
      background: "default",
      width: 5,
      height: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      roundStartAt: new Date(),
      extraState: {
        jutsus: {
          cast: { id: "cast", effects: [] } as never,
          hidden: { id: "hidden", effects: [] } as never,
        },
        profileCacheSnapshots: { private: { secret: true } as never },
      },
    });
    await db.insert(battle).values(snapshot);
    snapshot.extraState.revealedActions = { jutsuIds: ["cast"], itemIds: [] };
    expect(await updateBattle(db, null, "viewer", snapshot, 1)).not.toBeNull();
    const saved = await db.query.battle.findFirst({
      where: eq(battle.id, snapshot.id),
    });
    expect(saved?.extraState.revealedActions).toEqual(
      snapshot.extraState.revealedActions,
    );
    expect(saved?.extraState.profileCacheSnapshots).toEqual(
      snapshot.extraState.profileCacheSnapshots,
    );
    expect(saved?.version).toBe(2);
    expect(maskBattle(saved!, "viewer").extraState.jutsus).toHaveProperty("cast");
    expect(maskBattle(saved!, "viewer").extraState.jutsus).not.toHaveProperty("hidden");

    const stale = {
      ...snapshot,
      extraState: {
        ...snapshot.extraState,
        revealedActions: { jutsuIds: ["hidden"], itemIds: [] },
      },
    };
    expect(await updateBattle(db, null, "viewer", stale, 1)).toBeNull();
    expect(
      (await db.query.battle.findFirst({ where: eq(battle.id, snapshot.id) }))
        ?.extraState.revealedActions,
    ).toEqual({ jutsuIds: ["cast"], itemIds: [] });
  });
});
