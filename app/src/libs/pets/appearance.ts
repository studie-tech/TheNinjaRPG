/** Generate, inspect and bound companion artwork before the router accepts it. */
import sharp from "sharp";
import { PET_GENERATION_TIMEOUT_MS, type PetArtProvider } from "@/drizzle/constants";
import type { PetSpecies, UserPet } from "@/drizzle/schema";
import { validateSceneCharacterImage } from "@/libs/contentReview/sceneCharacter";
import { PIXEL_ART_RENDERING } from "@/libs/imagePrompts";
import { classifyNsfwImage } from "@/libs/moderator";
import {
  PET_AURAS,
  PET_CHARACTERISTICS,
  PET_PALETTES,
  PET_RANK_APPEARANCES,
} from "@/libs/pets/catalogue";
import { getPetSexClause } from "@/libs/pets/gender";
import { getPetRank } from "@/libs/pets/progression";
import {
  classifyPetAppearanceImage,
  validatePetAppearanceQuality,
} from "@/libs/pets/quality";
import { hasBackgroundHaze, normalizePetSprite } from "@/libs/pets/sprite";
import {
  generateNanoBananaImage,
  generateSpriteGPT,
  removeBackgroundToBuffer,
  uploadFileFromReplicate,
} from "@/libs/replicate";
import { servedUfsUrl } from "@/libs/uploadthing";

/** Authored traits and last accepted image needed for initial art, redraws or evolution. */
type AppearancePet = Pick<
  UserPet,
  | "userId"
  | "speciesId"
  | "paletteIndex"
  | "characteristicIndex"
  | "auraIndex"
  | "rank"
  | "artRank"
  | "avatar"
> & {
  /** Optional so legacy callers and pets adopted before gender existed keep the unsexed prompt. */
  gender?: UserPet["gender"];
  species: Pick<
    PetSpecies,
    "id" | "name" | "description" | "artDirection" | "rankConcepts"
  > | null;
};

/** Shared sprite rules; only the requested backdrop differs between providers. */
const getPetArtStyle = (provider: PetArtProvider) => `${PIXEL_ART_RENDERING}
TheNinja-RPG animal sprite: exactly ONE individual animal with ONE head and ONE connected body, natural species-appropriate adult anatomy and head-to-body proportions, no extra heads, duplicate animals or detached body parts. Cosmetic colours, markings, accessories and aura must preserve recognizable species anatomy. Bright eyes mean clear highlights at natural eye size, never an enlarged head or eyes or a shortened beak. Show strength through athletic native anatomy, a confident pose and a clean, readable silhouette with smooth species-specific fur, feathers or scales, never through bulk, spikes or stacked layers. Keep animal limb anatomy: no hands, human arms or humanoid torso. Use an elevated three-quarter isometric view with the face or beak pointing toward the viewer's LEFT. Fit the complete animal, including every crest tip, foot and tail, inside the central 80% of the canvas with empty 10% margins on all four sides. Keep the same canvas and view angle across ranks. Reframe when needed to fit a physically redesigned form inside the safe margins; uniform scaling, zoom or filling more of the frame alone is not strength.
Clean sprite composition overrides cinematic lighting: ${
  provider === "GPT"
    ? "draw on a fully transparent background, including every gap between legs, tails, wings and body, with no backdrop colour, haze or vignette."
    : "draw on a perfectly uniform light gray (#f0f0f0) background, including every gap between legs, tails, wings and body. The backdrop is not part of the animal."
} Redraw clean hard pixel boundaries; never trace or copy background pixels, grey/black fringe, shadows or artifacts from a reference. Express the selected aura only as this rank's aura stage allows, ON the animal, never as an exterior glow, outline, cloud, smoke, orbiting ring, floating particles or haze. No dark backdrop, gradient, ground patch, floor, pedestal, platform, cast/contact shadow, scenery, frame, text, watermark, humanoid body, weapons, blood, gore, sexual content, cartoon or chibi proportions, soft shading or smoothed edges.`;

const MAX_PET_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PET_IMAGE_PIXELS = 1024 * 1024;
/** Neutral backdrop for references and cutout input; matches the Nano Banana prompt. */
const PET_REFERENCE_BACKDROP = "#f0f0f0";

