import { afterEach, expect, it, vi } from "bun:test";
import { env } from "@/env/server.mjs";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import {
  buildMetaCapiRequest,
  type MetaConversion,
  sendMetaConversions,
} from "@/server/utils/metaCapi";
import {
  canCaptureMetaTracking,
  saveMetaTutorialCompletion,
} from "@/server/utils/metaTracking";
import type { MetaTrackingInput } from "@/validators/metaTracking";

const conversion: MetaConversion = {
  event: "register",
  eventId: "11f90b37-6015-4361-8c51-fbfcccb92b43",
  occurredAt: new Date("2026-11-18T09:20:04.123Z"),
  fbc: "fb.1.1794993604000.Real_Click",
  fbp: "fb.1.1794993604000.12345",
  userAgent: "Test browser",
};
afterEach(() => vi.restoreAllMocks());

it("preserves confirmed time, exact shared IDs and unhashed matching identifiers", () => {
  const { data } = buildMetaCapiRequest([
    conversion,
    { ...conversion, event: "tutorial_complete" },
  ]);
  expect(data[0]).toEqual({
    event_name: "CompleteRegistration",
    event_id: conversion.eventId,
    event_time: 1794993604,
    action_source: "website",
    event_source_url: "https://www.theninja-rpg.com/register",
    user_data: {
      client_user_agent: "Test browser",
      fbc: conversion.fbc ?? undefined,
      fbp: conversion.fbp ?? undefined,
    },
  });
  expect(data[1]?.event_name).toBe("TutorialComplete");
  expect(data[1]?.event_id).toBe(conversion.eventId);
});

it("uses a server authorization header and acknowledges accepted batches", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ events_received: 1 }));
  await sendMetaConversions("12345", "server-secret", [conversion]);
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://graph.facebook.com/v24.0/12345/events",
  );
  expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
    Authorization: "Bearer server-secret",
    "Content-Type": "application/json",
  });
});

it.each([
  Response.json({ events_received: 0 }),
  Response.json({ error: { message: "private vendor response" } }, { status: 400 }),
])("does not settle unacknowledged or rejected batches", async (response) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  await expect(
    sendMetaConversions("12345", "server-secret", [conversion]),
  ).rejects.toThrow(/Meta/);
});

it("does not leak transport errors containing request credentials", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("server-secret private-click"),
  );
  await expect(
    sendMetaConversions("12345", "server-secret", [conversion]),
  ).rejects.toThrow("Meta conversion delivery failed");
});

it("rejects expired, future, unmatched and native tracking snapshots", () => {
  const now = Date.now();
  const input: MetaTrackingInput = {
    revision: CONSENT_REVISION,
    consentId: crypto.randomUUID(),
    decidedAt: new Date(now - 1000).toISOString(),
    granted: true as const,
    fbc: conversion.fbc ?? undefined,
  };
  expect(canCaptureMetaTracking(input, "Browser", now)).toBe(true);
  expect(canCaptureMetaTracking(input, "TNR-Native/1.0.0 (ios)", now)).toBe(false);
  expect(canCaptureMetaTracking(input, undefined, now)).toBe(false);
  expect(
    canCaptureMetaTracking(
      { ...input, decidedAt: new Date(now + 1000).toISOString() },
      "Browser",
      now,
    ),
  ).toBe(false);
  expect(
    canCaptureMetaTracking(
      { ...input, decidedAt: new Date(now - 181 * 86400000).toISOString() },
      "Browser",
      now,
    ),
  ).toBe(false);
  expect(canCaptureMetaTracking({ ...input, fbc: undefined }, "Browser", now)).toBe(
    false,
  );
});

it("never marks a native tutorial as a website completion", async () => {
  const update = vi.fn();
  const configuration = {
    META_CAPI_ENABLED: env.META_CAPI_ENABLED,
    META_CAPI_ACCESS_TOKEN: env.META_CAPI_ACCESS_TOKEN,
    NEXT_PUBLIC_META_PIXEL_ID: env.NEXT_PUBLIC_META_PIXEL_ID,
    NODE_ENV: env.NODE_ENV,
  };
  Object.assign(env, {
    META_CAPI_ENABLED: "true",
    META_CAPI_ACCESS_TOKEN: "test-placeholder",
    NEXT_PUBLIC_META_PIXEL_ID: "12345",
    NODE_ENV: "production",
  });
  try {
    await saveMetaTutorialCompletion(
      { update } as never,
      "player",
      "TNR-Native/1.0.0 (ios)",
    );
    expect(update).not.toHaveBeenCalled();
  } finally {
    Object.assign(env, configuration);
  }
});
