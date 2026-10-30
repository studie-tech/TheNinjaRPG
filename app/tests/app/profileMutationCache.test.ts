import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "bun:test";
import { activeDungeonNotification } from "@/libs/dungeon";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const flows = [
  { file: "app/[shell]/blackmarket/page.tsx", procedure: "bloodline.pityRoll", patch: { bloodlineId: "new", bloodline: { id: "new" } } },
  { file: "layout/ProfileEdit.tsx", procedure: "bloodline.swapBloodline", patch: { bloodlineId: "new", bloodline: { id: "new" }, reputationPoints: 10 } },
  { file: "layout/ProfileEdit.tsx", procedure: "staff.unequipAllGear", patch: { items: [], maxEnergy: 100 } },
  { file: "layout/ProfileEdit.tsx", procedure: "staff.unequipAllJutsus", patch: { loadout: { jutsuIds: [] } } },
  { file: "layout/ProfileEdit.tsx", procedure: "blackmarket.updateStats", patch: { offence: 100, defence: 100 }, invalidations: 0 },
  { file: "layout/ProfileEdit.tsx", procedure: "skillTree.resetSkillPoints", patch: { userSkills: [], monthlySkillResets: { month: "2026-10", count: 1 }, maxEnergy: 100, effectiveMasteries: {} }, invalidations: 2 },
  { file: "layout/Clan.tsx", procedure: "clan.editClanColor", patch: { village: { id: "home", hexColor: "#123456" } }, invalidations: 0 },
  { file: "layout/ProfileEdit.tsx", procedure: "skillTree.resetAllUsersSkillPoints", patch: { userSkills: [], skillPoints: 12 } },
  { file: "app/[shell]/adminbuilding/page.tsx", procedure: "quests.startQuest", patch: { userQuests: [], questData: [] } },
  { file: "layout/RaidBrowser.tsx", procedure: "raids.claimDamageReward", patch: { reputationPoints: 10 }, invalidations: 2 },
  { file: "layout/Clan.tsx", procedure: "clan.upgradeHideoutToStronghold", patch: { village: { id: "home", type: "STRONGHOLD" } }, invalidations: 0 },
  { file: "layout/OccupationCrafting.tsx", procedure: "occupation.cancelQueuedCraft", patch: { queue: [] }, invalidations: 2 },
  { file: "app/[shell]/dungeon/page.tsx", procedure: "coop.dungeon.act", patch: { status: "BATTLE" }, invalidations: 2 },
  { file: "app/[shell]/territory-war/page.tsx", procedure: "territoryWar.startBattle", patch: { status: "QUEUED" } },
];

