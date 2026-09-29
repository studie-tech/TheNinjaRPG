import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { UTApi } from "uploadthing/server";
import {
  CONTENT_PROPOSAL_MAX_CANDIDATES,
  type ContentProposalMediaKind,
  type ContentType,
  type GameAssetType,
  IMG_AVATAR_DEFAULT,
} from "@/drizzle/constants";
import type { ContentProposalMedia } from "@/drizzle/schema";
import { gameAsset } from "@/drizzle/schema";
import { getPrePrompts, REMOVE_BG_TYPES } from "@/libs/imagePrompts";
import { generateAndUploadAudio, txt2imgNanoBanana } from "@/libs/replicate";
import { extensionCustomId, servedUfsUrl } from "@/libs/uploadthing";
import type { DrizzleClient } from "@/server/db";
import {
  epidemicSfxDownloadUrl,
  isEpidemicConfigured,
  searchEpidemicSfx,
} from "./epidemic";

/**
 * Candidates for one field, in order: catalog assets the submitter picked, Epidemic Sound
 * matches for a described sound, then a generated sound or image. Searches and generations
 * are taken from `budget`, which the whole run shares. Uploaded candidates are copies on our
 * own storage, so reviewers can listen days later and the CDN serves them.
 */
export const collectCandidates = async (
  client: DrizzleClient,
  request: MediaRequest,
  budget: MediaBudget,
  contentType: ContentType,
) => {
  const out: MediaCandidate[] = [];
  const room = () => CONTENT_PROPOSAL_MAX_CANDIDATES - out.length;
  if (request.catalogIds.length > 0) {
    const rows = await client
      .select()
      .from(gameAsset)
      .where(inArray(gameAsset.id, request.catalogIds));
    // The submitter's order is its preference, and the first candidate is the default pick.
    const assets = [...new Set(request.catalogIds)].flatMap((id) =>
      rows.filter((row) => row.id === id),
    );
    for (const asset of assets) {
      if (room() <= 0) break;
      if (asset.hidden || asset.type !== ASSET_TYPE_FOR[request.kind]) continue;
      out.push({
        source: "CATALOG",
        kind: request.kind,
        externalId: asset.id,
        title: asset.name,
        url: request.kind === "SFX" ? asset.url : asset.image,
        fileKey: null,
        lengthMs: null,
        prompt: null,
      });
    }
  }
  if (
    request.kind === "SFX" &&
    request.search &&
    room() > 0 &&
    budget.searches > 0 &&
    isEpidemicConfigured()
  ) {
    budget.searches -= 1;
    const found = await searchEpidemicSfx(request.search, room()).catch(
      skipped("Epidemic Sound search", []),
    );
    for (const sfx of found) {
      const copy = await epidemicSfxDownloadUrl(sfx.id)
        .then((url) => copyToStorage(url, "mp3"))
        .catch(skipped(`Epidemic Sound ${sfx.id}`, null));
      if (!copy) continue;
      out.push({
        source: "EPIDEMIC",
        kind: "SFX",
        externalId: sfx.id,
        title: sfx.title.slice(0, 191),
        url: copy.url,
        fileKey: copy.key,
        lengthMs: sfx.lengthMs,
        prompt: request.search,
      });
    }
  }
  if (request.generate && room() > 0 && budget.generations > 0) {
    budget.generations -= 1;
    const prompt = request.generate;
    const generate = async () => {
      if (request.kind === "SFX") {
        return generateAndUploadAudio({
          relationId: "content-review",
          prompt,
          secondsTotal: 2,
        });
      }
      if (request.kind !== "IMAGE") return null;
      const images = await txt2imgNanoBanana({
        preprompt: getPrePrompts(contentType),
        prompt,
        removeBg: REMOVE_BG_TYPES.includes(contentType),
        userId: "content-review",
        width: 512,
        height: 512,
        size: "square",
      });
      return images[0] ?? null;
    };
    const url = await generate().catch(skipped(`Generating "${prompt}"`, null));
    if (url) {
      out.push({
        source: "GENERATED",
        kind: request.kind,
        externalId: null,
        title: `Generated: ${request.generate}`.slice(0, 191),
        url,
        fileKey: storageKeyOf(url),
        lengthMs: request.kind === "SFX" ? 2000 : null,
        prompt: request.generate,
      });
    }
  }
  return out;
};

/**
 * The value a chosen candidate writes into its field, plus the GameAsset to create, credited
 * to `reviewerId`, when a new sound becomes part of the game. Content image fields hold URLs;
 * effect fields hold asset ids.
 */
