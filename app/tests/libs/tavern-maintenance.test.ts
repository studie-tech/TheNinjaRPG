import { describe, expect, it, vi } from "vitest";
import {
  GLOBAL_TAVERN_CLEANUP_QUERY,
  runDailyTavernMaintenance,
  TAVERN_ACTIVITY_DECAY_QUERY,
} from "@/libs/tavern-maintenance";
import type { DrizzleClient } from "@/server/db";

describe("runDailyTavernMaintenance", () => {
  it("does not clear tavern messages again during the same UTC day", async () => {
    const execute = vi.fn();
    const client = { execute } as unknown as DrizzleClient;

    await runDailyTavernMaintenance(client, {
      isNewDay: false,
      prevTime: new Date(),
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("clears old global messages and decays activity once on a new UTC day", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const client = { execute } as unknown as DrizzleClient;

    await runDailyTavernMaintenance(client, {
      isNewDay: true,
      prevTime: new Date(0),
    });

    expect(execute).toHaveBeenNthCalledWith(1, GLOBAL_TAVERN_CLEANUP_QUERY);
    expect(execute).toHaveBeenNthCalledWith(2, TAVERN_ACTIVITY_DECAY_QUERY);
  });
});
