import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  getQuestMapLocations,
  groupMapLocations,
  publicQuestLocations,
} from "@/libs/mapLocations";
import {
  findActionableBoundObjective,
  validateFriendlyPlacementBindings,
} from "@/libs/overworldAi";
import { getBoundObjectiveCandidates, getNewTrackers } from "@/libs/quest";
import { getPublicQuestUser } from "@/libs/quest/projection";
import { verifyQuestContentForSave } from "@/libs/quest/validation";
import { travelActorRecipes } from "@/libs/rendering/scenes/travelActors";
import {
  sectorSpriteDescriptions,
  type WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import type { UserWithRelations } from "@/routers/profile";
import { updateUserCache } from "@/utils/userCache";
import {
  type AllObjectivesType,
  DefeatOpponents,
  DeliverItem,
  DialogObjective,
  MoveToObjective,
  QuestValidator,
} from "@/validators/objectives";

const move = MoveToObjective.parse({
  id: "arrival",
  task: "move_to_location",
  sector: 724,
  longitude: 4,
  latitude: 5,
  structureAssetId: "tower",
  locationName: "Old watchtower",
  locationDescription: "A ruined tower overlooks the valley.",
  nextObjectiveId: "dialog",
  description: "Secret quest instructions",
  reward_money: 900,
});
const dialog = DialogObjective.parse({
  id: "dialog",
  task: "dialog",
  nextObjectiveId: [{ text: "Continue", nextObjectiveId: "end" }],
});
const quest = {
  id: "q1",
  hidden: false,
  startsAt: null,
  endsAt: null,
  consecutiveObjectives: true,
  content: { objectives: [move, dialog] },
};
const user = (goals: unknown[], overrides = {}) =>
  ({
    sector: 724,
    userQuests: [{ questId: "q1", quest, completed: 0, endAt: null }],
    questData: [{ id: "q1", goals }],
    ...overrides,
  }) as unknown as NonNullable<UserWithRelations>;
const arrival = { id: "arrival", sector: 724, longitude: 4, latitude: 5, done: false };

describe("public quest landmarks", () => {
  it("returns only neutral presentation, with no descriptions, rewards, or branches from the quest", () => {
    const locations = publicQuestLocations([quest]);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toEqual({
      id: "quest:q1:arrival",
      questId: "q1",
      objectiveId: "arrival",
      sector: 724,
      longitude: 4,
      latitude: 5,
      name: "Old watchtower",
      description: move.locationDescription,
      assetId: "tower",
      scale: 1,
    });
    expect(JSON.stringify(locations)).not.toContain("Secret");
    expect(JSON.stringify(locations)).not.toContain("reward");
    expect(JSON.stringify(locations)).not.toContain("nextObjectiveId");
  });
  it("excludes hidden, future, expired, randomized and masked locations", () => {
    for (const override of [
      { hidden: true },
      { startsAt: "2999-01-01" },
      { endsAt: "2000-01-01" },
    ]) {
      expect(publicQuestLocations([{ ...quest, ...override }])).toEqual([]);
    }
    for (const override of [
      { sectorType: "random" },
      { locationType: "random" },
      { hideLocation: true },
      { overworldPlacementId: "npc" },
    ]) {
      expect(
        publicQuestLocations([
          {
            ...quest,
            content: { objectives: [{ ...move, ...override } as typeof move] },
          },
        ]),
      ).toEqual([]);
    }
  });
  it.each([
    ["2026-10-18T23:59:59.999Z", 1],
    ["2026-10-19T00:00:00.000Z", 0],
    ["2026-10-19T17:17:00.000Z", 0],
  ])("expires public landmarks at midnight UTC of endsAt (%s)", (now, count) => {
    expect(
      publicQuestLocations([{ ...quest, endsAt: "2026-10-19" }], new Date(now)),
    ).toHaveLength(count);
  });
  it.each([
    ["2026-10-18T23:59:59.999Z", 0],
    ["2026-10-19T00:00:00.000Z", 1],
    ["2026-10-19T17:17:00.000Z", 1],
  ])("shows public landmarks from midnight UTC of startsAt (%s)", (now, count) => {
    expect(
      publicQuestLocations([{ ...quest, startsAt: "2026-10-19" }], new Date(now)),
    ).toHaveLength(count);
  });
  it("keeps real sector 1337 and tile zero valid", () => {
    expect(
      publicQuestLocations([
        {
          ...quest,
          content: {
            objectives: [{ ...move, sector: 1337, latitude: 0, longitude: 0 }],
          },
        },
      ])[0],
    ).toMatchObject({ sector: 1337, longitude: 0, latitude: 0 });
  });
});

describe("personal structure lifecycle", () => {
  it("does not show private structures to visitors", () => {
    expect(getQuestMapLocations(user([], { userQuests: [] }), [])).toEqual([]);
  });
  it("merges personal actions into the existing public landmark", () => {
    const result = getQuestMapLocations(user([arrival]), publicQuestLocations([quest]));
    expect(result).toHaveLength(1);
    expect(result[0]?.active).toBe(true);
  });
  it("follows the resolved private tracker, without changing source state", () => {
    const actor = user([{ ...arrival, longitude: 8 }]);
    const original = structuredClone(actor);
    expect(getQuestMapLocations(actor, [])[0]?.longitude).toBe(8);
    expect(actor).toEqual(original);
  });
  it("keeps an explicitly located starting dialog through tracker initialization, rendering and movement", async () => {
    const definition = QuestValidator.parse({
      name: "Tower quest",
      description: "Visit the tower",
      successDescription: "Done",
      questType: "mission",
      hidden: false,
      publicLocations: false,
      consecutiveObjectives: true,
      startsAt: null,
      endsAt: null,
      tierLevel: null,
      content: {
        objectives: [
          DialogObjective.parse({
            ...move,
            id: "STARTING",
            task: "dialog",
            nextObjectiveId: dialog.nextObjectiveId,
          }),
          { id: "end", task: "win_quest" },
        ],
        reward: {},
        sceneCharacters: ["guide"],
      },
    });
    expect(verifyQuestContentForSave(definition.content.objectives, true).check).toBe(
      true,
    );
    const actor = user([], {
      userId: "u1",
      status: "AWAKE",
      level: 50,
      rank: "JONIN",
      role: "USER",
      villageId: "v1",
      isOutlaw: false,
      bloodlineId: null,
      longitude: 0,
      latitude: 0,
      village: { id: "v1", sector: 724 },
      activeWars: [],
      completedQuests: [],
      userQuests: [
        {
          id: "uq-q1",
          questId: "q1",
          completed: 0,
          endAt: null,
          previousAttempts: 0,
          previousCompletes: 0,
          quest: { ...definition, id: "q1" },
        },
      ],
      questData: [],
    });
    actor.questData = getNewTrackers(actor, [{ task: "any" }]).trackers;
    expect(actor.questData[0]?.goals[0]).not.toHaveProperty("sector");
    expect(await renderThenMove(getPublicQuestUser(actor))).toMatchObject([
      {
        assetId: "tower",
        objectiveId: "STARTING",
        sector: 724,
        longitude: 4,
        latitude: 5,
        active: true,
      },
    ]);
  });
  it("keeps resolved random tracker coordinates authoritative, including tile zero", async () => {
    const actor = structuredClone(
      user([{ ...arrival, sector: 725, longitude: 0, latitude: 0 }]),
    );
    Object.assign(actor.userQuests[0]!.quest.content.objectives[0]!, {
      sectorType: "random",
      locationType: "random",
    });
    expect((await renderThenMove(actor))[0]).toMatchObject({
      sector: 725,
      longitude: 0,
      latitude: 0,
    });
  });
  it("keeps concealed targets hidden outside their sector after public projection", async () => {
    for (const sector of [724, 725]) {
      const actor = structuredClone(user([arrival], { sector, role: "USER" }));
      Object.assign(actor.userQuests[0]!.quest.content.objectives[0]!, {
        hideLocation: true,
      });
      const projected = getPublicQuestUser(actor);
      expect(await renderThenMove(projected)).toHaveLength(sector === 724 ? 1 : 0);
      if (sector === 725)
        expect(projected.questData![0]!.goals[0]).not.toHaveProperty("sector");
    }
  });
  it("retains the building when arrival advances to a dialog at the same location", async () => {
    const result = await renderThenMove(
      user([
        { ...arrival, done: true, selectedNextObjectiveId: "dialog" },
        { ...arrival, id: "dialog" },
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      assetId: "tower",
      objectiveId: "dialog",
      active: true,
    });
  });
  it("removes private scenery on departure to another objective location", () => {
    expect(
      getQuestMapLocations(
        user([
          { ...arrival, done: true, selectedNextObjectiveId: "dialog" },
          { ...arrival, id: "dialog", longitude: 9 },
        ]),
        [],
      ),
    ).toEqual([]);
  });
  it("keeps public scenery neutral after completion or abandonment", () => {
    const publicLocations = publicQuestLocations([quest]);
    expect(getQuestMapLocations(user([], { userQuests: [] }), publicLocations)).toEqual(
      publicLocations,
    );
  });
  it("does not draw masked coordinates or unavailable branches", () => {
    expect(
      getQuestMapLocations(
        user([{ ...arrival, latitude: 1337, longitude: 1337, sector: 1337 }]),
        [],
      ),
    ).toEqual([]);
    expect(getQuestMapLocations(user([{ ...arrival, id: "dialog" }]), [])).toEqual([]);
  });
  it("groups co-located landmarks deterministically while retaining all quest actions", () => {
    const location = publicQuestLocations([quest])[0]!;
    const groups = groupMapLocations([
      location,
      { ...location, id: "q2", active: true },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((l) => l.id)).toEqual(["q2", location.id]);
  });
  it("uses the live fixed NPC location and retains its interaction binding", () => {
    const actor = structuredClone(user([arrival]));
    actor.userQuests[0]!.quest.content.objectives[0] = {
      ...move,
      overworldPlacementId: "npc",
    };
    expect(getQuestMapLocations(actor, [])).toEqual([]);
    expect(
      getQuestMapLocations(
        actor,
        [],
        [{ npcPlacementId: "npc", sector: 724, longitude: 8, latitude: 9 }],
      )[0],
    ).toMatchObject({
      npcPlacementId: "npc",
      longitude: 8,
      latitude: 9,
      active: true,
    });
  });
  it("uses live NPC visibility without revealing masked neighboring targets or concealing local targets", () => {
    for (const role of ["USER", "CONTENT"]) {
      for (const sector of [724, 725]) {
        const actor = structuredClone(user([arrival], { role, sector }));
        actor.userQuests[0]!.quest.content.objectives[0] = {
          ...move,
          sector: 0,
          longitude: 0,
          latitude: 0,
          hideLocation: true,
          overworldPlacementId: "npc",
        };
        const projected = getPublicQuestUser(actor);
        const placements = [
          { npcPlacementId: "npc", sector: 724, longitude: 8, latitude: 9 },
        ];
        expect(getQuestMapLocations(actor, [], placements)).toHaveLength(
          sector === 724 || role === "CONTENT" ? 1 : 0,
        );
        expect(getQuestMapLocations(projected, [], placements)).toHaveLength(
          sector === 724 || role === "CONTENT" ? 1 : 0,
        );
      }
    }
  });
});

describe("location chains reloaded from authored quests", () => {
  for (const tile of [
    { longitude: 4, latitude: 5 },
    { longitude: 0, latitude: 0 },
  ]) {
    it(`retains art and Inspect text across dialogs bound to the same fixed NPC at ${tile.longitude},${tile.latitude}`, async () => {
      const placements = [{ npcPlacementId: "keeper", sector: 724, ...tile }];
      const { actor, read } = locationChain(
        "dialog",
        [
          {
            id: "detail",
            task: "dialog",
            overworldPlacementId: "keeper",
            nextObjectiveId: [{ text: "Continue", nextObjectiveId: "detail2" }],
          },
          {
            id: "detail2",
            task: "dialog",
            overworldPlacementId: "keeper",
            structureAssetId: "shrine",
            locationName: "Tower shrine",
            locationDescription: "A small shrine inside the tower.",
            nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
          },
          { id: "end", task: "win_quest" },
        ],
        {
          overworldPlacementId: "keeper",
          sector: undefined,
          longitude: undefined,
          latitude: undefined,
        },
      );
      const group = { children: [] as WorldSpriteDescription[] };
      Object.assign(actor, tile);
      for (const id of ["STARTING", "detail", "detail2"]) {
        const snapshot = read(id === "STARTING" ? undefined : id, placements);
        expect(
          validateFriendlyPlacementBindings(
            snapshot.userQuests[0]!.quest.content.objectives,
            new Map([["keeper", { interactionType: "FRIENDLY" }]]),
          ).check,
        ).toBe(true);
        expect(
          findActionableBoundObjective({
            activeQuests: getBoundObjectiveCandidates(actor),
            ownedItemIds: [],
            placementId: "keeper",
          })?.objective.id,
        ).toBe(id);
        expect(
          actor.questData![0]!.goals.find((goal) => goal.id === id),
        ).not.toHaveProperty("sector");
        expect(getQuestMapLocations(snapshot, [])).toEqual([]);
        expect(await renderThenMove(snapshot, group, placements)).toMatchObject([
          {
            id: `quest:q1:${id === "detail2" ? "detail2" : "STARTING"}`,
            objectiveId: id,
            npcPlacementId: "keeper",
            sector: 724,
            ...tile,
            active: true,
            assetId: id === "detail2" ? "shrine" : "tower",
            name: id === "detail2" ? "Tower shrine" : move.locationName,
            description:
              id === "detail2"
                ? "A small shrine inside the tower."
                : move.locationDescription,
          },
        ]);
      }
      expect(await renderThenMove(read("end", placements), group, placements)).toEqual(
        [],
      );
      expect(group.children).toHaveLength(0);
    });
  }

  it("inherits live NPC coordinates for an unbound implicit dialog with its own art", async () => {
    const placements = [
      { npcPlacementId: "keeper", sector: 724, longitude: 4, latitude: 5 },
    ];
    const { actor, read } = locationChain(
      "dialog",
      [
        {
          id: "detail",
          task: "dialog",
          structureAssetId: "shrine",
          locationName: "Tower shrine",
          locationDescription: "A small shrine inside the tower.",
          nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
        },
        { id: "end", task: "win_quest" },
      ],
      {
        overworldPlacementId: "keeper",
        sector: undefined,
        longitude: undefined,
        latitude: undefined,
      },
    );
    Object.assign(actor, { longitude: 4, latitude: 5 });
    read(undefined, placements);
    const snapshot = read("detail", placements);
    expect(getQuestMapLocations(snapshot, [])).toEqual([]);
    expect(
      await renderThenMove(
        snapshot,
        { children: [] as WorldSpriteDescription[] },
        placements,
      ),
    ).toMatchObject([
      {
        assetId: "shrine",
        objectiveId: "detail",
        sector: 724,
        longitude: 4,
        latitude: 5,
        name: "Tower shrine",
      },
    ]);
  });

  for (const task of ["deliver_item", "defeat_opponents"] as const) {
    for (const destination of ["inherited", "own-art", "explicit-zero"] as const) {
      it(`retains ${destination} dialog scenery after completing a bound ${task}`, async () => {
        const placements = [
          { npcPlacementId: "keeper", sector: 17, longitude: 4, latitude: 5 },
        ];
        const starting = (
          task === "deliver_item" ? DeliverItem : DefeatOpponents
        ).parse({
          ...move,
          id: "STARTING",
          task,
          overworldPlacementId: "keeper",
          sector: undefined,
          longitude: undefined,
          latitude: undefined,
          deliverItemIds: ["scroll"],
          opponentAIs: [{ ids: ["guard"], number: 1 }],
          nextObjectiveId: "detail",
        });
        const { actor, read } = locationChain(starting, [
          {
            id: "detail",
            task: "dialog",
            ...(destination !== "inherited"
              ? {
                  structureAssetId: "shrine",
                  locationName: "Tower shrine",
                  locationDescription: "A small shrine inside the tower.",
                }
              : {}),
            ...(destination === "explicit-zero"
              ? { sector: 0, longitude: 0, latitude: 0 }
              : {}),
            nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
          },
          { id: "end", task: "win_quest" },
        ]);
        Object.assign(actor, { useritems: [{ itemId: "scroll" }] });
        read(undefined, placements);
        expect(actor.questData![0]!.goals[0]).toMatchObject({
          sector: 0,
          longitude: 0,
          latitude: 0,
          done: false,
        });
        Object.assign(actor, placements[0]);
        const snapshot = read(
          undefined,
          placements,
          task === "defeat_opponents"
            ? [{ task, contentId: "guard", text: "Won" }]
            : [{ task: "any" }],
        );
        expect(actor.questData![0]!.goals[0]?.done).toBe(true);
        expect(
          await renderThenMove(
            snapshot,
            { children: [] as WorldSpriteDescription[] },
            placements,
          ),
        ).toMatchObject([
          {
            assetId: destination === "inherited" ? "tower" : "shrine",
            objectiveId: "detail",
            ...(destination === "explicit-zero"
              ? { sector: 0, longitude: 0, latitude: 0 }
              : { sector: 17, longitude: 4, latitude: 5 }),
          },
        ]);
      });
    }
  }

  it.each([
    { sector: 17, longitude: 4, latitude: 5 },
    { sector: 0, longitude: 0, latitude: 0 },
  ])(
    "repairs inherited default coordinates across persisted implicit NPC dialogs at %j",
    async (tile) => {
      const placements = [{ npcPlacementId: "keeper", ...tile }];
      const { actor, read } = locationChain(
        DeliverItem.parse({
          ...move,
          id: "STARTING",
          task: "deliver_item",
          overworldPlacementId: "keeper",
          sector: undefined,
          longitude: undefined,
          latitude: undefined,
          deliverItemIds: ["scroll"],
          nextObjectiveId: "detail",
        }),
      );
      Object.assign(actor, { useritems: [{ itemId: "scroll" }] });
      read(undefined, placements);
      Object.assign(actor, placements[0]);
      read(undefined, placements);
      read("detail2", placements);
      for (const goal of actor.questData![0]!.goals.filter(
        (goal) => goal.id === "detail" || goal.id === "detail2",
      )) {
        Object.assign(goal, {
          sector: 0,
          longitude: 0,
          latitude: 0,
          locationChecked: true,
        });
      }
      const snapshot = read(undefined, placements);
      expect(
        await renderThenMove(
          snapshot,
          { children: [] as WorldSpriteDescription[] },
          placements,
        ),
      ).toMatchObject([{ assetId: "tower", objectiveId: "detail2", ...tile }]);
    },
  );

  it("keeps inherited concealed NPC coordinates private outside their live sector", () => {
    const actor = structuredClone(
      user(
        [
          { ...arrival, done: true, selectedNextObjectiveId: "dialog" },
          { id: "dialog", done: false },
        ],
        { sector: 725, role: "USER" },
      ),
    );
    actor.userQuests[0]!.quest.content.objectives[0] = {
      ...move,
      hideLocation: true,
      overworldPlacementId: "keeper",
    };
    actor.userQuests[0]!.quest.content.objectives[1] = {
      ...dialog,
      structureAssetId: "shrine",
    };
    const placements = [
      { npcPlacementId: "keeper", sector: 724, longitude: 4, latitude: 5 },
    ];
    expect(getQuestMapLocations(actor, [], placements)).toEqual([]);
    expect(getQuestMapLocations(getPublicQuestUser(actor), [], placements)).toEqual([]);
    actor.sector = 724;
    expect(
      getQuestMapLocations(getPublicQuestUser(actor), [], placements),
    ).toMatchObject([
      {
        objectiveId: "dialog",
        assetId: "shrine",
        sector: 724,
        longitude: 4,
        latitude: 5,
      },
    ]);
  });

  for (const longitude of [4, 8]) {
    it(`compares live locations when the next dialog binds a different NPC at ${longitude},5`, async () => {
      const placements = [
        { npcPlacementId: "keeper", sector: 724, longitude: 4, latitude: 5 },
        { npcPlacementId: "guide", sector: 724, longitude, latitude: 5 },
      ];
      const { actor, read } = locationChain(
        "dialog",
        [
          {
            id: "detail",
            task: "dialog",
            overworldPlacementId: "guide",
            nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
          },
          { id: "end", task: "win_quest" },
        ],
        {
          overworldPlacementId: "keeper",
          sector: undefined,
          longitude: undefined,
          latitude: undefined,
        },
      );
      Object.assign(actor, { longitude: 4, latitude: 5 });
      read(undefined, placements);
      const locations = await renderThenMove(
        read("detail", placements),
        { children: [] as WorldSpriteDescription[] },
        placements,
      );
      expect(locations).toHaveLength(longitude === 4 ? 1 : 0);
      if (longitude === 4)
        expect(locations[0]).toMatchObject({
          assetId: "tower",
          objectiveId: "detail",
          npcPlacementId: "guide",
        });
    });
  }

  for (const start of ["dialog", "specific", "random", "zero"] as const) {
    it(`retains ${start} structure art through two implicit dialogs and removes it on completion`, async () => {
      const { actor, read } = locationChain(start);
      const group = { children: [] as WorldSpriteDescription[] };
      const initial = await renderThenMove(read(), group);
      expect(initial).toHaveLength(1);
      const { sector, longitude, latitude } = initial[0]!;
      if (start === "dialog")
        expect(actor.questData![0]!.goals[0]).not.toHaveProperty("sector");
      if (start === "zero")
        expect({ longitude, latitude }).toEqual({ longitude: 0, latitude: 0 });
      Object.assign(actor, { sector, longitude, latitude });
      for (const id of ["detail", "detail2"]) {
        const snapshot = read(start === "dialog" || id === "detail2" ? id : undefined);
        if (id === "detail2")
          expect(actor.questData![0]!.goals[2]).not.toHaveProperty("sector");
        expect(await renderThenMove(snapshot, group)).toMatchObject([
          {
            assetId: "tower",
            objectiveId: id,
            sector,
            longitude,
            latitude,
            active: true,
          },
        ]);
      }
      expect(await renderThenMove(read("end"), group)).toEqual([]);
      expect(group.children).toHaveLength(0);
    });
  }

  it("resolves an implicit dialog's coordinates while keeping its own art and Inspect text", async () => {
    const { actor, read } = locationChain("dialog", [
      DialogObjective.parse({
        id: "detail",
        task: "dialog",
        nextObjectiveId: [{ text: "Continue", nextObjectiveId: "detail2" }],
      }),
      DialogObjective.parse({
        id: "detail2",
        task: "dialog",
        structureAssetId: "shrine",
        locationName: "Tower shrine",
        locationDescription: "A small shrine inside the tower.",
        nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
      }),
      { id: "end", task: "win_quest" },
    ]);
    const group = { children: [] as WorldSpriteDescription[] };
    await renderThenMove(read(), group);
    Object.assign(actor, { longitude: 4, latitude: 5 });
    read("detail");
    const snapshot = read("detail2");
    expect(actor.questData![0]!.goals[2]).not.toHaveProperty("sector");
    expect(await renderThenMove(snapshot, group)).toMatchObject([
      {
        assetId: "shrine",
        objectiveId: "detail2",
        sector: 724,
        longitude: 4,
        latitude: 5,
        name: "Tower shrine",
        description: "A small shrine inside the tower.",
        active: true,
      },
    ]);
    expect(await renderThenMove(read("end"), group)).toEqual([]);
  });

  it("does not carry an implicit dialog's art across an explicit destination change", async () => {
    const { actor, read } = locationChain("dialog", [
      DialogObjective.parse({
        id: "detail",
        task: "dialog",
        nextObjectiveId: [{ text: "Continue", nextObjectiveId: "detail2" }],
      }),
      DialogObjective.parse({
        id: "detail2",
        task: "dialog",
        structureAssetId: "shrine",
        locationName: "Tower shrine",
        locationDescription: "A small shrine inside the tower.",
        nextObjectiveId: [{ text: "Leave", nextObjectiveId: "remote" }],
      }),
      MoveToObjective.parse({
        id: "remote",
        task: "move_to_location",
        sector: 725,
        longitude: 8,
        latitude: 9,
        nextObjectiveId: "end",
      }),
      { id: "end", task: "win_quest" },
    ]);
    const group = { children: [] as WorldSpriteDescription[] };
    read();
    Object.assign(actor, { longitude: 4, latitude: 5 });
    read("detail");
    expect(await renderThenMove(read("detail2"), group)).toHaveLength(1);
    const snapshot = read("remote");
    expect(actor.questData![0]!.goals[3]).toMatchObject({
      sector: 725,
      longitude: 8,
      latitude: 9,
      done: false,
    });
    expect(await renderThenMove(snapshot, group)).toEqual([]);
    expect(group.children).toHaveLength(0);
  });

  it("preserves concealed coordinates outside and inside the target sector", async () => {
    const { actor, read } = locationChain("specific", undefined, {
      hideLocation: true,
    });
    const group = { children: [] as WorldSpriteDescription[] };
    for (const sector of [725, 724, 725]) {
      actor.sector = sector;
      const snapshot = read();
      expect(await renderThenMove(snapshot, group)).toHaveLength(
        sector === 724 ? 1 : 0,
      );
      if (sector === 725) {
        expect(snapshot.questData![0]!.goals[0]).not.toHaveProperty("sector");
        expect(snapshot.userQuests[0]!.quest.content.objectives[0]).toMatchObject({
          sector: 1337,
          longitude: 1337,
          latitude: 1337,
        });
      }
    }
  });
});

const locationChain = (
  start: "dialog" | "specific" | "random" | "zero" | AllObjectivesType,
  objectives: unknown[] = [
    {
      id: "detail",
      task: "dialog",
      nextObjectiveId: [{ text: "Continue", nextObjectiveId: "detail2" }],
    },
    {
      id: "detail2",
      task: "dialog",
      nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
    },
    { id: "end", task: "win_quest" },
  ],
  overrides: Partial<AllObjectivesType> = {},
) => {
  const starting =
    typeof start === "object"
      ? start
      : start === "dialog"
        ? DialogObjective.parse({
            ...move,
            id: "STARTING",
            task: "dialog",
            ...overrides,
            nextObjectiveId: [{ text: "Continue", nextObjectiveId: "detail" }],
          })
        : MoveToObjective.parse({
            ...move,
            id: "STARTING",
            sectorType: start === "random" ? "random" : "specific",
            locationType: start === "random" ? "random" : "specific",
            ...(start === "zero" ? { longitude: 0, latitude: 0 } : {}),
            ...overrides,
            nextObjectiveId: "detail",
          });
  const definition = QuestValidator.parse({
    name: "Tower quest",
    description: "Visit the tower",
    successDescription: "Done",
    questType: "mission",
    hidden: false,
    publicLocations: false,
    consecutiveObjectives: true,
    startsAt: null,
    endsAt: null,
    tierLevel: null,
    content: {
      objectives: [starting, ...objectives],
      reward: {},
      sceneCharacters: ["guide"],
    },
  });
  expect(verifyQuestContentForSave(definition.content.objectives, true).check).toBe(
    true,
  );
  const savedDefinition = JSON.parse(JSON.stringify(definition)) as typeof definition;
  const actor = user([], {
    userId: "u1",
    status: "AWAKE",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    longitude: 2,
    latitude: 2,
    village: { id: "v1", sector: 724 },
    activeWars: [],
    completedQuests: [],
    userQuests: [],
    questData: [],
  });
  return {
    actor,
    read: (
      nextObjectiveId?: string,
      placements: NonNullable<Parameters<typeof getQuestMapLocations>[2]> = [],
      tasks: Parameters<typeof getNewTrackers>[1] = nextObjectiveId
        ? [{ task: "dialog", contentId: nextObjectiveId }]
        : [{ task: "any" }],
    ) => {
      // Each profile read starts with stored authored JSON, never a rendered projection.
      actor.userQuests = [
        {
          id: "uq-q1",
          questId: "q1",
          completed: 0,
          endAt: null,
          previousAttempts: 0,
          previousCompletes: 0,
          quest: { ...structuredClone(savedDefinition), id: "q1" },
        },
      ] as typeof actor.userQuests;
      const placementIds = placements.flatMap((placement) =>
        placement.npcPlacementId ? [placement.npcPlacementId] : [],
      );
      const atPlacementIds = placements.flatMap((placement) =>
        placement.npcPlacementId &&
        placement.sector === actor.sector &&
        placement.longitude === actor.longitude &&
        placement.latitude === actor.latitude
          ? [placement.npcPlacementId]
          : [],
      );
      actor.questData = getNewTrackers(
        actor,
        tasks,
        undefined,
        new Map(placementIds.map((id) => [id, true])),
        new Set(atPlacementIds),
      ).trackers;
      return getPublicQuestUser(actor);
    },
  };
};

const renderThenMove = async (
  actor: NonNullable<UserWithRelations>,
  group = { children: [] as WorldSpriteDescription[] },
  placements: NonNullable<Parameters<typeof getQuestMapLocations>[2]> = [],
) => {
  const original = structuredClone(actor);
  const locations = getQuestMapLocations(actor, [], placements);
  const grid = {
    getHex: ({ col, row }: { col: number; row: number }) => ({
      col,
      row,
      x: 0,
      y: 0,
      center: { x: 0, y: 0 },
      width: 20,
      height: 20,
    }),
  } as never;
  const assets = [
    { id: "tower", imageUrl: "tower.png", renderScale: 2.4 },
    { id: "shrine", imageUrl: "shrine.png", renderScale: 2.4 },
  ];
  const project = (entries: typeof locations) =>
    sectorSpriteDescriptions({
      grid,
      map: { objects: [] } as never,
      locations: entries,
      mapAssets: assets,
      structures: [],
      wall: null,
      decorations: new Map(),
      lightLayout: false,
    });
  group.children = project(locations);
  const sprites = [...group.children];
  const recipes = travelActorRecipes({
    grid,
    viewer: actor,
    users: [],
    sector: actor.sector,
    minBracket: -1,
    showUsers: true,
    friendlyAttack: false,
    structureObjectiveIds: new Set(locations.map((location) => location.objectiveId)),
  });
  expect(recipes.filter((recipe) => recipe.quest)).toEqual([]);
  const client = new QueryClient();
  const key = [["profile", "getUser"], { type: "query" }];
  client.setQueryData(key, { userData: actor });
  try {
    await updateUserCache(client, key, {
      location: "Tower trail",
      updatedAt: new Date(),
      longitude: 1,
      latitude: 1,
    });
    const moved = client.getQueryData<{ userData: typeof actor }>(key)!.userData;
    const refreshed = getQuestMapLocations(moved, [], placements);
    group.children = project(refreshed);
    expect(moved).not.toBe(actor);
    expect(moved.userQuests).toBe(actor.userQuests);
    expect(refreshed).toEqual(locations);
    expect(group.children).toEqual(sprites);
    expect(group.children).toHaveLength(groupMapLocations(locations).length * 2);
    expect(actor).toEqual(original);
    return refreshed;
  } finally {
    client.clear();
  }
};
