import { describe, expect, it, vi } from "vitest";
import { lockWithDailyTimer, lockWithHourlyTimer } from "@/libs/gamesettings";
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

describe("lockWithHourlyTimer", () => {
  const createClient = (time: Date) => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const client = {
      query: {
        gameSetting: {
          findFirst: vi.fn().mockResolvedValue({
            id: "timer-id",
            name: "cleaner-hourly",
            value: 0,
            time,
          }),
        },
      },
      update,
    } as unknown as DrizzleClient;

    return { client, update };
  };

  it("waits until a full hour has elapsed", async () => {
    const { client, update } = createClient(
      new Date(Date.now() - 10 * 60 * 1000),
    );

    const result = await lockWithHourlyTimer(client, "cleaner-hourly");

    expect(result.isNewHour).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows a run after an elapsed hour even when the UTC hour matches", async () => {
    const { client, update } = createClient(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    const result = await lockWithHourlyTimer(client, "cleaner-hourly");

    expect(result.isNewHour).toBe(true);
    expect(update).toHaveBeenCalledOnce();
  });
});
