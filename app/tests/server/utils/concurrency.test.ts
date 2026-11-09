import { describe, expect, it, vi } from "bun:test";
import { and, eq, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { bloodlineRolls, userData, userItem } from "@/drizzle/schema";
import { clearActiveNpcQuest, refundPityCredit } from "@/queries/concurrency";
import {
  adjustSeichiSilverAtomically,
  battleClaimRollbackStatus,
  claimActiveNpcQuest,
  claimUserSnapshot,
  consumeUserItemAtomically,
  refundUserItemQuantityAtomically,
  removeBloodlineFromPoolAtomically,
  reservePityCredit,
  restoreStaleUserItemMergeClaims,
  updateUserItemQuantityAtomically,
  userItemMergeQuantityCase,
} from "@/server/utils/concurrency";
import { getNextUserSnapshotAt } from "@/utils/time";

/** An `update().set().where()` chain whose write reports `rowsAffected`. */
const updateChain = (rowsAffected: number) => {
  const where = vi.fn().mockResolvedValue({ rowsAffected });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { client: { update } as never, update, set, where };
};

const itemSnapshot = {
  id: "item-row-1",
  createdAt: new Date("2026-08-18T10:00:00.000Z"),
  updatedAt: new Date("2026-08-18T10:00:00.000Z"),
  userId: "user-1",
  itemId: "repair-kit-1",
  quantity: 5,
  level: 1,
  experience: 0,
  equipped: "NONE",
  durability: 100,
  storedAtHome: false,
  homeX: null,
  homeY: null,
  homeRotation: 0,
  homeRoom: "main",
  craftingFinishedAt: null,
  isInAuction: false,
  activeVariantId: null,
  dropChancePerc: 0,
} as const;

describe("concurrency helpers", () => {
  it("advances a snapshot when the wall clock is in the same millisecond", () => {
    const snapshot = new Date("2026-05-01T10:00:00.123Z");

    expect(getNextUserSnapshotAt(snapshot, new Date(snapshot))).toEqual(
      new Date("2026-05-01T10:00:00.124Z"),
    );
  });

  it("claims a user snapshot by touching updatedAt", async () => {
    const { client, update, set, where } = updateChain(1);

    const result = await claimUserSnapshot({
      client,
      userId: "user-1",
      updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      set: { status: "AWAKE" },
    });

    expect(update).toHaveBeenCalledWith(userData);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
        status: "AWAKE",
      }),
    );
    expect(where).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("updates quantity atomically when the row still matches the snapshot", async () => {
    const { client, update, set } = updateChain(1);

    const result = await updateUserItemQuantityAtomically({
      client,
      userId: "user-1",
      userItemId: "item-row-1",
      expectedQuantity: 3,
      nextQuantity: 1,
    });

    expect(update).toHaveBeenCalledWith(userItem);
    expect(set).toHaveBeenCalledWith({ quantity: 1 });
    expect(result).toBe(true);
  });

  it("deletes the item row when consuming the last quantity", async () => {
    const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const client = {
      update: vi.fn(),
      delete: vi.fn().mockReturnValue({ where }),
    };

    const result = await consumeUserItemAtomically({
      client: client as never,
      userId: "user-1",
      userItemId: "item-row-1",
      expectedQuantity: 1,
    });

    expect(client.delete).toHaveBeenCalledWith(userItem);
    expect(where).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("rejects consume when expectedQuantity is zero", async () => {
    const client = { update: vi.fn(), delete: vi.fn() };
    const result = await consumeUserItemAtomically({
      client: client as never,
      userId: "user-1",
      userItemId: "item-row-1",
      expectedQuantity: 0,
    });
    expect(result).toBe(false);
    expect(client.delete).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it("rejects quantity update when nextQuantity is not strictly lower than expected", async () => {
    const client = { update: vi.fn(), delete: vi.fn() };
    const result = await updateUserItemQuantityAtomically({
      client: client as never,
      userId: "user-1",
      userItemId: "item-row-1",
      expectedQuantity: 3,
      nextQuantity: 3,
    });
    expect(result).toBe(false);
    expect(client.update).not.toHaveBeenCalled();
  });

  it("atomically refunds a consumed item whether its stack survived or was deleted", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue({ rowsAffected: 2 });
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    const client = { insert: vi.fn().mockReturnValue({ values }) };

    await refundUserItemQuantityAtomically({
      client: client as never,
      itemSnapshot,
      quantity: 2,
    });

    expect(client.insert).toHaveBeenCalledWith(userItem);
    expect(values).toHaveBeenCalledWith({ ...itemSnapshot, quantity: 2 });
    expect(onDuplicateKeyUpdate).toHaveBeenCalledTimes(1);
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: { quantity: expect.anything() },
    });
    const increment = onDuplicateKeyUpdate.mock.calls[0]?.[0].set.quantity as SQL;
    const rendered = new QueryBuilder()
      .select({ quantity: increment })
      .from(userItem)
      .toSQL();
    expect(rendered.sql).toMatch(/if\s*\(.*quantity.*>=\s*0.*quantity.*\+\s*\?/i);
    expect(rendered.params).toEqual([2]);
  });

  it("refunds into a fresh row when the original is held by a merge claim", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue({ rowsAffected: 0 });
    const values = vi
      .fn()
      .mockReturnValueOnce({ onDuplicateKeyUpdate })
      .mockReturnValueOnce(Promise.resolve({ rowsAffected: 1 }));
    const client = { insert: vi.fn().mockReturnValue({ values }) };

    await refundUserItemQuantityAtomically({
      client: client as never,
      itemSnapshot,
      quantity: 2,
    });

    // First attempt is the guarded upsert on the original row; the claimed row
    // no-ops it, and the fallback inserts the refund as a brand-new row that an
    // in-flight merge publish cannot overwrite.
    expect(client.insert).toHaveBeenCalledTimes(2);
    expect(onDuplicateKeyUpdate).toHaveBeenCalledTimes(1);
    const fallbackRow = values.mock.calls[1]?.[0] as {
      id: string;
      quantity: number;
      itemId: string;
    };
    expect(fallbackRow.quantity).toBe(2);
    expect(fallbackRow.itemId).toBe("repair-kit-1");
    expect(fallbackRow.id).not.toBe("item-row-1");
  });

  it("does not issue a refund statement for a non-positive quantity", async () => {
    const client = { insert: vi.fn() };
    const itemSnapshot = { id: "item-row-1" };

    await refundUserItemQuantityAtomically({
      client: client as never,
      itemSnapshot: itemSnapshot as never,
      quantity: 0,
    });

    expect(client.insert).not.toHaveBeenCalled();
  });

  it("restores stale negative merge claims and deletes stale zero tombstones", async () => {
    const updateWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const client = {
      update: vi.fn().mockReturnValue({ set }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    };
    const staleBefore = new Date("2026-08-18T10:00:00.000Z");

    await restoreStaleUserItemMergeClaims({
      client: client as never,
      userId: "user-1",
      staleBefore,
    });

    expect(client.update).toHaveBeenCalledWith(userItem);
    expect(client.delete).toHaveBeenCalledWith(userItem);
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);

    const restoredQuantity = set.mock.calls[0]?.[0].quantity as SQL;
    const rendered = new QueryBuilder()
      .select({ quantity: restoredQuantity })
      .from(userItem)
      .toSQL();
    expect(rendered.sql).toMatch(/-.*quantity/i);
  });

  it("builds one CASE expression for keeper quantities and zero tombstones", () => {
    const expression = userItemMergeQuantityCase([
      { id: "keeper-row", quantity: 5 },
      { id: "obsolete-row", quantity: 0 },
    ]);
    const rendered = new QueryBuilder()
      .select({ quantity: expression })
      .from(userItem)
      .toSQL();

    expect(rendered.sql).toMatch(/case.*when.*then.*when.*then.*else.*end/i);
    expect(rendered.params).toEqual(["keeper-row", 5, "obsolete-row", 0]);
  });
});

describe("battleClaimRollbackStatus", () => {
  // A session-less builder is enough: the helper only constructs SQL, and the
  // RANKED_PVP branch uses the client solely for its exists-subquery select.
  const qb = new QueryBuilder();
  const render = (expr: ReturnType<typeof battleClaimRollbackStatus>) => {
    if (typeof expr === "string") throw new Error("expected a SQL expression");
    return qb
      .select({ status: expr as SQL })
      .from(userData)
      .toSQL();
  };

  it("restores scheduled Kage participants to ordinary play", () => {
    expect(battleClaimRollbackStatus(qb as never, "KAGE_PVP")).toBe("AWAKE");
  });

  it("restores RANKED_PVP rows to QUEUED only while their queue row exists", () => {
    const expr = battleClaimRollbackStatus(qb as never, "RANKED_PVP");
    const { sql: rendered } = render(expr);
    expect(rendered).toMatch(/exists/i);
    expect(rendered).toContain("RankedPvpQueue");
    expect(rendered).toContain('THEN "QUEUED" ELSE "AWAKE" END');
  });

  it("restores plain AWAKE for battle types claimed from AWAKE", () => {
    expect(battleClaimRollbackStatus(qb as never, "COMBAT")).toBe("AWAKE");
    expect(battleClaimRollbackStatus(qb as never, "KAGE_AI")).toBe("AWAKE");
  });
});

describe("active NPC quest slot", () => {
  it("reports success only when the empty-slot compare-and-swap wins", async () => {
    const where = vi
      .fn()
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 0 });
    const set = vi.fn().mockReturnValue({ where });
    const client = { update: vi.fn().mockReturnValue({ set }) };

    await expect(
      claimActiveNpcQuest({
        client: client as never,
        userId: "user-1",
        questId: "quest-1",
      }),
    ).resolves.toBe(true);
    await expect(
      claimActiveNpcQuest({
        client: client as never,
        userId: "user-1",
        questId: "quest-2",
      }),
    ).resolves.toBe(false);

    expect(set).toHaveBeenNthCalledWith(1, { activeNpcQuestId: "quest-1" });
    expect(set).toHaveBeenNthCalledWith(2, { activeNpcQuestId: "quest-2" });
    const claimWhere = where.mock.calls[0]?.[0] as SQL;
    const rendered = new QueryBuilder()
      .select()
      .from(userData)
      .where(claimWhere)
      .toSQL();
    expect(rendered.sql).toMatch(/ActiveNpcQuestId.*is null/i);
    expect(rendered.params).toContain("user-1");
  });

  it("clears through a quest-scoped update so another quest's slot is preserved", async () => {
    const { client, update, set, where } = updateChain(0);

    await clearActiveNpcQuest({
      client,
      userId: "user-1",
      questId: "quest-1",
    });

    expect(update).toHaveBeenCalledWith(userData);
    expect(set).toHaveBeenCalledWith({ activeNpcQuestId: null });
    expect(where).toHaveBeenCalledTimes(1);
    const clearWhere = where.mock.calls[0]?.[0] as SQL;
    const rendered = new QueryBuilder()
      .select()
      .from(userData)
      .where(clearWhere)
      .toSQL();
    expect(rendered.params).toEqual(["user-1", "quest-1"]);
  });
});

