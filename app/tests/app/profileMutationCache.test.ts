import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "bun:test";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const flows = [
  { file: "app/[shell]/blackmarket/page.tsx", procedure: "bloodline.pityRoll", patch: { bloodlineId: "new", bloodline: { id: "new" } } },
  { file: "layout/ProfileEdit.tsx", procedure: "bloodline.swapBloodline", patch: { bloodlineId: "new", bloodline: { id: "new" }, reputationPoints: 10 } },
  { file: "layout/ProfileEdit.tsx", procedure: "staff.unequipAllGear", patch: { items: [], maxEnergy: 100 } },
  { file: "layout/ProfileEdit.tsx", procedure: "staff.unequipAllJutsus", patch: { loadout: { jutsuIds: [] } } },
  { file: "layout/ProfileEdit.tsx", procedure: "skillTree.resetAllUsersSkillPoints", patch: { userSkills: [], skillPoints: 12 } },
  { file: "app/[shell]/adminbuilding/page.tsx", procedure: "quests.startQuest", patch: { userQuests: [], questData: [] } },
];

const setup = (file: string, procedure: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const profile = {
    userData: { userId: "actor", money: 100, reputationPoints: 30, bloodlineId: null, bloodline: null, items: [{ id: "gear" }], loadout: { jutsuIds: ["jutsu"] }, userSkills: [{ id: "skill" }], skillPoints: 0, maxEnergy: 200 } as unknown as NonNullable<UserWithRelations>,
    achievementProgress: [{ questId: "preserved" }],
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
    skillTree: { getUserSkills: leaf },
    quests: { allianceBuilding: leaf },
  };
  const updateUser = vi.fn((patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(client, key, patch, options));
  const source = readFileSync(join(import.meta.dirname, "../../src", file), "utf8");
  const call = source.indexOf(`api.${procedure}.useMutation(`);
  const indent = source.slice(source.lastIndexOf("\n", call) + 1, call).match(/^\s*/)?.[0];
  const callbacks = source.slice(call).match(new RegExp(`useMutation\\((\\{[\\s\\S]*?\\n${indent}\\})\\);`))?.[1];
  if (!callbacks) throw new Error(`${procedure} callbacks were not found in ${file}`);
  // Execute the production callbacks with the real cache merger, matching userItemsRefresh.test.ts.
  const options = new Function("utils", "util", "prepareUserUpdate", "updateUser", "showMutationToast", "setIsOpen", `return (${callbacks});`)(
    utils, utils, () => prepareUserUpdate(client, key), updateUser, vi.fn(), vi.fn(),
  ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
  return {
    client, getUser, invalidate, updateUser, options, profile,
    value: () => client.getQueryData<typeof profile>(key),
    close: () => { unsubscribe(); client.clear(); },
  };
};

describe.each(flows)("$procedure profile updates", ({ file, procedure, patch }) => {
  it("applies a normal patch-only success without fetching the observed profile", async () => {
    const test = setup(file, procedure);
    try {
      await test.options.onSuccess({ success: true, userPatch: patch, achievementProgress: [] }, undefined, test.options.onMutate());
      expect(test.value()?.userData).toMatchObject({ ...patch, money: 100 });
      expect(test.getUser).not.toHaveBeenCalled();
      expect(test.invalidate).toHaveBeenCalledTimes(1);
      expect(test.updateUser).toHaveBeenCalledTimes(1);
      if (procedure.startsWith("bloodline.") || procedure === "skillTree.resetAllUsersSkillPoints" || procedure === "quests.startQuest") expect(test.value()?.achievementProgress).toEqual([]);
    } finally { test.close(); }
  });

  it("keeps an authoritative empty patch local", async () => {
    const test = setup(file, procedure);
    try {
      await test.options.onSuccess({ success: true, userPatch: {} }, undefined, test.options.onMutate());
      expect(test.value()?.userData).toEqual(test.profile.userData);
      expect(test.getUser).not.toHaveBeenCalled();
      expect(test.invalidate).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });

  it("fetches the profile when a successful response cannot supply a patch", async () => {
    const test = setup(file, procedure);
    try {
      await test.options.onSuccess({ success: true }, undefined, test.options.onMutate());
      expect(test.getUser).toHaveBeenCalledTimes(1);
      expect(test.invalidate).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });

  it("reconciles a patch arriving after another profile revision", async () => {
    const test = setup(file, procedure);
    try {
      const revision = test.options.onMutate();
      test.client.setQueryData(key, { ...test.profile, userData: { ...test.profile.userData, money: 90 } });
      await test.options.onSuccess({ success: true, userPatch: patch }, undefined, revision);
      expect(test.getUser).toHaveBeenCalledTimes(1);
      expect(test.invalidate).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });
});
