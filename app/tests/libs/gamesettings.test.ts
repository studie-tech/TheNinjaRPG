import { describe, expect, it, vi } from "vitest";
import { lockWithDailyTimer, lockWithHourlyTimer } from "@/libs/gamesettings";
import type { DrizzleClient } from "@/server/db";

describe("lockWithDailyTimer", () => {
  it("treats the same day number in a different year as a new day", async () => {
    const now = new Date();
    const previousYear = new Date(now);
    previousYear.setUTCFullYear(now.getUTCFullYear() - 1);
    const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
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

  it("allows only one caller to claim the same daily timer", async () => {
    const previousDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let claimed = false;
    const where = vi.fn().mockImplementation(async () => {
      if (claimed) return { rowsAffected: 0 };
      claimed = true;
      return { rowsAffected: 1 };
    });
    const set = vi.fn().mockReturnValue({ where });
    const client = {
      query: {
        gameSetting: {
          findFirst: vi.fn().mockResolvedValue({
            id: "timer-id",
            name: "daily-overworld-ai",
            value: 0,
            time: previousDay,
          }),
        },
      },
      update: vi.fn().mockReturnValue({ set }),
    } as unknown as DrizzleClient;

    const results = await Promise.all([
      lockWithDailyTimer(client, "daily-overworld-ai"),
      lockWithDailyTimer(client, "daily-overworld-ai"),
    ]);

    expect(results.filter(({ isNewDay }) => isNewDay)).toHaveLength(1);
    expect(results.filter(({ isNewDay }) => !isNewDay)).toHaveLength(1);
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
