import { describe, expect, it, vi } from "bun:test";
import { initTRPC, TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm";
import { z } from "zod";
import { buildToolRegistry, handleCallEndpoint } from "@/libs/mcp/meta-tools";
import { extractToolsFromProcedures } from "@/libs/mcp/tools";
import type { McpMeta } from "@/libs/mcp/types";
import { DATABASE_FAILURE_MESSAGE } from "@/server/utils/mysqlErrors";
import { idSchema } from "@/validators/misc";

const firstText = (result: Awaited<ReturnType<typeof handleCallEndpoint>>) => {
  const block = result.content[0];
  return block && "text" in block ? block.text : undefined;
};

const t = initTRPC.context<{ isStaff: boolean }>().meta<McpMeta>().create();
const staffProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isStaff) throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

const write = vi.fn(() => ({ success: true }));
const router = t.router({
  profile: t.router({
    read: t.procedure.query(() => ({ username: "ninja" })),
    update: t.procedure.input(idSchema).mutation(write),
    filtered: t.procedure
      .input(z.object({ search: z.string().optional() }))
      .query(({ input }) => ({ filtered: input })),
    described: t.procedure
      .meta({ mcp: { description: "A custom description" } })
      .query(() => ({ success: true })),
    broken: t.procedure.query(() => {
      throw new DrizzleQueryError(
        "select secret",
        ["secret"],
        new TypeError("fetch failed"),
      );
    }),
  }),
  staff: t.router({ update: staffProcedure.input(idSchema).mutation(write) }),
});

const tools = extractToolsFromProcedures(router);
const registry = buildToolRegistry(tools);
const toolAt = (path: string) =>
  tools.find((tool) => tool.pathInRouter.join(".") === path);
const call = (endpointName: string, input?: Record<string, unknown>, isStaff = false) =>
  handleCallEndpoint(
    registry,
    async () => router.createCaller({ isStaff }),
    endpointName,
    () => [],
    () => true,
    input,
  );

describe("universal MCP exposure", () => {
  it("discovers nested queries and mutations without opt-in metadata", () => {
    expect(tools.map((tool) => tool.pathInRouter.join(".")).sort()).toEqual(
      Object.keys(router._def.procedures).sort(),
    );
    expect(toolAt("profile.read")?.isMutation).toBe(false);
    expect(toolAt("profile.update")?.isMutation).toBe(true);
    expect(toolAt("profile.update")?.inputSchema.required).toEqual(["id"]);
  });

  it("keeps custom descriptions", () => {
    expect(toolAt("profile.described")?.description).toBe("A custom description");
  });

  it("invokes newly exposed queries and validated mutations", async () => {
    expect(firstText(await call("profile.read"))).toContain("ninja");
    expect(firstText(await call("profile.update", { id: "ninja" }))).toContain("true");
  });

  it("sends an empty object when input is omitted for an object schema", async () => {
    expect(firstText(await call("profile.filtered"))).toContain('"filtered":{}');
    expect(firstText(await call("profile.update"))).toContain(
      "Missing required fields",
    );
  });

  it("still enforces procedure authorization and input validation before writes", async () => {
    write.mockClear();
    expect(firstText(await call("staff.update", { id: "ninja" }))).toContain(
      "FORBIDDEN",
    );
    expect(firstText(await call("profile.update", { id: 123 }))).toContain(
      "Error calling",
    );
    expect(firstText(await call("profile.update", {}))).toContain(
      "Missing required fields",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps a failed statement out of the tool result", async () => {
    expect(firstText(await call("profile.broken"))).toBe(
      `Error calling profile.broken: ${DATABASE_FAILURE_MESSAGE}`,
    );
  });

  it("blocks unauthenticated mutations before creating a caller", async () => {
    const createCaller = vi.fn(async () => router.createCaller({ isStaff: false }));
    const result = await handleCallEndpoint(
      registry,
      createCaller,
      "profile.update",
      () => [],
      () => false,
      { id: "ninja" },
    );
    expect(firstText(result)).toContain("Insufficient permissions");
    expect(createCaller).not.toHaveBeenCalled();
  });
});
