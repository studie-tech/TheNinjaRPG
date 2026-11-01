/** Confirm that a mercenary invitation leaves the caller's profile unchanged. */
export const getInviteMercenaryUserUpdate = () => ({
  userPatch: {},
});

/** Clear the caller's completed war mission. */
export const getCompleteWarMissionUserUpdate = () => ({
  userPatch: { warMission: null },
});

/** Clear the cancelled war mission only after the guarded cancellation affected a row. */
export const getCancelWarMissionUserUpdate = ({
  cancelledRowsAffected,
}: {
  cancelledRowsAffected: number;
}) => ({
  userPatch: cancelledRowsAffected ? { warMission: null } : undefined,
});
