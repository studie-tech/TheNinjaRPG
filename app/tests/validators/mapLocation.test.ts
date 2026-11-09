import { describe, expect, it } from "bun:test";
import { QuestValidator } from "@/validators/objectives";
import { isQuestPresentationOnlyChange } from "@/libs/mapLocations";

const draft = {
  name: "Tower quest",
  description: "Visit the tower",
  successDescription: "Done",
  questType: "mission",
  content: {
    objectives: [
      {
        id: "arrival",
        task: "move_to_location",
        structureAssetId: "tower",
        locationName: "Tower",
        locationDescription: "An old tower.",
        sector: 724,
        longitude: 2,
        latitude: 3,
      },
    ],
    reward: {},
  },
  hidden: false,
  publicLocations: true,
  consecutiveObjectives: false,
  startsAt: null,
  endsAt: null,
  tierLevel: null,
};

describe("quest structure authoring", () => {
  it("preserves structures and the public flag across validation", () => {
    expect(QuestValidator.parse(draft)).toMatchObject(draft);
  });
  it("rejects public randomized, hidden, bound, fractional and undescribed locations", () => {
    for (const changes of [
      { sectorType: "random" },
      { locationType: "random" },
      { hideLocation: true },
      { overworldPlacementId: "npc" },
      { latitude: 2.5 },
      { locationDescription: " " },
      { sector: 9999 },
    ]) {
      const result = QuestValidator.safeParse({
        ...draft,
        content: {
          ...draft.content,
          objectives: [{ ...draft.content.objectives[0], ...changes }],
        },
      });
      expect(result.success).toBe(false);
    }
  });
  it("defaults existing quests to private locations", () => {
    expect(
      QuestValidator.parse({ ...draft, publicLocations: undefined }).publicLocations,
    ).toBe(false);
  });
  it("keeps cosmetic changes out of gameplay run invalidation", () => {
    const before = QuestValidator.parse(draft);
    const after = structuredClone(before);
    after.publicLocations = false;
    after.content.objectives[0]!.locationDescription = "A rebuilt tower.";
    expect(isQuestPresentationOnlyChange(before, after)).toBe(true);
    after.content.objectives[0]!.longitude = 12;
    expect(isQuestPresentationOnlyChange(before, after)).toBe(false);
  });
  it("preserves designer positions through validation without invalidating quest runs", () => {
    const before = QuestValidator.parse(draft);
    expect(before.content.nodePositions).toBeUndefined();
    const nodePositions = { arrival: { x: -120.5, y: 900 } };
    const after = QuestValidator.parse({
      ...before,
      content: { ...before.content, nodePositions },
    });
    expect(after.content.nodePositions).toEqual(nodePositions);
    expect(isQuestPresentationOnlyChange(before, after)).toBe(true);
    after.content.objectives[0]!.longitude = 12;
    expect(isQuestPresentationOnlyChange(before, after)).toBe(false);
  });
  it("rejects malformed and non-finite designer coordinates", () => {
    for (const position of [
      { x: "12", y: 0 },
      { x: 0 },
      { x: Infinity, y: 0 },
      { x: 0, y: NaN },
    ]) {
      expect(
        QuestValidator.safeParse({
          ...draft,
          content: { ...draft.content, nodePositions: { arrival: position } },
        }).success,
      ).toBe(false);
    }
  });
});
