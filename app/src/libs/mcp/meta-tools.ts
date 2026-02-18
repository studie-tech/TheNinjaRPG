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
    description:
      "Call a game API endpoint with the provided input data. Supports optional response filtering to reduce output size.",
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
        select: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Dot-notation paths to extract from the response (e.g., ['userData.username', 'userData.level']). Use * as wildcard for array elements (e.g., 'usersState.*.curHealth'). Returns a flat key-value map of selected paths.",
        },
        search: {
          type: "string" as const,
          description:
            "Case-insensitive text pattern to filter the response. Only returns parts of the response where keys or string values contain this pattern.",
        },
        maxLength: {
          type: "number" as const,
          description:
            "Maximum character length of the JSON response. Response is truncated with an indicator if exceeded.",
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

/**
 * Optional filters applied to callEndpoint responses to reduce output size.
 */
export type ResponseFilters = {
  select?: string[];
  search?: string;
  maxLength?: number;
};

/**
 * Traverse a nested object/array following dot-notation path segments.
 * The `*` wildcard maps over array elements (or object values).
 */
const getValueAtPath = (obj: unknown, parts: string[]): unknown => {
  let current: unknown = obj;

  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) return undefined;

    const part = parts[i];
    if (part === undefined) return undefined;

    if (part === "*") {
      const remaining = parts.slice(i + 1);
      const items = Array.isArray(current)
        ? current
        : typeof current === "object" && current !== null
          ? Object.values(current as Record<string, unknown>)
          : undefined;
      if (!items) return undefined;
      if (remaining.length === 0) return items;
      return items
        .map((item) => getValueAtPath(item, remaining))
        .filter((v) => v !== undefined);
    }

    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
};

/**
 * Extract specific dot-notation paths from a response object.
 * Returns a flat key-value map where keys are the requested paths.
 */
const selectFields = (obj: unknown, paths: string[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getValueAtPath(obj, path.split("."));
    if (value !== undefined) {
      result[path] = value;
    }
  }
  return result;
};

/**
 * Recursively filter a JSON value to only include subtrees where
 * keys or string values contain the pattern (case-insensitive).
 */
const searchObject = (obj: unknown, pattern: string): unknown => {
  if (obj === null || obj === undefined) return undefined;

  const lowerPattern = pattern.toLowerCase();

  if (typeof obj === "string") {
    return obj.toLowerCase().includes(lowerPattern) ? obj : undefined;
  }
  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj).toLowerCase().includes(lowerPattern) ? obj : undefined;
  }

  if (Array.isArray(obj)) {
    const filtered = obj
      .map((item) => searchObject(item, pattern))
      .filter((item) => item !== undefined);
    return filtered.length > 0 ? filtered : undefined;
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    let hasMatch = false;

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.toLowerCase().includes(lowerPattern)) {
        result[key] = value;
        hasMatch = true;
        continue;
      }
      const filtered = searchObject(value, pattern);
      if (filtered !== undefined) {
        result[key] = filtered;
        hasMatch = true;
      }
    }

    return hasMatch ? result : undefined;
  }

  return undefined;
};

/**
 * Truncate a string to maxLength, appending a truncation indicator.
 */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  const remaining = text.length - maxLength;
  return `${text.slice(0, maxLength)}...[truncated, ${remaining} more chars]`;
};

/**
 * Apply response filters (select, search, maxLength) to a raw result
 * and return the final JSON text.
 */
const applyFilters = (result: unknown, filters?: ResponseFilters): string => {
  let data = result;

  if (filters?.select && filters.select.length > 0) {
    data = selectFields(data, filters.select);
  }

  if (filters?.search) {
    const searched = searchObject(data, filters.search);
    data = searched !== undefined ? searched : {};
  }

  let text = JSON.stringify(data);

  if (filters?.maxLength && text.length > filters.maxLength) {
    text = truncateText(text, filters.maxLength);
  }

  return text;
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
  filters?: ResponseFilters,
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

      if (filters?.maxLength) {
        return {
          content: result.map((block) => {
            if ("text" in block && typeof block.text === "string") {
              return {
                ...block,
                text: truncateText(block.text, filters.maxLength ?? 0),
              };
            }
            return block;
          }),
        };
      }

      return { content: result };
    }

    const result = await procedure(input);
    const text = applyFilters(result, filters);
    return {
      content: [{ type: "text" as const, text }],
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
