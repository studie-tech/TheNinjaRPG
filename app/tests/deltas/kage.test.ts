import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "bun:test";
import { getCombatAdmissionUserUpdate } from "@/deltas/combat";
import { getKageDefenseCheckInUserUpdate } from "@/deltas/kage";
import type { UserCache } from "@/deltas/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { kageBattleResponseSchema } from "@/validators/kage";
import { userDeltaResponseSchema } from "@/validators/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const recovery = {
  userId: "challenger",
  userPatch: {
    status: "AWAKE" as const,
    curHealth: 100,
    curChakra: 90,
    curStamina: 80,
    curEnergy: 70,
  },
};

/** Observe confirmed Kage response projections through the shared profile cache binding. */
const setup = (status: "AWAKE" | "ASLEEP" | "HOSPITALIZED") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initial: UserCache = {
    userData: {
      userId: "challenger",
      status,
      battleId: null,
      money: 100,
      pveFights: 2,
      curHealth: 1,
      curChakra: 2,
      curStamina: 3,
      curEnergy: 4,
      rank: "JONIN",
      level: 50,
      earnedExperience: 0,
      isOutlaw: true,
    } as NonNullable<UserWithRelations>,
    notifications: [],
  };
  client.setQueryData(key, initial);
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      return initial;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  return {
    client,
    reads: () => reads,
    value: () => client.getQueryData<UserCache>(key),
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
};

it.each(["AWAKE", "ASLEEP", "HOSPITALIZED"] as const)(
  "projects %s defense check-in recovery without fetching the profile",
  async (status) => {
    const test = setup(status);
    try {
      const response = userDeltaResponseSchema.parse({
        success: true,
        message: "Checked in",
        ...getKageDefenseCheckInUserUpdate(),
        ...(status !== "AWAKE" ? { userRecovery: recovery } : {}),
      });
      await updateUserCache(test.client, key, response, {
        revision: prepareUserUpdate(test.client, key),
      });
      expect(test.reads()).toBe(0);
      expect(test.value()?.userData).toMatchObject({
        status: "AWAKE",
        battleId: null,
        money: 100,
        pveFights: 2,
        ...(status !== "AWAKE" ? recovery.userPatch : {}),
      });
    } finally {
      test.close();
    }
  },
);

it.each(["AWAKE", "ASLEEP", "HOSPITALIZED"] as const)(
  "retains %s battle admission and recovery through the Kage output schema",
  async (status) => {
    const test = setup(status);
    try {
      const admission = getCombatAdmissionUserUpdate({
        cacheActor: { userId: "challenger", bracketImmunityLiftedUntil: new Date(0) },
        requiresUserRefresh: false,
        allParticipantIds: ["challenger", "kage"],
        queuedParticipants: [],
        battleType: "KAGE_PVP",
        warAggressorIds: [],
        bracketImmunityAggressorIds: [],
        now: new Date(),
        battleId: "title-fight",
        stealthBreakUserIds: [],
        isTournament: false,
      });
      const response = kageBattleResponseSchema.parse({
        success: true,
        message: "Started",
        battleId: "title-fight",
        ...admission,
        ...(status !== "AWAKE" ? { userRecovery: recovery } : {}),
      });
      expect(response.battleId).toBe("title-fight");
      expect(response.userPatch).toEqual(admission.userPatch);
      expect(response.userDelta).toEqual(admission.userDelta);
      await updateUserCache(test.client, key, response, {
        revision: prepareUserUpdate(test.client, key),
      });
      expect(test.reads()).toBe(0);
      expect(test.value()?.userData).toMatchObject({
        status: "BATTLE",
        battleId: "title-fight",
        pveFights: 3,
        ...(status !== "AWAKE"
          ? { curHealth: 100, curChakra: 90, curStamina: 80, curEnergy: 70 }
          : {}),
      });
    } finally {
      test.close();
    }
  },
);

it("keeps failed defense responses without a known feature projection eligible for reconciliation", async () => {
  const test = setup("AWAKE");
  try {
    const response = userDeltaResponseSchema.parse({
      success: false,
      message: "Leadership changed",
    });
    expect(response.userPatch).toBeUndefined();
    expect(response.userDelta).toBeUndefined();
    await updateUserCache(test.client, key, response, {
      revision: prepareUserUpdate(test.client, key),
    });
    expect(test.reads()).toBe(1);
  } finally {
    test.close();
  }
});
