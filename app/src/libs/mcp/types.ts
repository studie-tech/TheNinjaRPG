import type { z } from "zod";

/**
 * Metadata type for customizing tRPC procedures exposed through MCP.
 */
export type McpMeta = {
  mcp?: {
    /** Description for the MCP tool */
    description?: string;
  };
};

/**
 * Internal representation of an extracted MCP tool from a tRPC procedure.
 */
export type ModelContextProtocolTool = {
  /** Tool description */
  description: string;
  /** Path segments to navigate the tRPC router */
  pathInRouter: string[];
  /** JSON Schema for the tool's input parameters */
  inputSchema: z.core.JSONSchema.JSONSchema;
  /** Whether this is a mutation (requires write scope) */
  isMutation: boolean;
};
