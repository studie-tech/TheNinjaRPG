// @vitest-environment node

import { describe, expect, it } from "vitest";
import { CONTENT_AUDIT_WEEKDAY_FOCUS } from "@/drizzle/constants";
import { epidemicAssetId, materializeChoice } from "@/libs/contentReview/media";
import { getAtPath, setAtPath, topLevelField } from "@/libs/contentReview/paths";
import {
  agentChangeViolation,
  applySetOperations,
  changedFields,
  isMediaPath,
  questRewardSignature,
} from "@/libs/contentReview/rules";
import { auditJsonSchema, resolveFocus } from "@/libs/contentReview/snapshot";
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

  it("keeps prices, visibility and quest rewards off limits", () => {
    expect(agentChangeViolation("ITEM", { cost: 100 }, { cost: 90 })).toMatch(/cost/);
    expect(agentChangeViolation("JUTSU", { hidden: false }, { hidden: true })).toMatch(
      /hidden/,
    );
    expect(agentChangeViolation("ITEM", { cost: 100 }, { cost: 100 })).toBeNull();
    const content = {
      reward: { reward_money: 100 },
      objectives: [{ description: "Go", reward_exp: 10 }],
    };
    const reworded = {
      ...content,
      objectives: [{ description: "Go now", reward_exp: 10 }],
    };
    const richer = {
      ...content,
      objectives: [{ description: "Go", reward_exp: 50 }],
    };
    expect(questRewardSignature(content)).toBe(questRewardSignature(reworded));
    expect(agentChangeViolation("QUEST", { content }, { content: reworded })).toBeNull();
    expect(agentChangeViolation("QUEST", { content }, { content: richer })).toMatch(
      /rewards/,
    );
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
  it("rotates the focus by UTC weekday", () => {
    const tuesday = new Date("2026-09-29T12:00:00.000Z");
    expect(resolveFocus("rotate", tuesday)).toBe(CONTENT_AUDIT_WEEKDAY_FOCUS[2]);
    expect(resolveFocus("sound", tuesday)).toBe("sound");
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
