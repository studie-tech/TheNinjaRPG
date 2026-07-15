// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { userData, userItem } from "@/drizzle/schema";
import {
  claimUserSnapshot,
  consumeUserItemAtomically,
  updateUserItemQuantityAtomically,
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
});
