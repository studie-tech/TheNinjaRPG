/** Confirm that creating a territory-war team has no profile balance changes. */
export const getCreateTeamUserUpdate = () => ({
  userDelta: {},
});

/** Project awake status only after the guarded territory-war queue exit affected a row. */
export const getLeaveTeamUserUpdate = ({
  wokeRowsAffected,
}: {
  wokeRowsAffected: number;
}) => ({
  userPatch: wokeRowsAffected ? { status: "AWAKE" as const } : undefined,
});

/** Project the caller's confirmed territory-war queue admission. */
export const getJoinTeamUserUpdate = () => ({
  userPatch: { status: "QUEUED" as const },
});
