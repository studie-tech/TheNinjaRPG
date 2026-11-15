import { describe, expect, it } from "bun:test";
import { createModuleLoader, createSerialQueue } from "@/utils/async";
import { deferred } from "../setup/deferred";

describe("createSerialQueue", () => {
  it("runs each operation after the previous one settles", async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    const { promise: gate, resolve: releaseFirst } = deferred<void>();

    const first = enqueue(async () => {
      await gate;
      order.push("first");
    });
    const second = enqueue(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("rejects only the failing caller and keeps the queue moving", async () => {
    const enqueue = createSerialQueue();

    const failed = enqueue(async () => {
      throw new Error("rejected");
    });
    const next = enqueue(async () => "next");

    await expect(failed).rejects.toThrow("rejected");
    await expect(next).resolves.toBe("next");
  });
});

describe("createModuleLoader", () => {
  it("shares one import and marks it fulfilled for use() once it loads", async () => {
    let imports = 0;
    const load = createModuleLoader(async () => {
      imports++;
      return { default: "module" };
    });

    const first = load();
    expect(load()).toBe(first);
    expect(first.status).toBeUndefined();
    await first;
    await Promise.resolve();
    expect(first).toMatchObject({ status: "fulfilled", value: { default: "module" } });
    expect(load()).toBe(first);
    expect(imports).toBe(1);
  });

  it("retries an import that failed", async () => {
    const outcomes = [deferred<string>(), deferred<string>()];
    let call = 0;
    const load = createModuleLoader(() => outcomes[call++]!.promise);

    const failed = load();
    outcomes[0]!.reject(new Error("chunk missing"));
    await expect(failed).rejects.toThrow("chunk missing");
    const retried = load();
    expect(retried).not.toBe(failed);
    outcomes[1]!.resolve("loaded");
    await expect(retried).resolves.toBe("loaded");
  });
});
