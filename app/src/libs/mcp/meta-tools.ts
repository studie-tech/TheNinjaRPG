import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { truncateString } from "@/utils/string";
import { isPlainObject } from "@/utils/typeutils";
import type { ModelContextProtocolTool, TransformMcpProcedureFunction } from "./types";

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
  isMutationEndpoint: boolean;
};

/**
 * Registry storing all endpoints grouped by router.
 */
export type ToolRegistry = {
  routers: Map<string, Map<string, EndpointData>>;
};

/**
 * Explicit allowlist of scopes that authorize write operations.
 * SECURITY: All values MUST be lowercase to match the normalization in hasWriteScope().
 * Never add mixed-case values here - they will not match and could cause authorization bypass.
 */
const WRITE_SCOPES = ["profile:write", "write"];

// Runtime check to ensure all WRITE_SCOPES values are lowercase
WRITE_SCOPES.forEach((scope) => {
  if (scope !== scope.toLowerCase()) {
    throw new Error(`WRITE_SCOPES contains non-lowercase value: ${scope}`);
  }
});

// Meta-tool description constants
const META_TOOL_DESC_LIST_ROUTERS =
  "List all available game API routers. Call this first to discover what's available.";
const META_TOOL_DESC_LIST_ENDPOINTS =
  "List all endpoints for a specific router with their descriptions.";
const META_TOOL_DESC_GET_SCHEMA = "Get the input schema for a specific endpoint.";
const META_TOOL_DESC_CALL_ENDPOINT =
  "Call a game API endpoint with the provided input data. Supports optional response filtering to reduce output size.";
const META_TOOL_DESC_ROUTER_NAME = "Name of the router (from listGameRouters)";
const META_TOOL_DESC_ENDPOINT_NAME =
  "Full endpoint name (e.g., 'profile.getPublicProfile')";
const META_TOOL_DESC_INPUT = "Input data matching the endpoint schema";
const META_TOOL_DESC_SELECT =
  "Dot-notation paths to extract from the response (e.g., ['userData.username', 'userData.level']). Use * as wildcard for array elements (e.g., 'usersState.*.curHealth'). Returns a flat key-value map of selected paths.";
const META_TOOL_DESC_SEARCH =
  "Case-insensitive text pattern to filter the response. Only returns parts of the response where keys or string values contain this pattern.";
const META_TOOL_DESC_MAX_LENGTH =
  "Maximum character length of the total response. For multi-block responses, this is the combined character budget across all blocks. Response is truncated with an indicator if exceeded.";

/**
 * Build a registry from extracted MCP tools.
 * Groups tools by router (first part of pathInRouter).
 */
export function buildToolRegistry(tools: ModelContextProtocolTool[]): ToolRegistry {
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
      isMutationEndpoint: tool.isMutation,
    });
  }

  return { routers };
}

/**
 * Meta-tool definitions for MCP discovery and invocation.
 */
