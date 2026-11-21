import { beforeEach, describe, expect, it } from "bun:test";
import { POST } from "@/app/api/content-review/proposals/route";
import { GET } from "@/app/api/content-review/snapshot/route";
import {
  badge,
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
  gameAsset,
  jutsu,
} from "@/drizzle/schema";
import { battlefieldSceneOf } from "@/libs/contentReview/battlefield";
import { buildAuditSnapshot } from "@/libs/contentReview/snapshot";
import { VisualTag } from "@/validators/combat";
import { restoreEnvAfterEach } from "../../../setup/env";
import { insertJutsus } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const SECRET = "test-content-review-secret";
restoreEnvAfterEach("CRON_SECRET");

const snapshotRequest = (auth?: string, focus = "grammar") =>
  new Request(`https://example.com/api/content-review/snapshot?focus=${focus}`, {
    headers: auth ? { authorization: auth } : {},
  });

const submitRequest = (auth: string | undefined, body: string) =>
  new Request("https://example.com/api/content-review/proposals", {
    method: "POST",
    headers: {
      ...(auth ? { authorization: auth } : {}),
      "content-type": "application/json",
    },
    body,
  });

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("content review routes authenticate like the crons", () => {
  it("refuse requests without the cron secret", async () => {
    expect((await GET(snapshotRequest())).status).toBe(401);
    expect((await GET(snapshotRequest("Bearer wrong"))).status).toBe(401);
    expect((await POST(submitRequest(undefined, "{}"))).status).toBe(401);
  });

  it("refuse malformed submissions before touching the database", async () => {
    const auth = `Bearer ${SECRET}`;
    expect((await POST(submitRequest(auth, "not json"))).status).toBe(400);
    expect(
      (await POST(submitRequest(auth, JSON.stringify({ proposals: 1 })))).status,
    ).toBe(400);
    expect((await GET(snapshotRequest(auth, "everything"))).status).toBe(400);
  });
});

