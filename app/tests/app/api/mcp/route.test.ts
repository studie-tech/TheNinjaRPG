import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { POST } from "@/app/api/mcp/[[...transport]]/route";

/** Answer the IP rate limiter's Upstash commands with an allowance; reject anything else. */
const stubUpstash = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(process.env.UPSTASH_REDIS_REST_URL ?? "")) {
      throw new Error(`Unexpected external request: ${url}`);
    }
    const commands = JSON.parse(String(init?.body)) as unknown[];
    const resultFor = (command: unknown[]) => ({
      result: command[0] === "evalsha" || command[0] === "eval" ? [29, 30] : 1,
    });
    return Response.json(
      Array.isArray(commands[0])
        ? commands.map((command) => resultFor(command as unknown[]))
        : resultFor(commands),
    );
  });

beforeEach(() => {
  stubUpstash();
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("answers an invalid bearer token with 401 without reporting it", async () => {
  const response = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer not-a-jwt",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeTruthy();
  expect(Sentry.captureException).not.toHaveBeenCalled();
});
