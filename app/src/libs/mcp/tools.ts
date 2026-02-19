import type {
  AnyRootTypes,
  Router,
  RouterRecord,
} from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";
import type { McpMeta, ModelContextProtocolTool } from "./types";

/**
 * Merges multiple Zod object schemas into a single schema.
 * Used when a tRPC procedure has multiple input validators.
 */
export function mergeInputs(
  inputs: z.ZodObject<z.core.$ZodLooseShape>[],
): z.ZodObject<z.core.$ZodLooseShape, z.core.$strip> {
  return inputs.reduce((acc, input) => {
    return acc.extend(input.shape);
  }, z.object({}));
}

/**
 * Extracts MCP tools from a tRPC router by iterating through all procedures
 * and collecting those that have `meta.mcp.enabled` set to true.
 *
 * @param appRouter - The tRPC router to extract tools from
 * @param currentPath - Internal path tracking for nested routers
 * @returns Array of ModelContextProtocolTool objects
 */
export function extractToolsFromProcedures<
  TRoot extends AnyRootTypes,
  TRecord extends RouterRecord,
>(
  appRouter: Router<TRoot, TRecord>,
  currentPath: string[] = [],
): ModelContextProtocolTool[] {
  const tools: ModelContextProtocolTool[] = [];
  const procedures = Object.entries(appRouter._def.procedures);

  for (const [name, procedure] of procedures) {
    const proc = procedure as {
      _def?: {
        inputs?: z.ZodObject<z.core.$ZodLooseShape>[];
        meta?: McpMeta;
        type?: "query" | "mutation" | "subscription";
        mutation?: boolean;
      };
    };

    if (proc._def && "inputs" in proc._def) {
      const inputs = proc._def.inputs;
      const meta = proc._def.meta;

      // Skip procedures that don't have MCP enabled
      if (!meta?.mcp?.enabled) {
        continue;
      }

      const pathInRouter = [...currentPath, ...name.split(".")];

      // Detect if this is a mutation - check explicit meta first, then procedure type
      const isMutation =
        meta.mcp.isMutation !== undefined
          ? meta.mcp.isMutation
          : proc._def.type === "mutation" || proc._def.mutation === true;

      const tool: ModelContextProtocolTool = {
        name: meta.mcp.name ?? name.replace(/\./g, "_"),
        description: meta.mcp.description ?? "",
        pathInRouter,
        transformMcpProcedure: meta.mcp.transformMcpProcedure,
        isMutation,
      };

      // Build input schema from procedure inputs
      if (inputs && inputs.length > 0) {
        const schema = inputs.length > 1 ? mergeInputs(inputs) : inputs[0];
        if (schema) {
          const jsonSchema = z.toJSONSchema(schema, {
            unrepresentable: "any",
          });

          if (jsonSchema.type === "object") {
            const { type, properties = {}, required = [] } = jsonSchema;
            tool.inputSchema = { type, properties, required };
          } else {
            console.error("[MCP] Procedure has non-object schema:", pathInRouter);
          }
        }
      } else {
        // Procedure with no inputs gets an empty object schema
        tool.inputSchema = z.toJSONSchema(z.object({}));
      }

      tools.push(tool);
    }
  }

  return tools;
}
