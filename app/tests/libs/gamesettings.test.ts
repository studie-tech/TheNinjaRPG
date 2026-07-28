import { afterEach, describe, expect, it, vi } from "vitest";
import { lockWithDailyTimer } from "@/libs/gamesettings";
import type { DrizzleClient } from "@/server/db";

afterEach(() => {
  vi.useRealTimers();
});

describe("lockWithDailyTimer", () => {
  it("treats the same day number in a different month as a new day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"));

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
            time: new Date("2026-06-28T12:00:00.000Z"),
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
