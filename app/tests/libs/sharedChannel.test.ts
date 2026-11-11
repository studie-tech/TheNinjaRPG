import { expect, it, vi } from "bun:test";
import type Pusher from "pusher-js";
import { subscribeSharedChannel } from "@/libs/sharedChannel";

const makePusher = () => {
  const channel = { bind: vi.fn(), unbind: vi.fn() };
  const pusher = { subscribe: vi.fn(() => channel), unsubscribe: vi.fn() };
  return { channel, pusher, client: pusher as never as Pusher };
};

it("keeps the sector channel live for the map after the raid panel closes", () => {
  const { channel, pusher, client } = makePusher();
  const onMove = () => {};
  const onRaid = () => {};
  const releaseMap = subscribeSharedChannel(client, "42", { event: onMove });
  const releaseRaid = subscribeSharedChannel(client, "42", { raidTeamUpdate: onRaid });

  releaseRaid();
  expect(channel.unbind).toHaveBeenCalledWith("raidTeamUpdate", onRaid);
  expect(channel.unbind).not.toHaveBeenCalledWith("event", onMove);
  expect(pusher.unsubscribe).not.toHaveBeenCalled();

  releaseMap();
  expect(channel.unbind).toHaveBeenCalledWith("event", onMove);
  expect(pusher.unsubscribe).toHaveBeenCalledWith("42");
});

it("ignores a repeated release so it cannot drop another holder", () => {
  const { pusher, client } = makePusher();
  const releaseMap = subscribeSharedChannel(client, "7", { event: () => {} });
  const releaseRaid = subscribeSharedChannel(client, "7", { raidTeamUpdate: () => {} });

  releaseRaid();
  releaseRaid();
  expect(pusher.unsubscribe).not.toHaveBeenCalled();
  releaseMap();
  expect(pusher.unsubscribe).toHaveBeenCalledTimes(1);
});

it("resubscribes cleanly after the last holder released the channel", () => {
  const { pusher, client } = makePusher();
  subscribeSharedChannel(client, "3", { event: () => {} })();
  const release = subscribeSharedChannel(client, "3", { event: () => {} });
  expect(pusher.subscribe).toHaveBeenCalledTimes(2);
  release();
  expect(pusher.unsubscribe).toHaveBeenCalledTimes(2);
});