export const metaTools = [
  {
    name: "listGameRouters",
    description: META_TOOL_DESC_LIST_ROUTERS,
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "listRouterEndpoints",
    description: META_TOOL_DESC_LIST_ENDPOINTS,
    inputSchema: {
      type: "object" as const,
      properties: {
        routerName: {
          type: "string" as const,
          description: META_TOOL_DESC_ROUTER_NAME,
        },
      },
      required: ["routerName"],
    },
  },
  {
    name: "getEndpointSchema",
    description: META_TOOL_DESC_GET_SCHEMA,
    inputSchema: {
      type: "object" as const,
      properties: {
        endpointName: {
          type: "string" as const,
          description: META_TOOL_DESC_ENDPOINT_NAME,
        },
      },
      required: ["endpointName"],
    },
  },
  {
    name: "callEndpoint",
    description: META_TOOL_DESC_CALL_ENDPOINT,
    inputSchema: {
      type: "object" as const,
      properties: {
        endpointName: {
          type: "string" as const,
          description: META_TOOL_DESC_ENDPOINT_NAME,
        },
        input: {
          type: "object" as const,
          description: META_TOOL_DESC_INPUT,
        },
        select: {
          type: "array" as const,
          items: { type: "string" as const },
          description: META_TOOL_DESC_SELECT,
        },
        search: {
          type: "string" as const,
          description: META_TOOL_DESC_SEARCH,
        },
        maxLength: {
          type: "number" as const,
          description: META_TOOL_DESC_MAX_LENGTH,
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
 * Handle getEndpointSchema meta-tool call.
 */
export const handleGetSchema = (registry: ToolRegistry, endpointName: string) => {
  const endpoint = findEndpoint(registry, endpointName);

  if (!endpoint) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Endpoint not found: ${endpointName}. Use listRouterEndpoints to see available endpoints.`,
        },
      ],
    };
  }

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
};

/**
 * Optional filters applied to callEndpoint responses to reduce output size.
 */
export type ResponseFilters = {
  select?: string[];
  search?: string;
  maxLength?: number;
};

// Prevent DoS attacks by limiting the number of select paths that can be processed
const MAXIMUM_SELECT_PATHS = 100;
// Cap response size at 1MB to prevent memory exhaustion and ensure reasonable network transfer times
const MAXIMUM_RESPONSE_LENGTH = 1024 * 1024; // 1MB
// Prevent DoS via extremely long individual path strings
const MAXIMUM_PATH_STRING_LENGTH = 1000;

/**
 * Parse and validate response filters from raw arguments.
 * Extracts select, search, and maxLength filters and returns undefined if none are present.
 * Enforces limits: max 100 select paths, max 1MB for maxLength.
 */
export const parseResponseFilters = (
  procedureArguments?: Record<string, unknown>,
): ResponseFilters | undefined => {
  const filters: ResponseFilters = {};

  if (Array.isArray(procedureArguments?.select)) {
    const validStrings = procedureArguments.select.filter(
      (s): s is string =>
        typeof s === "string" && s.length <= MAXIMUM_PATH_STRING_LENGTH,
    );
    if (validStrings.length > 0) {
      filters.select = validStrings.slice(0, MAXIMUM_SELECT_PATHS);
    }
  }

  if (typeof procedureArguments?.search === "string" && procedureArguments.search) {
    filters.search = procedureArguments.search;
  }

  if (
    typeof procedureArguments?.maxLength === "number" &&
    procedureArguments.maxLength > 0
  ) {
    filters.maxLength = Math.min(procedureArguments.maxLength, MAXIMUM_RESPONSE_LENGTH);
  }

  const hasActiveFilters =
    (Array.isArray(filters.select) && filters.select.length > 0) ||
    filters.search !== undefined ||
    filters.maxLength !== undefined;
  return hasActiveFilters ? filters : undefined;
};

/**
 * Expand a wildcard segment by extracting array elements or object values.
 */
function expandWildcard(arrayOrObject: unknown): unknown[] | undefined {
  if (Array.isArray(arrayOrObject)) {
    return arrayOrObject;
  }
  if (typeof arrayOrObject === "object" && arrayOrObject !== null) {
    return Object.values(arrayOrObject as Record<string, unknown>);
  }
  return undefined;
}

/**
 * Apply remaining path segments to each expanded item and filter out undefined results.
 */
function applyRemainingPath(
  expandedItems: unknown[],
  remainingSegments: string[],
): unknown[] {
  return expandedItems
    .map((item) => resolvePathWithWildcards(item, remainingSegments))
    .filter((result) => result !== undefined);
}

/**
 * Security constants for path segment validation
 */
const DANGEROUS_PROPS = ["__proto__", "constructor", "prototype"];
const SAFE_SEGMENT_PATTERN = /^([a-zA-Z0-9_-]+|\*)$/;
const MAXIMUM_PATH_DEPTH = 20;

/**
 * Validate a path segment for security and safety.
 * Returns the normalized segment or undefined if validation fails.
 */
function validatePathSegment(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;

  // Normalize to prevent Unicode-based bypass attempts
  const normalized = segment.normalize("NFC").trim();

  // Guard against prototype pollution
  if (DANGEROUS_PROPS.includes(normalized)) return undefined;

  // Validate segment contains only safe characters
  if (segment !== "*" && !SAFE_SEGMENT_PATTERN.test(normalized)) {
    return undefined;
  }

  return normalized;
}

/**
 * Handle wildcard expansion in a path.
 * Returns the resolved value after applying the wildcard and remaining path segments.
 */
function handleWildcardSegment(current: unknown, remainingSegments: string[]): unknown {
  const expandedArrayElements = expandWildcard(current);
  if (!expandedArrayElements) return undefined;

  // If no remaining path, return the expanded items directly
  if (remainingSegments.length === 0) return expandedArrayElements;

  // Otherwise, recursively apply remaining path to each item
  return applyRemainingPath(expandedArrayElements, remainingSegments);
}

/**
 * Safely access a property on an object.
 * Returns the property value or undefined if not accessible.
 */
function accessObjectProperty(current: unknown, normalizedSegment: string): unknown {
  if (typeof current !== "object" || current === null) return undefined;

  // Safe property access using Object.hasOwn to prevent prototype chain vulnerabilities
  if (Object.hasOwn(current as Record<string, unknown>, normalizedSegment)) {
    return (current as Record<string, unknown>)[normalizedSegment];
  }

  return undefined;
}

/**
 * Traverse a nested object/array following dot-notation path segments with wildcard support.
 * The `*` wildcard maps over array elements (or object values).
 *
 * SECURITY: Response objects passed to this function should be pre-sanitized and not contain sensitive
 * internal properties. While this function prevents prototype pollution and validates path segments,
 * it allows arbitrary property access on the response object based on user-controlled paths. Only pass
 * objects that are safe for external consumption (e.g., tRPC router responses, not internal database rows).
 */
const resolvePathWithWildcards = (
  responseObject: unknown,
  pathSegments: string[],
): unknown => {
  // Enforce depth limit to prevent deep recursion attacks
  if (pathSegments.length > MAXIMUM_PATH_DEPTH) return undefined;

  let current: unknown = responseObject;

  // Iterate through each path segment
  for (const [segmentIndex, segment] of pathSegments.entries()) {
    // Early exit for null/undefined values
    if (current === null || current === undefined) return undefined;

    // Validate and normalize the segment
    const normalized = validatePathSegment(segment);
    if (normalized === undefined) return undefined;

    // Handle wildcard expansion
    if (segment === "*") {
      const remainingSegments = pathSegments.slice(segmentIndex + 1);
      return handleWildcardSegment(current, remainingSegments);
    }

    // Access regular property
    current = accessObjectProperty(current, normalized);
    if (current === undefined) return undefined;
  }

  return current;
};

/**
 * Extract specific dot-notation paths from a response object.
 * Returns a flat key-value map where keys are the requested paths.
 */
function extractFieldsFromResponse(
  response: unknown,
  selectPaths: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of selectPaths) {
    const value = resolvePathWithWildcards(response, path.split("."));
    if (value !== undefined) {
      result[path] = value;
    }
  }
  return result;
}

/**
 * Check if a primitive value matches the search pattern.
 */
function matchesPrimitive(value: unknown, lowerCasePattern: string): boolean {
  if (typeof value === "string") {
    return value.toLowerCase().includes(lowerCasePattern);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(lowerCasePattern);
  }
  return false;
}

/**
 * Filter an object's entries based on key or value matching the pattern.
 */
function filterObjectEntries(
  sourceObject: Record<string, unknown>,
  lowercasePattern: string,
  pattern: string,
): { result: Record<string, unknown>; hasMatch: boolean } {
  const matchingEntries: Record<string, unknown> = {};
  let hasMatch = false;

  for (const [key, value] of Object.entries(sourceObject)) {
    if (key.toLowerCase().includes(lowercasePattern)) {
      matchingEntries[key] = value;
      hasMatch = true;
      continue;
    }
    const filtered = searchObject(value, pattern);
    if (filtered !== undefined) {
      matchingEntries[key] = filtered;
      hasMatch = true;
    }
  }

  return { result: matchingEntries, hasMatch };
}

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
function searchObject(value: unknown, pattern: string): unknown {
  const lowerCasePattern = pattern.toLowerCase();

  if (value === null || value === undefined) return undefined;

  if (matchesPrimitive(value, lowerCasePattern)) {
    return value;
  }

  if (Array.isArray(value)) {
    const filteredElements = value
      .map((element) => searchObject(element, pattern))
      .filter((filtered) => filtered !== undefined);
    return filteredElements.length > 0 ? filteredElements : undefined;
  }

  if (typeof value === "object") {
    const { result, hasMatch } = filterObjectEntries(
      value as Record<string, unknown>,
      lowerCasePattern,
      pattern,
    );
    return hasMatch ? result : undefined;
  }

  return undefined;
}

/**
 * Apply maxLength truncation to content blocks with text fields.
 * Tracks a running character budget across all blocks to ensure the total
 * response size stays within maxLength.
 */
function applyLengthBudgetToBlocks(
  responseBlocks: Array<{ type: string; text?: string }>,
  maxLength: number,
): Array<{ type: string; text?: string }> {
  let remainingBudget = maxLength;
  const truncatedBlocks: Array<{ type: string; text?: string }> = [];

  for (const block of responseBlocks) {
    if (remainingBudget <= 0) {
      // Budget exhausted, skip remaining blocks
      break;
    }

    if ("text" in block && typeof block.text === "string") {
      if (block.text.length <= remainingBudget) {
        // Block fits within budget
        truncatedBlocks.push(block);
        remainingBudget -= block.text.length;
      } else {
        // Block needs truncation
        truncatedBlocks.push({
          ...block,
          text: truncateString(block.text, remainingBudget, "...[truncated]"),
        });
        remainingBudget = 0;
      }
    } else {
      truncatedBlocks.push(block);
    }
  }

  return truncatedBlocks;
}

/**
 * Apply response filters (select, search, maxLength) to a raw result
 * and return the final JSON text.
 */
function applyFilters(result: unknown, filters?: ResponseFilters): string {
  let data = result;

  // Normalize undefined to empty object to prevent JSON.stringify returning undefined
  if (data === undefined) {
    data = {};
  }

  if (filters?.select && filters.select.length > 0) {
    data = extractFieldsFromResponse(data, filters.select);
  }

  if (filters?.search) {
    const searched = searchObject(data, filters.search);
    data = searched !== undefined ? searched : {};
  }

  let text = JSON.stringify(data);

  if (filters?.maxLength && text.length > filters.maxLength) {
    text = truncateString(text, filters.maxLength, "...[truncated]");
  }

  return text;
}

/**
 * Check if the provided scopes allow write operations.
 * Uses explicit allowlist matching only - no substring matching.
 * Normalizes scopes to prevent bypass via case/whitespace variations.
 */
function hasWriteScope(scopes: string[]): boolean {
  return scopes.some((scope) => WRITE_SCOPES.includes(scope.trim().toLowerCase()));
}

/**
 * Check if user has required scope for the endpoint.
 * Returns error response if unauthorized, undefined if authorized.
 *
 * For mutation endpoints the caller needs either:
 *  - To be an authenticated user (game policy: all authenticated users may mutate), OR
 *  - To hold an explicit write scope (for non-session tokens such as service-to-service).
 *
 * This keeps the "authenticated users can mutate" policy decision separate from
 * OAuth scope enforcement — scopes are never synthetically injected.
 *
 * NOTE: Currently checks for write scope broadly. All mutations with write scope can execute any mutation endpoint.
 * For production use, consider implementing endpoint-specific permission checks for sensitive operations
 * (e.g., require "profile:write" for profile mutations, "admin" scope for administrative operations).
 */
function checkEndpointAuthorization(
  endpoint: EndpointData,
  endpointName: string,
  getScopes?: () => string[],
  getIsAuthenticated?: () => boolean,
) {
  if (endpoint.isMutationEndpoint) {
    const isAuthenticated = getIsAuthenticated?.() ?? false;
    const scopes = getScopes?.() ?? [];
    if (!isAuthenticated && !hasWriteScope(scopes)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Insufficient permissions: ${endpointName} is a mutation and requires authentication or write scope. Current scopes: ${scopes.join(", ") || "none"}`,
          },
        ],
      };
    }
  }
  return undefined;
}