/** Only authored catalogue text enters the model; the player's chosen name is never a prompt. */
export const getPetAppearancePrompt = (
  pet: AppearancePet,
  provider: PetArtProvider,
) => {
  const { species, palette, characteristic, aura } = getPetAppearanceTraits(pet);
  const rank = getPetRank(pet.rank);
  const artDirection = species.artDirection
    ? ` Species art direction: ${toClause(species.artDirection)}.`
    : "";
  const identity = `${species.description}.${artDirection} Colour palette: ${palette.description}. Distinctive identity: ${characteristic.description}. Aura (shown only as this rank's aura stage allows): ${aura.description}.`;
  const multiTailed = isMultiTailedSpecies(species);
  const tailStage = multiTailed ? ` ${getPetTailStage(rank.rank)}` : "";
  const sexClause = getPetSexClause(pet.gender, rank.rank);
  const sexStage = sexClause ? ` ${sexClause}` : "";
  const maturity = `Evolution rank ${rank.rank} of 10 (${rank.name}): ${getPetRankConcept(species, rank.rank)}.${tailStage}${sexStage} ${getPetAuraStage(rank.rank)} Adapt every feature to this species: do not invent fur, limbs or other anatomy it does not naturally possess. Natural adult proportions override words such as young or small in the species description. Preserve its recognizable face, eye colours, primary palette and characteristic identity. Keep all limbs inside the frame.`;
  const edit =
    pet.artRank < pet.rank
      ? `Create a newly drawn full-body design of the next evolution, using the reference to identify the SAME individual animal rather than copying its pixels. Make this rank's named change obvious even at thumbnail size and keep the earlier rank features unless this rank refines or replaces them; you may simplify or remove clutter from the reference. Keep the animal the same size on the canvas as the reference unless this rank says it grows, never larger than 80% of the canvas, with the empty margins intact. It must look more advanced and more impressive than the reference through refinement, presence, markings, ornament or pose, never through extra bulk, fur, feather or scale layers, or filling the frame. Never draw spiky or porcupine-like masses, stacked layers, tails merged into the body or each other, ${multiTailed ? "more tails than this rank's tail stage allows" : "additional tails"}, wings, horns, extra limbs or other body parts this species does not naturally have, a smaller animal, or cartoon or chibi proportions. A near-copy, brighter outline or camera zoom is not an evolution. Preserve identity, not an identical pose or silhouette.`
      : "Redraw the supplied image as the SAME individual animal at its CURRENT rank, power and maturity. Do not evolve it, rank it up or age it.";
  return pet.avatar
    ? `${maturity} ${edit} The neutral reference backdrop is only for readability. Use the animal as an identity reference and redraw it cleanly; remove all prior background, shadow and image artifacts. ${identity} ${getPetArtStyle(provider)}`
    : `Full-body ${species.name} companion with recognizable species anatomy and natural adult proportions. ${identity} ${maturity} ${getPetArtStyle(provider)}`;
};

/**
 * Produce a moderated, complete, framed sprite and verify an evolution's visual identity.
 * Candidates are reviewed from their bytes; only the accepted sprite is uploaded, and
 * onUpload is awaited for it so the caller can track and clean up the stored file.
 * The caller persists the accepted image and its facing together in a guarded write.
 */
