// @vitest-environment node

import type { SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { userData, userItem } from "@/drizzle/schema";
import {
  battleClaimRollbackStatus,
  claimActiveNpcQuest,
  claimUserSnapshot,
  clearActiveNpcQuest,
  consumeUserItemAtomically,
  refundUserItemQuantityAtomically,
  restoreStaleUserItemMergeClaims,
  updateUserItemQuantityAtomically,
  userItemMergeQuantityCase,
} from "@/server/utils/concurrency";

describe("concurrency helpers", () => {
  it("claims a user snapshot by touching updatedAt", async () => {
    const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const set = vi.fn().mockReturnValue({ where });
    const client = {
      update: vi.fn().mockReturnValue({ set }),
    };

    const result = await claimUserSnapshot({
      client: client as never,
      userId: "user-1",
      updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      set: { status: "AWAKE" },
    });

    expect(client.update).toHaveBeenCalledWith(userData);
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
    const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const set = vi.fn().mockReturnValue({ where });
    const client = {
      update: vi.fn().mockReturnValue({ set }),
      delete: vi.fn(),
    };

    const result = await updateUserItemQuantityAtomically({
      client: client as never,
      userId: "user-1",
      userItemId: "item-row-1",
      expectedQuantity: 3,
      nextQuantity: 1,
    });

    expect(client.update).toHaveBeenCalledWith(userItem);
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
      craftingFinishedAt: null,
      isInAuction: false,
      activeVariantId: null,
      dropChancePerc: 0,
    } as const;

    await refundUserItemQuantityAtomically({
      client: client as never,
      itemSnapshot,
      quantity: 2,
    });

    expect(client.insert).toHaveBeenCalledWith(userItem);
    expect(values).toHaveBeenCalledWith({ ...itemSnapshot, quantity: 2 });
    expect(onDuplicateKeyUpdate).toHaveBeenCalledOnce();
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
      craftingFinishedAt: null,
      isInAuction: false,
      activeVariantId: null,
      dropChancePerc: 0,
    } as const;

    await refundUserItemQuantityAtomically({
      client: client as never,
      itemSnapshot,
      quantity: 2,
    });

    // First attempt is the guarded upsert on the original row; the claimed row
    // no-ops it, and the fallback inserts the refund as a brand-new row that an
    // in-flight merge publish cannot overwrite.
    expect(client.insert).toHaveBeenCalledTimes(2);
    expect(onDuplicateKeyUpdate).toHaveBeenCalledOnce();
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
    expect(updateWhere).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();

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
    return qb.select({ status: expr as SQL }).from(userData).toSQL();
  };

  it("restores KAGE_PVP challengers to KAGE_QUEUED with one binding per id", () => {
    const expr = battleClaimRollbackStatus(qb as never, "KAGE_PVP", [
      "challenger-1",
      "challenger-2",
    ]);
    const { sql: rendered, params } = render(expr);
    expect(rendered).toContain('THEN "KAGE_QUEUED" ELSE "AWAKE" END');
    expect(rendered).toMatch(/in \(\?,\s*\?\)/i);
    expect(params).toEqual(["challenger-1", "challenger-2", "KAGE", "PENDING"]);
  });

  it("only restores KAGE_QUEUED while the kage challenge request is still pending", () => {
    const expr = battleClaimRollbackStatus(qb as never, "KAGE_PVP", ["challenger-1"]);
    const { sql: rendered } = render(expr);
    expect(rendered).toMatch(/exists/i);
    expect(rendered).toContain("UserRequest");
  });

  it("restores RANKED_PVP rows to QUEUED only while their queue row exists", () => {
    const expr = battleClaimRollbackStatus(qb as never, "RANKED_PVP", ["challenger-1"]);
    const { sql: rendered } = render(expr);
    expect(rendered).toMatch(/exists/i);
    expect(rendered).toContain("RankedPvpQueue");
    expect(rendered).toContain('THEN "QUEUED" ELSE "AWAKE" END');
  });

  it("restores plain AWAKE for battle types claimed from AWAKE", () => {
    expect(battleClaimRollbackStatus(qb as never, "COMBAT", ["challenger-1"])).toBe(
      "AWAKE",
    );
    expect(battleClaimRollbackStatus(qb as never, "KAGE_AI", ["challenger-1"])).toBe(
      "AWAKE",
    );
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
    const where = vi.fn().mockResolvedValue({ rowsAffected: 0 });
    const set = vi.fn().mockReturnValue({ where });
    const client = { update: vi.fn().mockReturnValue({ set }) };

    await clearActiveNpcQuest({
      client: client as never,
      userId: "user-1",
      questId: "quest-1",
    });

    expect(client.update).toHaveBeenCalledWith(userData);
    expect(set).toHaveBeenCalledWith({ activeNpcQuestId: null });
    expect(where).toHaveBeenCalledOnce();
    const clearWhere = where.mock.calls[0]?.[0] as SQL;
    const rendered = new QueryBuilder()
      .select()
      .from(userData)
      .where(clearWhere)
      .toSQL();
    expect(rendered.params).toEqual(["user-1", "quest-1"]);
  });
});