/**
 * Resolve tRPC procedure from caller using endpoint path.
 */
function resolveProcedure(trpcCaller: unknown, pathInRouter: string[]): unknown {
  return pathInRouter.reduce<unknown>(
    (procedure, segment) => (procedure as Record<string, unknown>)?.[segment],
    trpcCaller,
  );
}

/**
 * Handle transformed endpoint response with filters.
 */
async function handleTransformedResponse(
  output: unknown,
  transform: TransformMcpProcedureFunction,
  filters?: ResponseFilters,
) {
  const result = await transform(output);

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

    const warningContent = { type: "text" as const, text: warning };

    if (filters?.maxLength) {
      // Apply maxLength only to response data blocks, exempt warning block
      const truncatedContent = applyLengthBudgetToBlocks(result, filters.maxLength);
      return {
        content: [warningContent, ...truncatedContent],
      };
    }

    return { content: [warningContent, ...result] };
  }

  if (filters?.maxLength) {
    return {
      content: applyLengthBudgetToBlocks(result, filters.maxLength),
    };
  }

  return { content: result };
}

/**
 * Validate input structure against endpoint schema.
 * Returns error response if validation fails, undefined if valid.
 */
function validateEndpointInput(
  input: Record<string, unknown> | undefined,
  schema: z.core.JSONSchema.JSONSchema | undefined,
  endpointName: string,
) {
  if (input === undefined || !schema) {
    return undefined;
  }

  if (schema.type === "object") {
    if (!isPlainObject(input)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid input type for ${endpointName}: expected object, received ${typeof input}`,
          },
        ],
      };
    }

    if (Array.isArray(schema.required) && schema.required.length > 0) {
      const missingFields = schema.required.filter((field) => !(field in input));
      if (missingFields.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Missing required fields for ${endpointName}: ${missingFields.join(", ")}`,
            },
          ],
        };
      }
    }
  }

  return undefined;
}

