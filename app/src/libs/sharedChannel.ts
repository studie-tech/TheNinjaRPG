import type Pusher from "pusher-js";

type Handlers = Record<string, (data: never) => void>;

const holders = new WeakMap<Pusher, Map<string, number>>();

/**
 * Subscribe to a channel that several components listen on, binding only this
 * caller's handlers. The returned release unbinds them and leaves the channel
 * until its last holder releases it, so one consumer unmounting never silences another.
 */
export const subscribeSharedChannel = (
  pusher: Pusher,
  channelName: string,
  handlers: Handlers,
) => {
  let counts = holders.get(pusher);
  if (!counts) {
    counts = new Map();
    holders.set(pusher, counts);
  }
  counts.set(channelName, (counts.get(channelName) ?? 0) + 1);
  const channel = pusher.subscribe(channelName);
  const entries = Object.entries(handlers) as [string, (data: unknown) => void][];
  for (const [event, handler] of entries) channel.bind(event, handler);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const [event, handler] of entries) channel.unbind(event, handler);
    const remaining = (counts.get(channelName) ?? 1) - 1;
    if (remaining > 0) {
      counts.set(channelName, remaining);
      return;
    }
    counts.delete(channelName);
    pusher.unsubscribe(channelName);
  };
};
