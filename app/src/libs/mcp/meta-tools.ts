import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
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
 * Parse and validate response filters from raw arguments.
 * Extracts select, search, and maxLength filters and returns undefined if none are present.
 */
export const parseResponseFilters = (
  procedureArguments?: Record<string, unknown>,
): ResponseFilters | undefined => {
  const filters: ResponseFilters = {};

  if (Array.isArray(procedureArguments?.select)) {
    filters.select = procedureArguments.select.filter(
      (s): s is string => typeof s === "string",
    );
  }

  if (typeof procedureArguments?.search === "string" && procedureArguments.search) {
    filters.search = procedureArguments.search;
  }

  if (
    typeof procedureArguments?.maxLength === "number" &&
    procedureArguments.maxLength > 0
  ) {
    filters.maxLength = procedureArguments.maxLength;
  }

  const hasFilters = filters.select || filters.search || filters.maxLength;
  return hasFilters ? filters : undefined;
};

/**
 * Traverse a nested object/array following dot-notation path segments.
 * The `*` wildcard maps over array elements (or object values).
 */
const getValueAtPath = (object: unknown, parts: string[]): unknown => {
  let current: unknown = object;

  for (let index = 0; index < parts.length; index++) {
    if (current === null || current === undefined) return undefined;

    const pathSegment = parts[index];
    if (pathSegment === undefined) return undefined;

    // Wildcard expansion: When encountering "*", expand it to map over array elements or object values.
    // The remaining path segments are applied to each expanded item, and undefined results are filtered out.
    if (pathSegment === "*") {
      const remaining = parts.slice(index + 1);
      const items = Array.isArray(current)
        ? current
        : typeof current === "object" && current !== null
          ? Object.values(current as Record<string, unknown>)
          : undefined;
      if (!items) return undefined;
      // If no remaining path, return the expanded items directly
      if (remaining.length === 0) return items;
      // Otherwise, recursively apply remaining path to each item and filter out undefined results
      return items
        .map((expandedItem) => getValueAtPath(expandedItem, remaining))
        .filter((filteredValue) => filteredValue !== undefined);
    }

    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[pathSegment];
  }

  return current;
};

/**
 * Extract specific dot-notation paths from a response object.
 * Returns a flat key-value map where keys are the requested paths.
 */
const selectFields = (object: unknown, paths: string[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getValueAtPath(object, path.split("."));
    if (value !== undefined) {
      result[path] = value;
    }
  }
  return result;
};

/**
 * Recursively filter a JSON value to only include subtrees where
 * keys or string values contain the pattern (case-insensitive).
 *
 * Filtering algorithm behavior:
 * - For primitives (string/number/boolean): Include if the value contains the pattern
 * - For arrays: Recursively filter each element and include the array if any elements match
 * - For objects: Include a key-value pair if either:
 *   1. The key name contains the pattern (includes the entire value regardless of nested matches)
 *   2. The value contains matches when recursively filtered (only includes matching subtree)
 * - Returns undefined if no matches found at any level, preserving the nested structure for matches
 */
