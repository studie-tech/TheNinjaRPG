import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { zodResolver } from "@hookform/resolvers/zod";
import * as useSize from "@radix-ui/react-use-size";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as navigation from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import type { Item, Quest } from "@/drizzle/schema";
import { useItemEditForm } from "@/hooks/item";
import { useQuestEditForm } from "@/hooks/quest";
import * as ContentImageSelector from "@/layout/ContentImageSelector";
import { EffectFormWrapper } from "@/layout/EditContent";
import {
  draftFieldsOutside,
  EffectFieldInputGeneric,
  MassEffectEditor,
} from "@/layout/MassEffectEditor";
import { ObjectiveFormWrapper } from "@/layout/ObjectiveFormWrapper";
import { RewardEditor, RewardFormWrapper } from "@/layout/RewardEditor";
import * as toastHelpers from "@/libs/toast";
import * as errorUtils from "@/utils/error";
import * as UserContext from "@/utils/UserContext";
import {
  DamageTag,
  getTagSchema,
  HealTag,
  ItemValidator,
  JutsuValidatorRawSchema,
  NonCombatConsumeRewardTag,
  NonCombatQuestTag,
  UnlockItemVariantTag,
  type ZodAllTags,
} from "@/validators/combat";
import {
  type AllObjectivesType,
  getObjectiveSchema,
  QuestValidator,
} from "@/validators/objectives";
import { QuestReward, type QuestRewardType } from "@/validators/rewardPackages";
import { ObjectiveReward } from "@/validators/rewards";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { spyOnToasts } from "../setup/toastMock";
import { mockUserContextValue } from "../setup/userContext";

const save = vi.fn(async (_input: { id: string; data: { effects: ZodAllTags[] } }) => ({
  success: true,
  message: "Saved",
}));
const pending = vi.fn();
const toast = vi.fn();
const saveQuest = vi.fn(async (_input: unknown) => ({ success: true }));
const names = { useQuery: () => ({ data: [] }) };
let rewardCatalog:
  | { packages: []; nodes: { id: string; name: string; fields: string[] }[] }
  | undefined;
const rewardCatalogQuery = {
  useQuery: (
    _input?: unknown,
    _options?: { enabled: boolean; retryOnMount?: boolean },
  ) => ({
    data: rewardCatalog,
    isFetched: !!rewardCatalog,
    isError: false,
    refetch: vi.fn(),
  }),
};
const update: {
  useMutation: (options?: { meta?: Record<string, unknown> }) => {
    mutateAsync: (...args: Parameters<typeof save>) => ReturnType<typeof save>;
    isPending?: boolean;
  };
} = { useMutation: () => ({ mutateAsync: save }) };

const api = {
  useUtils: () => ({
    item: {
      getAllNames: { invalidate: async () => undefined },
      getVariantNames: { invalidate: async () => undefined },
    },
  }),
  profile: { getAllAiNames: names, getUser: { useQuery: () => ({ data: undefined }) } },
  item: { getVariantNames: names, getAllNames: names, update },
  jutsu: { getAllNames: names, update },
  bloodline: { getAllNames: names, update },
  sageMode: { getAllNames: names },
  petSpecies: { getAll: names },
  skillTree: { getAllNames: names },
  badge: { getAll: names },
  mapAsset: { getAll: names },
  title: { getAllNames: names },
  misc: { getAllGameAssetNames: names },
  village: { getAllNames: names },
  quests: {
    getAllNames: names,
    getPublicLocations: names,
    update: { useMutation: () => ({ mutateAsync: saveQuest }) },
  },
  worldMap: { getSectorWindow: { useQuery: () => ({ data: undefined }) } },
  mapTerrain: { getAll: names },
  overworldAi: { getAllPlacementNames: names },
  rewardPackages: {
    getCatalog: rewardCatalogQuery,
  },
  gameAsset: {
    getAllNames: names,
    getNameTags: names,
    getSceneAssets: names,
    getAll: { useInfiniteQuery: () => ({ data: { pages: [] } }) },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), api);
  vi.spyOn(navigation, "useRouter").mockImplementation(
    () => ({ push: vi.fn() }) as never,
  );
  spyOnToasts();
  vi.spyOn(toastHelpers, "showMutationToast").mockImplementation(toast);
  vi.spyOn(ContentImageSelector, "default").mockImplementation(() => null);
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  rewardCatalog = { packages: [], nodes: [] };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Render real form controls to verify quest-specific and generic-package material visibility. */
const MaterialRewardForm = ({
  questType,
  allowPackages = true,
}: {
  questType: string;
  allowPackages?: boolean;
}) => {
  const form = useForm({
    defaultValues: {
      ...ObjectiveReward.parse({
        reward_hunter_items: true,
        reward_hunter_items_ids: ["hunter-material"],
        reward_gathering_items: true,
        reward_gathering_items_ids: ["gathering-material"],
      }),
      questType,
    },
  });
  return (
    <RewardEditor
      type="quest"
      form={form}
      allowPackages={allowPackages}
      formData={[
        { id: "reward_hunter_items", label: "Hunting material drops", type: "boolean" },
        {
          id: "reward_hunter_items_ids",
          label: "Hunting materials",
          type: "db_values",
          multiple: true,
          values: [{ id: "hunter-material", name: "Hunter Feather" }],
        },
        {
          id: "reward_gathering_items",
          label: "Gathering material drops",
          type: "boolean",
        },
        {
          id: "reward_gathering_items_ids",
          label: "Gathering materials",
          type: "db_values",
          multiple: true,
          values: [{ id: "gathering-material", name: "Gathered Herb" }],
        },
      ]}
    />
  );
};

describe("grouped material rewards", () => {
  it.each([
    [
      "hunting",
      "Hunting material drops",
      "Hunting materials",
      "Gathering material drops",
    ],
    [
      "gathering",
      "Gathering material drops",
      "Gathering materials",
      "Hunting material drops",
    ],
  ])(
    "preserves direct material controls for %s quests",
    (questType, label, materials, otherLabel) => {
      const view = render(<MaterialRewardForm questType={questType!} />);
      const toggle = view.getByRole("switch", { name: label! });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(view.getByText(materials!)).toBeDefined();
      expect(view.queryByRole("switch", { name: otherLabel! })).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    },
  );

  it("keeps quest material restrictions and the package editor's material allowance", () => {
    const view = render(<MaterialRewardForm questType="mission" />);
    expect(view.queryByRole("switch", { name: "Hunting material drops" })).toBeNull();
    expect(view.queryByRole("switch", { name: "Gathering material drops" })).toBeNull();
    view.rerender(<MaterialRewardForm questType="mission" allowPackages={false} />);
    expect(view.getByRole("switch", { name: "Hunting material drops" })).toBeDefined();
    expect(
      view.getByRole("switch", { name: "Gathering material drops" }),
    ).toBeDefined();
  });
});

/** Exercise saved groups through the shared editor used by quests and package payloads. */
const SavedRewardForm = ({
  allowPackages = true,
  optionalExperience,
}: {
  allowPackages?: boolean;
  optionalExperience?: number;
}) => {
  const form = useForm({
    defaultValues: ObjectiveReward.parse({
      reward_money: 100,
      reward_tokens: 10,
      reward_prestige: 20,
      reward_ninjutsu_experience: optionalExperience,
    }),
  });
  return (
    <RewardEditor
      form={form}
      allowPackages={allowPackages}
      formData={[
        { id: "reward_money", label: "Ryo", type: "number" },
        { id: "reward_tokens", label: "Tokens", type: "number" },
        { id: "reward_prestige", label: "Prestige", type: "number" },
        { id: "reward_exp", label: "Experience", type: "number" },
        {
          id: "reward_ninjutsu_experience",
          label: "Ninjutsu Experience",
          type: "number",
        },
      ]}
    />
  );
};

/** Keep nested snapshot edits in the same parent form and validation lifecycle as quests. */
const SnapshotRewardForm = ({
  packageId,
  onUpdate,
  onSave,
  onInvalid,
}: {
  packageId?: string;
  onUpdate: () => void;
  onSave: (data: QuestRewardType) => void;
  onInvalid: () => void;
}) => {
  const form = useForm<any>({
    defaultValues: QuestReward.parse({
      reward_packages: [
        {
          id: "snapshot",
          packageId,
          name: "Saved rewards",
          rewards: { reward_money: 100, reward_ninjutsu_experience: 100 },
        },
      ],
    }),
    resolver: zodResolver(QuestReward),
  });
  const values = useWatch({ control: form.control });
  return (
    <>
      <RewardEditor
        form={{
          ...form,
          setValue: (...args) => {
            onUpdate();
            form.setValue(...args);
          },
        }}
        formData={[]}
      />
      <output data-testid="snapshot-money">
        {String(values.reward_packages?.[0]?.rewards?.reward_money)}
      </output>
      <output data-testid="snapshot-experience">
        {String(values.reward_packages?.[0]?.rewards?.reward_ninjutsu_experience)}
      </output>
      <button type="button" onClick={() => void form.handleSubmit(onSave, onInvalid)()}>
        Save rewards
      </button>
    </>
  );
};

