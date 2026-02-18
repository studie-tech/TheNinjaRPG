import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  AnyRootTypes,
  MaybePromise,
  Router,
  RouterRecord,
} from "@trpc/server/unstable-core-do-not-import";
import { createMcpHandler } from "mcp-handler";
import {
  buildToolRegistry,
  handleCallEndpoint,
  handleGetSchema,
  handleListEndpoints,
  handleListRouters,
  metaTools,
  type ResponseFilters,
} from "./meta-tools";
import { extractToolsFromProcedures } from "./tools";

type McpServerOptions = ServerOptions & {
  serverInfo?: {
    name: string;
    version: string;
  };
};

/**
 * Configuration for the MCP handler (from mcp-handler).
 */
type McpHandlerConfig = {
  redisUrl?: string;
  streamableHttpEndpoint?: string;
  sseEndpoint?: string;
  sseMessageEndpoint?: string;
  maxDuration?: number;
  verboseLogs?: boolean;
  basePath?: string;
  disableSse?: boolean;
};

type McpHandlerOptions = {
  config: McpHandlerConfig;
  serverOptions?: McpServerOptions;
  /** Function to get current OAuth scopes for authorization checks */
  getScopes?: () => string[];
};

/**
 * Sets up MCP request handlers on the server using meta-tools for discovery and invocation.
 *
 * Instead of exposing individual tools (which can number in the hundreds), we expose
 * 4 meta-tools that allow AI clients to:
 * 1. List available routers
 * 2. List endpoints for a router
 * 3. Get the schema for an endpoint
 * 4. Call an endpoint
 *
 * @param server - The underlying MCP Server instance
 * @param tools - Array of extracted MCP tools (used to build the registry)
 * @param createCaller - Factory function to create a fresh tRPC caller for each request
 * @param getScopes - Optional function to get current OAuth scopes for authorization
 */
const setRequestHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  tools: ReturnType<typeof extractToolsFromProcedures>,
  createCaller: () => Promise<unknown>,
  getScopes?: () => string[],
) => {
  // Build registry from all extracted tools
  const registry = buildToolRegistry(tools);

  console.log(
    `[MCP] Built registry with ${registry.routers.size} routers and ${tools.length} total endpoints`,
  );

  // Return only the 4 meta-tools
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: metaTools,
  }));

  // Handle meta-tool calls
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "listGameRouters":
          return handleListRouters(registry);

        case "listRouterEndpoints": {
          const routerName = args?.routerName;
          if (typeof routerName !== "string" || !routerName) {
            return {
              content: [
                { type: "text", text: "Missing required argument: routerName" },
              ],
            };
          }
          return handleListEndpoints(registry, routerName);
        }

        case "getEndpointSchema": {
          const endpointName = args?.endpointName;
          if (typeof endpointName !== "string" || !endpointName) {
            return {
              content: [
                { type: "text", text: "Missing required argument: endpointName" },
              ],
            };
          }
          return handleGetSchema(registry, endpointName);
        }

        case "callEndpoint": {
          const endpointName = args?.endpointName;
          if (typeof endpointName !== "string" || !endpointName) {
            return {
              content: [
                { type: "text", text: "Missing required argument: endpointName" },
              ],
            };
          }
          const filters: ResponseFilters = {};
          if (Array.isArray(args?.select)) {
            filters.select = args.select.filter(
              (s): s is string => typeof s === "string",
            );
          }
          if (typeof args?.search === "string" && args.search) {
            filters.search = args.search;
          }
          if (typeof args?.maxLength === "number" && args.maxLength > 0) {
            filters.maxLength = args.maxLength;
          }
          const hasFilters = filters.select || filters.search || filters.maxLength;
          return handleCallEndpoint(
            registry,
            createCaller,
            endpointName,
            args?.input as Record<string, unknown> | undefined,
            getScopes,
            hasFilters ? filters : undefined,
          );
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
          };
      }
    },
  );
};

/**
 * Creates an MCP handler that bridges tRPC procedures to MCP tools.
 *
 * @param appRouter - The tRPC router containing procedures to expose
 * @param ctx - The context or context factory for creating tRPC callers
 * @param handlerOptions - Configuration options for the handler
 * @returns A request handler function compatible with Vercel/Next.js
 */
export const trpcToMcpHandler = <
  TRoot extends AnyRootTypes,
  TRecord extends RouterRecord,
>(
  appRouter: Router<TRoot, TRecord>,
  ctx: TRoot["ctx"] | (() => MaybePromise<TRoot["ctx"]>),
  handlerOptions: McpHandlerOptions,
): ((request: Request) => Promise<Response>) => {
  const { serverOptions, config, getScopes } = handlerOptions;

  // Extract tools once at startup
  const tools = extractToolsFromProcedures(appRouter);

  // Create the caller factory - this will be called for each request
  // to ensure the context is resolved with current auth state
  const createCaller = async () => {
    const resolvedCtx =
      typeof ctx === "function"
        ? await (ctx as () => MaybePromise<TRoot["ctx"]>)()
        : ctx;
    return appRouter.createCaller(resolvedCtx);
  };

  const handler = createMcpHandler(
    (server) => {
      // Pass the factory function, not a pre-created caller
      setRequestHandler(server.server, tools, createCaller, getScopes);
    },
    {
      capabilities: {
        tools: {},
      },
      ...serverOptions,
    },
    config,
  );

  return handler;
};

export type { McpHandlerConfig, McpServerOptions, McpHandlerOptions };
