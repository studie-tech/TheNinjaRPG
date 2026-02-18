import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer as ModelContextProtocolServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { isPlainObject } from "@/utils/typeutils";
import {
  buildToolRegistry,
  handleCallEndpoint,
  handleGetSchema,
  handleListEndpoints,
  handleListRouters,
  metaTools,
  parseResponseFilters,
} from "./meta-tools";
import { extractToolsFromProcedures } from "./tools";

type ModelContextProtocolServerOptions = ServerOptions & {
  serverInfo?: {
    name: string;
    version: string;
  };
};

/**
 * Configuration for the MCP handler (from mcp-handler).
 */
type ModelContextProtocolHandlerConfig = {
  redisUrl?: string;
  streamableHttpEndpoint?: string;
  sseEndpoint?: string;
  sseMessageEndpoint?: string;
  maxDuration?: number;
  verboseLogs?: boolean;
  basePath?: string;
  disableSse?: boolean;
};

type ModelContextProtocolHandlerOptions = {
  config: ModelContextProtocolHandlerConfig;
  serverOptions?: ModelContextProtocolServerOptions;
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
  modelContextProtocolServer: ModelContextProtocolServer,
  tools: ReturnType<typeof extractToolsFromProcedures>,
  createTrpcCaller: () => Promise<unknown>,
  getScopes?: () => string[],
) => {
  // Build registry from all extracted tools
  const registry = buildToolRegistry(tools);

  console.log(
    `[MCP] Built registry with ${registry.routers.size} routers and ${tools.length} total endpoints`,
  );

  // Access the underlying Server instance for setRequestHandler
  const underlyingServer = modelContextProtocolServer.server;

  // Return only the 4 meta-tools
  underlyingServer.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: metaTools,
  }));

  // Handle meta-tool calls
  underlyingServer.setRequestHandler(
    CallToolRequestSchema,
    async (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => {
      const { name, arguments: procedureArguments } = request.params;

      switch (name) {
        case "listGameRouters":
          return handleListRouters(registry);

        case "listRouterEndpoints": {
          const routerName = procedureArguments?.routerName;
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
          const endpointName = procedureArguments?.endpointName;
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
          const endpointName = procedureArguments?.endpointName;
          if (typeof endpointName !== "string" || !endpointName) {
            return {
              content: [
                { type: "text", text: "Missing required argument: endpointName" },
              ],
            };
          }
          const filters = parseResponseFilters(procedureArguments);
          // Validate input type guard: ensure input is an object if provided
          const input = procedureArguments?.input;
          if (input !== undefined && !isPlainObject(input)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Invalid input: expected an object or undefined",
                },
              ],
            };
          }
          return handleCallEndpoint(
            registry,
            createTrpcCaller,
            endpointName,
            getScopes,
            input as Record<string, unknown> | undefined,
            filters,
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
 * @param context - The context or context factory for creating tRPC callers
 * @param handlerOptions - Configuration options for the handler
 * @returns A request handler function compatible with Vercel/Next.js
 */
export const trpcToModelContextProtocolHandler = <
  TRoot extends AnyRootTypes,
  TRecord extends RouterRecord,
>(
  appRouter: Router<TRoot, TRecord>,
  context: TRoot["ctx"] | (() => MaybePromise<TRoot["ctx"]>),
  handlerOptions: ModelContextProtocolHandlerOptions,
): ((request: Request) => Promise<Response>) => {
  const { serverOptions, config, getScopes } = handlerOptions;

  // Extract tools once at startup
  const tools = extractToolsFromProcedures(appRouter);

  // Create the caller factory - this will be called for each request
  // to ensure the context is resolved with current auth state
  const createTrpcCaller = async () => {
    const resolvedContext =
      typeof context === "function"
        ? await (context as () => MaybePromise<TRoot["ctx"]>)()
        : context;
    return appRouter.createCaller(resolvedContext);
  };

  const handler = createMcpHandler(
    (server) => {
      // Pass the factory function, not a pre-created caller
      setRequestHandler(server, tools, createTrpcCaller, getScopes);
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

export type {
  ModelContextProtocolHandlerConfig,
  ModelContextProtocolServerOptions,
  ModelContextProtocolHandlerOptions,
};
