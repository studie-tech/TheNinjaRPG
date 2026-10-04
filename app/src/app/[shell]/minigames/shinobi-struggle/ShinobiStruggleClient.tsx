"use client";

import "@blockstruggle/game-ui/style.css";
import { useAuth } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

const NinjaMiniGame = dynamic(
  () => import("@blockstruggle/game-ui").then((module) => module.NinjaMiniGame),
  { ssr: false, loading: () => <p role="status">Loading Shinobi Struggle…</p> },
);

export default function ShinobiStruggleClient({
  initialMatchId,
}: {
  initialMatchId?: string;
}) {
  const router = useRouter();
  const { getToken, isLoaded, sessionId } = useAuth();
  const identity = useRef({ sessionId, isLoaded, version: 0 });
  if (
    identity.current.sessionId !== sessionId ||
    identity.current.isLoaded !== isLoaded
  )
    identity.current = { sessionId, isLoaded, version: identity.current.version + 1 };
  const identityVersion = identity.current.version;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  const fetchGame = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      fetchAuthenticatedGame(
        input,
        init,
        () => getTokenRef.current(),
        fetch,
        () => mounted.current && identity.current.version === identityVersion,
      ),
    [identityVersion],
  );
  const [linkedVersion, setLinkedVersion] = useState(0);
  if (!isLoaded) return <p role="status">Connecting to TheNinjaRPG…</p>;
  return (
    <>
      {process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED === "true" && (
        <IdentityLinkForm
          key={identityVersion}
          fetchGame={fetchGame}
          onLinked={() => {
            if (mounted.current && identity.current.version === identityVersion)
              setLinkedVersion((version) => version + 1);
          }}
        />
      )}
      <NinjaMiniGame
        key={`${sessionId ?? "signed-out"}:${initialMatchId ?? "lobby"}:${linkedVersion}`}
        fetcher={fetchGame}
        initialMatchId={initialMatchId}
        onExit={() => router.push("/minigames")}
        onSignIn={() =>
          router.push(ninjaSignInUrl(initialMatchId, window.location.origin))
        }
      />
    </>
  );
}

const IdentityLinkForm = ({
  fetchGame,
  onLinked,
}: {
  fetchGame: typeof fetch;
  onLinked: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [linked, setLinked] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const normalized = code.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
      setMessage("Enter the 43-character link code from Block Struggle.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetchGame(
        "/api/minigames/blockstruggle/identity-link/redeem",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: normalized }),
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        },
      );
      if (response.status === 200) {
        setCode("");
        setLinked(true);
        onLinked();
      } else {
        setMessage(
          response.status === 409
            ? "This Ninja account already has game data. These accounts cannot be merged automatically."
            : response.status === 410
              ? "This code expired or was already used. Create a new one in Block Struggle."
              : response.status === 401
                ? "Sign in to TheNinjaRPG and try again."
                : "Account linking is unavailable right now. Please try again later.",
        );
      }
    } catch {
      setMessage("Could not reach Block Struggle. Please try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-label="Block Struggle account linking"
      className="mx-auto mb-4 max-w-3xl rounded-lg border border-amber-500/50 bg-slate-950 p-4 text-amber-50"
    >
      <button
        type="button"
        className="font-semibold text-amber-200 underline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Link an existing Block Struggle account
      </button>
      {open && (
        <div className="mt-3">
          <p>
            Generate a link code while signed in to Block Struggle, then enter it here.
            A Ninja account with game progress cannot be merged automatically.
          </p>
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={submit}>
            <label htmlFor="blockstruggle-link-code" className="sr-only">
              Block Struggle link code
            </label>
            <input
              id="blockstruggle-link-code"
              className="min-w-0 flex-1 rounded border border-amber-500 bg-slate-900 p-2 text-white"
              value={code}
              maxLength={43}
              autoComplete="off"
              spellCheck={false}
              onInput={(event) => setCode(event.currentTarget.value)}
              placeholder="Paste 43-character code"
              disabled={pending}
            />
            <button
              type="submit"
              className="rounded bg-amber-600 px-4 py-2 font-semibold text-black disabled:opacity-50"
              disabled={pending}
            >
              Link accounts
            </button>
          </form>
          {pending && <p role="status">Linking accounts…</p>}
          {message && <p role="alert">{message}</p>}
          {linked && <p role="status">Accounts linked. Your game is reconnecting.</p>}
        </div>
      )}
    </section>
  );
};

/** Clerk development previews can authenticate in the browser without a first-party session cookie. */
export const fetchAuthenticatedGame = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  getToken: () => Promise<string | null>,
  transport: typeof fetch = fetch,
  isCurrent: () => boolean = () => true,
) => {
  if (typeof input !== "string" || !input.startsWith("/api/minigames/blockstruggle/"))
    throw new Error("Game requests must use the same-origin bridge");
  const assertCurrent = () => {
    if (!isCurrent()) throw new DOMException("Game account changed", "AbortError");
  };
  assertCurrent();
  const token = await getToken();
  assertCurrent();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await transport(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!isCurrent()) {
    await response.body?.cancel().catch(() => {});
    assertCurrent();
  }
  return response;
};

export const ninjaSignInUrl = (matchId: string | undefined, origin: string) => {
  const returnUrl = new URL("/minigames/shinobi-struggle", origin);
  if (matchId) returnUrl.searchParams.set("match", matchId);
  return `/login?redirect_url=${encodeURIComponent(returnUrl.href)}`;
};
