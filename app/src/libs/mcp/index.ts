// Types

export type { McpHandlerConfig, McpHandlerOptions, McpServerOptions } from "./handler";
// Handler
export { trpcToMcpHandler } from "./handler";
export type { EndpointInfo, RouterInfo, ToolRegistry } from "./meta-tools";

// Meta-tools
export { buildToolRegistry, metaTools } from "./meta-tools";
// Tool extraction
export { extractToolsFromProcedures, mergeInputs } from "./tools";
export type { McpMeta, McpTool, TransformMcpProcedureFunction } from "./types";
