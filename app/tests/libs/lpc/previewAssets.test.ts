import { afterEach, expect, it, vi } from "bun:test";
import {
  buildLpcCatalog,
  type LpcCatalog,
  spriteLayerSheets,
} from "@/libs/lpc/catalog";
import { loadLpcPreviewCatalog, lpcPreviewFingerprint } from "@/libs/lpc/previewAssets";
import { packLpcCatalog, unpackLpcCatalog } from "@/libs/lpc/transport";
import type { SpriteAppearance } from "@/validators/lpc";
import type { LpcPreviewManifest } from "@/validators/lpcPreview";
import { lpcAssets } from "../../setup/lpc";

afterEach(() => vi.restoreAllMocks());
let counter = 0;
const appearance: SpriteAppearance = {
  version: 1,
  body: "male",
  layers: [{ profile: "body", color: "light", slot: "body" }],
};
const fixture = async () => {
  const base = buildLpcCatalog([lpcAssets.find((asset) => asset.id === "body")!]);
  const source = await lpcPreviewFingerprint(base, "body");
  const url = `https://uploadthing.b-cdn.net/f/preview-test-${++counter}`;
  const { preview: _preview, ...metadata } = base.designs.body!;
  const atlas = {
    image: "https://uploadthing.b-cdn.net/f/intensity",
    depth: "https://uploadthing.b-cdn.net/f/depth",
    z: 1,
    layout: 0,
    intensityTint: [1, 0.5, 0.2] as [number, number, number],
  };
  const detailed: LpcCatalog = {
    designs: { body: metadata },
    palettes: [],
    entries: Object.fromEntries(
      Object.keys(base.entries).map((key) => [key, [{ ...atlas, travel: atlas }]]),
    ),
    layouts: [
      {
        cell: 640,
        columns: 1,
        pixelsPerUnit: 128000 / 381,
        ground: { x: 320, y: 320 + 52480 / 381 },
        cells: [{ x: 1, y: 1, trim: { x: 320, y: 320, width: 1, height: 1 } }],
        clips: { idle: [[0], [0], [0], [0]] },
      },
    ],
  };
  const manifest: LpcPreviewManifest = {
    version: 1,
    profile: "body",
    source,
    revision: "f".repeat(64),
    animation: "idle",
    catalog: packLpcCatalog(detailed),
  };
  base.designs.body = { ...metadata, preview: { source, index: `${url}-index` } };
  const index = {
    version: 1,
    profile: "body",
    source,
    revision: manifest.revision,
    clips: { idle: url },
  };
  return { base, manifest, url, index };
};

it("fingerprints visual definitions identically across transport and ignores preview pointers", async () => {
  const { base } = await fixture();
  const restored = unpackLpcCatalog(JSON.parse(JSON.stringify(packLpcCatalog(base))));
  expect(await lpcPreviewFingerprint(restored, "body")).toBe(
    await lpcPreviewFingerprint(base, "body"),
  );
});

it("requests only the chosen immutable clip and retains native colour decoding metadata", async () => {
  const { base, manifest, url, index } = await fixture();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(String(input).endsWith("-index") ? index : manifest),
        ),
    );
  const catalog = await loadLpcPreviewCatalog(
    base,
    appearance,
    "idle",
    new AbortController().signal,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[0]).toBe(`${url}-index`);
  expect(fetch.mock.calls[1]?.[0]).toBe(url);
  const [sheet] = spriteLayerSheets(
    catalog,
    appearance,
    appearance.layers[0]!,
    "travel",
  );
  expect(catalog.layouts[sheet!.layout]!.cell).toBe(640);
  expect(sheet!.intensityTint).toEqual([1, 0.5, 0.2]);
  await loadLpcPreviewCatalog(base, appearance, "idle", new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    await loadLpcPreviewCatalog(
      base,
      appearance,
      "slash",
      new AbortController().signal,
    ),
  ).toBe(base);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("retains edited gameplay artwork when its preview fingerprint no longer matches", async () => {
  const { base } = await fixture();
  const changed = {
    ...base,
    layouts: base.layouts.map((layout) => ({ ...layout, pixelsPerUnit: 100 })),
  };
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(
    await loadLpcPreviewCatalog(
      changed,
      appearance,
      "idle",
      new AbortController().signal,
    ),
  ).toBe(changed);
  expect(fetch).not.toHaveBeenCalled();
});

it("supports the same source under a standalone editor or thumbnail alias", async () => {
  const { base, manifest, index } = await fixture();
  const alias: LpcCatalog = {
    ...base,
    designs: { draft: base.designs.body! },
    entries: Object.fromEntries(
      Object.entries(base.entries).map(([key, value]) => [
        `draft/${key.slice(5)}`,
        value,
      ]),
    ),
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      new Response(JSON.stringify(String(input).endsWith("-index") ? index : manifest)),
  );
  const look = {
    ...appearance,
    layers: [{ ...appearance.layers[0]!, profile: "draft" }],
  };
  const catalog = await loadLpcPreviewCatalog(
    alias,
    look,
    "idle",
    new AbortController().signal,
  );
  const [sheet] = spriteLayerSheets(catalog, look, look.layers[0]!, "travel");
  expect(catalog.layouts[sheet!.layout]!.cell).toBe(640);
});

it("does not retain a failed manifest or an aborted request", async () => {
  const { base, manifest, index } = await fixture();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("{}"))
    .mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(String(input).endsWith("-index") ? index : manifest),
        ),
    );
  await expect(
    loadLpcPreviewCatalog(base, appearance, "idle", new AbortController().signal),
  ).rejects.toThrow();
  await loadLpcPreviewCatalog(base, appearance, "idle", new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(3);
  const next = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadLpcPreviewCatalog(next.base, appearance, "idle", controller.signal),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("does not fetch replaced body layers or preload another animation", async () => {
  const { base, manifest, url, index } = await fixture();
  const catalog = {
    ...base,
    designs: {
      ...base.designs,
      replacement: { ...base.designs.body!, replacementSlots: ["body" as const] },
    },
    entries: {
      ...base.entries,
      ...Object.fromEntries(
        Object.entries(base.entries).map(([key, value]) => [
          `replacement/${key.slice(5)}`,
          value,
        ]),
      ),
    },
  };
  const source = await lpcPreviewFingerprint(catalog, "replacement");
  catalog.designs.replacement.preview = {
    source,
    index: `${url}-replacement-index`,
  };
  const replacementManifest = {
    ...manifest,
    source,
    catalog: {
      ...manifest.catalog,
      designs: {
        body: { ...manifest.catalog.designs.body!, replacementSlots: ["body"] },
      },
    },
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith("-index")
              ? { ...index, source, clips: { idle: `${url}-replacement` } }
              : replacementManifest,
          ),
        ),
    );
  await loadLpcPreviewCatalog(
    catalog,
    {
      ...appearance,
      layers: [
        ...appearance.layers,
        { profile: "replacement", color: "light", slot: "equipment" },
      ],
    },
    "idle",
    new AbortController().signal,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[0]).toBe(`${url}-replacement-index`);
  expect(fetch.mock.calls[1]?.[0]).toBe(`${url}-replacement`);
});
