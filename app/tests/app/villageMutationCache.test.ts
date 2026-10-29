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
  it.each([{ achievementProgress: [] }, { achievementProgress: [{ questId: "destination-achievement" }] }])("replaces achievement progress with $achievementProgress without a profile refetch", async ({ achievementProgress }) => {
    const client = new QueryClient();
    const initial = { userData: { userId: "actor", villageId: "old" }, achievementProgress: [{ questId: "source-achievement" }] };
    client.setQueryData(key, initial);
    const getUser = vi.fn(async () => initial);
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
      await options.onSuccess({ success: true, userPatch: { villageId: "new", village: { id: "new" } }, achievementProgress }, undefined, options.onMutate());
      expect(client.getQueryData<{ achievementProgress: unknown[] }>(key)?.achievementProgress).toEqual([...achievementProgress]);
      expect(getUser).not.toHaveBeenCalled();
    } finally { unsubscribe(); client.clear(); }
  });
});
