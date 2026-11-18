import { afterEach, expect, it, vi } from "bun:test";
import { PUSHER_MAX_CHANNELS_PER_EVENT, Pusher } from "@/libs/pusher";

afterEach(() => vi.restoreAllMocks());

const sentBodies = () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  return () =>
    fetch.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
    );
};

it("sends one event to a single channel", async () => {
  const bodies = sentBodies();
  await new Pusher("app", "key", "secret", "").trigger("user", "event", {
    type: "anbu",
  });
  expect(bodies()).toEqual([
    { name: "event", data: JSON.stringify({ type: "anbu" }), channel: "user" },
  ]);
});

it("delivers a shared payload to every unique channel within the per-request limit", async () => {
  const bodies = sentBodies();
  const channels = Array.from(
    { length: PUSHER_MAX_CHANNELS_PER_EVENT + 1 },
    (_, i) => `user${i}`,
  );
  await new Pusher("app", "key", "secret", "").trigger(
    [...channels, "user0"],
    "event",
    { type: "newInbox" },
  );
  const sent = bodies();
  expect(sent).toHaveLength(2);
  expect(sent.map((body) => body.channels)).toEqual([
    channels.slice(0, PUSHER_MAX_CHANNELS_PER_EVENT),
    channels.slice(PUSHER_MAX_CHANNELS_PER_EVENT),
  ]);
  for (const body of sent) {
    expect(body.name).toBe("event");
    expect(body.data).toBe(JSON.stringify({ type: "newInbox" }));
    expect(body.channel).toBeUndefined();
  }
});

it("sends nothing for an empty channel list", async () => {
  const bodies = sentBodies();
  await new Pusher("app", "key", "secret", "").trigger([], "event", { type: "clan" });
  expect(bodies()).toEqual([]);
});