/** Execute profile mutation callbacks against a warmed cache and captured revision. */
const setup = (file: string, procedure: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const profile = {
    userData: { userId: "actor", status: "AWAKE", pveFights: 7, curHealth: 321, curChakra: 222, curStamina: 111, curEnergy: 37, money: 100, reputationPoints: 30, bloodlineId: null, bloodline: null, villageId: "home", village: { id: "home", type: "HIDEOUT" }, items: [{ id: "gear" }], loadout: { jutsuIds: ["jutsu"] }, userSkills: [{ id: "skill" }], skillPoints: 0, maxEnergy: 200 } as unknown as NonNullable<UserWithRelations>,
    achievementProgress: [{ questId: "preserved" }],
    notifications: [] as NavBarDropdownLink[],
  };
  client.setQueryData(key, profile);
  const getUser = vi.fn(async () => profile);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  const invalidate = vi.fn(async () => undefined);
  const leaf = { invalidate };
  const utils = {
    bloodline: { getItemRolls: leaf, getSwapInfo: leaf },
    item: { getUserItems: leaf },
    jutsu: { getUserJutsus: leaf },
    skillTree: { getUserSkills: leaf, getResetInfo: leaf },
    quests: { allianceBuilding: leaf },
    occupation: { getCraftingQueue: leaf },
    raids: { getRaidDetails: leaf, getUserRaidQueue: leaf },
    shrine: { getShrineBattles: leaf },
    clan: { getClanBattles: leaf },
    hunting: { getBoard: leaf, getSession: leaf },
    combat: { getBattle: leaf },
    travel: { getSectorData: leaf },
    profile: { getDashboard: leaf },
    territoryWar: { invalidate },
  };
  const updateUser = vi.fn((patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(client, key, patch, options));
  const source = readFileSync(join(import.meta.dirname, "../../src", file), "utf8");
  const call = source.indexOf(`api.${procedure}.useMutation(`);
  const optionsStart = source.indexOf("{", call);
  const indent = source.slice(source.lastIndexOf("\n", optionsStart) + 1, optionsStart).match(/^\s*/)?.[0];
  const callbacks = source.slice(call).match(new RegExp(`useMutation\\(\\s*(\\{[\\s\\S]*?\\n${indent}\\}),?\\s*\\);`))?.[1];
  if (!callbacks) throw new Error(`${procedure} callbacks were not found in ${file}`);
  const shared = procedure === "coop.dungeon.act"
    ? source.slice(source.indexOf("  const refresh ="), source.indexOf("  const create ="))
    : procedure === "territoryWar.startBattle"
      ? source.slice(source.indexOf("  const onSuccess ="), source.indexOf("  const create ="))
      : "";
  const transpiler = new (require("bun").Transpiler)({ loader: "tsx" }) as { transformSync(source: string): string };
  const factory = transpiler.transformSync(`function callbackOptions() { ${shared} return (${callbacks}); }`);
  // Execute the production callbacks with the real cache merger, matching userItemsRefresh.test.ts.
  const options = new Function("utils", "util", "prepareUserUpdate", "updateUser", "showMutationToast", "setIsOpen", "showRewardToast", "recoverUser", "state", "setMessage", "setAbandonId", "form", "pushToCombat", "router", "board", "onStarted", "setNpcDialog", "openRewardChoice", "available", "activeDungeonNotification", `${factory}\nreturn callbackOptions();`)(
    utils, utils, () => prepareUserUpdate(client, key), updateUser, vi.fn(), vi.fn(), vi.fn(), vi.fn(), { refetch: async () => { await invalidate(); return { data: { userPatch: {}, users: [], members: [{ runId: "squad", userId: "actor", activeUserId: "actor" }] }, isError: false }; } }, vi.fn(), vi.fn(), { reset: vi.fn() }, vi.fn(), { push: vi.fn() }, { refetch: invalidate }, undefined, vi.fn(), vi.fn(), { refetch: invalidate }, activeDungeonNotification,
  ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
  return {
    client, getUser, invalidate, updateUser, options, profile,
    value: () => client.getQueryData<typeof profile>(key),
    close: () => { unsubscribe(); client.clear(); },
  };
};

describe.each(flows)("$procedure profile updates", ({ file, procedure, patch, invalidations = 1 }) => {
  it("applies a normal patch-only success without fetching the observed profile", async () => {
    const test = setup(file, procedure);
    try {
      await test.options.onSuccess({ success: true, userPatch: patch, userDelta: {}, achievementProgress: [] }, {}, test.options.onMutate());
      await test.updateUser.mock.results[0]?.value;
      expect(test.value()?.userData).toMatchObject({ ...patch, money: 100 });
      expect(test.getUser).not.toHaveBeenCalled();
      expect(test.invalidate).toHaveBeenCalledTimes(invalidations);
      expect(test.updateUser).toHaveBeenCalledTimes(1);
      if (procedure.startsWith("bloodline.") || procedure === "skillTree.resetAllUsersSkillPoints" || procedure === "quests.startQuest") expect(test.value()?.achievementProgress).toEqual([]);
    } finally { test.close(); }
  });

  it("keeps an authoritative empty patch local", async () => {
    const test = setup(file, procedure);
    try {
      await test.options.onSuccess({ success: true, userPatch: {}, userDelta: {} }, {}, test.options.onMutate());
      await test.updateUser.mock.results[0]?.value;
      expect(test.value()?.userData).toEqual(test.profile.userData);
      expect(test.getUser).not.toHaveBeenCalled();
      expect(test.invalidate).toHaveBeenCalledTimes(invalidations);
    } finally { test.close(); }
  });

  it("fetches the profile when a successful response cannot supply a patch", async () => {
    const test = setup(file, procedure);
    try {
      await test.options.onSuccess({ success: true }, {}, test.options.onMutate());
      await test.updateUser.mock.results[0]?.value;
      expect(test.getUser).toHaveBeenCalledTimes(1);
      expect(test.invalidate).toHaveBeenCalledTimes(invalidations);
    } finally { test.close(); }
  });

  it("reconciles a patch arriving after another profile revision", async () => {
    const test = setup(file, procedure);
    try {
      const revision = test.options.onMutate();
      test.client.setQueryData(key, { ...test.profile, userData: { ...test.profile.userData, money: 90 } });
      await test.options.onSuccess({ success: true, userPatch: patch, userDelta: {} }, {}, revision);
      await test.updateUser.mock.results[0]?.value;
      expect(test.getUser).toHaveBeenCalledTimes(1);
      expect(test.invalidate).toHaveBeenCalledTimes(invalidations);
    } finally { test.close(); }
  });
});

describe.each(flows.filter(({ procedure }) => ["quests.startQuest", "bloodline.swapBloodline", "raids.claimDamageReward", "coop.dungeon.act", "territoryWar.startBattle"].includes(procedure)))("$procedure rejected profile updates", ({ file, procedure }) => {
  it("recovers settlement committed before a rejection without a patch", async () => {
    const test = setup(file, procedure);
    const settled = { ...test.profile, userData: { ...test.profile.userData, cookingExperience: 23, cookingJobs: [] } };
    test.getUser.mockResolvedValue(settled);
    try {
      await test.options.onSuccess({ success: false, message: "Action no longer available" }, undefined, test.options.onMutate());
      await test.updateUser.mock.results[0]?.value;
      expect(test.updateUser).toHaveBeenCalledTimes(1);
      expect(test.getUser).toHaveBeenCalledTimes(1);
      expect(test.value()?.userData).toMatchObject({ cookingExperience: 23, cookingJobs: [] });
    } finally { test.close(); }
  });
});


const admissionFlows = [
  { file: "layout/HuntingBoard.tsx", procedure: "hunting.start" },
  { file: "app/[shell]/dungeon/page.tsx", procedure: "coop.dungeon.act" },
  { file: "layout/ShrineBattleLobby.tsx", procedure: "shrine.initiateShrineBattle" },
  { file: "layout/Objective.tsx", procedure: "quests.retryBattle" },
  { file: "layout/Sector.tsx", procedure: "overworldAi.interactWithOverworldAi" },
  { file: "layout/RaidBrowser.tsx", procedure: "raids.startRaidBattle" },
  { file: "layout/Clan.tsx", procedure: "clan.initiateClanBattle" },
  { file: "app/[shell]/territory-war/page.tsx", procedure: "territoryWar.startBattle" },
];

describe.each(admissionFlows)("$procedure admission deltas", ({ file, procedure }) => {
  it("applies the actor's fight increment and raw pools together without a profile read", async () => {
    const test = setup(file, procedure);
    try {
      const userPatch = { status: "BATTLE", battleId: "admission" };
      await test.options.onSuccess({ success: true, battleId: "admission", userPatch, userDelta: { pveFights: 1 } }, {}, test.options.onMutate());
      await test.updateUser.mock.results[0]?.value;
      expect(test.value()?.userData).toMatchObject({ ...userPatch, pveFights: 8, curHealth: 321, curChakra: 222, curStamina: 111, curEnergy: 37 });
      expect(test.getUser).not.toHaveBeenCalled();
      expect(test.updateUser).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });

  it("reconciles an admission that withholds both patch and delta", async () => {
    const test = setup(file, procedure);
    const settled = { ...test.profile, userData: { ...test.profile.userData, status: "BATTLE" as const, battleId: "admission", pveFights: 8 } };
    test.getUser.mockResolvedValue(settled);
    try {
      await test.options.onSuccess({ success: true, battleId: "admission", userPatch: undefined, userDelta: undefined }, {}, test.options.onMutate());
      await test.updateUser.mock.results[0]?.value;
      expect(test.value()?.userData).toMatchObject({ status: "BATTLE", pveFights: 8 });
      expect(test.getUser).toHaveBeenCalledTimes(1);
      expect(test.updateUser).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });
});

it("keeps a known patch-only dungeon party change local when no delta is returned", async () => {
  const test = setup("app/[shell]/dungeon/page.tsx", "coop.dungeon.act");
  try {
    await test.options.onSuccess({ success: true, userPatch: {} }, {}, test.options.onMutate());
    await test.updateUser.mock.results[0]?.value;
    expect(test.getUser).not.toHaveBeenCalled();
    expect(test.value()?.userData).toEqual(test.profile.userData);
  } finally { test.close(); }
});

it("adds confirmed dungeon navigation once without replaying consumed feedback", async () => {
  const test = setup("app/[shell]/dungeon/page.tsx", "coop.dungeon.act");
  const unrelated: NavBarDropdownLink = { href: "/inbox", name: "Mail", color: "blue" };
  test.client.setQueryData(key, { ...test.profile, notifications: [unrelated, activeDungeonNotification, activeDungeonNotification, { href: "/news", name: "Consumed feedback", color: "toast" }] });
  try {
    await test.options.onSuccess({ success: true, userPatch: { status: "QUEUED", activeDungeonRunId: "squad" } }, { action: "accept" }, test.options.onMutate());
    await test.updateUser.mock.results[0]?.value;
    expect(test.value()?.userData).toMatchObject({ status: "QUEUED", money: 100 });
    expect(test.value()?.notifications).toEqual([unrelated, activeDungeonNotification]);
    expect(test.getUser).not.toHaveBeenCalled();
    expect(test.invalidate).toHaveBeenCalledTimes(2);
    expect(test.updateUser).toHaveBeenCalledTimes(1);
  } finally { test.close(); }
});

it("keeps a known no-battle retry projection local when no delta is returned", async () => {
  const test = setup("layout/Objective.tsx", "quests.retryBattle");
  try {
    await test.options.onSuccess({ success: true, userPatch: {} }, {}, test.options.onMutate());
    await test.updateUser.mock.results[0]?.value;
    expect(test.getUser).not.toHaveBeenCalled();
    expect(test.value()?.userData).toEqual(test.profile.userData);
  } finally { test.close(); }
});
