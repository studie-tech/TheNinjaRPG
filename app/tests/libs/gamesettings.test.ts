import { describe, expect, it, vi } from "vitest";
import { lockWithDailyTimer } from "@/libs/gamesettings";
import type { DrizzleClient } from "@/server/db";

describe("lockWithDailyTimer", () => {
  it("treats the same day number in a different year as a new day", async () => {
    const now = new Date();
    const previousYear = new Date(now);
    previousYear.setUTCFullYear(now.getUTCFullYear() - 1);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const client = {
      query: {
        gameSetting: {
          findFirst: vi.fn().mockResolvedValue({
            id: "timer-id",
            name: "cleaner-daily",
            value: 0,
            time: previousYear,
          }),
        },
      },
      update,
    } as unknown as DrizzleClient;

    const result = await lockWithDailyTimer(client, "cleaner-daily");

    expect(result.isNewDay).toBe(true);
    expect(update).toHaveBeenCalledOnce();
  });
});