const savedObjectiveQuest = {
  ...QuestValidator.parse({
    name: "Objective rewards",
    description: "Complete the objective",
    successDescription: "Done",
    questType: "story",
    hidden: false,
    consecutiveObjectives: false,
    endsAt: null,
    startsAt: null,
    tierLevel: null,
    content: {
      objectives: [
        getObjectiveSchema("pvp_kills").parse({
          id: "objective",
          task: "pvp_kills",
          reward_money: 100,
          reward_ninjutsu_experience: 100,
        }),
      ],
      reward: {},
    },
  }),
  id: "quest",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Quest;

/** Exercise direct objectives through the quest editor's real content setter and save validator. */
const ObjectiveRewardForm = ({ onUpdate }: { onUpdate: () => void }) => {
  const { objectives, setObjectives, handleQuestSubmit } = useQuestEditForm(
    savedObjectiveQuest,
    async () => undefined,
  );
  return (
    <>
      <ObjectiveFormWrapper
        idx={0}
        quest={savedObjectiveQuest}
        availableTags={["pvp_kills"]}
        hideTagType
        objective={objectives[0]!}
        objectives={objectives}
        setObjectives={(next) => {
          onUpdate();
          setObjectives(next);
        }}
      />
      <output data-testid="objective-money">
        {String(objectives[0]?.reward_money)}
      </output>
      <output data-testid="objective-experience">
        {String(objectives[0]?.reward_ninjutsu_experience)}
      </output>
      <button type="button" onClick={() => void handleQuestSubmit()}>
        Save objective
      </button>
    </>
  );
};

const savedStructureQuest = {
  ...savedObjectiveQuest,
  content: {
    ...savedObjectiveQuest.content,
    objectives: [
      getObjectiveSchema("move_to_location").parse({
        id: "structure",
        task: "move_to_location",
        structureAssetId: "tower",
        locationName: "Watchtower",
        locationDescription: "An old tower",
        structureScale: 1,
      }),
    ],
  },
} as Quest;

const StructureObjectiveForm = () => {
  const { objectives, setObjectives, handleQuestSubmit } = useQuestEditForm(
    savedStructureQuest,
    async () => undefined,
  );
  return (
    <>
      <ObjectiveFormWrapper
        idx={0}
        quest={savedStructureQuest}
        availableTags={["move_to_location"]}
        hideTagType
        objective={objectives[0]!}
        objectives={objectives}
        setObjectives={setObjectives}
      />
      <button type="button" onClick={() => void handleQuestSubmit()}>
        Save objective
      </button>
    </>
  );
};

describe("quest structure drafts", () => {
  it.each([
    ["structureScale", "6", "2"],
    ["locationName", "N".repeat(101), "Repaired tower"],
    ["locationDescription", "D".repeat(2001), "Repaired description"],
  ])(
    "keeps an invalid %s draft repairable after clearing artwork",
    async (field, invalid, repaired) => {
      const view = render(<StructureObjectiveForm />);
      const input = view.container.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >(`[name="${field}"]`)!;
      await act(async () => {
        fireEvent.input(input, { target: { value: invalid } });
      });
      fireEvent.click(
        view.getByRole("button", { name: "Clear Map structure (optional)" }),
      );
      await waitFor(() =>
        expect(view.container.querySelector(`[name="${field}"]`)).toBe(input),
      );
      fireEvent.click(view.getByRole("button", { name: "Save objective" }));
      await waitFor(() =>
        expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledTimes(1),
      );
      expect(saveQuest).not.toHaveBeenCalled();
      await act(async () => {
        input.focus();
        fireEvent.input(input, { target: { value: repaired } });
      });
      expect(view.container.querySelector(`[name="${field}"]`)).toBe(input);
      expect(document.activeElement).toBe(input);
      fireEvent.blur(input);
      fireEvent.click(view.getByRole("button", { name: "Save objective" }));
      await waitFor(() => expect(saveQuest).toHaveBeenCalledTimes(1));
      expect(saveQuest.mock.calls[0]?.[0]).toMatchObject({
        data: {
          content: {
            objectives: [
              {
                structureAssetId: "",
                [field!]: field === "structureScale" ? Number(repaired) : repaired,
              },
            ],
          },
        },
      });
    },
  );

  it("keeps valid cleared artwork drafts compact and preserves their values on save", async () => {
    const view = render(<StructureObjectiveForm />);
    fireEvent.click(
      view.getByRole("button", { name: "Clear Map structure (optional)" }),
    );
    await waitFor(() =>
      expect(view.queryByLabelText("Structure size multiplier")).toBeNull(),
    );
    expect(view.queryByLabelText("Location name")).toBeNull();
    expect(view.queryByLabelText("Location description (Inspect)")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Save objective" }));
    await waitFor(() => expect(saveQuest).toHaveBeenCalledTimes(1));
    expect(saveQuest.mock.calls[0]?.[0]).toMatchObject({
      data: {
        content: {
          objectives: [
            {
              structureAssetId: "",
              locationName: "Watchtower",
              locationDescription: "An old tower",
              structureScale: 1,
            },
          ],
        },
      },
    });
  });
});

describe("reward node editing", () => {
  withRadixBrowserGlobals();

  it.each(["button", "selector"])(
    "validates drafts before copying a reward group via the %s",
    async (control) => {
      const view = render(<SavedRewardForm />);
      const ryo = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_money"]',
      )!;
      const currency = ryo.closest("details")!;
      const initialOrder = [...view.container.querySelectorAll("summary")].map(
        (node) => node.textContent,
      );
      const copy = async () =>
        control === "button"
          ? fireEvent.click(
              within(currency).getByRole("button", { name: "Add Another Node" }),
            )
          : await pickRewardNode(view, /^Currency/);
      await act(async () => {
        ryo.focus();
        fireEvent.input(ryo, { target: { value: "" } });
      });
      await copy();
      await waitFor(() =>
        expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledTimes(1),
      );
      expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledWith({
        reward_money: {
          type: "invalid_type",
          message: expect.stringContaining("number"),
        },
      });
      expect(view.queryByRole("button", { name: "Remove Node" })).toBeNull();
      expect(view.container.querySelector('input[name="reward_money"]')).toBe(ryo);
      expect(ryo.value).toBe("");
      expect(
        [...view.container.querySelectorAll("summary")].map((node) => node.textContent),
      ).toEqual(initialOrder);
      await act(async () => {
        fireEvent.input(ryo, { target: { value: "350" } });
      });
      await copy();
      await waitFor(() =>
        expect(view.getAllByRole("button", { name: "Remove Node" })).toHaveLength(1),
      );
      const snapshot = view
        .getByRole("button", { name: "Remove Node" })
        .closest("details")!;
      const copiedRyo = snapshot.querySelector<HTMLInputElement>(
        'input[name="reward_money"]',
      )!;
      expect(copiedRyo.value).toBe("350");
      expect(copiedRyo).not.toBe(ryo);
      fireEvent.input(ryo, { target: { value: "400" } });
      expect(copiedRyo.value).toBe("350");
      expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps direct objective drafts editable and validates the current values on save", async () => {
    const onUpdate = vi.fn(() => {
      // Bound a reset/update regression before it can hang the test process.
      if (onUpdate.mock.calls.length > 20)
        throw new Error("Repeated objective updates");
    });
    const view = render(<ObjectiveRewardForm onUpdate={onUpdate} />);
    const initialOrder = [...view.container.querySelectorAll("summary")].map(
      (node) => node.textContent,
    );
    const ryo = view.container.querySelector<HTMLInputElement>(
      'input[name="reward_money"]',
    )!;
    await act(async () => {
      ryo.focus();
      fireEvent.input(ryo, { target: { value: "" } });
    });
    await waitFor(() =>
      expect(view.getByTestId("objective-money").textContent).toBe("NaN"),
    );
    expect(ryo.value).toBe("");
    expect(document.activeElement).toBe(ryo);
    expect(view.container.querySelector('input[name="reward_money"]')).toBe(ryo);
    expect(onUpdate.mock.calls.length).toBeLessThan(10);
    fireEvent.click(view.getByRole("button", { name: "Save objective" }));
    await waitFor(() =>
      expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledTimes(1),
    );
    expect(saveQuest).not.toHaveBeenCalled();
    const experience = view.container.querySelector<HTMLInputElement>(
      'input[name="reward_ninjutsu_experience"]',
    )!;
    await act(async () => {
      experience.focus();
      fireEvent.input(experience, { target: { value: "" } });
    });
    await waitFor(() =>
      expect(view.getByTestId("objective-experience").textContent).toBe("undefined"),
    );
    expect(experience.value).toBe("");
    expect(document.activeElement).toBe(experience);
    expect(
      view.container.querySelector('input[name="reward_ninjutsu_experience"]'),
    ).toBe(experience);
    await act(async () => {
      ryo.focus();
      fireEvent.input(ryo, { target: { value: "300" } });
    });
    await waitFor(() =>
      expect(view.getByTestId("objective-money").textContent).toBe("300"),
    );
    expect(document.activeElement).toBe(ryo);
    expect(view.container.querySelector('input[name="reward_money"]')).toBe(ryo);
    expect(
      [...view.container.querySelectorAll("summary")].map((node) => node.textContent),
    ).toEqual(initialOrder);
    expect(onUpdate.mock.calls.length).toBeLessThan(10);
    fireEvent.click(view.getByRole("button", { name: "Save objective" }));
    await waitFor(() => expect(saveQuest).toHaveBeenCalledTimes(1));
    expect(saveQuest.mock.calls[0]?.[0]).toMatchObject({
      data: {
        content: {
          objectives: [
            {
              id: "objective",
              task: "pvp_kills",
              reward_money: 300,
              reward_ninjutsu_experience: undefined,
            },
          ],
        },
      },
    });
  });
  it.each([undefined, "catalog-package"])(
    "retains invalid and optional drafts in a nested snapshot (package: %s)",
    async (packageId) => {
      const onSave = vi.fn();
      const onInvalid = vi.fn();
      const onUpdate = vi.fn(() => {
        // Bound a regression before React's repeated reset/update cycle can hang the suite.
        if (onUpdate.mock.calls.length > 20)
          throw new Error("Repeated snapshot updates");
      });
      const view = render(
        <SnapshotRewardForm
          packageId={packageId}
          onUpdate={onUpdate}
          onSave={onSave}
          onInvalid={onInvalid}
        />,
      );
      const input = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_money"]',
      )!;
      input.focus();
      fireEvent.input(input, { target: { value: "" } });
      await waitFor(() =>
        expect(view.getByTestId("snapshot-money").textContent).toBe("NaN"),
      );
      expect(input.value).toBe("");
      expect(document.activeElement).toBe(input);
      expect(view.container.querySelector('input[name="reward_money"]')).toBe(input);
      expect(onUpdate.mock.calls.length).toBeLessThan(10);
      fireEvent.click(view.getByRole("button", { name: "Save rewards" }));
      await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1));
      expect(onSave).not.toHaveBeenCalled();
      const experience = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_ninjutsu_experience"]',
      )!;
      fireEvent.input(experience, { target: { value: "" } });
      await waitFor(() =>
        expect(view.getByTestId("snapshot-experience").textContent).toBe("undefined"),
      );
      expect(experience.value).toBe("");
      fireEvent.input(input, { target: { value: "300" } });
      await waitFor(() =>
        expect(view.getByTestId("snapshot-money").textContent).toBe("300"),
      );
      fireEvent.click(view.getByRole("button", { name: "Save rewards" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]?.[0].reward_packages[0].rewards).toMatchObject({
        reward_money: 300,
        reward_ninjutsu_experience: undefined,
      });
    },
  );
  it("preserves an optional saved number when cleared and replaced", () => {
    const view = render(<SavedRewardForm optionalExperience={100} />);
    const input = view.container.querySelector<HTMLInputElement>(
      'input[name="reward_ninjutsu_experience"]',
    )!;
    fireEvent.input(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(
      view.container.querySelector('input[name="reward_ninjutsu_experience"]'),
    ).toBe(input);
    fireEvent.input(input, { target: { value: "250" } });
    expect(input.value).toBe("250");
  });
  it.each([undefined, "CONTENT-ADMIN"])(
    "waits for custom catalog groups before exposing saved controls (role: %s)",
    async (role) => {
      let profile: unknown = { data: role ? { role } : undefined };
      mockUserContextValue(() => profile);
      try {
        rewardCatalog = undefined;
        const view = render(<SavedRewardForm optionalExperience={100} />);
        expect(view.getByText("Loading rewards")).toBeDefined();
        expect(view.queryByRole("spinbutton")).toBeNull();
        expect(view.queryByRole("combobox", { name: "Add reward node" })).toBeNull();
        profile = { data: { role: "CONTENT-ADMIN" } };
        rewardCatalog = {
          packages: [],
          nodes: [
            { id: "custom-money", name: "Custom Money", fields: ["reward_money"] },
          ],
        };
        view.rerender(<SavedRewardForm optionalExperience={100} />);
        expect(view.queryByText("Loading rewards")).toBeNull();
        expect(
          [...view.container.querySelectorAll("summary")].map(
            (node) => node.textContent,
          ),
        ).toEqual(["Organization", "Custom Money", "Progression"]);
        const ryo = view.container.querySelector<HTMLInputElement>(
          'input[name="reward_money"]',
        )!;
        await act(async () => {
          ryo.focus();
          fireEvent.input(ryo, { target: { value: "0" } });
        });
        expect(view.container.querySelector('input[name="reward_money"]')).toBe(ryo);
        expect(document.activeElement).toBe(ryo);
        const experience = view.container.querySelector<HTMLInputElement>(
          'input[name="reward_ninjutsu_experience"]',
        )!;
        await act(async () => {
          experience.focus();
          fireEvent.input(experience, { target: { value: "" } });
        });
        expect(
          view.container.querySelector('input[name="reward_ninjutsu_experience"]'),
        ).toBe(experience);
        expect(document.activeElement).toBe(experience);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );
  it("keeps a failed catalog stable with nested snapshots and recovers on explicit retry", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const read = vi.fn(async (): Promise<NonNullable<typeof rewardCatalog>> => {
      // Bound a mount/refetch regression before repeated nested mounts can hang the suite.
      if (read.mock.calls.length > 3) return new Promise(() => {});
      throw new Error("Catalog unavailable");
    });
    const query = vi.spyOn(rewardCatalogQuery, "useQuery").mockImplementation(
      (_input, options) =>
        useQuery({
          queryKey: ["reward-catalog"],
          queryFn: read,
          ...options,
        }) as never,
    );
    mockUserContextValue({ data: { role: "CONTENT-ADMIN" } });
    try {
      const view = render(
        <QueryClientProvider client={client}>
          <SnapshotRewardForm onUpdate={vi.fn()} onSave={vi.fn()} onInvalid={vi.fn()} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(view.getAllByRole("alert")).toHaveLength(2));
      expect(read).toHaveBeenCalledTimes(1);
      expect(view.getAllByRole("alert")[0]!.textContent).toContain(
        "Could not load reward packages and nodes.",
      );
      const ryo = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_money"]',
      )!;
      await act(async () => {
        ryo.focus();
        fireEvent.input(ryo, { target: { value: "0" } });
      });
      expect(view.container.querySelector('input[name="reward_money"]')).toBe(ryo);
      expect(document.activeElement).toBe(ryo);
      const experience = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_ninjutsu_experience"]',
      )!;
      await act(async () => {
        experience.focus();
        fireEvent.input(experience, { target: { value: "" } });
      });
      expect(
        view.container.querySelector('input[name="reward_ninjutsu_experience"]'),
      ).toBe(experience);
      expect(document.activeElement).toBe(experience);
      expect(read).toHaveBeenCalledTimes(1);
      let resolveCatalog: (catalog: NonNullable<typeof rewardCatalog>) => void =
        () => {};
      read.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCatalog = resolve;
          }),
      );
      await act(async () => {
        fireEvent.click(view.getAllByRole("button", { name: "Retry" })[0]!);
      });
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(view.queryByText("Loading rewards")).toBeNull();
      expect(
        view.container.querySelector('input[name="reward_ninjutsu_experience"]'),
      ).toBe(experience);
      await act(async () => {
        resolveCatalog({ packages: [], nodes: [] });
      });
      await waitFor(() =>
        expect(client.getQueryState(["reward-catalog"])?.status).toBe("success"),
      );
      expect(view.queryByRole("alert")).toBeNull();
      expect(read).toHaveBeenCalledTimes(2);
      expect(
        view.container.querySelector('input[name="reward_ninjutsu_experience"]'),
      ).toBe(experience);
      expect(experience.value).toBe("");
      expect(view.container.querySelector('input[name="reward_money"]')).toBe(ryo);
      expect(ryo.value).toBe("0");
    } finally {
      cleanup();
      query.mockRestore();
      vi.restoreAllMocks();
      client.clear();
    }
  });
  it.each([true, false])(
    "keeps saved nodes mounted and ordered while editing (packages: %s)",
    (allowPackages) => {
      const view = render(<SavedRewardForm allowPackages={allowPackages} />);
      const ryo = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_money"]',
      )!;
      const tokens = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_tokens"]',
      )!;
      const prestige = view.container.querySelector<HTMLInputElement>(
        'input[name="reward_prestige"]',
      )!;
      const summaries = () =>
        [...view.container.querySelectorAll("summary")].map((node) => node.textContent);
      const initialOrder = summaries();
      ryo.focus();
      fireEvent.input(ryo, { target: { value: "0" } });
      expect(
        view.container.querySelector<HTMLInputElement>('input[name="reward_money"]')!,
      ).toBe(ryo);
      expect(document.activeElement).toBe(ryo);
      expect(summaries()).toEqual(initialOrder);
      fireEvent.input(ryo, { target: { value: "250" } });
      fireEvent.input(tokens, { target: { value: "0" } });
      fireEvent.input(prestige, { target: { value: "0" } });
      expect(summaries()).toEqual(initialOrder);
      expect(
        view.container.querySelector<HTMLInputElement>('input[name="reward_tokens"]')!,
      ).toBe(tokens);
      fireEvent.input(ryo, { target: { value: "" } });
      expect(ryo.value).toBe("");
      expect(
        view.container.querySelector<HTMLInputElement>('input[name="reward_money"]')!,
      ).toBe(ryo);
      fireEvent.input(ryo, { target: { value: "350" } });
      expect(ryo.value).toBe("350");
    },
  );

  it("appends newly opened nodes and removes a saved node only on Clear Node", async () => {
    const view = render(<SavedRewardForm />);
    const initialOrder = [...view.container.querySelectorAll("summary")].map(
      (node) => node.textContent,
    );
    await pickRewardNode(view, /^Progression/);
    expect(
      [...view.container.querySelectorAll("summary")].map((node) => node.textContent),
    ).toEqual([...initialOrder, "Progression"]);
    const ryo = view.container.querySelector<HTMLInputElement>(
      'input[name="reward_money"]',
    )!;
    const currency = ryo.closest("details")!;
    fireEvent.click(within(currency).getByRole("button", { name: "Clear Node" }));
    await waitFor(() =>
      expect(view.container.querySelector('input[name="reward_money"]')).toBeNull(),
    );
    await pickRewardNode(view, /^Currency/);
    expect(
      view.container.querySelector<HTMLInputElement>('input[name="reward_money"]')!
        .value,
    ).toBe("0");
    expect([...view.container.querySelectorAll("summary")].at(-1)?.textContent).toBe(
      "Currency",
    );
  });
});

