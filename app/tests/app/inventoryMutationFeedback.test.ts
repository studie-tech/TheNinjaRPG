import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MutationObserver, type MutationObserverOptions, QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "bun:test";

for (const procedure of ["item.sellUserItem", "item.toggleEquip", "jutsu.toggleEquip"]) {
  it(`${procedure} shows failures, recovers observed caches and releases the action`, async () => {
    const isItem = procedure.startsWith("item.");
    const file = isItem ? "items" : "jutsus";
    const source = readFileSync(join(import.meta.dirname, `../../src/app/[shell]/${file}/page.tsx`), "utf8");
    const call = source.indexOf(`api.${procedure}.useMutation(`);
    const callbacks = source.slice(call).match(/useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
    if (!callbacks) throw new Error(`${procedure} callbacks were not found`);

    const defaultError = vi.fn();
    const client = new QueryClient({ defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { onError: defaultError },
    } });
    const caches = (isItem ? ["inventory", "variants"] : ["jutsus", "loadouts", "profile"]).map((name) => {
      const queryKey = [name];
      client.setQueryData(queryKey, "stale");
      const queryFn = vi.fn(async () => "authoritative");
      const stop = new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {});
      return { queryKey, queryFn, stop, invalidate: () => client.invalidateQueries({ queryKey }) };
    });
    const showMutationToast = vi.fn();
    const onSettled = vi.fn();
    const loadoutRequestInFlightRef = { current: true };
    const bindings = {
      prepareInventoryUpdate: vi.fn(), updateInventory: vi.fn(),
      invalidateInventory: () => Promise.all(caches.map((cache) => cache.invalidate())),
      prepareJutsuUpdate: vi.fn(), prepareUserUpdate: vi.fn(),
      updateJutsus: vi.fn(), updateUser: vi.fn(),
      utils: { jutsu: { getUserJutsus: caches[0], getLoadouts: caches[1] }, profile: { getUser: caches[2] } },
      showMutationToast, onSettled, loadoutRequestInFlightRef,
    };
    const options = new Function(...Object.keys(bindings), `return (${callbacks});`)(...Object.values(bindings)) as MutationObserverOptions<never, Error, object>;
    const error = new Error("Could not confirm the action");
    const mutation = new MutationObserver(client, { ...options, mutationFn: async () => { throw error; } });
    try {
      await expect(mutation.mutate({})).rejects.toBe(error);
      expect(showMutationToast).toHaveBeenCalledTimes(1);
      expect(showMutationToast).toHaveBeenCalledWith({ success: false, message: error.message, variant: "destructive" });
      expect(defaultError).not.toHaveBeenCalled();
      for (const cache of caches) {
        expect(client.getQueryData(cache.queryKey)).toBe("authoritative");
        expect(cache.queryFn).toHaveBeenCalledTimes(1);
      }
      expect(mutation.getCurrentResult().isPending).toBe(false);
      expect(onSettled).toHaveBeenCalledTimes(1);
      if (!isItem) expect(loadoutRequestInFlightRef.current).toBe(false);
    } finally {
      for (const cache of caches) cache.stop();
      client.clear();
    }
  });
}
