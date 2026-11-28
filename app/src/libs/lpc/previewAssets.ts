import {
  expandLpcDesignVariants,
  type LpcCatalog,
  mergeLpcCatalogs,
  visibleSpriteLayers,
} from "@/libs/lpc/catalog";
import { unpackLpcCatalog } from "@/libs/lpc/transport";
import { canonicalJson } from "@/utils/canonicalJson";
import { textureImageUrl } from "@/utils/image";
import type { LpcAnimation, SpriteAppearance } from "@/validators/lpc";
import {
  LPC_CONFIG_MAX_BYTES,
  lpcConfigValidator,
  lpcPreviewMediaUrlValidator,
} from "@/validators/lpcAsset";
import {
  type LpcPreviewIndex,
  type LpcPreviewManifest,
  lpcPreviewIndexValidator,
  lpcPreviewManifestValidator,
} from "@/validators/lpcPreview";

const fingerprints = new WeakMap<LpcCatalog, Map<string, Promise<string>>>();
// This browser cache contains immutable media only; errors and in-flight aborted requests are not retained.
const manifests = new Map<string, LpcPreviewManifest>();
const indexes = new Map<string, LpcPreviewIndex>();

/** Bind a preview to the exact gameplay artwork, independent of transport table and object-key order. */
export const lpcPreviewFingerprint = (catalog: LpcCatalog, profile: string) => {
  let held = fingerprints.get(catalog);
  if (!held) {
    held = new Map();
    fingerprints.set(catalog, held);
  }
  let value = held.get(profile);
  if (!value) {
    const { preview: _preview, ...metadata } = catalog.designs[profile]!;
    const source = canonicalJson({
      metadata,
      variants: expandLpcDesignVariants(catalog, profile),
    });
    value = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(source))
      .then((hash) =>
        Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      );
    held.set(profile, value);
    const cache = held;
    void value.catch(() => cache.delete(profile));
  }
  return value;
};

const readJson = async (url: string, signal: AbortSignal) => {
  signal.throwIfAborted();
  lpcPreviewMediaUrlValidator.parse(url);
  const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const response = await fetch(textureImageUrl(url, 0), {
    signal: downloadSignal,
    redirect: "error",
  });
  if (response.status !== 200 || !response.body)
    throw new Error("Could not load the detailed character preview.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LPC_CONFIG_MAX_BYTES) {
        await reader.cancel();
        throw new Error("Character preview manifest is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  signal.throwIfAborted();
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};

/** Fetch only the visible designs' requested preview clip; gameplay scenes never call this loader. */
export const loadLpcPreviewCatalog = async (
  base: LpcCatalog,
  appearance: SpriteAppearance,
  animation: LpcAnimation,
  signal: AbortSignal,
): Promise<LpcCatalog> => {
  const profiles = [
    ...new Set(visibleSpriteLayers(base, appearance).map((layer) => layer.profile)),
  ];
  const detailed = await Promise.all(
    profiles.map(async (profile) => {
      const descriptor = base.designs[profile]?.preview;
      if (
        !descriptor ||
        descriptor.source !== (await lpcPreviewFingerprint(base, profile))
      )
        return null;
      const index =
        indexes.get(descriptor.index) ??
        lpcPreviewIndexValidator.parse(await readJson(descriptor.index, signal));
      if (index.source !== descriptor.source)
        throw new Error("Character preview index does not match the selected design.");
      signal.throwIfAborted();
      indexes.set(descriptor.index, index);
      if (indexes.size > 32) indexes.delete(indexes.keys().next().value!);
      const url = index.clips[animation];
      if (!url) return null;
      const manifest =
        manifests.get(url) ??
        lpcPreviewManifestValidator.parse(await readJson(url, signal));
      if (manifest.profile !== index.profile || manifest.revision !== index.revision)
        throw new Error("Character preview clip does not match its index.");
      if (manifest.animation !== animation || manifest.source !== descriptor.source)
        throw new Error("Character preview does not match the selected design.");
      const catalog = unpackLpcCatalog(manifest.catalog);
      if (
        Object.keys(catalog.designs)[0] !== manifest.profile ||
        Object.keys(catalog.entries).some(
          (key) => !key.startsWith(`${manifest.profile}/`),
        )
      )
        throw new Error("Character preview contains another design.");
      const metadata = base.designs[profile]!;
      const { preview: _preview, ...expected } = metadata;
      if (canonicalJson(catalog.designs[manifest.profile]) !== canonicalJson(expected))
        throw new Error("Character preview changes the outfit definition.");
      const variants = lpcConfigValidator.shape.variants.parse(
        expandLpcDesignVariants(catalog, manifest.profile),
      );
      const expectedVariants = Object.keys(base.entries)
        .filter((key) => key.startsWith(`${profile}/`))
        .map((key) => key.slice(profile.length + 1))
        .sort();
      if (
        canonicalJson(Object.keys(variants).sort()) !== canonicalJson(expectedVariants)
      )
        throw new Error("Character preview does not preserve every appearance choice.");
      if (
        catalog.layouts.some(
          (layout) =>
            !layout.clips[animation] ||
            Object.keys(layout.clips).some((clip) => clip !== animation),
        )
      )
        throw new Error("Character preview contains another animation.");
      if (
        ["male", "female"].some(
          (body) =>
            !variants[`${body}/${expected.defaultColor}/${expected.defaultEyes}`],
        ) ||
        Object.values(variants)
          .flat()
          .some(
            (sheet) =>
              Object.keys(sheet.layout.clips).some((clip) => clip !== animation) ||
              !sheet.layout.clips[animation],
          )
      )
        throw new Error(
          "Character preview must supply only the requested animation for both bodies.",
        );
      signal.throwIfAborted();
      manifests.set(url, manifest);
      if (manifests.size > 32) manifests.delete(manifests.keys().next().value!);
      // Standalone editor/thumbnail catalogs can alias the same immutable source design.
      return {
        ...catalog,
        designs: { [profile]: catalog.designs[manifest.profile]! },
        entries: Object.fromEntries(
          Object.entries(catalog.entries).map(([key, sheets]) => [
            `${profile}/${key.slice(manifest.profile.length + 1)}`,
            sheets,
          ]),
        ),
      };
    }),
  );
  signal.throwIfAborted();
  return detailed.some(Boolean)
    ? mergeLpcCatalogs([base, ...detailed.filter((catalog) => catalog !== null)])
    : base;
};