export const materializeChoice = (
  media: Pick<ContentProposalMedia, "source" | "kind" | "externalId" | "title" | "url">,
  reviewerId: string,
) => {
  if (media.kind === "IMAGE") return { value: media.url, asset: null };
  if (media.source === "CATALOG") return { value: media.externalId, asset: null };
  const id =
    media.source === "EPIDEMIC" && media.externalId
      ? epidemicAssetId(media.externalId)
      : nanoid();
  return {
    value: id,
    asset: {
      id,
      name: media.title.slice(0, 191),
      type: ASSET_TYPE_FOR[media.kind],
      image: IMG_AVATAR_DEFAULT,
      url: media.url ?? IMG_AVATAR_DEFAULT,
      frames: 1,
      speed: 1,
      hidden: false,
      folder: media.source === "EPIDEMIC" ? "epidemic" : "generated",
      licenseDetails:
        media.source === "EPIDEMIC"
          ? `Epidemic Sound · ${media.externalId} · ${media.title}`.slice(0, 512)
          : "TNR (generated)",
      createdByUserId: reviewerId,
    } satisfies typeof gameAsset.$inferInsert,
  };
};

/** Library id of an Epidemic Sound effect: one asset per sound, however often it is picked. */
export const epidemicAssetId = (epidemicId: string) => `epidemic-${epidemicId}`;

/**
 * Add one Epidemic Sound effect to the asset library for the Epidemic tab of the SFX picker,
 * copying it to our storage unless the library already holds it. Returns the library row and
 * whether this call created it.
 */
export const importEpidemicSfx = async (
  client: DrizzleClient,
  reviewerId: string,
  sfx: { epidemicId: string; title: string },
) => {
  const existing = await client.query.gameAsset.findFirst({
    where: eq(gameAsset.id, epidemicAssetId(sfx.epidemicId)),
  });
  if (existing) return { asset: existing, created: false };
  const copy = await copyToStorage(await epidemicSfxDownloadUrl(sfx.epidemicId), "mp3");
  const { asset } = materializeChoice(
    {
      source: "EPIDEMIC",
      kind: "SFX",
      externalId: sfx.epidemicId,
      title: sfx.title,
      url: copy.url,
    },
    reviewerId,
  );
  if (!asset) throw new Error("Epidemic sounds always become assets");
  const inserted = await client
    .insert(gameAsset)
    .values(asset)
    .onDuplicateKeyUpdate({ set: { id: asset.id } });
  if (inserted.rowsAffected === 1) return { asset, created: true };
  // A simultaneous import of the same sound won; its row stands and this copy goes again.
  const [kept] = await Promise.all([
    client.query.gameAsset.findFirst({ where: eq(gameAsset.id, asset.id) }),
    deleteStoredFiles([copy.key]).catch((error: unknown) =>
      console.error(`Could not delete the extra copy of ${asset.id}`, error),
    ),
  ]);
  return { asset: kept ?? asset, created: false };
};

/**
 * Remove uploaded candidate files by their UploadThing customIds. Throws when storage reports
 * a failure, so callers can keep the rows that point at the files and retry.
 */
export const deleteStoredFiles = async (keys: string[]) => {
  if (keys.length === 0) return;
  const result = await new UTApi().deleteFiles(keys, { keyType: "customId" });
  if (!result.success)
    throw new Error("Could not delete suggestion media from storage");
};

/**
 * A candidate whose service fails is left out rather than failing the suggestion, which keeps
 * the candidates already copied to storage recorded, and so removable.
 */
const skipped =
  <T>(what: string, fallback: T) =>
  (error: unknown) => {
    console.error(`${what} failed; leaving it out of the candidates`, error);
    return fallback;
  };

/** Copy a remote file to our storage under a new customId; returns its served URL and key. */
const copyToStorage = async (url: string, extension: string) => {
  const customId = extensionCustomId(`file.${extension}`);
  const uploaded = await new UTApi().uploadFilesFromUrl({
    url,
    name: customId,
    customId,
  });
  if (!uploaded.data) throw new Error("Could not copy the file to storage");
  return { url: servedUfsUrl(uploaded.data), key: customId };
};

/** Storage key of a file we uploaded, read from its served URL (/f/<customId>), or null. */
const storageKeyOf = (url: string) => {
  try {
    return /\/f\/([^/?#]+)$/.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
};

/** Asset type that serves each media kind: catalog picks must have it, new sounds get it. */
const ASSET_TYPE_FOR: Record<ContentProposalMediaKind, GameAssetType> = {
  SFX: "SFX",
  ANIMATION: "ANIMATION",
  IMAGE: "STATIC",
};

/** What a suggestion asks for one media field: catalog picks, a sound search, a prompt. */
type MediaRequest = {
  kind: ContentProposalMediaKind;
  path: string;
  catalogIds: string[];
  search: string | null;
  generate: string | null;
};

/** Searches and generations left in one audit run; both cost money or quota. */
export type MediaBudget = { searches: number; generations: number };

/** A candidate as ContentProposalMedia stores it, before it is tied to a suggestion. */
type MediaCandidate = Pick<
  ContentProposalMedia,
  "source" | "kind" | "externalId" | "title" | "url" | "fileKey" | "lengthMs" | "prompt"
>;
