import { expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MutationObserver,
  type MutationObserverOptions,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { deferred } from "../setup/deferred";

// Exercise the actual callbacks alongside cache recovery and user feedback.
for (const procedure of [
  "item.mergeStacks",
  "item.mergeAllStacks",
  "item.sellUserItem",
  "item.sellUserItems",
  "item.toggleEquip",
  "jutsu.toggleEquip",
]) {
  it(`${procedure} shows failures, recovers observed caches and releases the action`, async () => {
    const isItem = procedure.startsWith("item.");
    const isMergeAll = procedure === "item.mergeAllStacks";
    const file = isMergeAll
      ? "../../src/layout/MergeAllStacksButton.tsx"
      : procedure === "item.sellUserItems"
        ? "../../src/hooks/useBulkSellItems.ts"
        : isItem
          ? "../../src/hooks/useItemActions.ts"
          : "../../src/app/[shell]/jutsus/page.tsx";
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    const call = source.indexOf(`api.${procedure}.useMutation(`);
    const callbacks = source
      .slice(call)
      .match(/useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
    if (!callbacks) throw new Error(`${procedure} callbacks were not found`);

    const defaultError = vi.fn();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { onError: defaultError },
      },
    });
    const { promise: recovery, resolve: finishRecovery } = deferred<string>();
    const caches = (
      isItem ? ["inventory", "variants"] : ["jutsus", "loadouts", "profile"]
    ).map((name) => {
      const queryKey = [name];
      client.setQueryData(queryKey, "stale");
      const { promise: started, resolve: startRecovery } = deferred<void>();
      const queryFn = vi.fn(() => {
        startRecovery();
        return recovery;
      });
      const stop = new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {});
      return {
        queryKey,
        queryFn,
        stop,
        started,
        invalidate: () => client.invalidateQueries({ queryKey }),
      };
    });
    const showMutationToast = vi.fn();
    const onSettled = vi.fn();
    const onMerged = vi.fn();
    const loadoutRequestInFlightRef = { current: true };
    const bindings = {
      prepareInventoryUpdate: vi.fn(),
      updateInventory: vi.fn(),
      invalidateInventory: () => Promise.all(caches.map((cache) => cache.invalidate())),
      prepareJutsuUpdate: vi.fn(),
      prepareUserUpdate: vi.fn(),
      prepareLoadoutUpdate: vi.fn(),
      updateEquippedLoadout: vi.fn(),
      updateJutsus: vi.fn(),
      updateUser: vi.fn(),
      utils: {
        jutsu: { getUserJutsus: caches[0], getLoadouts: caches[1] },
        profile: { getUser: caches[2] },
      },
      showMutationToast,
      onSettled,
      onMerged,
      loadoutRequestInFlightRef,
    };
    const options = new Function(...Object.keys(bindings), `return (${callbacks});`)(
      ...Object.values(bindings),
    ) as MutationObserverOptions<never, Error, object>;
    const error = new Error("Could not confirm the action");
    const mutation = new MutationObserver(client, {
      ...options,
      mutationFn: async () => {
        throw error;
      },
    });
    const result = mutation.mutate({});
    const finished = result.catch(() => {});
    try {
      await Promise.all(caches.map((cache) => cache.started));
      expect(showMutationToast).toHaveBeenCalledWith({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      expect(mutation.getCurrentResult().isPending).toBe(true);
      expect(onSettled).not.toHaveBeenCalled();
      for (const cache of caches)
        expect(client.getQueryData(cache.queryKey)).toBe("stale");
      finishRecovery("authoritative");
      await expect(result).rejects.toBe(error);
      expect(showMutationToast).toHaveBeenCalledTimes(1);
      expect(showMutationToast).toHaveBeenCalledWith({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      expect(defaultError).not.toHaveBeenCalled();
      for (const cache of caches) {
        expect(client.getQueryData(cache.queryKey)).toBe("authoritative");
        expect(cache.queryFn).toHaveBeenCalledTimes(1);
      }
      expect(mutation.getCurrentResult().isPending).toBe(false);
      expect(onSettled).toHaveBeenCalledTimes(isMergeAll ? 0 : 1);
      expect(onMerged).not.toHaveBeenCalled();
      if (!isItem) expect(loadoutRequestInFlightRef.current).toBe(false);
    } finally {
      finishRecovery("authoritative");
      await finished;
      for (const cache of caches) cache.stop();
      client.clear();
    }
  });
}