describe("MassEffectEditor numeric drafts", () => {
  for (const kind of ["item", "jutsu", "bloodline"] as const) {
    it(`validates all ${kind} effect rows for the saved entry and retains invalid drafts`, async () => {
      const entries = [
        {
          id: "first",
          name: "First",
          effects: [DamageTag.parse({}), DamageTag.parse({})],
          updatedAt: new Date(),
        },
        {
          id: "second",
          name: "Second",
          effects: [DamageTag.parse({})],
          updatedAt: new Date(),
        },
      ];
      const view = render(
        <MassEffectEditor
          kind={kind}
          entries={entries}
          selectedFields={["power"]}
          onPendingChange={pending}
        />,
      );
      const inputs = view.getAllByRole("spinbutton") as HTMLInputElement[];
      const invalid = inputs[1]!;
      const reportValidity = vi.spyOn(invalid, "reportValidity");
      fireEvent.input(invalid, { target: { value: "" } });
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );

      expect(reportValidity).toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalled();
      expect(invalid.value).toBe("");
      expect(invalid.getAttribute("aria-invalid")).toBe("true");
      expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBe("false");

      fireEvent.input(inputs[2]!, { target: { value: "4" } });
      fireEvent.click(
        view.getByRole("button", { name: `Save ${kind} effects for Second` }),
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
      expect(save.mock.calls[0]?.[0]).toMatchObject({ id: "second" });
      expect(invalid.value).toBe("");

      fireEvent.input(inputs[0]!, { target: { value: "3.5" } });
      fireEvent.input(invalid, { target: { value: "7" } });
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1]?.[0]).toMatchObject({
        id: "first",
        data: { effects: [{ power: 3.5 }, { power: 7 }] },
      });
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
    });

    it(`blocks ${kind} drafts after their numeric field or effect row is hidden`, async () => {
      const entries = [
        {
          id: "first",
          name: "First",
          effects: [DamageTag.parse({}), DamageTag.parse({}), HealTag.parse({})],
          updatedAt: new Date(),
        },
      ];
      const mount = (selectedFields: string[], filterEffectTypes?: string[]) => (
        <MassEffectEditor
          kind={kind}
          entries={entries}
          selectedFields={selectedFields}
          filterEffectTypes={filterEffectTypes}
          onPendingChange={pending}
        />
      );
      const view = render(mount(["power"]));
      fireEvent.input(view.getAllByRole("spinbutton")[1]!, { target: { value: "" } });
      view.rerender(mount(["description"]));
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );
      expect(save).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({
        success: false,
        message: expect.any(String),
      });
      view.rerender(mount(["power"], ["heal"]));
      fireEvent.click(
        view.getByRole("button", { name: `Save ${kind} effects for First` }),
      );
      expect(save).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalled();
      view.rerender(mount(["power"]));
      expect((view.getAllByRole("spinbutton")[1] as HTMLInputElement).value).toBe("");
      fireEvent.input(view.getAllByRole("spinbutton")[1]!, { target: { value: "7" } });
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
    });
  }
});