const searchObject = (value: unknown, pattern: string): unknown => {
  const lowerPattern = pattern.toLowerCase();

  if (value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    return value.toLowerCase().includes(lowerPattern) ? value : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(lowerPattern) ? value : undefined;
  }

  if (Array.isArray(value)) {
    const filtered = value
      .map((arrayElement) => searchObject(arrayElement, pattern))
      .filter((filteredElement) => filteredElement !== undefined);
    return filtered.length > 0 ? filtered : undefined;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    let hasMatch = false;

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase().includes(lowerPattern)) {
        result[key] = nestedValue;
        hasMatch = true;
        continue;
      }
      const filtered = searchObject(nestedValue, pattern);
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
 * Apply maxLength truncation to content blocks with text fields.
 */
const truncateResultBlocks = (
  blocks: Array<{ type: string; text?: string }>,
  maxLength: number,
): Array<{ type: string; text?: string }> => {
  return blocks.map((block) => {
    if ("text" in block && typeof block.text === "string") {
      return {
        ...block,
        text: truncateText(block.text, maxLength),
      };
    }
    return block;
  });
};

/**
 * Apply response filters (select, search, maxLength) to a raw result
 * and return the final JSON text.
 */
const applyFilters = (result: unknown, filters?: ResponseFilters): string => {
  let data = result;

  // Normalize undefined to empty object to prevent JSON.stringify returning undefined
  if (data === undefined) {
    data = {};
  }

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
 * Find endpoint in registry across all routers.
 */
const findEndpoint = (
  registry: ToolRegistry,
  endpointName: string,
): EndpointData | undefined => {
  for (const [, endpoints] of registry.routers) {
    const endpoint = endpoints.get(endpointName);
    if (endpoint) {
      return endpoint;
    }
  }
  return undefined;
};

/**
 * Check if user has required scope for the endpoint.
 * Returns error response if unauthorized, undefined if authorized.
 */
const checkEndpointAuthorization = (
  endpoint: EndpointData,
  endpointName: string,
  getScopes?: () => string[],
) => {
  if (endpoint.isMutation && getScopes) {
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
  return undefined;
};

/**
 * Resolve tRPC procedure from caller using endpoint path.
 */
const resolveProcedure = (trpcCaller: unknown, pathInRouter: string[]): unknown => {
  return pathInRouter.reduce<unknown>(
    (accumulator, routerSegment) =>
      (accumulator as Record<string, unknown>)?.[routerSegment],
    trpcCaller,
  );
};

/**
 * Handle transformed endpoint response with filters.
 */
const handleTransformedResponse = async (
  output: unknown,
  transformFunction: TransformMcpProcedureFunction,
  filters?: ResponseFilters,
) => {
  const result = await transformFunction(output);

  // Check if select/search filters are requested but can't be applied to transformed text content
  const hasUnsupportedFilters =
    (filters?.select && filters.select.length > 0) || filters?.search;

  if (hasUnsupportedFilters) {
    // Return warning about filter limitations for transformed endpoints
    const warning = [
      "Warning: select and search filters cannot be applied to transformed endpoint responses.",
      "Only maxLength truncation is supported for these endpoints.",
      "---",
    ].join("\n");

    const contentWithWarning = [{ type: "text" as const, text: warning }, ...result];

    if (filters?.maxLength) {
      return {
        content: truncateResultBlocks(contentWithWarning, filters.maxLength),
      };
    }

    return { content: contentWithWarning };
  }

  if (filters?.maxLength) {
    return {
      content: truncateResultBlocks(result, filters.maxLength),
    };
  }

  return { content: result };
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
  const foundEndpoint = findEndpoint(registry, endpointName);

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

  const authError = checkEndpointAuthorization(foundEndpoint, endpointName, getScopes);
  if (authError) {
    return authError;
  }

  const trpcCaller = await createCaller();
  const procedure = resolveProcedure(trpcCaller, foundEndpoint.pathInRouter);

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
      return handleTransformedResponse(
        output,
        foundEndpoint.transformMcpProcedure,
        filters,
      );
    }

    const result = await procedure(input);
    const text = applyFilters(result, filters);
    return {
      content: [{ type: "text" as const, text }],
    };
  } catch (error) {
    // Sanitize error messages to avoid leaking sensitive information
    // Only expose tRPC error messages (which are user-facing) or generic errors
    const isTRPCError = error instanceof TRPCError;
    const message = isTRPCError
      ? (error as Error).message
      : "An error occurred while processing your request";

    // Log non-tRPC errors to Sentry for debugging
    if (!isTRPCError) {
      Sentry.captureException(error, {
        tags: { source: "mcp-tool", endpoint: endpointName },
      });
    }

    return {
      content: [
        { type: "text" as const, text: `Error calling ${endpointName}: ${message}` },
      ],
    };
  }
};
