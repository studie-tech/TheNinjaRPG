import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { truncateString } from "@/utils/string";
import { isPlainObject } from "@/utils/typeutils";
import type {
  McpTool as ModelContextProtocolTool,
  TransformMcpProcedureFunction,
} from "./types";

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
 * Build a registry from extracted MCP tools.
 * Groups tools by router (first part of pathInRouter).
 */
export const buildToolRegistry = (tools: ModelContextProtocolTool[]): ToolRegistry => {
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
            "Maximum character length of the total response. For multi-block responses, this is the combined character budget across all blocks. Response is truncated with an indicator if exceeded.",
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
  for (const [_routerName, endpoints] of registry.routers) {
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

const MAXIMUM_SELECT_PATHS = 100;
const MAXIMUM_RESPONSE_LENGTH = 1024 * 1024; // 1MB

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
      (s): s is string => typeof s === "string",
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
const expandWildcard = (valueToExpand: unknown): unknown[] | undefined => {
  if (Array.isArray(valueToExpand)) {
    return valueToExpand;
  }
  if (typeof valueToExpand === "object" && valueToExpand !== null) {
    return Object.values(valueToExpand as Record<string, unknown>);
  }
  return undefined;
};

/**
 * Apply remaining path segments to each expanded item and filter out undefined results.
 */
const applyRemainingPath = (
  expandedElements: unknown[],
  remainingPathSegments: string[],
): unknown[] => {
  return expandedElements
    .map((item) => resolvePathWithWildcards(item, remainingPathSegments))
    .filter((result) => result !== undefined);
};

/**
 * Traverse a nested object/array following dot-notation path segments with wildcard support.
 * The `*` wildcard maps over array elements (or object values).
 *
 * SECURITY: Response objects passed to this function should be pre-sanitized and not contain sensitive
 * internal properties. While this function prevents prototype pollution and validates path segments,
 * it allows arbitrary property access on the response object based on user-controlled paths. Only pass
 * objects that are safe for external consumption (e.g., tRPC router responses, not internal database rows).
 *
 * Algorithm flow:
 * 1. Enforce depth limit (max 20 segments) to prevent recursion attacks
 * 2. For each path segment:
 *    a. Check for null/undefined values and exit early
 *    b. Normalize segment to prevent Unicode-based bypass attempts
 *    c. Validate against dangerous properties (__proto__, constructor, prototype)
 *    d. Validate segment contains only safe characters (alphanumeric, underscore, hyphen, or wildcard)
 *    e. Handle wildcard (*) by expanding to array elements/object values and recursively applying remaining path
 *    f. For regular segments, safely access property using Object.hasOwn to prevent prototype chain vulnerabilities
 * 3. Return the final resolved value or undefined if path invalid
 */
const resolvePathWithWildcards = (
  objectToResolve: unknown,
  pathParts: string[],
): unknown => {
  // Step 1: Depth limit to prevent deep recursion attacks
  const MAXIMUM_PATH_DEPTH = 20;
  if (pathParts.length > MAXIMUM_PATH_DEPTH) return undefined;

  let current: unknown = objectToResolve;

  // Security constants for validation
  const DANGEROUS_PROPS = ["__proto__", "constructor", "prototype"];
  const SAFE_SEGMENT_PATTERN = /^([a-zA-Z0-9_-]+|\*)$/;

  // Step 2: Iterate through each path segment
  for (const [segmentIndex, segment] of pathParts.entries()) {
    // Step 2a: Early exit for null/undefined values
    if (current === null || current === undefined) return undefined;

    if (segment === undefined) return undefined;

    // Step 2b: Normalize to prevent Unicode-based bypass attempts
    const normalized = segment.normalize("NFC").trim();

    // Step 2c: Guard against prototype pollution
    if (DANGEROUS_PROPS.includes(normalized)) return undefined;

    // Step 2d: Validate segment contains only safe characters
    if (segment !== "*" && !SAFE_SEGMENT_PATTERN.test(normalized)) {
      return undefined;
    }

    // Step 2e: Wildcard expansion - map over array elements or object values
    if (segment === "*") {
      const remainingPathSegments = pathParts.slice(segmentIndex + 1);
      const expandedArrayElements = expandWildcard(current);
      if (!expandedArrayElements) return undefined;
      // If no remaining path, return the expanded items directly
      if (remainingPathSegments.length === 0) return expandedArrayElements;
      // Otherwise, recursively apply remaining path to each item and filter out undefined results
      return applyRemainingPath(expandedArrayElements, remainingPathSegments);
    }

    if (typeof current !== "object") return undefined;

    // Step 2f: Safe property access using Object.hasOwn to prevent prototype chain vulnerabilities
    if (Object.hasOwn(current as Record<string, unknown>, normalized)) {
      current = (current as Record<string, unknown>)[normalized];
    } else {
      return undefined;
    }
  }

  // Step 3: Return final resolved value
  return current;
};

/**
 * Extract specific dot-notation paths from a response object.
 * Returns a flat key-value map where keys are the requested paths.
 */
const extractFieldsFromResponse = (
  response: unknown,
  selectPaths: string[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const path of selectPaths) {
    const value = resolvePathWithWildcards(response, path.split("."));
    if (value !== undefined) {
      result[path] = value;
    }
  }
  return result;
};

/**
 * Check if a primitive value matches the search pattern.
 */
const matchesPrimitive = (value: unknown, lowercasePattern: string): boolean => {
  if (typeof value === "string") {
    return value.toLowerCase().includes(lowercasePattern);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(lowercasePattern);
  }
  return false;
};

/**
 * Filter an object's entries based on key or value matching the pattern.
 */
const filterObjectEntries = (
  object: Record<string, unknown>,
  lowercasePattern: string,
  pattern: string,
): { result: Record<string, unknown>; hasMatch: boolean } => {
  const result: Record<string, unknown> = {};
  let hasMatch = false;

  for (const [key, value] of Object.entries(object)) {
    if (key.toLowerCase().includes(lowercasePattern)) {
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

  return { result, hasMatch };
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
  const lowercasePattern = pattern.toLowerCase();

  if (value === null || value === undefined) return undefined;

  if (matchesPrimitive(value, lowercasePattern)) {
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
      lowercasePattern,
      pattern,
    );
    return hasMatch ? result : undefined;
  }

  return undefined;
};

/**
 * Apply maxLength truncation to content blocks with text fields.
 * Tracks a running character budget across all blocks to ensure the total
 * response size stays within maxLength.
 */
const applyLengthBudgetToBlocks = (
  contentBlocks: Array<{ type: string; text?: string }>,
  maxLength: number,
): Array<{ type: string; text?: string }> => {
  let remainingBudget = maxLength;
  const result: Array<{ type: string; text?: string }> = [];

  for (const block of contentBlocks) {
    if (remainingBudget <= 0) {
      // Budget exhausted, skip remaining blocks
      break;
    }

    if ("text" in block && typeof block.text === "string") {
      if (block.text.length <= remainingBudget) {
        // Block fits within budget
        result.push(block);
        remainingBudget -= block.text.length;
      } else {
        // Block needs truncation
        result.push({
          ...block,
          text: truncateString(block.text, remainingBudget, "...[truncated]"),
        });
        remainingBudget = 0;
      }
    } else {
      result.push(block);
    }
  }

  return result;
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

/**
 * Check if the provided scopes allow write operations.
 * Uses explicit allowlist matching only - no substring matching.
 * Normalizes scopes to prevent bypass via case/whitespace variations.
 */
const hasWriteScope = (scopes: string[]): boolean => {
  return scopes.some((scope) => WRITE_SCOPES.includes(scope.trim().toLowerCase()));
};

/**
 * Check if user has required scope for the endpoint.
 * Returns error response if unauthorized, undefined if authorized.
 *
 * NOTE: Currently checks for write scope broadly. All mutations with write scope can execute any mutation endpoint.
 * For production use, consider implementing endpoint-specific permission checks for sensitive operations
 * (e.g., require "profile:write" for profile mutations, "admin" scope for administrative operations).
 */
const checkEndpointAuthorization = (
  endpoint: EndpointData,
  endpointName: string,
  getScopes?: () => string[],
) => {
  if (endpoint.isMutationEndpoint) {
    if (!getScopes) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Insufficient permissions: ${endpointName} is a mutation and requires authentication.`,
          },
        ],
      };
    }
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
    (procedure, segment) => (procedure as Record<string, unknown>)?.[segment],
    trpcCaller,
  );
};

/**
 * Handle transformed endpoint response with filters.
 */
const handleTransformedResponse = async (
  output: unknown,
  transform: TransformMcpProcedureFunction,
  filters?: ResponseFilters,
) => {
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
};

/**
 * Validate input structure against endpoint schema.
 * Returns error response if validation fails, undefined if valid.
 */
const validateEndpointInput = (
  input: Record<string, unknown> | undefined,
  schema: z.core.JSONSchema.JSONSchema | undefined,
  endpointName: string,
) => {
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
};

/**
 * Execute a procedure and handle errors.
 * Returns formatted response content or throws on unexpected errors.
 */
const executeProcedure = async (
  procedure: unknown,
  input: Record<string, unknown> | undefined,
  endpoint: EndpointData,
  endpointName: string,
  filters?: ResponseFilters,
) => {
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
};

/**
 * Handle callEndpoint meta-tool call.
 * Creates a fresh caller for each request to ensure current auth context.
 */
export const handleCallEndpoint = async (
  registry: ToolRegistry,
  createCaller: () => Promise<unknown>,
  endpointName: string,
  getScopes?: () => string[],
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

  const authError = checkEndpointAuthorization(endpoint, endpointName, getScopes);
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
