import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "bun:test";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const flows = [
  { file: "app/[shell]/village/page.tsx", procedure: "leaveVillage" },
  { file: "app/[shell]/travel/page.tsx", procedure: "joinVillage" },
  { file: "layout/ProfileEdit.tsx", procedure: "swapVillage" },
];

describe.each(flows)("village.$procedure profile updates", ({ file, procedure }) => {
  it.each([
    { description: "replaces empty achievement progress locally", achievementProgress: [] },
    { description: "replaces destination achievement progress locally", achievementProgress: [{ questId: "destination-achievement" }] },
    { description: "refetches unavailable progression without repeating a debit", achievementProgress: undefined },
  ])("$description", async ({ achievementProgress }) => {
    const client = new QueryClient();
    const initial = { userData: { userId: "actor", villageId: "old", reputationPoints: 100 }, achievementProgress: [{ questId: "source-achievement" }] };
    const canonical = { userData: { userId: "actor", villageId: "new", reputationPoints: 100, userQuests: [{ questId: "child-mission" }] }, achievementProgress: [{ questId: "destination-achievement" }] };
    client.setQueryData(key, initial);
    const getUser = vi.fn(async () => canonical);
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    const source = readFileSync(join(import.meta.dirname, "../../src", file), "utf8");
    const call = source.indexOf(`api.village.${procedure}.useMutation`);
    const indent = source.slice(source.lastIndexOf("\n", call) + 1, call).match(/^\s*/)?.[0];
    const callbacks = source.slice(call).match(new RegExp(`useMutation\\((\\{[\\s\\S]*?\\n${indent}\\})\\);`))?.[1];
    if (!callbacks) throw new Error(`${procedure} callbacks were not found in ${file}`);
    const options = new Function("prepareUserUpdate", "updateUser", "showMutationToast", "setIsOpen", `return (${callbacks});`)(
      () => prepareUserUpdate(client, key),
      (patch: UserPatch | undefined, update: UserUpdateOptions) => updateUserCache(client, key, patch, update),
      vi.fn(), vi.fn(),
    ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
    try {
      await options.onSuccess({ success: true, userPatch: achievementProgress ? { villageId: "new", village: { id: "new" } } : undefined, achievementProgress, userDelta: undefined }, undefined, options.onMutate());
      if (achievementProgress) {
        expect(client.getQueryData<{ achievementProgress: unknown[] }>(key)?.achievementProgress).toEqual([...achievementProgress]);
        expect(getUser).not.toHaveBeenCalled();
      } else {
        expect(getUser).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(key)).toEqual(canonical);
      }
      expect(client.getQueryData<typeof initial>(key)?.userData.reputationPoints).toBe(100);
    } finally { unsubscribe(); client.clear(); }
  });
});