export const generatePetAppearance = async (
  pet: AppearancePet,
  provider: PetArtProvider,
  onUpload: (url: string) => Promise<void>,
  signal = AbortSignal.timeout(PET_GENERATION_TIMEOUT_MS),
) => {
  signal.throwIfAborted();
  const prompt = getPetAppearancePrompt(pet, provider);
  const { species } = getPetAppearanceTraits(pet);
  // Fetch the accepted reference before spending on an edit, then reuse it for identity review.
  const previousImage = pet.avatar
    ? await downloadPetImage(pet.avatar, signal)
    : undefined;
  /** Apply the same cutout, framing, moderation and visual checks to every candidate. */
  const generateCandidate = async (
    candidatePrompt: string,
    referenceImage?: Buffer,
  ) => {
    const image = await renderPetSprite({
      provider,
      prompt: candidatePrompt,
      referenceImage,
      userId: pet.userId,
      signal,
    });
    await checkModeration(image, signal);
    const verdict = await reviewVisualQuality(image, previousImage, pet, signal);
    return { image, verdict };
  };
  let candidate = await generateCandidate(prompt, previousImage);
  try {
    validatePetAppearanceQuality(candidate.verdict);
  } catch {
    // Correct visual failures once under the same deadline; safety/provider failures never retry.
    // Evolution repairs start from the accepted form so rejected cutout artifacts do not propagate.
    candidate = await generateCandidate(
      `Create a new full-body ${species.name} candidate from the supplied reference. The previous attempt was rejected for these visible defects: ${candidate.verdict.reason}. Correct those defects while following this complete request: ${prompt}`,
      previousImage ?? candidate.image,
    );
    // The strength comparison is subjective; a corrected sprite that passes every
    // objective check is kept rather than spending the player's limited attempts.
    validatePetAppearanceQuality(candidate.verdict, {
      requireStrongerEvolution: false,
    });
    // Expected and subjective, so a structured log line rather than a Sentry issue.
    if (!candidate.verdict.evolutionStronger)
      console.warn(
        "[pets] Accepted companion evolution not judged clearly stronger",
        JSON.stringify({
          speciesId: pet.speciesId,
          rank: pet.rank,
          reason: candidate.verdict.reason,
        }),
      );
  }
  signal.throwIfAborted();
  // Keep profiles and evolution references left-facing without another model prediction.
  // Lossless mirroring preserves the reviewed pixels and transparency.
  const stored =
    candidate.verdict.avatarFacing === "right"
      ? await sharp(candidate.image, { limitInputPixels: MAX_PET_IMAGE_PIXELS })
          .flop()
          .webp({ lossless: true, exact: true })
          .toBuffer()
      : candidate.image;
  signal.throwIfAborted();
  const uploaded = await uploadFileFromReplicate(
    "pet",
    new Blob([stored as BlobPart], { type: "image/webp" }),
    "webp",
    signal,
  );
  if (!uploaded.data) throw new Error("Could not upload the generated pet image");
  const avatar = servedUfsUrl(uploaded.data);
  await onUpload(avatar);
  signal.throwIfAborted();
  return { avatar, avatarFacing: "left" as const };
};

/**
 * Draw one candidate with the selected provider and return a framed 512px sprite.
 * Nano Banana is always cut out with 851-labs. GPT draws with native transparency; when that
 * leaves an opaque corner or a semi-transparent haze, the same cutout model is applied to the
 * image flattened on the neutral backdrop before the cutout is rejected. Every cutout must
 * pass the transparency check before it is trimmed and padded onto the shared canvas.
 */
const renderPetSprite = async (config: {
  provider: PetArtProvider;
  prompt: string;
  referenceImage?: Buffer;
  userId: string;
  signal: AbortSignal;
}) => {
  const { provider, prompt, userId, signal } = config;
  signal.throwIfAborted();
  // Explicit opaque reference pixels prevent transparent gaps being interpreted as black fur.
  const reference = config.referenceImage
    ? await sharp(config.referenceImage, { limitInputPixels: MAX_PET_IMAGE_PIXELS })
        .flatten({ background: PET_REFERENCE_BACKDROP })
        .png()
        .toBuffer()
    : undefined;
  signal.throwIfAborted();
  let cutout: Buffer;
  if (provider === "NANO_BANANA") {
    // Inline bytes reuse the downloaded image without another upload or provider request.
    cutout = await generateNanoBananaImage({
      preprompt: getPetArtStyle(provider),
      prompt,
      previousImg: reference
        ? `data:image/png;base64,${reference.toString("base64")}`
        : undefined,
      removeBg: true,
      backgroundRemovalModel: "851-labs",
      userId,
      size: "square",
      signal,
    });
  } else {
    cutout = await generateSpriteGPT({ prompt, reference, userId, signal });
    if (!(await isCleanCutout(cutout))) {
      const flattened = await sharp(cutout, { limitInputPixels: MAX_PET_IMAGE_PIXELS })
        .flatten({ background: PET_REFERENCE_BACKDROP })
        .png()
        .toBuffer();
      cutout = await removeBackgroundToBuffer(flattened, signal);
    }
  }
  signal.throwIfAborted();
  await validateSceneCharacterImage(cutout);
  if (await hasBackgroundHaze(cutout))
    throw new Error("Scene character background was not removed cleanly");
  const image = await normalizePetSprite(cutout);
  signal.throwIfAborted();
  return image;
};

/** Whether a native-transparency cutout passes the corner and haze checks unaided. */
const isCleanCutout = async (image: Buffer) => {
  try {
    await validateSceneCharacterImage(image);
  } catch {
    return false;
  }
  return !(await hasBackgroundHaze(image));
};