describe("MassEffectEditor drafts overview", () => {
  const entries = [
    {
      id: "first",
      name: "First",
      effects: [DamageTag.parse({}), HealTag.parse({})],
      updatedAt: new Date(),
    },
    {
      id: "second",
      name: "Second",
      effects: [DamageTag.parse({})],
      updatedAt: new Date(),
    },
  ];

  it("asks for a field before showing the table", () => {
    const view = render(
      <MassEffectEditor kind="jutsu" entries={entries} selectedFields={[]} />,
    );
    expect(view.getByText(/Pick one or more effect fields/)).toBeTruthy();
    expect(view.queryByRole("button", { name: /Save jutsu effects/ })).toBeNull();
  });

  it("enables saving only for edited entries and saves all of them in order", async () => {
    const view = render(
      <MassEffectEditor kind="jutsu" entries={entries} selectedFields={["power"]} />,
    );
    const saveFirst = () =>
      view.getAllByRole("button", {
        name: "Save jutsu effects for First",
      })[0] as HTMLButtonElement;
    const saveAll = () =>
      view.getByRole("button", { name: "Save all" }) as HTMLButtonElement;
    expect(saveFirst().disabled).toBe(true);
    expect(saveAll().disabled).toBe(true);
    expect(view.getByText("No unsaved changes")).toBeTruthy();

    const inputs = view.getAllByRole("spinbutton");
    fireEvent.input(inputs[0]!, { target: { value: "5" } });
    fireEvent.input(inputs[2]!, { target: { value: "6" } });
    expect(saveFirst().disabled).toBe(false);
    expect(view.getByText("2 entries with unsaved changes")).toBeTruthy();
    // First has two effect rows, Second one.
    expect(view.getAllByText("Unsaved")).toHaveLength(3);

    fireEvent.click(saveAll());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls.map((call) => call[0].id)).toEqual(["first", "second"]);
  });

  it("lists drafts in hidden columns next to the entry", () => {
    const view = render(
      <MassEffectEditor kind="jutsu" entries={entries} selectedFields={["power"]} />,
    );
    fireEvent.input(view.getAllByRole("spinbutton")[0]!, { target: { value: "5" } });
    view.rerender(
      <MassEffectEditor kind="jutsu" entries={entries} selectedFields={["rounds"]} />,
    );
    expect(view.getAllByText("Unsaved · also saves power").length).toBeGreaterThan(0);
  });
});

describe("draftFieldsOutside", () => {
  it("names changed fields outside the visible columns and effect types", () => {
    const base = [DamageTag.parse({}), HealTag.parse({})];
    const draft = [
      { ...base[0]!, power: 9, rounds: 2 },
      { ...base[1]!, power: 3 },
    ] as ZodAllTags[];
    expect(draftFieldsOutside(base, draft, ["power"])).toEqual(["rounds"]);
    expect(draftFieldsOutside(base, draft, ["power", "rounds"], ["damage"])).toEqual([
      "power",
    ]);
    expect(draftFieldsOutside(base, base, [])).toEqual([]);
  });
});

