/** Clear the matching village's cancelled active mission. */
export const getCancelUserUpdate = ({
  inputVillageId,
}: {
  inputVillageId: string;
}) => ({
  userPatch: { village: { id: inputVillageId, activeMission: null } },
});

/** Clear the matching village's claimed mission and credit its confirmed token reward. */
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
