import type { Clerk } from "@clerk/nextjs/types";
import type { TRPCLink } from "@trpc/client";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/api/root";

export const SESSION_CHANGED_MESSAGE = "Your active account changed. Please try again.";
export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";
/** Keep a signed-out tab anonymous even when another tab supplies a session cookie. */
export const TRPC_ANONYMOUS_HEADER = "x-tnr-anonymous";

/** Share a toast ID only for session failures reported by multiple feedback handlers. */
export const getSessionErrorToastId = (message: unknown) =>
  message === SESSION_CHANGED_MESSAGE || message === SESSION_EXPIRED_MESSAGE
    ? message
    : undefined;

/**
 * Bind one hydrated client to its first resolved Clerk identity.
 * The stored ID detects switches; authorization always reads live identity and tokens.
 * Undefined means loading and null means signed out. Retirement is permanent, so
 * switching away and back cannot revive the old client's queued work.
 */
export const createTrpcSession = (clerk: Pick<Clerk, "session">) => {
  const initialSession = clerk.session;
  let clientSessionId =
    initialSession === undefined ? undefined : (initialSession?.id ?? null);
  let retired = false;
  let ready: Promise<void> | undefined;
  let resolveReady: (() => void) | undefined;
  /** Consume Clerk listener and cleanup snapshots, ignoring unresolved hydration. */
  const observeSession = (sessionId: string | null | undefined) => {
    if (sessionId === undefined) return;
    if (clientSessionId === undefined) clientSessionId = sessionId;
    if (clientSessionId !== sessionId) retired = true;
    resolveReady?.();
  };
  /** Reject retired clients using Clerk's current identity at call time. */
  const assertCurrent = () => {
    const session = clerk.session;
    observeSession(session === undefined ? undefined : (session?.id ?? null));
    if (retired) throw new Error(SESSION_CHANGED_MESSAGE);
  };
  /** Wait for identity and bind each batch to a freshly obtained account token. */
  const headers = async (): Promise<Record<string, string>> => {
    assertCurrent();
    // Public queries can depend on the viewer too. Do not cache an anonymous result
    // while Clerk is still discovering the account that hydrated this tree.
    if (clerk.session === undefined) {
      ready ??= new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      await ready;
      assertCurrent();
    }
    const session = clerk.session;
    if (session === undefined) throw new Error(SESSION_EXPIRED_MESSAGE);
    if (!session) return { [TRPC_ANONYMOUS_HEADER]: "1" };
    const token = await session.getToken();
    assertCurrent();
    // assertCurrent ignores loading; a session disappearing during getToken still
    // invalidates this batch, even before Clerk reports a replacement identity.
    if (clerk.session?.id !== session.id) throw new Error(SESSION_CHANGED_MESSAGE);
    // Falling back to cookies here could authenticate the request as another tab's user.
    if (!token) throw new Error(SESSION_EXPIRED_MESSAGE);
    return { Authorization: `Bearer ${token}` };
  };
  return { headers, assertCurrent, observeSession };
};

/**
 * Guard dispatch and late successes against the client's account lifetime.
 * Guard failures use observer.error so pending requests settle. Device-registration
 * success retains its cleanup proof; upstream errors pass through unchanged.
 */
export const trpcSessionLink =
  (
    session: Pick<ReturnType<typeof createTrpcSession>, "assertCurrent">,
  ): TRPCLink<AppRouter> =>
  () =>
  ({ op, next }) =>
    observable((observer) => {
      try {
        session.assertCurrent();
      } catch (error) {
        observer.error(TRPCClientError.from(error as Error));
        return;
      }
      return next(op).subscribe({
        next(value) {
          try {
            // The push hook needs a completed bind's rotating proof for queued detach.
            // Its registration epoch keeps it out of the next account's widget state.
            if (op.type !== "mutation" || op.path !== "push.registerDevice") {
              session.assertCurrent();
            }
            observer.next(value);
          } catch (error) {
            observer.error(TRPCClientError.from(error as Error));
          }
        },
        error(error) {
          observer.error(error);
        },
        complete() {
          observer.complete();
        },
      });
    });

/** Preserve experiment cookies without borrowing another tab's authentication. */
export const trpcSessionUserId = (
  authenticatedUserId: string | null,
  headers: Pick<Headers, "get">,
) => (headers.get(TRPC_ANONYMOUS_HEADER) === "1" ? null : authenticatedUserId);