const CoordinateDraftForm = () => {
  const [effects, setEffects] = useState<ZodAllTags[]>([
    DamageTag.parse({
      target: "COORDINATES",
      coordinateTargeting: {
        origin: "BATTLEFIELD",
        selection: "ALL",
        randomCount: 1,
        coordinates: [
          { longitude: 1, latitude: 1 },
          { longitude: 2, latitude: 1 },
        ],
      },
    }),
  ]);
  return (
    <>
      <EffectFormWrapper
        type="jutsu"
        allowCoordinateTargeting
        idx={0}
        tag={effects[0]!}
        effects={effects}
        setEffects={setEffects}
        availableTags={["damage"]}
      />
      <button
        type="button"
        onClick={() => {
          if (JutsuValidatorRawSchema.shape.effects.safeParse(effects).success) {
            void save({ id: "coordinates", data: { effects } });
          }
        }}
      >
        Save coordinate effects
      </button>
    </>
  );
};

/** Radix selects and popovers need these browser APIs; installs them around each test of a describe. */
function withRadixBrowserGlobals() {
  beforeEach(() => {
    installBrowserGlobals({
      resizeObserver: true,
      scrollIntoView: true,
      animationFrame: true,
    });
  });
  afterEach(() => {
    cleanup();
    restoreBrowserGlobals();
  });
}

/** Open the reward editor's "Add reward node" select and choose the node named `name`. */
async function pickRewardNode(view: ReturnType<typeof render>, name: RegExp) {
  fireEvent.keyDown(view.getByRole("combobox", { name: "Add reward node" }), {
    key: "Enter",
  });
  fireEvent.click(await view.findByRole("option", { name }));
}