describeWithDatabase("content review routes end to end", () => {
  beforeEach(async () => {
    await resetTables(
      badge,
      contentProposal,
      contentProposalBasis,
      contentProposalChange,
      contentProposalMedia,
      gameAsset,
      jutsu,
    );
    await (await getTestDatabase()).insert(badge).values({
      id: "route-badge",
      name: "Route Badge",
      image: "https://ui0arpl8sm.ufs.sh/f/badge.webp",
      description: "Given for braveyr.",
    });
  });

  it("serves a snapshot whose versions a submission can cite", async () => {
    const auth = `Bearer ${SECRET}`;
    const response = await GET(snapshotRequest(auth));
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as {
      focus: string;
      proposalSchema: object;
      entities: {
        type: string;
        id: string;
        v: string;
        fields: Record<string, unknown>;
      }[];
    };
    expect(snapshot.focus).toBe("grammar");
    expect(snapshot.proposalSchema).toHaveProperty("properties.proposals");
    const entity = snapshot.entities.find((row) => row.id === "route-badge");
    expect(entity?.fields.description).toBe("Given for braveyr.");

    const submitted = await POST(
      submitRequest(
        auth,
        JSON.stringify({
          agentName: "codex · route test",
          focus: "grammar",
          proposals: [
            {
              title: "Fix the spelling of bravery",
              category: "GRAMMAR",
              rationale: "The description misspells bravery.",
              confidence: 95,
              usesUsageData: false,
              changes: [
                {
                  entityType: "BADGE",
                  entityId: "route-badge",
                  operation: "UPDATE",
                  set: [{ path: "description", valueJson: '"Given for bravery."' }],
                  media: [],
                },
              ],
              basis: [{ entityType: "BADGE", entityId: "route-badge", v: entity?.v }],
            },
          ],
        }),
      ),
    );
    expect(submitted.status).toBe(200);
    const result = (await submitted.json()) as {
      accepted: unknown[];
      refused: unknown[];
      summary: string;
    };
    expect(result.accepted).toHaveLength(1);
    expect(result.refused).toHaveLength(0);
    expect(result.summary).toContain("Accepted 1 of 1");
  });

  it("keeps paired media, rounds and targeting available to both presentation focuses", async () => {
    const { pattern, effect } = await seedBattlefieldContent();
    const db = await getTestDatabase();
    const [sound, animation, balance] = await Promise.all([
      buildAuditSnapshot(db, "sound"),
      buildAuditSnapshot(db, "animation"),
      buildAuditSnapshot(db, "balance"),
    ]);
    for (const snapshot of [sound, animation]) {
      const fields = snapshot.entities.find((row) => row.id === "phase-jutsu")?.fields;
      expect(fields).toMatchObject({
        description: "A field that remains for three rounds.",
        target: "GROUND",
        method: "AOE_LARGE_WALL_SHOOT",
        range: 3,
        methodSize: { x: 0, y: 2 },
        effects: [
          {
            rounds: 3,
            target: "COORDINATES",
            coordinateTargeting: pattern,
            projectileAnimation: effect.projectileAnimation,
            appearSfx: effect.appearSfx,
            disappearSfx: effect.disappearSfx,
            projectileScale: 0.8,
            groundStyle: "DECAL",
            groundOpacity: 0.6,
            groundFeather: 0.2,
            appearSfxPrimary: false,
            disappearSfxPrimary: true,
          },
        ],
      });
      const scene = battlefieldSceneOf("JUTSU", "phase-jutsu", fields ?? {});
      expect(scene?.effects[0]?.coordinateTargeting).toEqual(pattern);
      expect(
        snapshot.assets.find((asset) => asset.id === "phase-travel"),
      ).toMatchObject({ type: "ANIMATION", frames: 4, speed: 100 });
      expect(snapshot.assets.find((asset) => asset.id === "phase-cue")?.v).toMatch(
        /^[0-9a-f]{16}$/,
      );
    }
    expect(sound.assets.some((asset) => asset.id === "unused-animation")).toBe(false);
    expect(sound.assets.some((asset) => asset.id === "unused-sound")).toBe(true);
    expect(animation.assets.some((asset) => asset.id === "unused-animation")).toBe(
      true,
    );
    expect(animation.assets.some((asset) => asset.id === "unused-sound")).toBe(false);
    const mechanical = balance.entities.find((row) => row.id === "phase-jutsu")?.fields
      .effects;
    expect(mechanical).toMatchObject([{ type: "visual", rounds: 3 }]);
    for (const key of [
      "groundStyle",
      "groundOpacity",
      "groundFeather",
      "appearSfxPrimary",
      "disappearSfxPrimary",
    ]) {
      expect(mechanical).not.toHaveProperty(`0.${key}`);
    }
  });

  it("queues a projectile candidate and presentation controls without changing live content", async () => {
    await seedBattlefieldContent();
    const db = await getTestDatabase();
    const snapshot = await buildAuditSnapshot(db, "animation");
    const entity = snapshot.entities.find((row) => row.id === "phase-jutsu");
    const asset = snapshot.assets.find((row) => row.id === "unused-animation");
    expect(entity).toBeDefined();
    expect(asset).toBeDefined();
    const response = await POST(
      submitRequest(
        `Bearer ${SECRET}`,
        JSON.stringify({
          agentName: "content phase test",
          focus: "animation",
          proposals: [
            {
              title: "Improve the field's travelling effect",
              category: "ANIMATION",
              rationale:
                "Reuse the catalogue projectile with softer ground opacity and one arrival cue.",
              confidence: 90,
              usesUsageData: false,
              changes: [
                {
                  entityType: "JUTSU",
                  entityId: "phase-jutsu",
                  operation: "UPDATE",
                  set: [
                    { path: "effects.0.projectileScale", valueJson: "1.1" },
                    { path: "effects.0.groundOpacity", valueJson: "0.45" },
                    { path: "effects.0.appearSfxPrimary", valueJson: "true" },
                  ],
                  media: [
                    {
                      kind: "ANIMATION",
                      path: "effects.0.projectileAnimation",
                      catalogIds: [asset?.id],
                      search: null,
                      generate: null,
                    },
                  ],
                },
              ],
              basis: [
                { entityType: "JUTSU", entityId: entity?.id, v: entity?.v },
                { entityType: "GAME_ASSET", entityId: asset?.id, v: asset?.v },
              ],
            },
          ],
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: [{ title: "Improve the field's travelling effect" }],
      refused: [],
    });
    expect((await db.select().from(contentProposal))[0]?.status).toBe("PENDING");
    expect((await db.select().from(contentProposalMedia))[0]).toMatchObject({
      kind: "ANIMATION",
      path: "effects.0.projectileAnimation",
      source: "CATALOG",
      externalId: "unused-animation",
    });
    expect((await db.select().from(jutsu))[0]?.effects[0]?.projectileAnimation).toBe(
      "phase-travel",
    );
  });
});

/** A three-round field whose visual footprint differs from its clicked destination. */
const seedBattlefieldContent = async () => {
  const db = await getTestDatabase();
  const pattern = {
    origin: "TARGET" as const,
    selection: "ALL" as const,
    coordinates: [{ longitude: -1, latitude: 0 }],
    randomCount: 1,
  };
  const effect = VisualTag.parse({
    rounds: 3,
    target: "COORDINATES",
    coordinateTargeting: pattern,
    appearAnimation: "phase-arrival",
    projectileAnimation: "phase-travel",
    staticAnimation: "phase-loop",
    staticAssetPath: "phase-material",
    disappearAnimation: "phase-arrival",
    appearSfx: "phase-cue",
    disappearSfx: "phase-cue",
    animationScale: 1.5,
    projectileScale: 0.8,
    animationOffsetY: 0.2,
    groundStyle: "DECAL",
    groundOpacity: 0.6,
    groundFeather: 0.2,
    appearSfxPrimary: false,
    disappearSfxPrimary: true,
  });
  await insertJutsus([
    {
      id: "phase-jutsu",
      description: "A field that remains for three rounds.",
      target: "GROUND",
      range: 3,
      method: "AOE_LARGE_WALL_SHOOT",
      methodSize: { x: 0, y: 2 },
      effects: [effect],
    },
  ]);
  await db.insert(gameAsset).values([
    ...["phase-arrival", "phase-travel", "phase-loop", "unused-animation"].map(
      (id) => ({
        id,
        name: id,
        type: "ANIMATION" as const,
        hidden: false,
        image: `https://uploadthing.b-cdn.net/f/${id}.webp`,
        url: `https://uploadthing.b-cdn.net/f/${id}.webp`,
        frames: 4,
        speed: 100,
      }),
    ),
    {
      id: "phase-material",
      name: "Material",
      type: "STATIC",
      hidden: false,
      image: "https://uploadthing.b-cdn.net/f/material.webp",
      url: "https://uploadthing.b-cdn.net/f/material.webp",
    },
    ...["phase-cue", "unused-sound"].map((id) => ({
      id,
      name: id,
      type: "SFX" as const,
      hidden: false,
      image: `https://uploadthing.b-cdn.net/f/${id}.webp`,
      url: `https://uploadthing.b-cdn.net/f/${id}.mp3`,
    })),
  ]);
  return { pattern, effect };
};
