import { describe, expect, it } from "bun:test";
import type { DrizzleClient } from "@/server/db";
import { createDefinitionCache } from "@/server/utils/definitionCache";
import { deferred } from "../../setup/deferred";

const client = {} as DrizzleClient;
const revision = (id: string, version = "current") => ({ id, revision: version });
const row = (id: string, version = "current") => ({
  definition: { id, effects: ["original"] },
  revision: version,
});

describe("definition cache concurrent reads", () => {
  it("shares a cold revision and gives every use a private copy", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    let selects = 0;
    const cache = createDefinitionCache({
      name: `definition-concurrent-${crypto.randomUUID()}`,
      memoryLimit: 10,
      select: async (_client, ids) => {
        selects++;
        started.resolve();
        await release.promise;
        return ids.map((id) => row(id));
      },
    });
    const first = cache.hydrate(client, [revision("blade")]);
    await started.promise;
    const second = cache.hydrate(client, [revision("blade")]);
    release.resolve();
    const [one, two] = await Promise.all([first, second]);
    expect(selects).toBe(1);
    const definition = one?.(revision("blade"));
    definition?.effects.push("private");
    expect(one?.(revision("blade"))?.effects).toEqual(["original"]);
    expect(two?.(revision("blade"))?.effects).toEqual(["original"]);
    const warm = await cache.hydrate(client, [revision("blade")]);
    expect(warm?.(revision("blade"))?.effects).toEqual(["original"]);
    expect(selects).toBe(1);
  });

  it("shares overlapping revisions while batching new misses", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const batches: string[][] = [];
    const cache = createDefinitionCache({
      name: `definition-overlap-${crypto.randomUUID()}`,
      memoryLimit: 10,
      select: async (_client, ids) => {
        batches.push(ids);
        started.resolve();
        await release.promise;
        return ids.map((id) => row(id));
      },
    });
    const first = cache.hydrate(client, [revision("a"), revision("b")]);
    await started.promise;
    const second = cache.hydrate(client, [revision("b"), revision("c"), revision("d")]);
    release.resolve();
    const [, resolve] = await Promise.all([first, second]);
    expect(batches).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(resolve?.(revision("b"))?.id).toBe("b");
    expect(resolve?.(revision("d"))?.id).toBe("d");
  });

  it("does not share a pending read across different revisions", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    let selects = 0;
    const cache = createDefinitionCache({
      name: `definition-edit-${crypto.randomUUID()}`,
      memoryLimit: 10,
      select: async () => {
        selects++;
        started.resolve();
        await release.promise;
        return [row("blade", "edited")];
      },
    });
    const old = cache.hydrate(client, [revision("blade")]);
    await started.promise;
    const edited = cache.hydrate(client, [revision("blade", "edited")]);
    release.resolve();
    const [stale, fresh] = await Promise.all([old, edited]);
    expect(stale).toBeUndefined();
    expect(fresh?.(revision("blade", "edited"))?.id).toBe("blade");
    expect(selects).toBe(2);
  });

  it.each(["deleted", "changed", "failed"])(
    "retries a shared %s read",
    async (outcome) => {
      const started = deferred<void>();
      const release = deferred<void>();
      let selects = 0;
      const cache = createDefinitionCache({
        name: `definition-retry-${crypto.randomUUID()}`,
        memoryLimit: 10,
        select: async () => {
          selects++;
          if (selects > 1) return [row("blade")];
          started.resolve();
          await release.promise;
          if (outcome === "failed") throw new Error("read failed");
          return outcome === "deleted" ? [] : [row("blade", "changed")];
        },
      });
      const first = cache.hydrate(client, [revision("blade")]);
      await started.promise;
      const second = cache.hydrate(client, [revision("blade")]);
      const results = Promise.allSettled([first, second]);
      release.resolve();
      for (const result of await results) {
        if (outcome === "failed") expect(result.status).toBe("rejected");
        else expect(result).toEqual({ status: "fulfilled", value: undefined });
      }
      expect(selects).toBe(1);
      const retry = await cache.hydrate(client, [revision("blade")]);
      expect(retry?.(revision("blade"))?.id).toBe("blade");
      expect(selects).toBe(2);
    },
  );
});
