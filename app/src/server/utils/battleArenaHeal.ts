interface HealedArenaPools {
  money: number;
  curHealth: number;
  curStamina: number;
  curChakra: number;
}

const committedHealResponse = {
  success: true as const,
  message: "You've healed",
};

/**
 * Read back the authoritative values after an arena heal has committed.
 * A read failure must never turn that committed paid action into a client-visible
 * failure, because the client would otherwise offer a misleading retry.
 */
export const resolveCommittedArenaHeal = async (
  readHealedPools: () => Promise<HealedArenaPools | undefined>,
) => {
  try {
    const healedUser = await readHealedPools();
    return healedUser
      ? { ...committedHealResponse, ...healedUser }
      : committedHealResponse;
  } catch {
    return committedHealResponse;
  }
};
