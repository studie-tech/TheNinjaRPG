import { describe, expect, it } from "bun:test";
import { createSerialQueue } from "@/utils/async";

describe("createSerialQueue", () => {
  it("runs each operation after the previous one settles", async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    let releaseFirst = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

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