describe("adjustSeichiSilverAtomically", () => {
  it("succeeds on a positive delta (no floor predicate)", async () => {
    const { client, update } = updateChain(1);
    const ok = await adjustSeichiSilverAtomically({
      client,
      userId: "u1",
      delta: 100,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("fails when a subtraction is blocked by the balance floor (0 rows)", async () => {
    const { client } = updateChain(0);
    const ok = await adjustSeichiSilverAtomically({
      client,
      userId: "u1",
      delta: -100,
    });
    expect(ok).toBe(false);
  });
});

const poolClient = (deleteRows: number, updateRows: number) => {
  const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: deleteRows });
  const del = vi.fn().mockReturnValue({ where: deleteWhere });
  const updateWhere = vi.fn().mockResolvedValue({ rowsAffected: updateRows });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });
  return { client: { delete: del, update } as never, del, update };
};

describe("removeBloodlineFromPoolAtomically", () => {
  it("deletes non-NATURAL rows and nulls NATURAL rows; succeeds when rows change", async () => {
    const { client, del, update } = poolClient(2, 1);
    const ok = await removeBloodlineFromPoolAtomically({
      client,
      userId: "u1",
      bloodlineId: "bl1",
      now: new Date(0),
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("fails when nothing changed (became equipped / not in pool)", async () => {
    const { client } = poolClient(0, 0);
    const ok = await removeBloodlineFromPoolAtomically({
      client,
      userId: "u1",
      bloodlineId: "bl1",
      now: new Date(0),
    });
    expect(ok).toBe(false);
  });
});

describe("reservePityCredit", () => {
  it("returns true when the CAS updates exactly one row", async () => {
    const { client, where } = updateChain(1);
    const won = await reservePityCredit({
      client,
      rollId: "roll1",
      expectedPityRolls: 2,
    });
    expect(won).toBe(true);
    // The reservation is only safe if the CAS is scoped to BOTH the roll id and the
    // expected pity count — dropping the pityRolls equality would let a stale request
    // fund a second grant. Assert the predicate, not just the mocked outcome.
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith(
      and(eq(bloodlineRolls.id, "roll1"), eq(bloodlineRolls.pityRolls, 2)),
    );
  });

  it("returns false when the CAS matches zero rows (stale count / lost race)", async () => {
    const { client, where } = updateChain(0);
    const won = await reservePityCredit({
      client,
      rollId: "roll1",
      expectedPityRolls: 2,
    });
    expect(won).toBe(false);
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith(
      and(eq(bloodlineRolls.id, "roll1"), eq(bloodlineRolls.pityRolls, 2)),
    );
  });
});

describe("refundPityCredit", () => {
  it("issues a single decrement scoped to the roll id on the given table", async () => {
    const { client, update, set, where } = updateChain(1);
    await refundPityCredit({ client, rollId: "roll1" });
    // Unconditional decrement (no expectedPityRolls guard): one update, one set, one where.
    expect(update).toHaveBeenCalledWith(bloodlineRolls);
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the refund matches zero rows", async () => {
    const { client } = updateChain(0);
    await expect(
      refundPityCredit({ client, rollId: "roll1" }),
    ).resolves.toBeUndefined();
  });
});
