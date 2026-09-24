"use client";

import "@blockstruggle/game-ui/style.css";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

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
  const [linkedVersion, setLinkedVersion] = useState(0);
  return (
    <>
      {process.env.NEXT_PUBLIC_BLOCKSTRUGGLE_IDENTITY_LINK_ENABLED === "true" && (
        <IdentityLinkForm onLinked={() => setLinkedVersion((version) => version + 1)} />
      )}
      <NinjaMiniGame
        key={`${initialMatchId ?? "lobby"}:${linkedVersion}`}
        initialMatchId={initialMatchId}
        onExit={() => router.push("/minigames")}
        onSignIn={() => router.push("/login")}
      />
    </>
  );
}

const IdentityLinkForm = ({ onLinked }: { onLinked: () => void }) => {
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
      const response = await fetch(
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
    <section className="mx-auto mb-4 max-w-3xl rounded-lg border border-amber-500/50 bg-slate-950 p-4 text-amber-50">
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
              onChange={(event) => setCode(event.target.value)}
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
