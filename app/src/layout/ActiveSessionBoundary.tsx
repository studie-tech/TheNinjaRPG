"use client";

import { useSession } from "@clerk/nextjs";
import { Fragment, useState } from "react";
import { activeSessionKey } from "@/libs/activeSession";

/**
 * Rebuilds the app when the active Clerk session changes, so nothing tied to the previous
 * account (the QueryClient, Pusher subscriptions, page state) survives an account switch
 * or a sign-out. Unlike Clerk's MultisessionAppSupport, the session clerk-js reports once
 * it has loaded does not count as a change from the hydrated tree, and the key is left
 * alone while Clerk is loading, so a switch rebuilds the tree once rather than twice.
 */
export const ActiveSessionBoundary: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isLoaded, session } = useSession();
  // Both are set during render rather than in an effect, so no committed render carries
  // a key that a later one would change.
  const [firstSessionId, setFirstSessionId] = useState<string | null | undefined>(
    undefined,
  );
  const [key, setKey] = useState("initial");
  if (isLoaded) {
    const sessionId = session?.id ?? null;
    const first = firstSessionId === undefined ? sessionId : firstSessionId;
    if (firstSessionId === undefined) setFirstSessionId(first);
    const next = activeSessionKey({ sessionId, firstSessionId: first });
    if (next !== key) setKey(next);
  }
  return <Fragment key={key}>{children}</Fragment>;
};
