import * as SentryNext from "@sentry/nextjs";
import * as SentryNode from "@sentry/node";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DSN =
  "https://c35c54f99b73b4a3b8a7e60936bc2967@o4507797256601600.ingest.de.sentry.io/4507797262958672";

type ClientInfo = {
  initialized: boolean;
  dsn: string | null;
  environment: string | null;
  release: string | null;
  sampleRate: number | null;
  enabled: boolean | null;
  integrations: string[] | null;
};

const describeClient = (
  client: ReturnType<typeof SentryNext.getClient>,
): ClientInfo => {
  if (!client) {
    return {
      initialized: false,
      dsn: null,
      environment: null,
      release: null,
      sampleRate: null,
      enabled: null,
      integrations: null,
    };
  }
  const options = client.getOptions();
  return {
    initialized: true,
    dsn: options.dsn ? String(options.dsn).slice(-24) : null,
    environment: options.environment ?? null,
    release: options.release ?? null,
    sampleRate: options.sampleRate ?? null,
    enabled: options.enabled ?? null,
    integrations: Object.keys(
      (client as unknown as { _integrations?: Record<string, unknown> })
        ._integrations ?? {},
    ),
  };
};

export async function GET(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode") ?? "info";
  const marker = `SENTRY_PROBE_${mode.toUpperCase()}_${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}_${Date.now()}`;

  const nextClient = SentryNext.getClient();
  const nodeClient = SentryNode.getClient();
  const carrier = (globalThis as Record<string, unknown>).__SENTRY__ as
    | Record<string, unknown>
    | undefined;

  const diagnostics: Record<string, unknown> = {
    marker,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      VERCEL: process.env.VERCEL ?? null,
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      VERCEL_REGION: process.env.VERCEL_REGION ?? null,
      SENTRY_DSN_set: !!process.env.SENTRY_DSN,
      NEXT_PUBLIC_SENTRY_DSN_set: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      SENTRY_AUTH_TOKEN_set: !!process.env.SENTRY_AUTH_TOKEN,
    },
    sdkVersions: {
      nextjs: SentryNext.SDK_VERSION,
      node: SentryNode.SDK_VERSION,
    },
    registerMarker:
      (globalThis as Record<string, unknown>).__TNR_SENTRY_REGISTER__ ?? null,
    carrierKeys: carrier ? Object.keys(carrier) : null,
    sameClientInstance: !!nextClient && nextClient === nodeClient,
    nextjsClient: describeClient(nextClient),
    nodeClient: describeClient(nodeClient),
  };

  if (mode === "info") {
    return Response.json(diagnostics);
  }

  if (mode === "throw") {
    throw new Error(marker);
  }

  if (mode === "raw") {
    // Bypass the SDK entirely: does this lambda have egress to Sentry ingest?
    const { host, publicKey, projectId } = parseDsn(DSN);
    const envelope = buildEnvelope(marker, publicKey);
    try {
      const res = await fetch(`https://${host}/api/${projectId}/envelope/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      });
      diagnostics.raw = { status: res.status, body: (await res.text()).slice(0, 300) };
    } catch (error) {
      diagnostics.raw = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return Response.json(diagnostics);
  }

  // mode=capture (via @sentry/nextjs) or mode=capturenode (via @sentry/node)
  const sdk = mode === "capturenode" ? SentryNode : SentryNext;
  const eventId = sdk.captureException(new Error(marker));
  let flushed: boolean | string;
  try {
    flushed = await sdk.flush(8000);
  } catch (error) {
    flushed = `flush threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  diagnostics.capture = { via: mode, eventId, flushed };
  return Response.json(diagnostics);
}

const parseDsn = (dsn: string) => {
  const url = new URL(dsn);
  return {
    host: url.host,
    publicKey: url.username,
    projectId: url.pathname.replace("/", ""),
  };
};

const buildEnvelope = (marker: string, publicKey: string) => {
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const sentAt = new Date().toISOString();
  const header = JSON.stringify({
    event_id: eventId,
    sent_at: sentAt,
    dsn: DSN,
    sdk: { name: "tnr.probe", version: "0.0.0" },
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    exception: {
      values: [{ type: "SentryProbeRawEnvelope", value: marker }],
    },
    tags: { probe: "raw-envelope", public_key: publicKey.slice(0, 6) },
  });
  return `${header}\n${itemHeader}\n${payload}\n`;
};
