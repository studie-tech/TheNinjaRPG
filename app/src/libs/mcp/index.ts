// Types

export type {
  ModelContextProtocolHandlerConfig,
  ModelContextProtocolHandlerOptions,
  ModelContextProtocolServerOptions,
} from "./handler";
// Handler
export { trpcToModelContextProtocolHandler } from "./handler";
export type { EndpointInfo, RouterInfo, ToolRegistry } from "./meta-tools";

// Meta-tools
export { buildToolRegistry, metaTools } from "./meta-tools";
// Tool extraction
export { extractToolsFromProcedures, mergeInputs } from "./tools";
export type {
  McpMeta,
  McpTool as ModelContextProtocolTool,
  TransformMcpProcedureFunction,
} from "./types";
