import type { z } from "zod";
import type { McpTool, TransformMcpProcedureFunction } from "./types";

/**
 * Information about a router for discovery.
 */
export type RouterInfo = {
  name: string;
  endpointCount: number;
};

/**
 * Information about an endpoint for discovery.
 */
export type EndpointInfo = {
  name: string;
  description: string;
};

/**
 * Internal endpoint data stored in the registry.
 */
type EndpointData = {
  description: string;
  inputSchema?: z.core.JSONSchema.JSONSchema;
  pathInRouter: string[];
  transformMcpProcedure?: TransformMcpProcedureFunction;
  isMutation: boolean;
};

/**
 * Registry storing all endpoints grouped by router.
 */
export type ToolRegistry = {
  routers: Map<string, Map<string, EndpointData>>;
};

/**
 * Build a registry from extracted MCP tools.
 * Groups tools by router (first part of pathInRouter).
 */
export const buildToolRegistry = (tools: McpTool[]): ToolRegistry => {
  const routers = new Map<string, Map<string, EndpointData>>();

  for (const tool of tools) {
    const routerName = tool.pathInRouter[0];
    if (!routerName) continue;

    if (!routers.has(routerName)) {
      routers.set(routerName, new Map());
    }

    const endpointName = tool.pathInRouter.join(".");
    routers.get(routerName)?.set(endpointName, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      pathInRouter: tool.pathInRouter,
      transformMcpProcedure: tool.transformMcpProcedure,
      isMutation: tool.isMutation,
    });
  }

  return { routers };
};

/**
 * Meta-tool definitions for MCP discovery and invocation.
 */
export const metaTools = [
  {
    name: "listGameRouters",
    description:
      "List all available game API routers. Call this first to discover what's available.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "listRouterEndpoints",
    description: "List all endpoints for a specific router with their descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        routerName: {
          type: "string" as const,
          description: "Name of the router (from listGameRouters)",
        },
      },
      required: ["routerName"],
    },
  },
  {
    name: "getEndpointSchema",
    description: "Get the input schema for a specific endpoint.",
    inputSchema: {
      type: "object" as const,
      properties: {
        endpointName: {
          type: "string" as const,
          description: "Full endpoint name (e.g., 'profile.getPublicProfile')",
        },
      },
      required: ["endpointName"],
    },
  },
  {
    name: "callEndpoint",
    description: "Call a game API endpoint with the provided input data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        endpointName: {
          type: "string" as const,
          description: "Full endpoint name (e.g., 'profile.getPublicProfile')",
        },
        input: {
          type: "object" as const,
          description: "Input data matching the endpoint schema",
        },
      },
      required: ["endpointName"],
    },
  },
];

/**
 * Handle listGameRouters meta-tool call.
 */
export const handleListRouters = (registry: ToolRegistry) => {
  const routers: RouterInfo[] = [];

  for (const [name, endpoints] of registry.routers) {
    routers.push({
      name,
      endpointCount: endpoints.size,
    });
  }

  // Sort alphabetically for consistent output
  routers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    content: [{ type: "text" as const, text: JSON.stringify(routers, null, 2) }],
  };
};

/**
 * Handle listRouterEndpoints meta-tool call.
 */
export const handleListEndpoints = (registry: ToolRegistry, routerName: string) => {
  const routerEndpoints = registry.routers.get(routerName);

  if (!routerEndpoints) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Router not found: ${routerName}. Use listGameRouters to see available routers.`,
        },
      ],
    };
  }

  const endpoints: EndpointInfo[] = [];

  for (const [name, data] of routerEndpoints) {
    endpoints.push({
      name,
      description: data.description,
    });
  }

  // Sort alphabetically for consistent output
  endpoints.sort((a, b) => a.name.localeCompare(b.name));

  return {
    content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }],
  };
};

/**
 * Handle getEndpointSchema meta-tool call.
 */
export const handleGetSchema = (registry: ToolRegistry, endpointName: string) => {
  // Find the endpoint across all routers
  for (const [, endpoints] of registry.routers) {
    const endpoint = endpoints.get(endpointName);
    if (endpoint) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                endpointName,
                description: endpoint.description,
                inputSchema: endpoint.inputSchema ?? { type: "object", properties: {} },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `Endpoint not found: ${endpointName}. Use listRouterEndpoints to see available endpoints.`,
      },
    ],
  };
};

/** Explicit allowlist of scopes that authorize write operations */
const WRITE_SCOPES = ["profile:write", "write"];

/**
 * Check if the provided scopes allow write operations.
 * Uses explicit allowlist matching only - no substring matching.
 */
const hasWriteScope = (scopes: string[]): boolean => {
  return scopes.some((scope) => WRITE_SCOPES.includes(scope));
};

/**
 * Handle callEndpoint meta-tool call.
 * Creates a fresh caller for each request to ensure current auth context.
 */
export const handleCallEndpoint = async (
  registry: ToolRegistry,
  createCaller: () => Promise<unknown>,
  endpointName: string,
  input?: Record<string, unknown>,
  getScopes?: () => string[],
) => {
  // Find the endpoint across all routers
  let foundEndpoint: EndpointData | undefined;

  for (const [, endpoints] of registry.routers) {
    const endpoint = endpoints.get(endpointName);
    if (endpoint) {
      foundEndpoint = endpoint;
      break;
    }
  }

  if (!foundEndpoint) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Endpoint not found: ${endpointName}. Use listRouterEndpoints to see available endpoints.`,
        },
      ],
    };
  }

  // Check scope requirements for mutations
  if (foundEndpoint.isMutation && getScopes) {
    const scopes = getScopes();
    if (!hasWriteScope(scopes)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Insufficient permissions: ${endpointName} is a mutation and requires write scope. Current scopes: ${scopes.join(", ") || "none"}`,
          },
        ],
      };
    }
  }

  // Create a fresh caller for this request to get current auth context
  const trpcCaller = await createCaller();

  // Navigate the router to find the procedure
  const procedure = foundEndpoint.pathInRouter.reduce<unknown>(
    (acc, part) => (acc as Record<string, unknown>)?.[part],
    trpcCaller,
  );

  if (typeof procedure !== "function") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid procedure path: ${foundEndpoint.pathInRouter.join(".")}`,
        },
      ],
    };
  }

  try {
    if (typeof foundEndpoint.transformMcpProcedure === "function") {
      const output = await procedure(input);
      const result = await foundEndpoint.transformMcpProcedure(output);
      return { content: result };
    }

    const result = await procedure(input);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    // Sanitize error messages to avoid leaking sensitive information
    // Only expose tRPC error messages (which are user-facing) or generic errors
    const isTRPCError =
      error instanceof Error &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string";
    const message = isTRPCError
      ? (error as Error).message
      : "An error occurred while processing your request";

    return {
      content: [
        { type: "text" as const, text: `Error calling ${endpointName}: ${message}` },
      ],
    };
  }
};
