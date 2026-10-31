import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "bun:test";

const key = [["profile", "getUser"], { type: "query" }];
const flows = [
  { file: "app/[shell]/village/page.tsx", procedure: "leaveVillage" },
  { file: "app/[shell]/travel/page.tsx", procedure: "joinVillage" },
  { file: "layout/ProfileEdit.tsx", procedure: "swapVillage" },
];

describe.each(flows)("village.$procedure profile reconciliation", ({ file, procedure }) => {
  it.each([true, false])("invalidates committed membership with an active observer: %s", async (active) => {
    const client = new QueryClient();
    const initial = { userData: { userId: "actor", villageId: "old", reputationPoints: 100 }, achievementProgress: [{ questId: "source-achievement" }] };
    const canonical = { userData: { userId: "actor", villageId: "new", reputationPoints: 100, userQuests: [{ questId: "child-mission" }] }, achievementProgress: [{ questId: "destination-achievement" }] };
    client.setQueryData(key, initial);
    const getUser = vi.fn(async () => canonical);
    client.setQueryDefaults(key, { queryFn: getUser, staleTime: Infinity });
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = active ? observer.subscribe(() => {}) : () => {};
    const source = readFileSync(join(import.meta.dirname, "../../src", file), "utf8");
    const call = source.indexOf(`api.village.${procedure}.useMutation`);
    const indent = source.slice(source.lastIndexOf("\n", call) + 1, call).match(/^\s*/)?.[0];
    const callbacks = source.slice(call).match(new RegExp(`useMutation\\((\\{[\\s\\S]*?\n${indent}\\})\\);`))?.[1];
    if (!callbacks) throw new Error(`${procedure} callbacks were not found in ${file}`);
    const options = new Function("utils", "showMutationToast", "setIsOpen", `return (${callbacks});`)(
      { profile: { getUser: { invalidate: () => client.invalidateQueries({ queryKey: key, exact: true }) } } }, vi.fn(), vi.fn(),
    ) as { onSuccess: (data: unknown) => Promise<void> };
    try {
      await options.onSuccess({ success: false, message: "Status changed" });
      expect(getUser).not.toHaveBeenCalled();
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      await options.onSuccess({ success: true });
      expect(getUser).toHaveBeenCalledTimes(active ? 1 : 0);
      expect(client.getQueryState(key)?.isInvalidated).toBe(!active);
      expect(client.getQueryData(key)).toEqual(active ? canonical : initial);
      expect(client.getQueryData<typeof initial>(key)?.userData.reputationPoints).toBe(100);
    } finally { unsubscribe(); client.clear(); }
  });
});
