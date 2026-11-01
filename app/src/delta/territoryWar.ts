export const getCreateTeamUserUpdate = () => ({
  userDelta: {},
});

export const getLeaveTeamUserUpdate = ({
  wokeRowsAffected,
}: {
  wokeRowsAffected: number;
}) => ({
  userPatch: wokeRowsAffected ? { status: "AWAKE" as const } : undefined,
});

export const getJoinTeamUserUpdate = () => ({
  userPatch: { status: "QUEUED" as const },
});
