export const getNominateKageUserUpdate = ({
  inputVillageId,
  candidateUserId,
  leaderUpdatedAt,
  ctxUserId,
  candidateRank,
}: {
  inputVillageId: string;
  candidateUserId: string;
  leaderUpdatedAt: Date;
  ctxUserId: string;
  candidateRank:
    | "NONE"
    | "STUDENT"
    | "GENIN"
    | "CHUNIN"
    | "JONIN"
    | "ELITE JONIN"
    | "ELDER";
}) => ({
  userPatch: {
    village: {
      id: inputVillageId,
      kageId: candidateUserId,
      leaderUpdatedAt,
      kageSchedule: null,
    },
    ...(candidateUserId === ctxUserId && candidateRank === "ELDER"
      ? { rank: "JONIN" as const }
      : {}),
  },
});
