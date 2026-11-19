import { NextResponse } from "next/server";
import { z } from "zod";

const receiptSchema = z.strictObject({
  consentId: z.uuid(),
  revision: z.number().int().min(1).max(10000),
  categories: z
    .array(z.enum(["necessary", "preferences", "statistics", "marketing"]))
    .min(1)
    .max(4)
    .refine((values) => values.includes("necessary")),
  consentTimestamp: z.iso.datetime(),
  language: z.literal("en"),
});
const responseHeaders = { "Cache-Control": "no-store" };

/** Anonymous integration: forward only the receipt, never browser credentials or request metadata. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return failure(403);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return failure(415);
  const destination = process.env.CONSENT_RECEIPTS_URL;
  if (!destination) return failure(503);

  let receipt: z.infer<typeof receiptSchema>;
  try {
    if (!request.body) return failure(400);
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2048) {
          await reader.cancel();
          return failure(413);
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = receiptSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return failure(400);
    receipt = parsed.data;
  } catch {
    return failure(400);
  }

  try {
    const upstream = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(receipt),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return failure(503);
    return new NextResponse(null, { status: 204, headers: responseHeaders });
  } catch {
    // The client keeps its choice, queues delivery, and retries on a later visit or reconnection.
    return failure(503);
  }
}

const failure = (status: number) =>
  NextResponse.json(
    { error: "Consent receipt could not be recorded" },
    { status, headers: responseHeaders },
  );