describe("effect drafts", () => {
  withRadixBrowserGlobals();

  it("shows normal size for a legacy effect in the mass editor", () => {
    const legacy = DamageTag.parse({});
    delete (legacy as Partial<typeof legacy>).animationScale;
    const onChange = vi.fn();
    const view = render(
      <EffectFieldInputGeneric
        effect={legacy}
        field="animationScale"
        onChange={onChange}
      />,
    );
    const input = view.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("1");
    fireEvent.input(input, { target: { value: "1.375" } });
    expect(onChange).toHaveBeenLastCalledWith(1.375);
  });

  it("edits one tag's animation scale without changing its sibling", async () => {
    const onChange = vi.fn();
    const legacy = DamageTag.parse({});
    delete (legacy as Partial<typeof legacy>).animationScale;
    const initial = [legacy, HealTag.parse({})];
    const Fixture = () => {
      const [effects, setEffects] = useState<ZodAllTags[]>(initial);
      return (
        <>
          <EffectFormWrapper
            type="jutsu"
            idx={0}
            tag={effects[0]!}
            effects={effects}
            setEffects={(next) => {
              onChange(next);
              setEffects(next);
            }}
            availableTags={["damage"]}
          />
          <button
            type="button"
            onClick={() => {
              if (JutsuValidatorRawSchema.shape.effects.safeParse(effects).success)
                void save({ id: "sizes", data: { effects } });
            }}
          >
            Save sizes
          </button>
        </>
      );
    };
    const view = render(<Fixture />);
    const input = view.getByLabelText("Animation scale (1–3×)");
    expect((input as HTMLInputElement).value).toBe("1");
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: "1.375" } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ animationScale: 1.375 }),
        initial[1],
      ]),
    );
    for (const scale of [0.99, 3.01]) {
      fireEvent.input(input, { target: { value: String(scale) } });
      await waitFor(() =>
        expect(onChange.mock.calls.at(-1)?.[0][0]?.animationScale).toBe(scale),
      );
      fireEvent.click(view.getByRole("button", { name: "Save sizes" }));
      expect(save).not.toHaveBeenCalled();
    }
    fireEvent.input(input, { target: { value: "" } });
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0][0]?.animationScale).toBeNaN(),
    );
    fireEvent.click(view.getByRole("button", { name: "Save sizes" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: "3" } });
    fireEvent.click(view.getByRole("button", { name: "Save sizes" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  describe("MassEffectEditor selects", () => {
    const mount = (selectedFields: string[]) =>
      render(
        <MassEffectEditor
          kind="item"
          entries={[
            {
              id: "first",
              name: "First",
              effects: [DamageTag.parse({})],
              updatedAt: new Date(),
            },
          ]}
          selectedFields={selectedFields}
        />,
      );

    it("searches an enum field by name and saves the choice", async () => {
      const view = mount(["target"]);
      fireEvent.click(view.getByRole("combobox", { name: "target" }));
      const search = await view.findByPlaceholderText("Search target...");
      fireEvent.change(search, { target: { value: "self" } });
      await waitFor(() =>
        expect(view.queryByRole("option", { name: "OPPONENT" })).toBeNull(),
      );
      fireEvent.click(view.getByRole("option", { name: "SELF" }));
      expect(view.queryByRole("option", { name: "SELF" })).toBeNull();
      expect(view.getByRole("combobox", { name: "target" }).textContent).toContain(
        "SELF",
      );
      fireEvent.click(
        view.getByRole("button", { name: "Save item effects for First" }),
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({ target: "SELF" });
    });

    it("offers long animation names in a popover wider than a narrow cell", async () => {
      const animation = "a-very-long-animation-identifier-without-any-break";
      const assets = vi.spyOn(names, "useQuery").mockReturnValue({
        data: [
          { id: animation, type: "ANIMATION" },
          { id: "still-image", type: "STATIC" },
        ],
      } as never);
      const view = mount(["appearAnimation", "staticAssetPath"]);
      fireEvent.click(view.getByRole("combobox", { name: "appearAnimation" }));
      const option = await view.findByRole("option", { name: animation });
      expect(view.queryByRole("option", { name: "still-image" })).toBeNull();
      expect(option.closest('[role="dialog"]')?.className).toContain("min-w-[240px]");
      assets.mockRestore();
    });
  });

  for (const target of ["INHERIT", "SELF"] as const) {
    it(`discards invalid coordinates when changing target to ${target}`, async () => {
      const view = render(<CoordinateDraftForm />);
      fireEvent.input(view.getByRole("spinbutton", { name: "Coordinate 2 column" }), {
        target: { value: "1" },
      });
      await waitFor(() =>
        expect(view.getByText("Coordinates must be unique.")).toBeDefined(),
      );
      fireEvent.click(view.getByRole("button", { name: "Save coordinate effects" }));
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole("combobox", { name: "Target" }));
      fireEvent.click(await view.findByRole("option", { name: target }));
      await waitFor(() =>
        expect(
          view.queryByRole("spinbutton", { name: "Coordinate 2 column" }),
        ).toBeNull(),
      );
      fireEvent.click(view.getByRole("button", { name: "Save coordinate effects" }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
        target,
        coordinateTargeting: null,
      });
    });
  }

  it("blocks duplicate coordinates in parent validation and saves corrected drafts", async () => {
    const view = render(<CoordinateDraftForm />);
    fireEvent.input(view.getByRole("spinbutton", { name: "Coordinate 2 column" }), {
      target: { value: "1" },
    });
    await waitFor(() =>
      expect(view.getByText("Coordinates must be unique.")).toBeDefined(),
    );
    fireEvent.click(view.getByRole("button", { name: "Save coordinate effects" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.input(view.getByRole("spinbutton", { name: "Coordinate 2 column" }), {
      target: { value: "3" },
    });
    await waitFor(() =>
      expect(view.queryByText("Coordinates must be unique.")).toBeNull(),
    );
    fireEvent.click(view.getByRole("button", { name: "Save coordinate effects" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      save.mock.calls[0]?.[0].data.effects[0]?.coordinateTargeting?.coordinates[1]
        ?.longitude,
    ).toBe(3);
  });
  it.each(["column", "row"] as const)(
    "keeps blank coordinate %s drafts invalid until corrected",
    async (axis) => {
      const view = render(<CoordinateDraftForm />);
      const input = view.getByRole("spinbutton", { name: `Coordinate 1 ${axis}` });
      fireEvent.input(input, { target: { value: "" } });
      await waitFor(() => expect(view.getByRole("alert")).toBeDefined());
      fireEvent.click(view.getByRole("button", { name: "Save coordinate effects" }));
      expect(save).not.toHaveBeenCalled();
      expect((input as HTMLInputElement).value).toBe("");
      fireEvent.input(input, { target: { value: "4" } });
      await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
      fireEvent.click(view.getByRole("button", { name: "Save coordinate effects" }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(
        save.mock.calls[0]?.[0].data.effects[0]?.coordinateTargeting?.coordinates[0],
      ).toEqual(
        axis === "column"
          ? { longitude: 4, latitude: 1 }
          : { longitude: 1, latitude: 4 },
      );
    },
  );
});

const CacheDraftForm = () => {
  const [effects, setEffects] = useState<ZodAllTags[]>([
    NonCombatConsumeRewardTag.parse({
      reward_money: 17,
      rewardMode: "weightedCache",
      weightedCache: {
        version: 1,
        displayName: "Pill Cache",
        rolls: [
          { count: 1, probability: 5000 },
          { count: 2, probability: 5000 },
        ],
        tiers: [
          {
            name: "Common",
            probability: 10_000,
            entries: [{ items: [{ itemId: "pill", quantity: 2 }] }],
          },
        ],
      },
    }),
  ]);
  return (
    <>
      <EffectFormWrapper
        type="item"
        idx={0}
        tag={effects[0]!}
        effects={effects}
        setEffects={setEffects}
        availableTags={["noncombatconsumereward"]}
      />
      <button
        type="button"
        onClick={() => {
          if (NonCombatConsumeRewardTag.safeParse(effects[0]).success)
            void save({ id: "cache", data: { effects } });
        }}
      >
        Save cache effects
      </button>
    </>
  );
};

const CompanionRewardDraftForm = () => {
  const [effects, setEffects] = useState<ZodAllTags[]>([
    NonCombatConsumeRewardTag.parse({}),
  ]);
  return (
    <>
      <EffectFormWrapper
        type="item"
        idx={0}
        tag={effects[0]!}
        effects={effects}
        setEffects={setEffects}
        availableTags={["noncombatconsumereward"]}
      />
      <button
        type="button"
        onClick={() => {
          if (NonCombatConsumeRewardTag.safeParse(effects[0]).success)
            void save({ id: "companion-contract", data: { effects } });
        }}
      >
        Save companion reward
      </button>
    </>
  );
};

describe("companion reward editing", () => {
  withRadixBrowserGlobals();
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ["Fox", "fox-id"],
    ["Gift Fox", "gift-id"],
  ])(
    "saves %s as a companion reward regardless of daily-offer availability",
    async (name, id) => {
      vi.spyOn(names, "useQuery").mockReturnValue({
        data: [
          { id: "fox-id", name: "Fox", isActive: true },
          { id: "gift-id", name: "Gift Fox", isActive: false },
        ],
      } as never);
      const view = render(<CompanionRewardDraftForm />);
      const field = view
        .getByText("Companion species")
        .closest<HTMLElement>('[data-slot="form-item"]');
      if (!field) throw new Error("Missing companion species field");
      fireEvent.click(within(field).getByRole("combobox"));
      expect(await view.findByRole("option", { name: "Fox" })).toBeDefined();
      expect(view.getByRole("option", { name: "Gift Fox" })).toBeDefined();
      fireEvent.click(view.getByRole("option", { name }));
      fireEvent.click(view.getByRole("button", { name: "Save companion reward" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
        reward_pets: [id],
      });
    },
  );
});

/** Hold rewards the way the wrapper's owners do, so its draft sync settles. */
const VillageRewardForm = () => {
  const [rewards, setRewards] = useState([ObjectiveReward.parse({})]);
  return (
    <>
      <RewardFormWrapper
        idx={0}
        reward={rewards[0]!}
        rewards={rewards}
        setRewards={setRewards}
      />
      <output data-testid="village">{rewards[0]!.reward_village_membership}</output>
    </>
  );
};

describe("village membership reward", () => {
  withRadixBrowserGlobals();
  it("offers the starter villages as a selector and keeps the chosen key", async () => {
    const view = render(<VillageRewardForm />);
    const field = view
      .getByText("Village Membership")
      .closest<HTMLElement>('[data-slot="form-item"]');
    if (!field) throw new Error("Missing village membership field");
    expect(field.querySelector("input[type=text]")).toBeNull();
    fireEvent.click(within(field).getByRole("combobox"));
    expect(await view.findByRole("option", { name: "SHIROHANA" })).toBeDefined();
    fireEvent.click(view.getByRole("option", { name: "HYORIN" }));
    await waitFor(() => expect(view.getByTestId("village").textContent).toBe("HYORIN"));
  });
});

/** Exercise the effect form's nullable database choice through real form controls. */
const VariantTokenDraftForm = ({ variantId }: { variantId: string | null }) => {
  const [effects, setEffects] = useState<ZodAllTags[]>([
    UnlockItemVariantTag.parse({ variantId }),
  ]);
  return (
    <>
      <EffectFormWrapper
        type="item"
        idx={0}
        tag={effects[0]!}
        effects={effects}
        setEffects={setEffects}
        availableTags={["unlockitemvariant"]}
      />
      <button
        type="button"
        onClick={() => void save({ id: "variant-token", data: { effects } })}
      >
        Save token effects
      </button>
    </>
  );
};

describe("variant token effect drafts", () => {
  withRadixBrowserGlobals();
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ["Any variant", "red-variant", null],
    ["Sword: Red", null, "red-variant"],
  ] as const)(
    "saves %s as the token's variant binding",
    async (label, initial, expected) => {
      vi.spyOn(names, "useQuery").mockReturnValue({
        data: [{ id: "red-variant", name: "Sword: Red" }],
      } as never);
      const view = render(<VariantTokenDraftForm variantId={initial} />);
      const field = view
        .getByText("Variant", { exact: true })
        .closest<HTMLElement>('[data-slot="form-item"]')!;
      expect(within(field).getByRole("combobox").textContent).toContain(
        initial ? "Sword: Red" : "Any variant",
      );
      fireEvent.click(within(field).getByRole("combobox"));
      fireEvent.click(await view.findByRole("option", { name: label }));
      await waitFor(() =>
        expect(within(field).getByRole("combobox").textContent).toContain(label),
      );
      fireEvent.click(view.getByRole("button", { name: "Save token effects" }));
      expect(save.mock.calls.at(-1)?.[0].data.effects[0]).toMatchObject({
        type: "unlockitemvariant",
        variantId: expected,
      });
    },
  );
});

const cacheItem = {
  ...ItemValidator.parse({
    name: "Cache item",
    image: "cache.webp",
    description: "Cache",
    battleDescription: "",
    stackSize: 10,
    chakraCost: 0,
    healthCost: 0,
    staminaCost: 0,
    healthCostReducePerLvl: 0,
    chakraCostReducePerLvl: 0,
    staminaCostReducePerLvl: 0,
    actionCostPerc: 100,
    maxImbueNumber: 1,
    maxDurability: 100,
    hidden: false,
    cooldown: 0,
    cost: 1,
    repsCost: 0,
    seichiSilverCost: 0,
    range: 0,
    maxEquips: 0,
    method: "SINGLE",
    target: "SELF",
    itemType: "CONSUMABLE",
    weaponType: "NONE",
    destroyOnUse: true,
    preventBattleUsage: true,
    rarity: "COMMON",
    slot: "NONE",
    expireFromStoreAt: null,
    bloodlineId: null,
    farmYieldItemId: null,
    farmExtractSeedItemId: null,
    crystalTargetTypes: null,
    effects: [
      NonCombatConsumeRewardTag.parse({
        reward_money: 17,
        rewardMode: "weightedCache",
        weightedCache: {
          version: 1,
          displayName: "Pill Cache",
          rolls: [
            { count: 1, probability: 5000 },
            { count: 2, probability: 5000 },
          ],
          tiers: [
            {
              name: "Common",
              probability: 10_000,
              entries: [{ items: [{ itemId: "pill", quantity: 2 }] }],
            },
          ],
        },
      }),
    ],
  }),
  id: "cache",
  craftingRequirements: [],
} as unknown as Item & { craftingRequirements: [] };

const ItemCacheDraftForm = ({ item = cacheItem }: { item?: typeof cacheItem }) => {
  const { effects, setEffects, handleItemSubmit, isUpdating } = useItemEditForm(
    item,
    async () => undefined,
  );
  const validEffects = (effects?.filter(
    (effect): effect is ZodAllTags => effect !== undefined,
  ) ?? []) as ZodAllTags[];
  return (
    <>
      <EffectFormWrapper
        type="item"
        idx={0}
        tag={validEffects[0]!}
        effects={validEffects}
        setEffects={setEffects}
        availableTags={["noncombatconsumereward"]}
        submitLoading={isUpdating}
      />
      <button type="button" onClick={() => void handleItemSubmit()}>
        Save item
      </button>
    </>
  );
};

const ItemQuestDraftForm = ({ initial }: { initial: ZodAllTags }) => {
  const [item] = useState(() => ({ ...cacheItem, effects: [initial] }));
  const { effects, setEffects, handleItemSubmit, isUpdating } = useItemEditForm(
    item,
    async () => undefined,
  );
  const validEffects = effects as ZodAllTags[];
  const tag = validEffects[0]!;
  return (
    <>
      <EffectFormWrapper
        key={tag.type}
        type="item"
        idx={0}
        tag={tag}
        effects={validEffects}
        setEffects={setEffects}
        availableTags={["heal", "noncombatquest"]}
        submitLoading={isUpdating}
      />
      <button type="button" onClick={() => void handleItemSubmit()}>
        Save item
      </button>
      <button
        type="button"
        onClick={() => setEffects([{ ...tag, questId: "" } as ZodAllTags])}
      >
        Clear quest draft
      </button>
    </>
  );
};

describe("Special quest item drafts", () => {
  withRadixBrowserGlobals();
  beforeEach(() => {
    vi.spyOn(names, "useQuery").mockReturnValue({
      data: [
        { id: "special-quest", name: "Special contract", questType: "special" },
        { id: "mission", name: "Ordinary mission", questType: "mission" },
      ],
    } as never);
    vi.spyOn(toastHelpers, "showFormErrorsToast");
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["a new quest effect", NonCombatQuestTag.parse({})],
    ["a Heal effect", HealTag.parse({})],
  ] as const)(
    "saves the first quest selection immediately from %s",
    async (_name, initial) => {
      const view = render(<ItemQuestDraftForm initial={initial} />);
      if (initial.type === "heal") {
        fireEvent.click(view.getByRole("combobox", { name: "Type" }));
        fireEvent.click(await view.findByRole("option", { name: "noncombatquest" }));
      }
      const field = view
        .getByText("Special quest")
        .closest<HTMLElement>('[data-slot="form-item"]')!;
      fireEvent.click(within(field).getByRole("combobox"));
      expect(view.queryByRole("option", { name: "Ordinary mission" })).toBeNull();
      fireEvent.click(await view.findByRole("option", { name: "Special contract" }));
      fireEvent.click(view.getByRole("button", { name: "Save item" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
        type: "noncombatquest",
        questId: "special-quest",
      });
      expect(toastHelpers.showFormErrorsToast).not.toHaveBeenCalled();
    },
  );

  it("rejects a quest draft without a selection", async () => {
    const view = render(<ItemQuestDraftForm initial={NonCombatQuestTag.parse({})} />);
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() =>
      expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledTimes(1),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a cleared quest draft and saves its replacement", async () => {
    const view = render(
      <ItemQuestDraftForm
        initial={NonCombatQuestTag.parse({ questId: "previous-quest" })}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Clear quest draft" }));
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() =>
      expect(toastHelpers.showFormErrorsToast).toHaveBeenCalledTimes(1),
    );
    expect(save).not.toHaveBeenCalled();
    const field = view
      .getByText("Special quest")
      .closest<HTMLElement>('[data-slot="form-item"]')!;
    fireEvent.click(within(field).getByRole("combobox"));
    fireEvent.click(await view.findByRole("option", { name: "Special contract" }));
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
      questId: "special-quest",
    });
  });
});

describe("weighted cache effect drafts", () => {
  withRadixBrowserGlobals();
  beforeEach(() => {
    vi.spyOn(names, "useQuery").mockReturnValue({
      data: [{ id: "pill", name: "Chakra Pill" }],
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());
  it("propagates invalid probability totals to the parent and allows correction", async () => {
    const view = render(<CacheDraftForm />);
    const probabilities = view.getAllByRole("spinbutton", { name: "Probability (%)" });
    fireEvent.input(probabilities[0]!, { target: { value: "49" } });
    await waitFor(() =>
      expect(view.getByText("Roll probability total: 99% / 100%")).toBeTruthy(),
    );
    fireEvent.click(view.getByRole("button", { name: "Save cache effects" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.input(probabilities[0]!, { target: { value: "50" } });
    await waitFor(() =>
      expect(view.getByText("Roll probability total: 100% / 100%")).toBeTruthy(),
    );
    fireEvent.click(view.getByRole("button", { name: "Save cache effects" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
      reward_money: 17,
      weightedCache: { displayName: "Pill Cache" },
    });
  });
  it("retains a blank quantity draft instead of silently saving the previous quantity", async () => {
    const view = render(<CacheDraftForm />);
    fireEvent.input(view.getByRole("spinbutton", { name: /quantity/ }), {
      target: { value: "" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save cache effects" }));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "Common · Entry 1 · Item 1: Enter a valid number",
      ),
    );
  });

  it("locks cache controls and closes an open item picker throughout a pending save", async () => {
    let finishSave: (value: { success: boolean; message: string }) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    vi.spyOn(update, "useMutation").mockImplementation(() => {
      const [isPending, setIsPending] = useState(false);
      return {
        isPending,
        mutateAsync: async (input: Parameters<typeof save>[0]) => {
          setIsPending(true);
          try {
            return await save(input);
          } finally {
            setIsPending(false);
          }
        },
      };
    });
    const view = render(<ItemCacheDraftForm />);
    fireEvent.change(view.getByRole("textbox", { name: "Cache display name" }), {
      target: { value: "Saved Cache" },
    });
    const picker = view.container.querySelector<HTMLElement>(
      '[role="combobox"][aria-disabled]',
    )!;
    fireEvent.click(picker);
    expect(await view.findByPlaceholderText("Search ...")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(
      view.getByRole("combobox", { name: "Reward mode" }).matches(":disabled"),
    ).toBe(true);
    const editor = view.getByRole("region", { name: "Weighted Cache editor" });
    for (const control of editor.querySelectorAll("input, button"))
      expect(control.matches(":disabled")).toBe(true);
    expect(picker.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() => expect(view.queryByPlaceholderText("Search ...")).toBeNull());
    fireEvent.click(picker);
    expect(view.queryByPlaceholderText("Search ...")).toBeNull();
    await act(async () => finishSave!({ success: true, message: "Saved" }));
    await waitFor(() =>
      expect(
        view.getByRole("combobox", { name: "Reward mode" }).matches(":disabled"),
      ).toBe(false),
    );
    expect(
      (view.getByRole("textbox", { name: "Cache display name" }) as HTMLInputElement)
        .value,
    ).toBe("Saved Cache");
  });

  it("reveals a hidden invalid cache on failed save and repairs it without changing Standard mode", async () => {
    const view = render(<ItemCacheDraftForm />);
    fireEvent.input(view.getByRole("spinbutton", { name: /quantity/ }), {
      target: { value: "" },
    });
    fireEvent.click(view.getByRole("combobox", { name: "Reward mode" }));
    fireEvent.click(await view.findByRole("option", { name: "Standard rewards" }));
    const inactive = view
      .getByText("Inactive Weighted Cache · Needs attention")
      .closest("details")!;
    expect(inactive.open).toBe(false);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Reward mode"),
    );
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(inactive.open).toBe(true));
    const error = view.getByRole("alert");
    await waitFor(() => expect(document.activeElement === error).toBe(true));
    expect(error.textContent).toBe("Common · Entry 1 · Item 1: Enter a valid number");
    expect(toast).toHaveBeenCalledWith({
      success: false,
      message: `Cannot save. ${error.textContent}`,
    });
    expect(save).not.toHaveBeenCalled();
    const quantity = within(inactive).getByRole("spinbutton", {
      name: /quantity/,
    }) as HTMLInputElement;
    expect(quantity.value).toBe("");
    fireEvent.input(quantity, { target: { value: "3" } });
    await waitFor(() =>
      expect(view.queryByText("Inactive Weighted Cache · Needs attention")).toBeNull(),
    );
    expect(view.getByRole("combobox", { name: "Reward mode" }).textContent).toBe(
      "Standard rewards",
    );
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
      rewardMode: "standard",
      reward_money: 17,
      weightedCache: {
        tiers: [{ entries: [{ items: [{ itemId: "pill", quantity: 3 }] }] }],
      },
    });
  });

  it("keeps incomplete inactive probability totals saveable without a repair section", async () => {
    const view = render(<ItemCacheDraftForm />);
    fireEvent.input(view.getAllByRole("spinbutton", { name: "Probability (%)" })[0]!, {
      target: { value: "49" },
    });
    fireEvent.click(view.getByRole("combobox", { name: "Reward mode" }));
    fireEvent.click(await view.findByRole("option", { name: "Standard rewards" }));
    expect(view.queryByText("Inactive Weighted Cache · Needs attention")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
      rewardMode: "standard",
      weightedCache: {
        rolls: [
          { count: 1, probability: 4900 },
          { count: 2, probability: 5000 },
        ],
      },
    });
  });

  it("reveals and replaces missing rewards in a saved Standard cache without enforcing active totals", async () => {
    vi.spyOn(names, "useQuery").mockReturnValue({
      data: [{ id: "replacement", name: "Replacement Pill" }],
    } as never);
    const effect = NonCombatConsumeRewardTag.parse({
      ...cacheItem.effects[0],
      rewardMode: "standard",
    });
    effect.weightedCache!.rolls[0]!.probability = 4900;
    const view = render(
      <ItemCacheDraftForm item={{ ...cacheItem, effects: [effect] }} />,
    );
    const inactive = view
      .getByText("Inactive Weighted Cache · Needs attention")
      .closest("details")!;
    expect(inactive.open).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(inactive.open).toBe(true));
    const error = view.getByRole("alert");
    expect(error.textContent).toBe(
      "Common · Entry 1 · Item 1: Remove or replace missing item: pill",
    );
    expect(document.activeElement).toBe(error);
    expect(toast).toHaveBeenCalledWith({
      success: false,
      message: `Cannot save. ${error.textContent}`,
    });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(inactive).getByRole("combobox"));
    fireEvent.click(await view.findByRole("option", { name: "Replacement Pill" }));
    fireEvent.click(view.getByRole("button", { name: "Remove pill" }));
    await waitFor(() =>
      expect(view.queryByText("Inactive Weighted Cache · Needs attention")).toBeNull(),
    );
    expect(view.getByRole("combobox", { name: "Reward mode" }).textContent).toBe(
      "Standard rewards",
    );
    fireEvent.click(view.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].data.effects[0]).toMatchObject({
      rewardMode: "standard",
      reward_money: 17,
      weightedCache: {
        rolls: [
          { count: 1, probability: 4900 },
          { count: 2, probability: 5000 },
        ],
        tiers: [{ entries: [{ items: [{ itemId: "replacement", quantity: 1 }] }] }],
      },
    });
  });
});

describe("schema-derived field visibility", () => {
  beforeEach(() => {
    installBrowserGlobals({
      resizeObserver: true,
      scrollIntoView: true,
      animationFrame: true,
    });
  });
  afterEach(() => {
    cleanup();
    restoreBrowserGlobals();
  });

  const labels = (container: HTMLElement) =>
    [...container.querySelectorAll("label")].map((label) => label.textContent);

  it.each([
    [
      "damage",
      "jutsu",
      [
        "Type",
        "Static asset path",
        "Static animation",
        "Appear animation",
        "Disappear animation",
        "Animation scale (1–3×)",
        "Appear sfx",
        "Disappear sfx",
        "Rounds",
        "Power",
        "Power per level",
        "Target",
        "Friendly fire",
        "Calculation",
        "Stat types",
        "General types",
        "Elements",
        "Residual modifier",
        "Dmg modifier",
        "Allow bloodline damage increase",
        "Allow bloodline damage decrease",
        "Description",
      ],
    ],
    [
      "heal",
      "bloodline",
      [
        "Type",
        "Static asset path",
        "Static animation",
        "Appear animation",
        "Disappear animation",
        "Animation scale (1–3×)",
        "Appear sfx",
        "Disappear sfx",
        "Power",
        "Power per level",
        "Target",
        "Calculation",
        "Pools affected",
        "Description",
      ],
    ],
    [
      "noncombatgainskill",
      "item",
      [
        "Type",
        "Appear sfx",
        "Disappear sfx",
        "Skill Unlocked by Consumption",
        "Description",
      ],
    ],
    [
      "noncombatquest",
      "item",
      ["Type", "Appear sfx", "Disappear sfx", "Special quest", "Description"],
    ],
    [
      "repair",
      "item",
      [
        "Type",
        "Appear sfx",
        "Disappear sfx",
        "Power",
        "Power per level",
        "Description",
      ],
    ],
    [
      "rollbloodline",
      "item",
      [
        "Type",
        "Appear sfx",
        "Disappear sfx",
        "Power",
        "Power per level",
        "Rank",
        "Description",
      ],
    ],
    [
      "rollsagemode",
      "item",
      [
        "Type",
        "Appear sfx",
        "Disappear sfx",
        "Power",
        "Power per level",
        "Description",
      ],
    ],
    [
      "removebloodline",
      "item",
      [
        "Type",
        "Appear sfx",
        "Disappear sfx",
        "Power",
        "Power per level",
        "Description",
      ],
    ],
    [
      "marriageslotincrease",
      "item",
      [
        "Type",
        "Appear sfx",
        "Disappear sfx",
        "Power",
        "Power per level",
        "Rank",
        "Description",
      ],
    ],
  ] as const)("shows the %s tag fields for a %s", (type, wrapper, expected) => {
    const tag = getTagSchema(type).parse({ type }) as ZodAllTags;
    const view = render(
      <EffectFormWrapper
        type={wrapper}
        idx={0}
        tag={tag}
        effects={[tag]}
        setEffects={vi.fn()}
        availableTags={[type]}
      />,
    );
    expect(labels(view.container)).toEqual([...expected]);
  });

  it.each([
    ["specific", true, false],
    ["from_list", false, true],
    ["random", false, false],
    ["user_village", false, false],
    ["current_sector", false, false],
    ["enemy_village", false, false],
  ] as const)(
    "shows location fields for the %s sector type",
    (sectorType, showsSector, showsSectorList) => {
      const objective = getObjectiveSchema("move_to_location").parse({
        id: "travel",
        task: "move_to_location",
        sectorType,
      });
      const view = render(
        <ObjectiveFormWrapper
          idx={0}
          quest={{ consecutiveObjectives: true }}
          availableTags={["move_to_location"]}
          objective={objective}
          objectives={[objective]}
          setObjectives={vi.fn()}
        />,
      );
      expect(labels(view.container).includes("sector")).toBe(showsSector);
      expect(labels(view.container).includes("sectorList")).toBe(showsSectorList);
      expect(labels(view.container).includes("sectorType")).toBe(true);
    },
  );

  it.each([
    ["defeat_opponents", ["Next Objective ID", "If fail, go to objective"]],
    ["reset_quest", ["Reset to specific objective"]],
  ] as const)(
    "offers every objective id in the %s objective links",
    async (task, links) => {
      const parsed = getObjectiveSchema(task).safeParse({ id: "fight", task });
      const objective = (
        parsed.success ? parsed.data : { id: "fight", task }
      ) as AllObjectivesType;
      const objectives = [
        objective,
        { ...objective, id: "retry" },
        { ...objective, id: "done" },
      ] as AllObjectivesType[];
      const view = render(
        <ObjectiveFormWrapper
          idx={0}
          quest={{ consecutiveObjectives: true }}
          availableTags={[task]}
          objective={objective}
          objectives={objectives}
          setObjectives={vi.fn()}
        />,
      );
      expect(
        labels(view.container).filter((label) =>
          /Objective ID|objective$/.test(label ?? ""),
        ),
      ).toEqual([...links]);
      for (const label of links) {
        const trigger = view
          .getByText(label)
          .closest("div")!
          .querySelector<HTMLElement>('[role="combobox"]')!;
        fireEvent.click(trigger);
        for (const id of ["fight", "retry", "done"])
          expect(await view.findByRole("option", { name: id })).toBeTruthy();
        fireEvent.click(trigger);
        await waitFor(() =>
          expect(view.queryByRole("option", { name: "retry" })).toBeNull(),
        );
      }
    },
  );
});

describe("MassEffectEditor save failures", () => {
  for (const kind of ["item", "jutsu", "bloodline"] as const) {
    it(`reports ${kind} save failures once and releases the pending state`, async () => {
      const mutation = vi.spyOn(update, "useMutation");
      const retryable = vi
        .spyOn(errorUtils, "isRetryableTrpcError")
        .mockImplementation((error) => error.message === "Network down");
      for (const failure of [
        new Error("Server rejected"),
        new Error("Network down"),
        "opaque",
      ]) {
        save.mockImplementationOnce(async () => {
          throw failure;
        });
      }
      const entries = [
        {
          id: "first",
          name: "First",
          effects: [DamageTag.parse({})],
          updatedAt: new Date(),
        },
      ];
      const view = render(
        <MassEffectEditor
          kind={kind}
          entries={entries}
          selectedFields={["power"]}
          onPendingChange={pending}
        />,
      );
      // Failed saves keep the draft, so each retry still has unsaved changes to send.
      fireEvent.input(view.getByRole("spinbutton"), { target: { value: "4" } });
      for (let attempt = 1; attempt <= 3; attempt++) {
        fireEvent.click(
          view.getByRole("button", { name: `Save ${kind} effects for First` }),
        );
        await waitFor(() => expect(save).toHaveBeenCalledTimes(attempt));
        await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
        await waitFor(() => expect(view.queryByRole("status")).toBeNull());
      }
      expect(pending.mock.calls).toEqual([
        [true],
        [false],
        [true],
        [false],
        [true],
        [false],
      ]);
      // The global tRPC handler reports every failure except retryable transport errors.
      expect(mutation).toHaveBeenCalled();
      for (const [options] of mutation.mock.calls)
        expect(options?.meta).toEqual({ handlesTransportError: true });
      expect(toast.mock.calls).toEqual([
        [
          {
            success: false,
            message: `Could not confirm whether the ${kind} effects saved. Refresh before retrying.`,
          },
        ],
      ]);
      retryable.mockRestore();
    });
  }
});
