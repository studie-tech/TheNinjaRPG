import { describe, expect, it } from "bun:test";
import { after } from "next/server";
import { withAfterTasks } from "../../setup/after";
import { deferred } from "../../setup/deferred";

describe("direct router caller deferred work", () => {
  it("finishes callbacks and nested callbacks before returning to SQL assertions", async () => {
    const events: string[] = [];
    const caller = withAfterTasks({
      nested: {
        query: async () => {
          after(() => {
            events.push("after");
            after(() => {
              events.push("nested after");
            });
          });
          events.push("response");
          return "result";
        },
      },
    });
    expect(await caller.nested.query()).toBe("result");
    expect(events).toEqual(["response", "after", "nested after"]);
  });

  it("keeps callbacks scoped to each concurrent invocation", async () => {
    const events: string[] = [];
    const { promise: gate, resolve: release } = deferred<void>();
    const caller = withAfterTasks({
      query: async (id: string, wait: Promise<void>) => {
        after(() => {
          events.push(id);
        });
        await wait;
        return id;
      },
    });
    const first = caller.query("first", gate);
    expect(await caller.query("second", Promise.resolve())).toBe("second");
    expect(events).toEqual(["second"]);
    release();
    expect(await first).toBe("first");
    expect(events).toEqual(["second", "first"]);
  });
});
