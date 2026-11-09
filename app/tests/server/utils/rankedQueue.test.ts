import { afterEach, expect, it, vi } from "bun:test";
import { Pusher } from "@/libs/pusher";
import { notifyRankedQueueChanged } from "@/server/utils/rankedQueue";

afterEach(() => vi.restoreAllMocks());

it("skips notifications when a guarded queue write changed no rows", async () => {
  const trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  await notifyRankedQueueChanged(0);
  expect(trigger).not.toHaveBeenCalled();
});

it("records rejected HTTP delivery while preserving a successful queue write", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("Unavailable", { status: 503 }),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await notifyRankedQueueChanged(1);
  expect(error).toHaveBeenCalledWith("Pusher event request failed", 503);
});
