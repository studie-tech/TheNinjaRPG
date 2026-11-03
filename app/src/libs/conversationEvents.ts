import type Pusher from "pusher-js";

/** Events shared by the full conversation, floating chat and team chat. */
export type ConversationEvent = {
  message: string;
  fromId?: string;
  commentId?: string;
  emoji?: string;
  username?: string;
};

type Listener = {
  cacheKey: string;
  onEvent: (event: ConversationEvent, ownsCacheUpdate: boolean) => void;
};

type Subscription = {
  listeners: Set<Listener>;
  onEvent: (event: ConversationEvent) => void;
};

const subscriptions = new WeakMap<Pusher, Map<string, Subscription>>();

/** Keep a shared channel alive and update each query cache once per incoming event. */
export const subscribeConversation = (
  pusher: Pusher,
  conversationId: string,
  cacheKey: string,
  onEvent: Listener["onEvent"],
) => {
  let channels = subscriptions.get(pusher);
  if (!channels) {
    channels = new Map();
    subscriptions.set(pusher, channels);
  }
  let subscription = channels.get(conversationId);
  const channel = pusher.subscribe(conversationId);
  if (!subscription) {
    const listeners = new Set<Listener>();
    subscription = {
      listeners,
      onEvent: (event) => {
        const updated = new Set<string>();
        for (const listener of listeners) {
          listener.onEvent(event, !updated.has(listener.cacheKey));
          updated.add(listener.cacheKey);
        }
      },
    };
    channels.set(conversationId, subscription);
    channel.bind("event", subscription.onEvent);
  }
  const { listeners } = subscription;
  const listener = { cacheKey, onEvent };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    channel.unbind("event", subscription.onEvent);
    pusher.unsubscribe(conversationId);
    channels.delete(conversationId);
  };
};