/**
 * Execute a procedure and handle errors.
 * Returns formatted response content or throws on unexpected errors.
 */
async function executeProcedure(
  procedure: unknown,
  input: Record<string, unknown> | undefined,
  endpoint: EndpointData,
  endpointName: string,
  filters?: ResponseFilters,
) {
  try {
    if (typeof endpoint.transformMcpProcedure === "function") {
      const output = await (procedure as (input?: unknown) => Promise<unknown>)(input);
      return await handleTransformedResponse(
        output,
        endpoint.transformMcpProcedure,
        filters,
      );
    }

    const result = await (procedure as (input?: unknown) => Promise<unknown>)(input);
    const text = applyFilters(result, filters);
    return {
      content: [{ type: "text" as const, text }],
    };
  } catch (error) {
    const isTRPCError = error instanceof TRPCError;

    if (isTRPCError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error calling ${endpointName}: ${error.message}`,
          },
        ],
      };
    }

    Sentry.captureException(error, {
      tags: { source: "mcp-tool", endpoint: endpointName },
    });
    throw error;
  }
}

/**
 * Handle callEndpoint meta-tool call.
 * Creates a fresh caller for each request to ensure current auth context.
 */
export const handleCallEndpoint = async (
  registry: ToolRegistry,
  createCaller: () => Promise<unknown>,
  endpointName: string,
  getScopes?: () => string[],
  getIsAuthenticated?: () => boolean,
  input?: Record<string, unknown>,
  filters?: ResponseFilters,
) => {
  const endpoint = findEndpoint(registry, endpointName);

  if (!endpoint) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Endpoint not found: ${endpointName}. Use listRouterEndpoints to see available endpoints.`,
        },
      ],
    };
  }

  const authError = checkEndpointAuthorization(
    endpoint,
    endpointName,
    getScopes,
    getIsAuthenticated,
  );
  if (authError) {
    return authError;
  }

  const validationError = validateEndpointInput(
    input,
    endpoint.inputSchema,
    endpointName,
  );
  if (validationError) {
    return validationError;
  }

  const trpcCaller = await createCaller();
  const procedure = resolveProcedure(trpcCaller, endpoint.pathInRouter);

  if (typeof procedure !== "function") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid procedure path: ${endpoint.pathInRouter.join(".")}`,
        },
      ],
    };
  }

  return await executeProcedure(procedure, input, endpoint, endpointName, filters);
};
