import { describe, expect, it } from "vitest";
import {
  getActivatedSkillIds,
  getRequiredSkillStatus,
  meetsRequiredSkill,
} from "@/libs/skillTree";

describe("getActivatedSkillIds", () => {
  it("keeps only activated skill ids", () => {
    expect(
      getActivatedSkillIds([
        { skillId: "a", activated: true },
        { skillId: "b", activated: false },
        { skillId: "c", activated: true },
      ]),
    ).toEqual(new Set(["a", "c"]));
  });
});

describe("meetsRequiredSkill", () => {
  it("uses only activated skills and lets AI bypass the requirement", () => {
    const active = getActivatedSkillIds([
      { skillId: "active", activated: true },
      { skillId: "inactive", activated: false },
    ]);
    expect(meetsRequiredSkill(null, active)).toBe(true);
    expect(meetsRequiredSkill("active", active)).toBe(true);
    expect(meetsRequiredSkill("inactive", active)).toBe(false);
    expect(meetsRequiredSkill("inactive", active, true)).toBe(true);
  });
});

describe("getRequiredSkillStatus", () => {
  const active = new Set(["active"]);

  it("treats no requirement and AI as met", () => {
    expect(getRequiredSkillStatus(null, null)).toBe("met");
    expect(getRequiredSkillStatus("active", null, true)).toBe("met");
    expect(getRequiredSkillStatus(null, active)).toBe("met");
  });

  it("returns pending while activated skills are still loading", () => {
    // An empty set means "loaded, none active"; null means "query not ready yet".
    expect(getRequiredSkillStatus("active", null)).toBe("pending");
    expect(getRequiredSkillStatus("active", new Set())).toBe("unmet");
  });

  it("returns met or unmet once skills have loaded", () => {
    expect(getRequiredSkillStatus("active", active)).toBe("met");
    expect(getRequiredSkillStatus("missing", active)).toBe("unmet");
  });
});
