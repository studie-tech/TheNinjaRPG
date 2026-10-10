
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { ContentAuditFocuses } from "@/drizzle/constants";
import { ENTITY_CONFIG } from "@/libs/contentReview/entities";
import * as epidemic from "@/libs/contentReview/epidemic";
import {
  collectCandidates,
  epidemicAssetId,
  materializeChoice,
} from "@/libs/contentReview/media";
import * as replicate from "@/libs/replicate";
import type { DrizzleClient } from "@/server/db";
import {
  getAtPath,
  isMediaPath,
  setAtPath,
  topLevelField,
} from "@/libs/contentReview/paths";
import {
  agentChangeViolation,
  applySetOperations,
  changedFields,
} from "@/libs/contentReview/rules";
import {
  auditJsonSchema,
  leadingRowsWithin,
  resolveFocus,
} from "@/libs/contentReview/snapshot";
import { normalizeEditable } from "@/libs/contentReview/submit";
import { canonicalJson, contentVersion, sameValue } from "@/libs/contentReview/version";
import { agentAuditOutputSchema } from "@/validators/contentReview";

describe("content versions", () => {
  it("ignores key order, so a re-read row keeps its version", () => {
    const a = { name: "Fireball", effects: [{ power: 5, type: "damage" }] };
    const b = { effects: [{ type: "damage", power: 5 }], name: "Fireball" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(contentVersion(a)).toBe(contentVersion(b));
    expect(contentVersion(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when any editable value changes", () => {
    const base = { name: "Fireball", effects: [{ power: 5 }] };
    expect(contentVersion(base)).not.toBe(
      contentVersion({ ...base, effects: [{ power: 5.1 }] }),
    );
  });

  it("treats dates and undefined fields like JSON does", () => {
    const at = new Date("2026-09-29T10:00:00.000Z");
    expect(canonicalJson({ at, gone: undefined })).toBe('{"at":"2026-09-29T10:00:00.000Z"}');
    expect(sameValue([1, { a: null }], [1, { a: null }])).toBe(true);
    expect(sameValue("1", 1)).toBe(false);
  });
});

describe("paths", () => {
  it("writes a copy and leaves the original untouched", () => {
    const original = { effects: [{ power: 5, type: "damage" }] };
    const next = setAtPath(original, "effects.0.power", 4);
    expect(getAtPath(next, "effects.0.power")).toBe(4);
    expect(original.effects[0]?.power).toBe(5);
    expect(topLevelField("effects.0.power")).toBe("effects");
  });

  it("appends at the next index but refuses holes and prototype paths", () => {
    const original = { effects: [{ power: 5 }] };
    expect(setAtPath(original, "effects.1", { power: 1 }).effects).toHaveLength(2);
    expect(() => setAtPath(original, "effects.5.power", 1)).toThrow(/out of range/);
    expect(() => setAtPath(original, "__proto__.polluted", 1)).toThrow(/not allowed/);
  });
});

describe("audit rules", () => {
  it("only lets the audit set editable fields of the entity", () => {
    const result = applySetOperations("BADGE", { name: "Old" }, [
      { path: "createdAt", value: "2020-01-01" },
    ]);
    expect(result).toEqual({ ok: false, reason: "Badge has no editable field createdAt" });
    const ok = applySetOperations("BADGE", { name: "Old", description: "x" }, [
      { path: "name", value: "New" },
    ]);
    expect(ok.ok && ok.editable.name).toBe("New");
  });

  it("keeps reputation and seichi silver amounts off limits wherever they sit", () => {
    const item = { cost: 100, repsCost: 0, seichiSilverCost: 0, hidden: false };
    expect(agentChangeViolation(item, { ...item, cost: 90, hidden: true })).toBeNull();
    expect(agentChangeViolation(item, { ...item, repsCost: 5 })).toMatch(/^repsCost:/);
    expect(agentChangeViolation(item, { ...item, seichiSilverCost: 5 })).toMatch(
      /^seichiSilverCost:/,
    );
    const effect = { type: "noncombatconsumereward", reward_money: 50, reward_reputation: 2 };
    expect(
      agentChangeViolation({ effects: [effect] }, { effects: [{ ...effect, reward_money: 80 }] }),
    ).toBeNull();
    expect(
      agentChangeViolation(
        { effects: [effect] },
        { effects: [{ ...effect, reward_reputation: 3 }] },
      ),
    ).toMatch(/^effects\.0\.reward_reputation:/);
    const content = {
      reward: { reward_money: 100, reward_seichi_silver: 10 },
      objectives: [{ description: "Go", reward_exp: 10 }],
    };
    const extended = {
      reward: { reward_money: 500, reward_seichi_silver: 10 },
      objectives: [...content.objectives, { description: "Return", reward_reputation: 0 }],
    };
    expect(agentChangeViolation({ content }, { content: extended })).toBeNull();
    expect(
      agentChangeViolation({ content }, { content: { ...content, reward: {} } }),
    ).toMatch(/^content\.reward\.reward_seichi_silver:/);
    // A draft is checked against no fields, so it may not bring an amount of its own.
    expect(agentChangeViolation({}, item)).toBeNull();
    expect(agentChangeViolation({}, { ...item, repsCost: 50 })).toMatch(/^repsCost:/);
  });

  it("reports only fields whose values changed", () => {
    expect(
      changedFields(
        { name: "A", effects: [{ power: 1 }], description: "x" },
        { name: "A", effects: [{ power: 2 }], description: "x" },
      ),
    ).toEqual({ before: { effects: [{ power: 1 }] }, after: { effects: [{ power: 2 }] } });
  });

  it("matches media kinds to the effect fields that hold them", () => {
    expect(isMediaPath("SFX", "effects.0.appearSfx")).toBe(true);
    expect(isMediaPath("SFX", "effects.0.appearAnimation")).toBe(false);
    expect(isMediaPath("ANIMATION", "effects.1.staticAnimation")).toBe(true);
    expect(isMediaPath("IMAGE", "image")).toBe(true);
  });

  it("sorts order-insensitive lists so reordering is not a change", () => {
    const one = normalizeEditable("AI", { jutsus: ["b", "a"], items: [{ ids: ["z"] }, { ids: ["y"] }] });
    const two = normalizeEditable("AI", { jutsus: ["a", "b"], items: [{ ids: ["y"] }, { ids: ["z"] }] });
    expect(sameValue(one, two)).toBe(true);
  });
});

describe("audit snapshot helpers", () => {
  it("takes the focuses in turn, one per scheduled run", () => {
    const at = (time: string) => resolveFocus("rotate", new Date(`2026-09-30T${time}Z`));
    const runs = ["00:40", "03:40", "06:40", "09:40", "12:40", "15:40", "18:40", "21:40"].map(
      (time) => at(`${time}:00`),
    );
    const first = ContentAuditFocuses.findIndex((focus) => focus === runs[0]);
    expect(runs).toEqual<Array<ReturnType<typeof resolveFocus> | undefined>>(
      runs.map((_, index) => ContentAuditFocuses[(first + index) % ContentAuditFocuses.length]),
    );
    // A run that GitHub starts late keeps the focus of its window.
    expect(at("02:59:59")).toBe<ReturnType<typeof resolveFocus> | undefined>(runs[0]);
    // The rotation carries on across days instead of restarting at midnight.
    expect(resolveFocus("rotate", new Date("2026-10-01T00:40:00Z"))).toBe<ReturnType<typeof resolveFocus> | undefined>(runs[1]);
    expect(resolveFocus("sound")).toBe("sound");
  });

  it("emits a schema in the strict structured-output subset", () => {
    const schema = auditJsonSchema() as Record<string, unknown>;
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      for (const key of ["format", "pattern", "minLength", "maxLength", "$schema"]) {
        expect(record).not.toHaveProperty(key);
      }
      if (record.type === "object" && record.properties) {
        expect(record.additionalProperties).toBe(false);
        expect(record.required).toEqual(Object.keys(record.properties as object));
      }
      Object.values(record).forEach(visit);
    };
    visit(schema);
    expect(Object.keys((schema.properties ?? {}) as object)).toEqual(["proposals"]);
  });

  it("accepts the example proposal the skill documents", () => {
    const parsed = agentAuditOutputSchema.safeParse({
      proposals: [
        {
          title: "Fix spelling in Water Prison's description",
          category: "GRAMMAR",
          rationale: "Three spelling errors in the description.",
          confidence: 90,
          usesUsageData: false,
          changes: [
            {
              entityType: "JUTSU",
              entityId: "jutsu-1",
              operation: "UPDATE",
              set: [{ path: "description", valueJson: '"The user traps their opponent."' }],
              media: [],
            },
          ],
          basis: [{ entityType: "JUTSU", entityId: "jutsu-1", v: "a91f3c07d2b44e10" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("chosen media", () => {
  it("gives an Epidemic sound one library id however often it is picked", () => {
    const pick = {
      source: "EPIDEMIC" as const,
      kind: "SFX" as const,
      externalId: "7c9ac26f-3c04-4fbd-8a70-049cd775c094",
      title: "Water, Splash",
      url: "https://ui0arpl8sm.ufs.sh/f/water.mp3",
    };
    const first = materializeChoice(pick, "reviewer");
    const second = materializeChoice(pick, "another-reviewer");
    expect(first.value).toBe(epidemicAssetId(pick.externalId));
    expect(second.asset?.id).toBe(first.asset?.id);
    expect(first.asset).toMatchObject({ type: "SFX", folder: "epidemic" });
  });

  it("uses a catalog pick as it is and never adds an asset for it", () => {
    const pick = {
      source: "CATALOG" as const,
      kind: "ANIMATION" as const,
      externalId: "asset-1",
      title: "Splash",
      url: null,
    };
    expect(materializeChoice(pick, "reviewer")).toEqual({ value: "asset-1", asset: null });
  });
});

describe("candidate collection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves out candidates whose service fails instead of failing the suggestion", async () => {
    vi.spyOn(epidemic, "isEpidemicConfigured").mockReturnValue(true);
    vi.spyOn(epidemic, "searchEpidemicSfx").mockRejectedValue(new Error("Epidemic is down"));
    vi.spyOn(replicate, "generateAndUploadAudio").mockRejectedValue(
      new Error("Replicate is down"),
    );
    const found = await collectCandidates(
      {} as DrizzleClient,
      {
        kind: "SFX",
        path: "effects.0.appearSfx",
        catalogIds: [],
        search: "fiery whoosh",
        generate: "a fiery whoosh",
      },
      { searches: 1, generations: 1 },
      "jutsu",
    );
    expect(found).toEqual([]);
  });
});

describe("snapshot size", () => {
  it("keeps the leading rows that fit and stops at the first that does not", () => {
    const rows = [{ id: "aaaa" }, { id: "bb" }, { id: "cccccccc" }, { id: "d" }];
    const size = (row: { id: string }) => Buffer.byteLength(JSON.stringify(row)) + 1;
    const budget = size({ id: "aaaa" }) + size({ id: "bb" }) + 3;
    expect(leadingRowsWithin(rows, budget)).toEqual([{ id: "aaaa" }, { id: "bb" }]);
    expect(leadingRowsWithin(rows, 0)).toEqual([]);
  });
});

describe("audit output schema", () => {
  it("fits a draft that sets every editable field of an item", () => {
    const set = ENTITY_CONFIG.ITEM.editableKeys.map((path) => ({ path, valueJson: "null" }));
    const parsed = agentAuditOutputSchema.safeParse({
      proposals: [
        {
          title: "New item draft",
          category: "NEW_CONTENT",
          rationale: "A complete item needs every field.",
          confidence: null,
          usesUsageData: false,
          changes: [
            { entityType: "ITEM", entityId: null, operation: "CREATE", set, media: [] },
          ],
          basis: [],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});


describe("scene cast media", () => {
  it("uses indexed IMAGE media for main and objective casts, not whole arrays", () => {
    expect(isMediaPath("IMAGE", "content.sceneCharacters.0")).toBe(true);
    expect(isMediaPath("IMAGE", "content.objectives.2.sceneCharacters.1")).toBe(true);
    expect(isMediaPath("IMAGE", "content.sceneCharacters")).toBe(false);
    expect(isMediaPath("SFX", "content.sceneCharacters.0")).toBe(false);
  });
  it("writes catalog character ids and creates character assets for generated cutouts", () => {
    const path = "content.sceneCharacters.0";
    const base = { kind: "IMAGE" as const, path, title: "Village representative", url: "https://example.com/elder.png" };
    expect(materializeChoice({ ...base, source: "CATALOG", externalId: "elder" }, "staff")).toEqual({ value: "elder", asset: null });
    const generated = materializeChoice({ ...base, source: "GENERATED", externalId: null }, "staff");
    expect(generated.asset).toMatchObject({ id: generated.value, type: "SCENE_CHARACTER", image: base.url, createdByUserId: "staff" });
    expect(materializeChoice({ ...base, path: "image", source: "GENERATED", externalId: null }, "staff")).toEqual({ value: base.url, asset: null });
  });
});


describe("generated scene candidates", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { vi.restoreAllMocks(); globalThis.fetch = originalFetch; });
  it("uses cutout generation for quest casts and rejects opaque output", async () => {
    const generate = vi.spyOn(replicate, "txt2imgNanoBanana").mockResolvedValue(["https://example.com/character.png"]);
    const pixels = Buffer.alloc(128 * 128 * 4);
    for (let y = 20; y < 110; y += 1) for (let x = 40; x < 90; x += 1) pixels[(y * 128 + x) * 4 + 3] = 255;
    const cutout = await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
    const fetchImage = vi.fn().mockResolvedValue(new Response(cutout));
    globalThis.fetch = fetchImage;
    const request = { kind: "IMAGE" as const, path: "content.objectives.0.sceneCharacters.0", catalogIds: [], search: null, generate: "A dignified village representative" };
    const candidates = await collectCandidates({} as DrizzleClient, request, { searches: 0, generations: 1 }, "quest");
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ removeBg: true, width: 341, height: 512, size: "portrait", preprompt: expect.stringContaining("scene character") }));
    expect(candidates).toHaveLength(1);
    const opaque = await sharp({ create: { width: 128, height: 128, channels: 3, background: "white" } }).png().toBuffer();
    fetchImage.mockResolvedValue(new Response(opaque));
    expect(await collectCandidates({} as DrizzleClient, request, { searches: 0, generations: 1 }, "quest")).toEqual([]);
  });
});
