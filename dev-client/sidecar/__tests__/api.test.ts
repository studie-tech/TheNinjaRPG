import { expect, test } from "bun:test";
import superjson from "superjson";
import { GameApi, TrpcError } from "../api";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(respondWith: (url: string, init: RequestInit) => unknown): {
  fetchImpl: typeof fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? String(init.body)
          : undefined;
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body,
    });
    const payload = respondWith(url, init ?? {});
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// tRPC responses carry the superjson envelope as a JSON object.
const ok = (data: unknown) => [{ result: { data: superjson.serialize(data) } }];

test("mutations POST superjson input with the device token", async () => {
  const { fetchImpl, calls } = fakeFetch(() =>
    ok({ success: true, claimed: false, message: "none" }),
  );
  const api = new GameApi({
    getApiBase: () => "https://game.example.com/",
    getDeviceToken: () => "device-token-123",
    fetchImpl,
  });
  await api.claimNextJob("CLAUDE");

  expect(calls[0]?.url).toBe(
    "https://game.example.com/api/trpc/devContribution.claimNextJob",
  );
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.headers.authorization).toBe("Bearer device-token-123");
  expect(calls[0]?.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    json: { agent: "CLAUDE" },
  });
});

test("queries pass input via the query string", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ok({ success: true, jobs: [] }));
  const api = new GameApi({
    getApiBase: () => "https://game.example.com",
    getDeviceToken: () => null,
    fetchImpl,
  });
  const result = await api.getMyJobs(7);

  expect(calls[0]?.method).toBe("GET");
  expect(calls[0]?.url).toBe(
    `https://game.example.com/api/trpc/devContribution.getMyJobs?input=${encodeURIComponent(
      superjson.stringify({ limit: 7 }),
    )}`,
  );
  expect(calls[0]?.headers.authorization).toBeUndefined();
  expect(result.jobs).toEqual([]);
});

test("superjson payloads revive Dates on the way in", async () => {
  const { fetchImpl } = fakeFetch(() =>
    ok({
      success: true,
      jobs: [
        {
          id: 1,
          jobType: "PR_REVIEW",
          refKind: "PULL_REQUEST",
          refNumber: 7,
          refUrl: "https://github.com/studie-tech/TheNinjaRPG/pull/7",
          context: {},
          agent: "CLAUDE",
          claimedAt: new Date("2026-08-19T10:00:00Z"),
          heartbeatAt: null,
          staleThresholdMs: 600_000,
        },
      ],
    }),
  );
  const api = new GameApi({
    getApiBase: () => "https://game.example.com",
    getDeviceToken: () => null,
    fetchImpl,
  });
  const { jobs } = await api.getMyJobs();
  expect(jobs[0]?.claimedAt instanceof Date).toBe(true);
  expect(jobs[0]?.claimedAt?.toISOString()).toBe("2026-08-19T10:00:00.000Z");
});

test("tRPC error responses surface the server message", async () => {
  const { fetchImpl } = fakeFetch(() => [
    {
      error: {
        message: "Connect code is invalid, expired, or already used",
        data: { code: "UNAUTHORIZED", httpStatus: 401 },
      },
    },
  ]);
  const api = new GameApi({
    getApiBase: () => "https://game.example.com",
    getDeviceToken: () => null,
    fetchImpl,
  });
  let caught: unknown = null;
  try {
    await api.exchangeConnectCode({
      code: "c".repeat(40),
      codeVerifier: "v".repeat(40),
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TrpcError);
  expect((caught as TrpcError).message).toBe(
    "Connect code is invalid, expired, or already used",
  );
  expect((caught as TrpcError).code).toBe("UNAUTHORIZED");
});

test("non-JSON responses become a TrpcError", async () => {
  const fetchImpl = (async () =>
    new Response("gateway hiccup", { status: 502 })) as unknown as typeof fetch;
  const api = new GameApi({
    getApiBase: () => "https://game.example.com",
    getDeviceToken: () => null,
    fetchImpl,
  });
  await expect(api.getProfile()).rejects.toThrow(TrpcError);
});
