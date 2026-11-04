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
 * All game procedures are exposed; metadata customizes descriptions.
 *
 * @param appRouter - The tRPC router to extract tools from
 * @returns Array of ModelContextProtocolTool objects
 */
export function extractToolsFromProcedures<
  TRoot extends AnyRootTypes,
  TRecord extends RouterRecord,
>(appRouter: Router<TRoot, TRecord>): ModelContextProtocolTool[] {
  const tools: ModelContextProtocolTool[] = [];
  const procedures = Object.entries(appRouter._def.procedures);

  for (const [name, procedure] of procedures) {
    const proc = procedure as {
      _def?: {
        inputs?: z.ZodObject<z.core.$ZodLooseShape>[];
        meta?: McpMeta;
        type?: "query" | "mutation" | "subscription";
      };
    };

    if (proc._def && "inputs" in proc._def) {
      const inputs = proc._def.inputs;
      const meta = proc._def.meta;

      // Procedures without inputs get an empty object schema. A single input keeps
      // its own schema so unions, nullable inputs and references survive discovery;
      // the tRPC caller remains responsible for validating the original schema.
      const [first, ...rest] = inputs ?? [];
      const schema = !first
        ? z.object({})
        : rest.length > 0
          ? mergeInputs([first, ...rest])
          : first;

      tools.push({
        description:
          meta?.mcp?.description ?? `${proc._def.type ?? "procedure"} ${name}`,
        pathInRouter: name.split("."),
        inputSchema: z.toJSONSchema(schema, { unrepresentable: "any" }),
        isMutation: proc._def.type === "mutation",
      });
    }
  }

  return tools;
}
