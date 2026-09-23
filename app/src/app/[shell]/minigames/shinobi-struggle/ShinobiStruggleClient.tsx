"use client";

import "@blockstruggle/game-ui/style.css";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

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
  return (
    <NinjaMiniGame
      key={initialMatchId ?? "lobby"}
      initialMatchId={initialMatchId}
      onExit={() => router.push("/minigames")}
      onSignIn={() => router.push("/login")}
    />
  );
}
