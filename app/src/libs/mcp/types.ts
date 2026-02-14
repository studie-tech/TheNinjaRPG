import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type {
  AnyProcedure,
  inferProcedureOutput,
  MaybePromise,
} from "@trpc/server/unstable-core-do-not-import";
import type { z } from "zod";

/**
 * Function type for transforming procedure output to MCP content blocks.
 */
export type TransformMcpProcedureFunction = (
  output: inferProcedureOutput<AnyProcedure>,
) => MaybePromise<ContentBlock[]>;

/**
 * Metadata type for tRPC procedures to enable MCP exposure.
 */
export type McpMeta = {
  mcp?: {
    /** Whether this procedure should be exposed as an MCP tool */
    enabled?: boolean;
    /** Description for the MCP tool */
    description?: string;
    /** Custom name for the MCP tool (defaults to procedure path with dots replaced by underscores) */
    name?: string;
    /** Transform function to customize the MCP response */
    transformMcpProcedure?: TransformMcpProcedureFunction;
    /** Whether this is a mutation (write operation). Mutations require write scope. */
    isMutation?: boolean;
  };
};

/**
 * Internal representation of an extracted MCP tool from a tRPC procedure.
 */
export type McpTool = {
  /** Tool name exposed to MCP clients */
  name: string;
  /** Tool description */
  description: string;
  /** Path segments to navigate the tRPC router */
  pathInRouter: string[];
  /** JSON Schema for the tool's input parameters */
  inputSchema?: z.core.JSONSchema.JSONSchema;
  /** Optional transform function for the tool's output */
  transformMcpProcedure?: TransformMcpProcedureFunction;
  /** Whether this is a mutation (requires write scope) */
  isMutation: boolean;
};
