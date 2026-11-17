/** Point the player's profile at the AI rules their active jutsu loadout now fights with. */
export const getToggleAiProfileUserUpdate = (
  jutsuLoadout: string,
  aiProfileId: string | null,
) => ({
  userPatch: { jutsuLoadout, aiProfileId },
});

/**
 * Mark the toggled jutsu loadout as fighting with its own rules (a rules row id) or the Default
 * ones (null); a loadout keeps its own rules row while it uses the Default rules.
 */
export const getToggledAiLoadouts = <
  T extends { id: string; customAi: boolean; aiProfile: { id: string } | null },
>(
  loadouts: T[],
  toggled: { jutsuLoadout: string; aiProfileId: string | null },
): T[] =>
  loadouts.map((loadout) =>
    loadout.id === toggled.jutsuLoadout
      ? {
          ...loadout,
          customAi: toggled.aiProfileId !== null,
          aiProfile: toggled.aiProfileId
            ? { id: toggled.aiProfileId }
            : loadout.aiProfile,
        }
      : loadout,
  );
