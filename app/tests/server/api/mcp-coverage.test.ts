import { describe, expect, it } from "bun:test";
import { appRouter } from "@/api/root";
import { extractToolsFromProcedures } from "@/libs/mcp/tools";

describe("main-game MCP registry", () => {
  it("can extract every registered game endpoint and its input schema", () => {
    const tools = extractToolsFromProcedures(appRouter);
    expect(tools.map((tool) => tool.pathInRouter.join(".")).sort()).toEqual(
      Object.keys(appRouter._def.procedures).sort(),
    );
    expect(tools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
    for (const path of [
      "towerDefense.getRunHistory",
      "gameAsset.getAllGameAssetContentTagNames",
      "paypal.resolveOrder",
    ]) {
      expect(tools.some((tool) => tool.pathInRouter.join(".") === path)).toBe(true);
    }
    expect(
      tools.find((tool) => tool.pathInRouter.join(".") === "gameAsset.getAll")
        ?.inputSchema?.properties,
    ).toHaveProperty("tags");
    expect(
      tools.find((tool) => tool.pathInRouter.join(".") === "poll.addOption")
        ?.inputSchema?.oneOf,
    ).toBeDefined();
    expect(
      tools.find((tool) => tool.pathInRouter.join(".") === "raids.getAvailableRaids")
        ?.inputSchema?.anyOf,
    ).toBeDefined();
    expect(
      tools.find((tool) => tool.pathInRouter.join(".") === "staff.pushBackupToDev")
        ?.isMutation,
    ).toBe(true);
  });
});
