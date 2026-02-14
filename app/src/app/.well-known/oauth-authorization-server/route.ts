import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";
import { NextResponse } from "next/server";

const mcpEnabled = process.env.NEXT_PUBLIC_MCP_ENABLED === "true";

export const OPTIONS = mcpEnabled
  ? metadataCorsOptionsRequestHandler()
  : () => new NextResponse(null, { status: 404 });

export const GET = mcpEnabled
  ? authServerMetadataHandlerClerk()
  : () => NextResponse.json({ error: "MCP not enabled" }, { status: 404 });
