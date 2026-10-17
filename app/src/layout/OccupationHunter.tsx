"use client";

import { HUNTING_RANKS, HUNTING_REQUIRED_EXP } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { HuntingBoard } from "@/layout/HuntingBoard";
import { useRequiredUserData } from "@/utils/UserContext";

export default function OccupationHunter() {
  const { data: user } = useRequiredUserData();
  if (user?.occupation !== "HUNTER") return null;
  return (
    <>
      <HuntingBoard />
      <ContentBox
        title="Hunting ranks"
        subtitle="Your hunting experience is preserved"
        initialBreak
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {HUNTING_RANKS.filter((r) => r !== "NONE").map((r) => (
            <p key={r}>
              {r}: {HUNTING_REQUIRED_EXP[r].toLocaleString()}+ experience
            </p>
          ))}
        </div>
        <p className="mt-4">
          Higher hunting ranks unlock new targets within each habitat. Prepare once per
          session; repeated hunts keep the same creature and sector. Materials and
          hunting experience arrive automatically on victory. Switching contracts
          preserves each creature’s remaining allowance.
        </p>
        <p className="mt-2">
          Existing hunting quests can still be finished through your logbook.
        </p>
      </ContentBox>
    </>
  );
}
