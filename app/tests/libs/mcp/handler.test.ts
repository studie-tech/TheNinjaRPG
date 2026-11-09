import { describe, expect, it } from "bun:test";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { trpcToModelContextProtocolHandler } from "@/libs/mcp/handler";
import type { McpMeta } from "@/libs/mcp/types";

describe("MCP HTTP transport", () => {
  it("negotiates a legacy client, exposes discovery and resolves fresh tRPC context", async () => {
    const trpc = initTRPC.context<{ request: number }>().meta<McpMeta>().create();
    const router = trpc.router({
      game: trpc.router({
        greet: trpc.procedure
          .input(z.object({ name: z.string() }))
          .query(({ input, ctx }) => ({ greeting: input.name, request: ctx.request })),
      }),
    });
    let request = 0;
    const handler = trpcToModelContextProtocolHandler(
      router,
      () => ({ request: ++request }),
      { config: {}, getIsAuthenticated: () => true },
    );
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await handler(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-06-18",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.text();
      const event = body.split("\n").find((line) => line.startsWith("data:"));
      return JSON.parse(event ? event.slice(5) : body);
    };
    const initialized = await call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "compatibility-test", version: "1.0.0" },
    });
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    const discovery = await call("tools/list", {});
    expect(discovery.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "listGameRouters",
      "listRouterEndpoints",
      "getEndpointSchema",
      "callEndpoint",
    ]);
    for (const expected of [1, 2]) {
      const result = await call("tools/call", {
        name: "callEndpoint",
        arguments: { endpointName: "game.greet", input: { name: "ninja" } },
      });
      expect(result.error).toBeUndefined();
      expect(JSON.parse(result.result.content[0].text)).toEqual({
        greeting: "ninja",
        request: expected,
      });
    }
  });
});
