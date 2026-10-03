// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { appRouter } from "@/api/root";
import { extractToolsFromProcedures } from "@/libs/mcp/tools";

vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_PUSHER_APP_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_PUSHER_APP_CLUSTER", "us2");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

describe("main-game MCP registry", () => {
  it("can extract every registered game endpoint and its input schema", () => {
    const tools = extractToolsFromProcedures(appRouter);
    expect(tools.map((tool) => tool.pathInRouter.join(".")).sort()).toEqual(
      Object.keys(appRouter._def.procedures).sort(),
    );
    expect(tools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
    expect(tools.find((tool) => tool.pathInRouter.join(".") === "poll.addOption")?.inputSchema?.oneOf).toBeDefined();
    expect(tools.find((tool) => tool.pathInRouter.join(".") === "raids.getAvailableRaids")?.inputSchema?.anyOf).toBeDefined();
    expect(tools.find((tool) => tool.pathInRouter.join(".") === "staff.pushBackupToDev")?.isMutation).toBe(true);
  });
});
