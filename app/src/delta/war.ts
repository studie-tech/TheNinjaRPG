export const getInviteMercenaryUserUpdate = () => ({
  userPatch: {},
});

export const getCompleteWarMissionUserUpdate = () => ({
  userPatch: { warMission: null },
});

export const getCancelWarMissionUserUpdate = ({
  cancelledRowsAffected,
}: {
  cancelledRowsAffected: number;
}) => ({
  userPatch: cancelledRowsAffected ? { warMission: null } : undefined,
});