/** Review the candidate's species and, for evolution, the accepted prior identity. */
const reviewVisualQuality = async (
  image: Buffer,
  previousImage: Buffer | undefined,
  pet: AppearancePet,
  signal: AbortSignal,
) => {
  const { species, palette, characteristic, aura } = getPetAppearanceTraits(pet);
  return classifyPetAppearanceImage(
    {
      image,
      previousImage,
      species: species.name,
      identity: [
        palette.description,
        characteristic.description,
        aura.description,
      ].join(". "),
      rank: pet.rank,
      previousRank: pet.artRank,
      sex: pet.gender ?? undefined,
    },
    signal,
  );
};

/** A staff-authored concept for this species' rank, else the generic built-in milestone. */
const getPetRankConcept = (species: Pick<PetSpecies, "rankConcepts">, rank: number) => {
  const concept = species.rankConcepts[rank - 1];
  return concept?.trim() ? toClause(concept) : PET_RANK_APPEARANCES[rank - 1];
};

/** A species described (or art-directed) with plural tails grows them over the ranks. */
const isMultiTailedSpecies = (
  species: Pick<PetSpecies, "description" | "artDirection">,
) => /\btails\b/i.test(`${species.description} ${species.artDirection ?? ""}`);

/**
 * Tail count for multi-tailed species: one tail at rank 1, one more per rank, and the
 * species' full count from rank 7. Other species never receive tail-count wording,
 * which image models otherwise apply to single-tailed animals.
 */
const getPetTailStage = (rank: number) =>
  rank < 7
    ? `Tail stage: this multi-tailed species has exactly ${["ONE tail", "TWO tails", "THREE tails", "FOUR tails", "FIVE tails", "SIX tails"][rank - 1]} at this rank, each clearly separate; this overrides any tail count in its description.`
    : "Tail stage: it now shows its full number of tails (for example nine for a nine-tailed fox spirit), each clearly separate.";

/**
 * Aura intensity by rank, applied after built-in or staff rank concepts: early ranks keep
 * natural colouring, seasoned ranks paint markings, and only ascended ranks glow.
 */
const getPetAuraStage = (rank: number) =>
  rank <= 3
    ? "Aura stage: no aura effects yet, only plain natural colouring with no glowing, luminous or emissive markings and no wisps, sparks, droplets or motes; at most a faint tint of the aura's colour on the coat, feathers or scales."
    : rank <= 6
      ? "Aura stage: flat painted markings in the aura's colour; nothing glows yet and there are no wisps, sparks, droplets or motes."
      : "Aura stage: crisp luminous markings in the aura's colour, drawn on the body.";

/** Authored text is joined into sentences, so drop its own closing punctuation and spacing. */
const toClause = (text: string) => text.trim().replace(/[\s.]+$/, "");

/** Resolve saved catalogue IDs and reject corrupt identity before calling an image model. */
const getPetAppearanceTraits = (pet: AppearancePet) => {
  const species = pet.species;
  const palette = PET_PALETTES[pet.paletteIndex];
  const characteristic = PET_CHARACTERISTICS[pet.characteristicIndex];
  const aura = PET_AURAS[pet.auraIndex];
  if (!species || species.id !== pet.speciesId || !palette || !characteristic || !aura)
    throw new Error("Invalid pet appearance traits");
  return { species, palette, characteristic, aura };
};

/**
 * Download nonempty image bytes under the caller's cancellation and a local timeout.
 * Streaming enforces the byte cap even if upstream misstates Content-Length;
 * decoding and content checks are performed separately before acceptance.
 */
export const downloadPetImage = async (imageUrl: string, signal: AbortSignal) => {
  const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  downloadSignal.throwIfAborted();
  const response = await fetch(imageUrl, { signal: downloadSignal });
  if (!response.ok || !response.body)
    throw new Error("Could not download the generated image");
  if (Number(response.headers.get("content-length")) > MAX_PET_IMAGE_BYTES) {
    await response.body.cancel();
    throw new Error("The generated image is too large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PET_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("The generated image is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("The generated image is empty");
  return Buffer.concat(chunks, total);
};

/** Fail closed on unsafe moderation of the normalized WebP sprite. */
const checkModeration = async (image: Buffer, signal: AbortSignal) => {
  signal.throwIfAborted();
  // Fresh uploads may not yet be reachable by OpenAI, so send the sprite bytes inline.
  const dataUrl = `data:image/webp;base64,${image.toString("base64")}`;
  const result = await classifyNsfwImage(dataUrl, true, signal);
  if (result.isNsfw) throw new Error("The generated image did not pass content review");
};
