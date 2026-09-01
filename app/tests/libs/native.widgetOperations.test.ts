import { describe, expect, it, vi } from "vitest";
import { NativeWidgetOperations } from "@/libs/native/widgetOperations";

describe("native widget ownership queue", () => {
  it("advances the persisted owner only after a confirmed native mutation", async () => {
    const operations = new NativeWidgetOperations();
    const confirmed = vi.fn();

    await expect(
      operations.sync(
        async () => {
          throw new Error("native sync rejected");
        },
        () => confirmed("account-b"),
      ),
    ).rejects.toThrow("native sync rejected");
    expect(confirmed).not.toHaveBeenCalled();

    await expect(
      operations.clear(
        async () => {
          throw new Error("native clear rejected");
        },
        () => confirmed(null),
      ),
    ).rejects.toThrow("native clear rejected");
    expect(confirmed).not.toHaveBeenCalled();

    await expect(
      operations.clear(
        async () => undefined,
        () => confirmed(null),
      ),
    ).resolves.toBeUndefined();
    expect(confirmed).toHaveBeenCalledOnce();
    expect(confirmed).toHaveBeenCalledWith(null);
  });

  it("invalidates queued stale writes and orders an in-flight write before clear", async () => {
    const operations = new NativeWidgetOperations();
    const events: string[] = [];
    let finishInFlight: (() => void) | undefined;

    const inFlight = operations.sync(
      () =>
        new Promise<void>((resolve) => {
          events.push("sync-a:start");
          finishInFlight = resolve;
        }),
      () => events.push("sync-a:confirmed"),
    );
    await Promise.resolve();

    const stale = operations.sync(
      async () => {
        events.push("stale-a:mutated");
      },
      () => events.push("stale-a:confirmed"),
    );
    const clear = operations.clear(
      async () => {
        events.push("clear:mutated");
      },
      () => events.push("clear:confirmed"),
    );

    finishInFlight?.();
    await expect(inFlight).resolves.toBe("confirmed");
    await expect(stale).resolves.toBe("stale");
    await clear;
    expect(events).toEqual([
      "sync-a:start",
      "sync-a:confirmed",
      "clear:mutated",
      "clear:confirmed",
    ]);
  });
});
