
import { describe, expect, it } from "bun:test";
import { extractToolsFromProcedures } from "@/libs/mcp/tools";

describe("main-game MCP registry", () => {
  it("can extract every registered game endpoint and its input schema", async () => {
    // Configure the environment before loading the router.
    const testEnvironment = {
      NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
      NEXT_PUBLIC_PUSHER_APP_CLUSTER: "us2",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
      UPSTASH_REDIS_REST_URL: "https://redis.example.test",
      UPSTASH_REDIS_REST_TOKEN: "test-token",
      OPENAI_API_KEY: "test-key",
    };
    const previousEnvironment = Object.fromEntries(
      Object.keys(testEnvironment).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, testEnvironment);
    try {
      const { appRouter } = await import("@/api/root");
      const tools = extractToolsFromProcedures(appRouter);
      expect(tools.map((tool) => tool.pathInRouter.join(".")).sort()).toEqual(
        Object.keys(appRouter._def.procedures).sort(),
      );
      expect(tools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
      expect(tools.find((tool) => tool.pathInRouter.join(".") === "poll.addOption")?.inputSchema?.oneOf).toBeDefined();
      expect(tools.find((tool) => tool.pathInRouter.join(".") === "raids.getAvailableRaids")?.inputSchema?.anyOf).toBeDefined();
      expect(tools.find((tool) => tool.pathInRouter.join(".") === "staff.pushBackupToDev")?.isMutation).toBe(true);
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
