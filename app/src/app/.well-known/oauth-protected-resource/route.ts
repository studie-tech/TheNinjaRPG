import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

export const OPTIONS = metadataCorsOptionsRequestHandler();
export const GET = protectedResourceHandlerClerk({ resourceUrl: "/api/mcp" });
