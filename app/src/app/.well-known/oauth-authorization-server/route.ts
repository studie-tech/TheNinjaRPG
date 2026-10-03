import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

export const OPTIONS = metadataCorsOptionsRequestHandler();
export const GET = authServerMetadataHandlerClerk();
