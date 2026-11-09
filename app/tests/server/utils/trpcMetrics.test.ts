import { describe, expect, it, mock } from "bun:test";
import type * as Sentry from "@sentry/nextjs";
import { measureTrpcCall } from "@/server/utils/trpcMetrics";

const recorder = () => ({
  count: mock<typeof Sentry.metrics.count>(() => {}),
  distribution: mock<typeof Sentry.metrics.distribution>(() => {}),
});

describe("generic tRPC load metrics", () => {
  it.each(["mutation", "query"])(
    "skips metrics but still executes an unsampled %s",
    async (type) => {
      const metrics = recorder();
      const next = mock(async () => ({ ok: true }));
      const random = mock(() => 0.02);
      expect(
        await measureTrpcCall({ path: "item.consume", type }, next, metrics, random),
      ).toEqual({ ok: true });
      expect(next).toHaveBeenCalledTimes(1);
      expect(random).toHaveBeenCalledTimes(1);
      expect(metrics.count).not.toHaveBeenCalled();
      expect(metrics.distribution).not.toHaveBeenCalled();
    },
  );

  it("samples each execution once before its outcome, retaining query counts and durations together", async () => {
    const metrics = recorder();
    const random = mock(() => 0.019999);
    const error = new Error("database unavailable");
    await expect(
      measureTrpcCall(
        { path: "profile.getUser", type: "query" },
        async () => {
          throw error;
        },
        metrics,
        random,
      ),
    ).rejects.toBe(error);
    expect(random).toHaveBeenCalledTimes(1);
    expect(metrics.count.mock.calls[0]?.[1]).toBe(50);
    expect(metrics.distribution.mock.calls[0]?.[2]?.attributes).toMatchObject({
      outcome: "error",
      sample_rate: 0.02,
    });
  });

  it("preserves unsampled errors and never samples subscriptions", async () => {
    const metrics = recorder();
    const error = new Error("database unavailable");
    await expect(
      measureTrpcCall(
        { path: "profile.getUser", type: "query" },
        async () => {
          throw error;
        },
        metrics,
        () => 0.5,
      ),
    ).rejects.toBe(error);
    const random = mock(() => 0);
    await measureTrpcCall(
      { path: "stream.events", type: "subscription" },
      async () => ({ ok: true }),
      metrics,
      random,
    );
    expect(random).not.toHaveBeenCalled();
    expect(metrics.count).not.toHaveBeenCalled();
    expect(metrics.distribution).not.toHaveBeenCalled();
  });

  it("counts mutations without putting arguments or results in attributes", async () => {
    const metrics = recorder();
    const result = { ok: true, data: { success: false, userId: "private" } };
    expect(
      await measureTrpcCall(
        { path: "item.consume", type: "mutation" },
        async () => result,
        metrics,
        () => 0,
      ),
    ).toBe(result);
    expect(metrics.count).toHaveBeenCalledWith("trpc.mutation", 50, {
      attributes: { procedure: "item.consume", sample_rate: 0.02 },
    });
    expect(metrics.distribution).not.toHaveBeenCalled();
  });

  it.each(["profile.getUser", "item.getUserItems", "combat.getBattle"])(
    "counts actual executions and wall time for %s",
    async (path) => {
      const metrics = recorder();
      await measureTrpcCall(
        {
          path,
          type: "query",
          attribution: { trigger: "invalidation", mutationContext: "item.consume" },
        },
        async () => ({ ok: true }),
        metrics,
        () => 0,
      );
      const attributes = {
        procedure: path,
        trigger: "invalidation",
        mutation_context: "item.consume",
        sample_rate: 0.02,
      };
      expect(metrics.count).toHaveBeenCalledWith("trpc.query.fetch", 50, {
        attributes,
      });
      expect(metrics.distribution).toHaveBeenCalledWith(
        "trpc.query.duration",
        expect.any(Number),
        {
          unit: "millisecond",
          attributes: { ...attributes, outcome: "success" },
        },
      );
      expect(metrics.distribution.mock.calls[0]![1]).toBeGreaterThanOrEqual(0);
    },
  );

  it("keeps older clients and direct callers visible without fabricating attribution", async () => {
    const metrics = recorder();
    await measureTrpcCall(
      { path: "profile.getUser", type: "query" },
      async () => ({ ok: false }),
      metrics,
      () => 0,
    );
    const attributes = {
      procedure: "profile.getUser",
      trigger: "unknown",
      mutation_context: "none",
      sample_rate: 0.02,
    };
    expect(metrics.count).toHaveBeenCalledWith("trpc.query.fetch", 50, { attributes });
    expect(metrics.distribution).toHaveBeenCalledWith(
      "trpc.query.duration",
      expect.any(Number),
      {
        unit: "millisecond",
        attributes: { ...attributes, outcome: "error" },
      },
    );
  });

  it("preserves the original exception when measuring failed database work", async () => {
    const metrics = recorder();
    const error = new Error("database unavailable");
    await expect(
      measureTrpcCall(
        { path: "profile.getUser", type: "query" },
        async () => {
          throw error;
        },
        metrics,
        () => 0,
      ),
    ).rejects.toBe(error);
    expect(metrics.count).toHaveBeenCalledTimes(1);
    expect(metrics.distribution).toHaveBeenCalledTimes(1);
  });

  it("isolates telemetry failures from mutations and queries", async () => {
    const metrics = {
      count: () => {
        throw new Error("telemetry");
      },
      distribution: () => {
        throw new Error("telemetry");
      },
    };
    for (const type of ["mutation", "query"]) {
      await expect(
        measureTrpcCall(
          { path: "item.consume", type },
          async () => ({ ok: true }),
          metrics,
          () => 0,
        ),
      ).resolves.toEqual({ ok: true });
    }
  });
});
