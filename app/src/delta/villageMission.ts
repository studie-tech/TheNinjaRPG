export const getCancelUserUpdate = ({
  inputVillageId,
}: {
  inputVillageId: string;
}) => ({
  userPatch: { village: { id: inputVillageId, activeMission: null } },
});

export const getClaimUserUpdate = ({
  inputVillageId,
  rewardTokens,
}: {
  inputVillageId: string;
  rewardTokens: number;
}) => ({
  userPatch: { village: { id: inputVillageId, activeMission: null } },
  userDelta: { village: { id: inputVillageId, tokens: rewardTokens } },
});
