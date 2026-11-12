import { afterEach, beforeEach, expect, it, setDefaultTimeout, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import * as navigation from "next/navigation";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import PetProfilePage from "@/app/[shell]/profile/pet/page";
import * as toastUi from "@/components/ui/use-toast";
import {
  getAssignExperienceUserUpdate,
  getSavedPetSettingsUpdate,
} from "@/deltas/pets";
import type { UserPatch, UserUpdateOptions } from "@/deltas/profile";
import {
  MAP_WAKE_ISLAND_SECTOR,
  PET_ABILITY_SLOTS_BY_RARITY,
  PET_BATTLE_CONFIG,
  PET_FEED_COOLDOWN_HOURS,
  PET_FEED_EXPERIENCE_BY_RARITY,
  PET_RANKS,
  PetRarities,
} from "@/drizzle/constants";
import * as SectorVillage from "@/hooks/useSectorVillage";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as Link from "@/layout/Link";
import { PetProfile } from "@/layout/PetProfile";
import * as PetTasks from "@/layout/PetTasks";
import * as StatsDistributionForm from "@/layout/StatsDistributionForm";
import { AUTO_WAKE_MESSAGE, actionStatusMessage } from "@/libs/actionReadiness";
import { getPetAbilityCapacity } from "@/libs/pets/abilities";
import { getDailyPetOptions, PET_PALETTES } from "@/libs/pets/catalogue";
import * as petGender from "@/libs/pets/gender";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import {
  prepareUserUpdate as captureUserUpdate,
  updateUserCache,
} from "@/utils/userCache";
import { IncreaseStatTag } from "@/validators/combat";
import type { PetTask } from "@/validators/petTasks";
import { petJutsuFixture, petSkillFixture } from "../libs/pets/helpers/abilities";
import { petSpeciesFixture } from "../libs/pets/helpers/species";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";
import { actualShowMutationToast } from "../setup/preload";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

// These workflows render multiple dialogs and large forms in one interaction.
setDefaultTimeout(20_000);

type PetView = RouterOutputs["pets"]["getPet"];
let owner: {
  autoWakeUp?: boolean;
  userId: string;
  role: string;
  status: string;
  rank: string;
  reputationPoints: number;
  seichiSilver: number;
  sector: number;
  battleId: string | null;
  isOutlaw: boolean;
  updatedAt: Date;
  experience: number;
  earnedExperience: number;
  petExperience: number;
  petTask?: PetTask | null;
  activePetId?: string;
  village: {
    name: string;
    type: string;
    sector: number;
    structures: { route: string }[];
    relationshipA: [];
    relationshipB: [];
  };
};
let queryClient: QueryClient;
let data: PetView;
let requestedPetId: string | null;
let update: ReturnType<typeof vi.fn>;
let saveAbilities: ReturnType<typeof vi.fn>;
let feed: ReturnType<typeof vi.fn>;
let saveAi: ReturnType<typeof vi.fn>;
let getPet: ReturnType<typeof vi.fn>;
let getUser: ReturnType<typeof vi.fn>;
let unlockSlot: ReturnType<typeof vi.fn>;
let generate: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let evolve: ReturnType<typeof vi.fn>;
let timeDiff: number;
let previousBattleEnabled: boolean;
const prepareUserUpdate = vi.fn<() => number | undefined>(() => 17);
const updateUser = vi.fn<
  (patch: UserPatch | undefined, mutation?: UserUpdateOptions) => Promise<boolean>
>(async () => false);

beforeEach(() => {
  prepareUserUpdate.mockReset().mockReturnValue(17);
  updateUser.mockReset().mockResolvedValue(false);
  installBrowserGlobals({
    resizeObserver: true,
    scrollIntoView: true,
    animationFrame: true,
  });
  timeDiff = 0;
  previousBattleEnabled = PET_BATTLE_CONFIG.enabled;
  PET_BATTLE_CONFIG.enabled = true;
  requestedPetId = "companion";
  owner = {
    userId: "owner",
    role: "USER",
    status: "AWAKE",
    rank: "JONIN",
    reputationPoints: 1000,
    seichiSilver: 100,
    sector: 1,
    battleId: null,
    isOutlaw: false,
    updatedAt: new Date("2026-10-26T10:00:00Z"),
    experience: 100,
    earnedExperience: 100,
    petExperience: 0,
    village: {
      name: "Horizon",
      type: "VILLAGE",
      sector: 1,
      structures: [{ route: "/home" }],
      relationshipA: [],
      relationshipB: [],
    },
  };
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const pet = {
    id: "companion",
    name: "Miso",
    rank: 7,
    experience: 0,
    storedExperience: 0,
    revision: 0,
    potentialValue: 1,
    potentialRevealed: true,
    potentialChances: [],
    speciesId: "pet-species-0",
    species: petSpeciesFixture({ rarity: "UNCOMMON" }),
    paletteIndex: 0,
    characteristicIndex: 0,
    auraIndex: 0,
    generationStatus: "READY",
    avatar: "/miso.webp",
    artRank: 7,
    battleEnabled: true,
    spawnPosition: "BEHIND",
    jutsuIds: [],
    skillIds: [],
    aiRules: [],
    includeDefaultRules: false,
    lastFedAt: null,
    offence: 10,
    defence: 10,
    strength: 10,
    speed: 10,
    intelligence: 10,
    willpower: 10,
  };
  data = {
    pet,
    pets: [pet],
    activePetId: pet.id,
    slots: 6,
    permanentSlots: 6,
    bonusSlots: 0,
    maxSlots: 6,
    slotCost: 20,
    slotSilverCost: 50,
    maxRank: 7,
    nextRank: null,
    canRankUp: false,
    remainingGenerations: 3,
    generationLimit: 3,
    generationRetryAt: null,
    unusedExperience: 100,
    dayKey: "2026-10-16",
    options: getDailyPetOptions("owner", "NONE", [pet.species], "2026-10-16"),
    canFeed: true,
    feedAvailableAt: null,
    feedMeals: [
      {
        id: "meal",
        name: "Rice",
        quantity: 2,
        rarity: "COMMON",
        experience: PET_FEED_EXPERIENCE_BY_RARITY.COMMON,
      },
    ],
    abilityCapacity: getPetAbilityCapacity(pet),
    abilities: {
      jutsus: Array.from({ length: 12 }, (_, i) =>
        petJutsuFixture({ id: `jutsu-${i}`, name: `Strike ${i}` }),
      ),
      skills: Array.from({ length: 6 }, (_, i) =>
        petSkillFixture({ id: `skill-${i}`, name: `Skill ${i}` }),
      ),
    },
  } as unknown as PetView;
  update = vi.fn((input: RouterInputs["pets"]["updatePet"]) => {
    if (input.name === "Rejected")
      return { success: false, message: "This companion cannot be renamed right now." };
    data = { ...data, pet: { ...data.pet!, ...input } };
    return { success: true, message: "Updated" };
  });
  saveAbilities = vi.fn((input: RouterInputs["pets"]["updateAbilities"]) => {
    data = { ...data, pet: { ...data.pet!, ...input } };
    return { success: true, message: "Abilities saved" };
  });
  feed = vi.fn(() => ({ success: true, message: "Fed" }));
  saveAi = vi.fn(() => ({ success: true, message: "Rules saved" }));
  getPet = vi.fn(() => data);
  getUser = vi.fn(() => ({ userData: owner }));
  unlockSlot = vi.fn(() => ({ success: true, message: "Slot unlocked" }));
  generate = vi.fn(() => ({ success: false, message: "Please retry your image." }));
  assign = vi.fn(() => ({
    success: true,
    message: "Experience assigned",
    userPatch: { petExperience: 99 },
  }));
  evolve = vi.fn(() => ({ success: true, message: "Evolved" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    pets: testApi.pets,
    ai: testApi.ai,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(navigation, "useSearchParams").mockImplementation(
    () => new URLSearchParams(requestedPetId ? { petId: requestedPetId } : {}) as never,
  );
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () => ({ data: owner, timeDiff, prepareUserUpdate, updateUser }) as never,
  );
  vi.spyOn(SectorVillage, "useSectorVillage").mockImplementation(
    () =>
      ({
        sectorVillage:
          owner.sector === owner.village.sector || owner.isOutlaw
            ? owner.village
            : null,
        isLoading: false,
      }) as never,
  );
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ title, subtitle, children }) => (
      <section aria-label={title}>
        <p>{subtitle}</p>
        {children}
      </section>
    ),
  );
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(Link, "default").mockImplementation(({ href, children }) => (
    <a href={String(href)}>{children}</a>
  ));
  vi.spyOn(ItemWithEffects, "default").mockImplementation(({ item }) => (
    <p>{"description" in item ? String(item.description) : item.name}</p>
  ));
  vi.spyOn(StatsDistributionForm, "default").mockImplementation(
    ({ disabled, availableStats, onAccept }) => (
      <div>
        <p>
          {availableStats} training points {disabled ? "unavailable" : "available"}
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void onAccept({
              offence: 1,
              defence: 0,
              strength: 0,
              speed: 0,
              intelligence: 0,
              willpower: 0,
            })
          }
        >
          Assign experience
        </button>
      </div>
    ),
  );
  vi.spyOn(PetTasks, "PetTasks").mockImplementation(({ petId }) => (
    <p>Tasks for {petId}</p>
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  PET_BATTLE_CONFIG.enabled = previousBattleEnabled;
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const advanceClock = async (milliseconds: number) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
  // Query observers publish on a task after their transport's promise resolves.
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
};

const mount = (strictMode = false) => {
  const trpcClient = fakeTrpcClient(async (path, input) => {
    if (path === "profile.getUser") return getUser();
    if (path === "pets.getPet") {
      return getPet(input);
    }
    if (path === "pets.updatePet") return update(input);
    if (path === "pets.unlockSlot") return unlockSlot(input);
    if (path === "pets.updateAbilities") return saveAbilities(input);
    if (path === "pets.feedPet") return feed(input);
    if (path === "pets.updateAiConfig") return saveAi(input);
    if (path === "pets.generateAppearance") return generate(input);
    if (path === "pets.assignExperience") return assign(input);
    if (path === "pets.revealPotential") {
      data = {
        ...data,
        pet: { ...data.pet!, potentialValue: 5, potentialRevealed: true },
      };
      return { success: true, message: "Companion potential revealed.", userPatch: {} };
    }
    if (path === "pets.rankUp") return evolve(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(<PetProfile />, {
    wrapper: ({ children }) => (
      <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
        {children}
      </TrpcTestProviders>
    ),
    reactStrictMode: strictMode,
  });
};
const selectTab = (view: ReturnType<typeof mount>, name: string) =>
  fireEvent.mouseDown(view.getByRole("tab", { name }), { button: 0, ctrlKey: false });
const mealButton = (view: ReturnType<typeof mount>) =>
  view
    .getAllByRole("button", { name: "Feed one meal" })
    .find((button) => button.tagName === "BUTTON") as HTMLButtonElement;
const confirmMeal = async (view: ReturnType<typeof mount>) => {
  fireEvent.click(mealButton(view));
  const dialog = await view.findByRole("dialog", { name: /Feed .* to Miso\?/ });
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
};
const openSlotDialog = async (view: ReturnType<typeof mount>) => {
  fireEvent.click(await view.findByRole("button", { name: "Add slot" }));
  return view.findByRole("dialog", { name: "Add a companion slot" });
};

/** Exercise the real profile revision/merge path while retaining the surrounding pet UI fixtures. */
const observeProfileCache = () => {
  const key = getQueryKey(testApi.profile.getUser, undefined, "query");
  queryClient.setQueryData(key, { userData: owner });
  prepareUserUpdate.mockImplementation(() => captureUserUpdate(queryClient, key));
  updateUser.mockImplementation((patch, mutation) =>
    updateUserCache(queryClient, key, patch, mutation),
  );
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(() => {
    const { data: cached } = testApi.profile.getUser.useQuery(undefined, {
      staleTime: Infinity,
    });
    return { data: cached?.userData, timeDiff, prepareUserUpdate, updateUser } as never;
  });
  return () => queryClient.getQueryData<{ userData: typeof owner }>(key)?.userData;
};

it.each([false, true])(
  "refreshes cached companions once on remount with StrictMode %s",
  async (strictMode) => {
    const initial = mount();
    await initial.findByRole("tab", { name: "Training" });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    initial.unmount();
    getPet.mockClear();

    const returned = mount(strictMode);
    await returned.findByRole("tab", { name: "Training" });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(getPet).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [false, null],
  [true, null],
  [false, "companion"],
  [true, "companion"],
] as const)(
  "replaces an inherited companion refetch after unmounted rewards with StrictMode %s and pet %s",
  async (strictMode, petId) => {
    requestedPetId = petId;
    const initial = mount();
    await initial.findByRole("tab", { name: "Training" });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const staleData = data;
    let finishPrevious: (value: PetView) => void = () => undefined;
    getPet.mockImplementationOnce(
      () =>
        new Promise<PetView>((resolve) => {
          finishPrevious = resolve;
        }),
    );
    const previousFetch = queryClient.refetchQueries({
      queryKey: getQueryKey(
        testApi.pets.getPet,
        petId ? { petId } : undefined,
        "query",
      ),
      exact: true,
    });
    await waitFor(() => expect(getPet).toHaveBeenCalledTimes(2));
    initial.unmount();
    getPet.mockClear();
    owner = {
      ...owner,
      experience: owner.experience + 100,
      petExperience: owner.petExperience + 150,
    };
    data = { ...data, unusedExperience: 250 };

    const returned = mount(strictMode);
    selectTab(returned, "Training");
    await act(async () => {
      finishPrevious(staleData);
      await previousFetch;
    });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(returned.getByText(/\d+ training points available/).textContent).toBe(
      "250 training points available",
    );
    expect(getPet).toHaveBeenCalledTimes(1);
  },
);

it.each(["updatedAt", "experience", "earnedExperience", "petExperience"] as const)(
  "refreshes the companion bank when owner %s changes while mounted",
  async (field) => {
    const view = mount(true);
    await view.findByRole("tab", { name: "Training" });
    selectTab(view, "Training");
    await view.findByText("100 training points available");
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    getPet.mockClear();

    data = { ...data, unusedExperience: 250 };
    if (field === "updatedAt")
      owner = { ...owner, updatedAt: new Date(owner.updatedAt.getTime() + 1000) };
    else owner = { ...owner, [field]: owner[field] + 100 };
    view.rerender(<PetProfile />);

    await view.findByText("250 training points available");
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(getPet).toHaveBeenCalledTimes(1);
  },
);

it("keeps the companion query idle when owner progress values are unchanged", async () => {
  const view = mount(true);
  await view.findByRole("tab", { name: "Training" });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  getPet.mockClear();

  owner = {
    ...owner,
    updatedAt: new Date(owner.updatedAt),
    reputationPoints: owner.reputationPoints + 1,
  };
  await act(async () => {
    view.rerender(<PetProfile />);
  });
  expect(queryClient.isFetching()).toBe(0);
  expect(getPet).not.toHaveBeenCalled();
});

it("chooses daily cosmetics for a gifted founder, keeps its saved look available and resets cancelled drafts", async () => {
  const savedPalette = PET_PALETTES.find(
    (entry) => !data.options.palettes.some(({ index }) => index === entry.index),
  )!;
  data = {
    ...data,
    pet: {
      ...data.pet!,
      rank: 1,
      artRank: 0,
      avatar: null,
      generationStatus: "PENDING",
      paletteIndex: savedPalette.index,
    },
  };
  const view = mount();
  const openAppearance = async () => {
    fireEvent.click(
      await view.findByRole("button", { name: "Create / retry appearance" }),
    );
    return view.findByRole("dialog", { name: "Choose companion appearance" });
  };
  let dialog = await openAppearance();
  expect(within(dialog).getAllByRole("combobox")).toHaveLength(3);
  expect(within(dialog).queryByLabelText("Species")).toBeNull();
  expect(
    within(dialog).getByRole("combobox", { name: "Palette" }).textContent,
  ).toContain(`${savedPalette.name} (current)`);
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Palette" }));
  fireEvent.click(
    await view.findByRole("option", { name: data.options.palettes[0]!.name }),
  );
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
  expect(generate).not.toHaveBeenCalled();
  dialog = await openAppearance();
  expect(
    within(dialog).getByRole("combobox", { name: "Palette" }).textContent,
  ).toContain(`${savedPalette.name} (current)`);
  for (const [label, entries] of [
    ["Palette", data.options.palettes],
    ["Characteristic", data.options.characteristics],
    ["Aura", data.options.auras],
  ] as const) {
    fireEvent.click(within(dialog).getByRole("combobox", { name: label }));
    fireEvent.click(await view.findByRole("option", { name: entries[0]!.name }));
  }
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate appearance" }));
  await waitFor(() =>
    expect(generate).toHaveBeenCalledWith({
      petId: "companion",
      appearance: {
        dayKey: data.dayKey,
        paletteIndex: data.options.palettes[0]!.index,
        characteristicIndex: data.options.characteristics[0]!.index,
        auraIndex: data.options.auras[0]!.index,
      },
    }),
  );
  expect(
    view.queryByRole("dialog", { name: "Choose companion appearance" }),
  ).toBeNull();
  expect(await view.findByRole("alert")).toHaveProperty(
    "textContent",
    "Please retry your image.",
  );
});

it("selects founder cosmetics with Enter without generating until confirmation", async () => {
  data = {
    ...data,
    pet: {
      ...data.pet!,
      rank: 1,
      artRank: 0,
      avatar: null,
      paletteIndex: data.options.palettes[0]!.index,
      characteristicIndex: data.options.characteristics[0]!.index,
      auraIndex: data.options.auras[0]!.index,
    },
  };
  const view = mount();
  fireEvent.click(
    await view.findByRole("button", { name: "Create / retry appearance" }),
  );
  const dialog = await view.findByRole("dialog", {
    name: "Choose companion appearance",
  });
  for (const [label, entries] of [
    ["Palette", data.options.palettes],
    ["Characteristic", data.options.characteristics],
    ["Aura", data.options.auras],
  ] as const) {
    const trigger = within(dialog).getByRole("combobox", { name: label });
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const initial = await view.findByRole("option", { name: entries[0]!.name });
    await waitFor(() => expect(document.activeElement).toBe(initial));
    fireEvent.keyDown(initial, { key: "ArrowDown" });
    const chosen = view.getByRole("option", { name: entries[1]!.name });
    await waitFor(() => expect(document.activeElement).toBe(chosen));
    await act(async () => {
      fireEvent.keyDown(chosen, { key: "Enter" });
    });
    expect(generate).not.toHaveBeenCalled();
    expect(view.getByRole("dialog", { name: "Choose companion appearance" })).toBe(
      dialog,
    );
    expect(trigger.textContent).toContain(entries[1]!.name);
  }
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate appearance" }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  expect(generate).toHaveBeenCalledWith({
    petId: "companion",
    appearance: {
      dayKey: data.dayKey,
      paletteIndex: data.options.palettes[1]!.index,
      characteristicIndex: data.options.characteristics[1]!.index,
      auraIndex: data.options.auras[1]!.index,
    },
  });
  expect(
    view.queryByRole("dialog", { name: "Choose companion appearance" }),
  ).toBeNull();
});

it("retries an evolution from its accepted image without offering cosmetic changes", async () => {
  data = {
    ...data,
    pet: { ...data.pet!, rank: 2, artRank: 1, generationStatus: "FAILED" },
  };
  const view = mount();
  fireEvent.click(
    await view.findByRole("button", { name: "Create / retry appearance" }),
  );
  await waitFor(() => expect(generate).toHaveBeenCalledWith({ petId: "companion" }));
  expect(
    view.queryByRole("dialog", { name: "Choose companion appearance" }),
  ).toBeNull();
});

it.each([0, 2])(
  "keeps ready-pet care compact with %s attempts and offers redraw as a secondary setting",
  async (attempts) => {
    data = { ...data, remainingGenerations: attempts };
    const view = mount();
    await view.findByRole("tab", { name: "Settings" });
    const overview = view.getByRole("region", { name: "Miso" });
    expect(overview.textContent).not.toContain("image attempts");
    expect(overview.textContent).not.toContain("Creating the image");
    expect(view.queryByRole("button", { name: "Regenerate appearance" })).toBeNull();
    expect(mealButton(view).disabled).toBe(false);
    selectTab(view, "Settings");
    const settings = view.getByRole("tabpanel", { name: "Settings" });
    const redraw = within(settings).getByRole("button", {
      name: "Regenerate appearance",
    }) as HTMLButtonElement;
    expect(redraw.disabled).toBe(attempts === 0);
    expect(redraw.className).toContain("border-input");
    expect(settings.textContent).toContain(
      `${attempts} / 3 image attempts remain for this rank`,
    );
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  },
);

it("keeps failed missing-art recovery visible above the activity tabs", async () => {
  data = {
    ...data,
    pet: {
      ...data.pet!,
      rank: 1,
      artRank: 0,
      avatar: null,
      generationStatus: "FAILED",
    },
    canFeed: false,
  };
  const view = mount();
  const retry = await view.findByRole("button", { name: "Create / retry appearance" });
  const overview = view.getByRole("region", { name: "Miso" });
  expect(overview.contains(retry)).toBe(true);
  expect(overview.textContent).toContain(
    "The last image attempt did not finish, so it did not use an attempt.",
  );
  expect(overview.textContent).toContain("3 / 3 image attempts remain for this rank");
  expect(mealButton(view).disabled).toBe(true);
  selectTab(view, "Training");
  expect(
    (view.getByRole("button", { name: "Assign experience" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it.each([1, 2])(
  "directs an exhausted rank %s appearance to support and resumes after an attempt reset",
  async (rank) => {
    const pet = {
      ...data.pet!,
      rank,
      artRank: rank - 1,
      avatar: rank === 1 ? null : "/miso.webp",
      generationStatus: "FAILED" as const,
    };
    data = {
      ...data,
      pet,
      pets: [pet],
      remainingGenerations: 0,
      canFeed: false,
      generationRetryAt: new Date(Date.now() + 60_000),
    };
    const view = mount();
    const support = await view.findByRole("link", { name: "Contact support" });
    expect(support.getAttribute("href")).toBe("/support");
    expect(view.getByRole("region", { name: "Miso" }).contains(support)).toBe(true);
    expect(
      view.getByText(/request an image attempt reset for this companion/),
    ).toBeDefined();
    expect(view.queryByText(/Retry this same companion for free/)).toBeNull();
    expect(view.queryByText(/Appearance retry available in/)).toBeNull();
    expect(
      view.queryByRole("button", { name: "Create / retry appearance" }),
    ).toBeNull();
    selectTab(view, "Training");
    expect(
      (view.getByRole("button", { name: "Assign experience" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    data = { ...data, remainingGenerations: 1, generationRetryAt: null };
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    const retry = (await view.findByRole("button", {
      name: "Create / retry appearance",
    })) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    fireEvent.click(retry);
    if (rank === 1) {
      const dialog = await view.findByRole("dialog", {
        name: "Choose companion appearance",
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Generate appearance" }),
      );
    }
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        rank === 1
          ? {
              petId: pet.id,
              appearance: {
                dayKey: data.dayKey,
                paletteIndex: pet.paletteIndex,
                characteristicIndex: pet.characteristicIndex,
                auraIndex: pet.auraIndex,
              },
            }
          : { petId: pet.id },
      ),
    );
  },
);

it.each(["FAILED", "READY"] as const)(
  "waits for the final active image attempt before showing its %s outcome",
  async (generationStatus) => {
    const pet = {
      ...data.pet!,
      rank: 2,
      artRank: 1,
      generationStatus: "GENERATING" as const,
    };
    data = {
      ...data,
      pet,
      pets: [pet],
      remainingGenerations: 0,
      canFeed: false,
      generationRetryAt: new Date(Date.now() + 60_000),
    };
    const view = mount();
    await view.findByText("Your companion's appearance is being created");
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    expect(view.queryByText(/Appearance retry available in/)).toBeNull();
    expect(
      view.queryByRole("button", { name: "Create / retry appearance" }),
    ).toBeNull();
    expect(mealButton(view).disabled).toBe(true);

    const completed = {
      ...pet,
      generationStatus,
      artRank: generationStatus === "READY" ? 2 : 1,
    };
    data = {
      ...data,
      pet: completed,
      pets: [completed],
      canFeed: generationStatus === "READY",
    };
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    if (generationStatus === "FAILED") {
      await view.findByRole("link", { name: "Contact support" });
    } else {
      await waitFor(() => expect(mealButton(view).disabled).toBe(false));
      expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
      expect(view.queryByText(/appearance is unfinished/)).toBeNull();
    }
  },
);

it("waits for a local final-attempt response before offering support for failed art", async () => {
  const pet = {
    ...data.pet!,
    rank: 2,
    artRank: 1,
    generationStatus: "FAILED" as const,
  };
  data = { ...data, pet, pets: [pet], remainingGenerations: 1, canFeed: false };
  const { promise: generation, resolve: finishGeneration } = deferred<void>();
  generate.mockImplementation(async () => {
    await generation;
    return { success: false, message: "Image creation failed." };
  });
  const view = mount();
  try {
    fireEvent.click(
      await view.findByRole("button", { name: "Create / retry appearance" }),
    );
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    data = { ...data, remainingGenerations: 0 };
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(
      view.getByText("Your companion's appearance is being created"),
    ).toBeDefined();
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    expect(view.queryByText(/Retry this same companion for free/)).toBeNull();
    expect(
      (
        view.getByRole("button", {
          name: "Creating appearance...",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      finishGeneration();
    });
    await view.findByRole("link", { name: "Contact support" });
  } finally {
    finishGeneration();
  }
});

it("offers support once an exhausted generation lease has expired", async () => {
  const pet = {
    ...data.pet!,
    rank: 2,
    artRank: 1,
    generationStatus: "GENERATING" as const,
  };
  data = {
    ...data,
    pet,
    pets: [pet],
    remainingGenerations: 0,
    generationRetryAt: new Date(Date.now() - 1000),
  };
  const view = mount();
  await view.findByRole("link", { name: "Contact support" });
  expect(view.queryByText("Your companion's appearance is being created")).toBeNull();
  expect(view.queryByRole("button", { name: "Create / retry appearance" })).toBeNull();
});

it.each([1, 7])(
  "regenerates a rank %s companion with its saved traits and no cosmetic picker",
  async (rank) => {
    data = {
      ...data,
      pet: { ...data.pet!, rank, artRank: rank },
      remainingGenerations: 2,
    };
    const view = mount();
    await view.findByRole("tab", { name: "Settings" });
    selectTab(view, "Settings");
    fireEvent.click(await view.findByRole("button", { name: "Regenerate appearance" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ petId: "companion" }));
    expect(
      view.queryByRole("dialog", { name: "Choose companion appearance" }),
    ).toBeNull();
    expect(view.getByText(/2 \/ 3 image attempts remain for this rank/)).toBeTruthy();
    expect(await view.findByRole("alert")).toHaveProperty(
      "textContent",
      "Please retry your image.",
    );
    expect(view.getByRole("img", { name: "Miso" })).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Regenerate appearance" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  },
);

it.each(["hospital", "rejection", "success"] as const)(
  "keeps redraw %s feedback actionable without losing companion context",
  async (outcome) => {
    owner.status = "HOSPITALIZED";
    const success = outcome === "success";
    const message =
      outcome === "hospital"
        ? actionStatusMessage("HOSPITALIZED")
        : success
          ? "Appearance ready"
          : "Please retry your image.";
    const result = {
      success,
      message,
      ...(outcome === "hospital" ? {} : { actionNotice: AUTO_WAKE_MESSAGE }),
    };
    let finishGeneration: (value: typeof result) => void = () => undefined;
    generate.mockImplementation(
      () =>
        new Promise<typeof result>((resolve) => {
          finishGeneration = resolve;
        }),
    );
    vi.spyOn(toast, "showMutationToast").mockImplementation(actualShowMutationToast);
    const shown = vi
      .spyOn(toastUi, "toast")
      .mockImplementation(
        Object.assign(() => "pet-redraw", { dismiss: () => "pet-redraw" }),
      );
    const view = mount();
    try {
      await view.findByRole("tab", { name: "Settings" });
      selectTab(view, "Settings");
      const redraw = view.getByRole("button", {
        name: "Regenerate appearance",
      }) as HTMLButtonElement;
      expect(redraw.disabled).toBe(false);
      fireEvent.click(redraw);
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const pending = view.getByRole("button", {
        name: "Creating appearance...",
      }) as HTMLButtonElement;
      expect(pending.disabled).toBe(true);
      fireEvent.click(pending);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(shown).not.toHaveBeenCalled();
      await act(async () => {
        finishGeneration(result);
      });
      await waitFor(() => expect(shown).toHaveBeenCalledTimes(1));
      const feedback = shown.mock.calls[0]![0];
      expect(feedback.description).toBe(
        outcome === "hospital" ? message : `Miso: ${message} ${AUTO_WAKE_MESSAGE}`,
      );
      const action = render(feedback.action);
      if (outcome === "hospital") {
        expect(
          action.getByRole("link", { name: "Go to hospital" }).getAttribute("href"),
        ).toBe("/hospital");
      } else {
        expect(action.queryByRole("link", { name: "Go to hospital" })).toBeNull();
        expect(action.getByRole("button", { name: "OK" })).toBeDefined();
      }
      expect(
        (
          (await view.findByRole("button", {
            name: "Regenerate appearance",
          })) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      if (success) expect(view.queryByRole("alert")).toBeNull();
      else expect(view.getByRole("alert").textContent).toBe(message);
      expect(getUser).not.toHaveBeenCalled();
    } finally {
      finishGeneration(result);
    }
  },
);

it("waits for the server retry time before offering another redraw", async () => {
  vi.useFakeTimers({ now: Date.now() });
  data = { ...data, generationRetryAt: new Date(Date.now() + 2000) };
  const view = mount();
  await advanceClock(0);
  selectTab(view, "Settings");
  expect(view.getByText(/Appearance retry available in/)).toBeDefined();
  expect(view.queryByRole("button", { name: "Regenerate appearance" })).toBeNull();
  data = { ...data, generationRetryAt: null };
  await advanceClock(1990);
  expect(view.queryByRole("button", { name: "Regenerate appearance" })).toBeNull();
  expect(getPet).toHaveBeenCalledTimes(1);
  await advanceClock(10);
  expect(view.getByRole("button", { name: "Regenerate appearance" })).toBeDefined();
  expect(getPet).toHaveBeenCalledTimes(2);
});

it.each(["rejection", "network error", "success"])(
  "allows routine activity and companion switching during redraw, scoping late %s feedback",
  async (outcome) => {
    owner.rank = "ELITE JONIN";
    const other = { ...data.pet!, id: "second", name: "Sora" };
    data = {
      ...data,
      pets: [data.pet!, other],
      maxRank: 10,
      nextRank: PET_RANKS[7]!,
      canRankUp: true,
    };
    getPet.mockImplementation((input: { petId: string }) => ({
      ...data,
      pet: data.pets.find((entry) => entry.id === input.petId),
    }));
    const { promise: generation, resolve: finishGeneration } = deferred<void>();
    const { promise: assignment, resolve: finishAssignment } = deferred<void>();
    assign.mockImplementation(async () => {
      await assignment;
      return { success: true, message: "Experience assigned" };
    });
    generate.mockImplementation(async ({ petId }: { petId: string }) => {
      if (petId !== "companion") return { success: true, message: "Appearance ready" };
      await generation;
      if (outcome === "network error")
        throw new TRPCClientError("Miso image response lost");
      return {
        success: outcome === "success",
        message: outcome === "success" ? "Appearance ready" : "Miso image needs retry",
      };
    });
    const view = mount();
    const redraw = async () => {
      selectTab(view, "Settings");
      fireEvent.click(view.getByRole("button", { name: "Regenerate appearance" }));
    };
    const selectCompanion = async (name: string) => {
      fireEvent.click(view.getByRole("combobox", { name: "Companion" }));
      fireEvent.click(await view.findByRole("option", { name: new RegExp(name) }));
      await view.findByRole("img", { name });
    };
    try {
      await view.findByRole("tab", { name: "Settings" });
      await redraw();
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const pending = view.getByRole("button", {
        name: "Creating appearance...",
      }) as HTMLButtonElement;
      expect(pending.disabled).toBe(true);
      fireEvent.click(pending);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(
        (view.getByRole("textbox", { name: "Companion name" }) as HTMLInputElement)
          .disabled,
      ).toBe(false);
      expect(
        (view.getByRole("combobox", { name: "Companion" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(
        (
          view
            .getAllByRole("button", { name: "Release companion" })
            .find((button) => button.tagName === "BUTTON") as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      selectTab(view, "Care");
      expect(mealButton(view).disabled).toBe(false);
      await confirmMeal(view);
      await waitFor(() => expect(feed).toHaveBeenCalledTimes(1));
      selectTab(view, "Training");
      await waitFor(() =>
        expect(
          (view.getByRole("button", { name: "Assign experience" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      fireEvent.click(view.getByRole("button", { name: "Assign experience" }));
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          expect.objectContaining({ petId: "companion", offence: 1 }),
        ),
      );
      expect(
        (view.getByRole("combobox", { name: "Companion" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      selectTab(view, "Care");
      expect(mealButton(view).disabled).toBe(true);
      selectTab(view, "Settings");
      expect(
        (view.getByRole("textbox", { name: "Companion name" }) as HTMLInputElement)
          .disabled,
      ).toBe(true);
      await act(async () => {
        finishAssignment();
      });
      selectTab(view, "Training");
      const evolution = view
        .getAllByRole("button", { name: `Evolve to ${data.nextRank!.name}` })
        .find((button) => button.tagName === "BUTTON") as HTMLButtonElement;
      expect(evolution.disabled).toBe(true);
      fireEvent.click(evolution);
      expect(evolve).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          (view.getByRole("combobox", { name: "Companion" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      await selectCompanion("Sora");
      await redraw();
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      await view.findByRole("button", { name: "Regenerate appearance" });
      await selectCompanion("Miso");
      expect(
        (
          view.getByRole("button", {
            name: "Creating appearance...",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      await selectCompanion("Sora");
      // A redraw response must not clear another pet's actionable mutation rejection either.
      fireEvent.change(view.getByRole("textbox", { name: "Companion name" }), {
        target: { value: "Rejected" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await view.findByText("This companion cannot be renamed right now.");
      await act(async () => {
        finishGeneration();
      });
      await waitFor(() => expect(getPet).toHaveBeenLastCalledWith({ petId: "second" }));
      expect(view.getAllByRole("alert").map((entry) => entry.textContent)).toEqual([
        "This companion cannot be renamed right now.",
      ]);
      if (outcome === "network error") {
        expect(toast.showMutationToast).toHaveBeenCalledWith({
          success: false,
          message: `Miso: Miso image response lost. The image may still finish; refresh in a few minutes. Failed generations do not use an attempt.`,
        });
      }
      await selectCompanion("Miso");
      const retry = (await view.findByRole("button", {
        name: "Regenerate appearance",
      })) as HTMLButtonElement;
      expect(retry.disabled).toBe(false);
      if (outcome === "success") {
        expect(view.queryByRole("alert")).toBeNull();
        expect(toast.showMutationToast).toHaveBeenCalledWith({
          success: true,
          message: "Miso: Appearance ready",
        });
      } else {
        expect((await view.findByRole("alert")).textContent).toBe(
          outcome === "network error"
            ? "Miso image response lost. The image may still finish; refresh in a few minutes. Failed generations do not use an attempt."
            : "Miso image needs retry",
        );
      }
    } finally {
      finishGeneration();
      finishAssignment();
    }
  },
);

it.each([0, 3])(
  "keeps evolution and artwork recoverable with %s attempts left in the previous rank",
  async (remainingGenerations) => {
    owner.rank = "ELITE JONIN";
    data = {
      ...data,
      maxRank: 10,
      nextRank: PET_RANKS[7]!,
      canRankUp: true,
      remainingGenerations,
    };
    const { promise: evolution, resolve: finishEvolution } = deferred<void>();
    const { promise: generation, resolve: finishGeneration } = deferred<void>();
    evolve.mockImplementation(async () => {
      await evolution;
      const pet = { ...data.pet!, rank: 8, generationStatus: "PENDING" as const };
      data = {
        ...data,
        pet,
        pets: [pet],
        canRankUp: false,
        canFeed: false,
        remainingGenerations: 3,
      };
      return { success: true, message: "Evolved" };
    });
    generate.mockImplementation(async () => {
      await generation;
      return { success: false, message: "Retry evolved appearance" };
    });
    const view = mount();
    try {
      await view.findByRole("tab", { name: "Training" });
      selectTab(view, "Training");
      const button = view
        .getAllByRole("button", { name: `Evolve to ${data.nextRank!.name}` })
        .find((entry) => entry.tagName === "BUTTON")!;
      fireEvent.click(button);
      const dialog = await view.findByRole("dialog", { name: /Evolve Miso/ });
      fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
      await waitFor(() => expect(evolve).toHaveBeenCalledTimes(1));
      expect(
        (view.getByRole("combobox", { name: "Companion" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (view.getByRole("button", { name: "Assign experience" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      fireEvent.click(button);
      expect(evolve).toHaveBeenCalledTimes(1);
      await act(async () => {
        finishEvolution();
      });
      await waitFor(() =>
        expect(generate).toHaveBeenCalledWith({ petId: "companion" }),
      );
      expect(
        (view.getByRole("combobox", { name: "Companion" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (
          view.getByRole("button", {
            name: "Creating appearance...",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      await act(async () => {
        finishGeneration();
      });
      expect(
        (
          (await view.findByRole("button", {
            name: "Create / retry appearance",
          })) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      expect((await view.findByRole("alert")).textContent).toBe(
        "Retry evolved appearance",
      );
      fireEvent.click(view.getByRole("button", { name: "Create / retry appearance" }));
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      expect(evolve).toHaveBeenCalledTimes(1);
    } finally {
      finishEvolution();
      finishGeneration();
    }
  },
);

it("polls a server-side cosmetic replacement while keeping accepted art and care usable", async () => {
  vi.useFakeTimers({ now: Date.now() });
  const pending = { ...data.pet!, generationStatus: "GENERATING" as const };
  data = {
    ...data,
    pet: pending,
    pets: [pending],
    generationRetryAt: new Date(Date.now() + 60000),
  };
  getPet.mockImplementation(() => {
    const snapshot = data;
    data = {
      ...data,
      pet: { ...pending, generationStatus: "READY" },
      pets: [{ ...pending, generationStatus: "READY" }],
      generationRetryAt: null,
    };
    return snapshot;
  });
  const view = mount();
  await advanceClock(0);
  expect(view.getByRole("img", { name: "Miso" })).toBeDefined();
  expect(mealButton(view).disabled).toBe(false);
  selectTab(view, "Settings");
  expect(view.getByRole("status").textContent).toBe(
    "Creating appearance... Your current appearance stays usable.",
  );
  expect(view.queryByRole("button", { name: "Regenerate appearance" })).toBeNull();
  await advanceClock(2990);
  expect(getPet).toHaveBeenCalledTimes(1);
  expect(view.queryByRole("button", { name: "Regenerate appearance" })).toBeNull();
  await advanceClock(10);
  expect(view.getByRole("button", { name: "Regenerate appearance" })).toBeDefined();
  expect(getPet).toHaveBeenCalledTimes(2);
});

it.each(["REPUTATION", "SEICHI_SILVER"] as const)(
  "buys a permanent collection slot using only the chosen %s balance",
  async (currency) => {
    data = { ...data, slots: 4, permanentSlots: 1, bonusSlots: 3, maxSlots: 9 };
    owner.reputationPoints = currency === "REPUTATION" ? 20 : 0;
    owner.seichiSilver = currency === "SEICHI_SILVER" ? 50 : 0;
    const view = mount();
    await view.findByRole("button", { name: "Add slot" });
    expect(view.queryByRole("radio")).toBeNull();
    expect(view.queryByText(/^Balance:/)).toBeNull();
    const dialog = await openSlotDialog(view);
    const reputation = within(dialog).getByRole("radio", { name: "20 reputation" });
    if (currency === "SEICHI_SILVER") {
      expect(
        (
          within(dialog).getByRole("button", {
            name: "Unlock slot · 20 reputation",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      fireEvent.click(within(dialog).getByRole("radio", { name: "50 Seichi Silver" }));
    } else {
      expect(reputation.getAttribute("aria-checked")).toBe("true");
    }
    const price = currency === "SEICHI_SILVER" ? "50 Seichi Silver" : "20 reputation";
    expect(dialog.textContent).toContain(
      "Add one permanent slot to keep up to 5 companions.",
    );
    expect(unlockSlot).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: `Unlock slot · ${price}` }),
    );
    await waitFor(() => expect(unlockSlot).toHaveBeenCalledWith({ currency }));
    await waitFor(() =>
      expect(view.queryByRole("dialog", { name: "Add a companion slot" })).toBeNull(),
    );
    expect(
      view.getByText(/1 permanent slot · 3 federal support bonus slots/),
    ).toBeTruthy();
    expect(view.getByText(/Your companions are kept if support expires/)).toBeTruthy();
  },
);

it("opens slot pricing with no reputation and only enables payment after choosing an affordable currency", async () => {
  data = { ...data, slots: 1, permanentSlots: 1 };
  owner.reputationPoints = 0;
  owner.seichiSilver = 50;
  const view = mount();
  const dialog = await openSlotDialog(view);
  expect(within(dialog).getByRole("status").textContent).toBe(
    "You need 20 more reputation to unlock this slot.",
  );
  const reputationPayment = within(dialog).getByRole("button", {
    name: "Unlock slot · 20 reputation",
  }) as HTMLButtonElement;
  expect(reputationPayment.disabled).toBe(true);
  fireEvent.click(reputationPayment);
  expect(unlockSlot).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("radio", { name: "50 Seichi Silver" }));
  expect(within(dialog).queryByRole("status")).toBeNull();
  expect(
    (
      within(dialog).getByRole("button", {
        name: "Unlock slot · 50 Seichi Silver",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(unlockSlot).not.toHaveBeenCalled();
});

it("does not buy a collection slot when the payment dialog is closed", async () => {
  data = { ...data, slots: 1, permanentSlots: 1 };
  const view = mount();
  const dialog = await openSlotDialog(view);
  fireEvent.click(within(dialog).getByRole("radio", { name: "50 Seichi Silver" }));
  fireEvent.click(within(dialog).getByText("Close", { selector: "button" }));
  await waitFor(() =>
    expect(view.queryByRole("dialog", { name: "Add a companion slot" })).toBeNull(),
  );
  expect(unlockSlot).not.toHaveBeenCalled();
});

it("keeps a rejected slot purchase open with recoverable feedback and closes after a successful retry", async () => {
  data = { ...data, slots: 1, permanentSlots: 1 };
  unlockSlot.mockReturnValueOnce({
    success: false,
    message: "Your account changed. Please try again.",
  });
  const view = mount();
  const dialog = await openSlotDialog(view);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Unlock slot · 20 reputation" }),
  );
  await within(dialog).findByRole("alert");
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Your account changed. Please try again.",
  );
  await waitFor(() =>
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Unlock slot · 20 reputation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(within(dialog).getByRole("radio", { name: "50 Seichi Silver" }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Unlock slot · 50 Seichi Silver" }),
  );
  await waitFor(() =>
    expect(unlockSlot).toHaveBeenLastCalledWith({ currency: "SEICHI_SILVER" }),
  );
  await waitFor(() =>
    expect(view.queryByRole("dialog", { name: "Add a companion slot" })).toBeNull(),
  );
  expect(unlockSlot).toHaveBeenCalledTimes(2);
});

it("keeps a pending slot purchase guarded against duplicate payment or a changed currency", async () => {
  data = { ...data, slots: 1, permanentSlots: 1 };
  let completePurchase!: (result: { success: boolean; message: string }) => void;
  unlockSlot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completePurchase = resolve;
      }),
  );
  const view = mount();
  const dialog = await openSlotDialog(view);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Unlock slot · 20 reputation" }),
  );
  const pending = (await within(dialog).findByRole("button", {
    name: "Unlocking slot...",
  })) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  expect(
    (
      within(dialog).getByRole("radio", {
        name: "50 Seichi Silver",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(pending);
  expect(unlockSlot).toHaveBeenCalledTimes(1);
  await act(async () => completePurchase({ success: true, message: "Slot unlocked" }));
  await waitFor(() =>
    expect(view.queryByRole("dialog", { name: "Add a companion slot" })).toBeNull(),
  );
});

it("omits the slot purchase action at maximum capacity", async () => {
  const view = mount();
  await view.findByRole("combobox", { name: "Companion" });
  expect(view.queryByRole("button", { name: "Add slot" })).toBeNull();
  expect(view.queryByRole("radio", { name: "20 reputation" })).toBeNull();
});

it("keeps companion management available after support expires while offering remaining permanent slots", async () => {
  data = {
    ...data,
    slots: 1,
    permanentSlots: 1,
    bonusSlots: 0,
    maxSlots: 6,
    pets: [data.pet!, { ...data.pet!, id: "retained", name: "Retained" }],
  };
  const view = mount();
  await view.findByRole("button", { name: "Add slot" });
  expect(view.getByText("2 / 1 collection slots")).toBeTruthy();
  expect(
    (view.getByRole("combobox", { name: "Companion" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(view.getByRole("tabpanel", { name: "Care" })).toBeTruthy();
  expect(
    view.getByText(/adopting requires room in your current capacity/),
  ).toBeTruthy();
  expect(
    view.getByText(/adopting requires room in your current capacity/).closest("details")
      ?.open,
  ).toBe(true);
  const dialog = await openSlotDialog(view);
  expect(within(dialog).getByRole("radio", { name: "20 reputation" })).toBeTruthy();
});

it.each([false, true])(
  "keeps companion combat off and unavailable for a saved preference of %s",
  async (battleEnabled) => {
    PET_BATTLE_CONFIG.enabled = false;
    data.pet!.battleEnabled = battleEnabled;
    const view = mount();
    await view.findByRole("tab", { name: "Battle" });
    selectTab(view, "Battle");
    const toggle = view.getByRole("switch", { name: "Join me in battle" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(
      document.getElementById(toggle.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("Companion battles are not available yet.");
    expect(view.getByText("Unavailable")).toBeTruthy();
    expect(view.queryByText("Joining battle")).toBeNull();
    fireEvent.click(toggle);
    expect(update).not.toHaveBeenCalled();
  },
);

it("shows focused activities and preserves an AI draft while switching tabs", async () => {
  const view = mount();
  await view.findByRole("tablist", { name: "Companion activities" });
  expect(view.getAllByRole("tabpanel")).toHaveLength(1);
  const care = view.getByRole("tab", { name: /^Care$/ });
  const carePanel = view.getByRole("tabpanel", { name: /^Care$/ });
  expect(carePanel.getAttribute("aria-labelledby")).toBe(care.id);
  expect(carePanel.textContent).toContain("Feed one meal");
  expect(carePanel.textContent).not.toContain("training points available");
  expect(carePanel.textContent).not.toContain("final evolution");
  const stats = view.getAllByRole("definition")[0]!.closest("dl")!;
  expect(stats.getAttribute("aria-label")).toBe("Companion stats");
  expect(stats.closest("section")?.getAttribute("aria-label")).toBe("Miso");
  expect(stats.closest('[role="tabpanel"]')).toBeNull();
  act(() => care.focus());
  fireEvent.keyDown(care, { key: "ArrowRight" });
  await waitFor(() =>
    expect(view.getByRole("tabpanel", { name: "Training" })).toBeTruthy(),
  );
  expect(view.getByText("100 training points available")).toBeTruthy();
  expect(
    view.getByText("Your companion has reached its final evolution."),
  ).toBeTruthy();
  expect(view.queryAllByRole("button", { name: "Feed one meal" })).toHaveLength(0);
  fireEvent.keyDown(view.getByRole("tab", { name: "Training" }), { key: "ArrowRight" });
  await waitFor(() =>
    expect(view.getByRole("tabpanel", { name: "Abilities" })).toBeTruthy(),
  );
  expect(document.activeElement).toBe(view.getByRole("tab", { name: "Abilities" }));
  expect(view.queryByRole("button", { name: "Save Profile" })).toBeNull();
  selectTab(view, "Battle");
  fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
  expect(view.getByRole("button", { name: /Rule 1:/ })).toBeTruthy();
  selectTab(view, "Abilities");
  expect(view.queryByRole("button", { name: /Rule 1:/ })).toBeNull();
  selectTab(view, "Battle");
  fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
  await waitFor(() => expect(saveAi).toHaveBeenCalledTimes(1));
  expect(saveAi.mock.calls[0]?.[0]).toMatchObject({
    petId: "companion",
    includeDefaultRules: false,
  });
  expect(saveAi.mock.calls[0]?.[0].rules).toHaveLength(1);
});

it("associates a friendly blank-name error with the field and preserves backend rejection messages", async () => {
  const view = mount();
  await view.findByRole("tab", { name: "Settings" });
  selectTab(view, "Settings");
  const name = view.getByRole("textbox", { name: "Companion name" });
  fireEvent.change(name, { target: { value: " " } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  const error = await view.findByRole("alert");
  expect(error.textContent).toBe("Enter a companion name.");
  expect(name.getAttribute("aria-describedby")).toContain(error.id);
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(name);
  expect(update).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: "Rejected" } });
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await view.findByText("This companion cannot be renamed right now.");
  expect(
    (view.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.change(name, { target: { value: "Sora" } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(data.pet?.name).toBe("Sora"));
});

it("offers a free gender setting before the cutoff and shows it read-only afterwards", async () => {
  const view = mount();
  await view.findByRole("tab", { name: "Settings" });
  selectTab(view, "Settings");
  const gender = view.getByRole("combobox", { name: "Gender" });
  expect(gender.textContent).toContain("Not set");
  expect(
    (view.getByRole("button", { name: "Save gender" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    view.getByText(
      /Changeable until 26 Nov, without using an image attempt\. Regenerate to redraw with it\./,
    ),
  ).toBeDefined();
  cleanup();
  vi.spyOn(petGender, "isPetGenderEditable").mockReturnValue(false);
  data = { ...data, pet: { ...data.pet!, gender: "FEMALE" } };
  const later = mount();
  await later.findByRole("tab", { name: "Settings" });
  selectTab(later, "Settings");
  expect(later.queryByRole("combobox", { name: "Gender" })).toBeNull();
  expect(later.queryByRole("button", { name: "Save gender" })).toBeNull();
  expect(later.getByText("Female")).toBeDefined();
});

it("keeps the selected loadout and save action before compact searchable choices and enforces shared slots", async () => {
  const view = mount();
  await view.findByRole("tab", { name: "Abilities" });
  selectTab(view, "Abilities");
  const choices = view.getByRole("group", { name: "Available companion abilities" });
  const save = view.getByRole("button", { name: "Save abilities" });
  expect(
    save.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(choices).getAllByRole("checkbox")).toHaveLength(18);
  fireEvent.click(view.getByRole("checkbox", { name: /Strike 0 Jutsu/ }));
  fireEvent.click(view.getByRole("checkbox", { name: /Strike 1 Jutsu/ }));
  fireEvent.click(view.getByRole("checkbox", { name: /Skill 0 Skill/ }));
  expect(
    (view.getByRole("checkbox", { name: /Strike 2 Jutsu/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (view.getByRole("checkbox", { name: /Strike 0 Jutsu/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    view
      .getAllByText("This loadout exceeds your companion's rarity-based ability slots.")
      .every((message) => message.closest("details")?.open === false),
  ).toBe(true);
  fireEvent.change(view.getByRole("textbox", { name: "Find an ability" }), {
    target: { value: "Strike 0" },
  });
  expect(within(choices).getAllByRole("checkbox")).toHaveLength(1);
  selectTab(view, "Care");
  selectTab(view, "Abilities");
  fireEvent.click(view.getByRole("button", { name: "Save abilities" }));
  await waitFor(() =>
    expect(saveAbilities).toHaveBeenCalledWith({
      petId: "companion",
      jutsuIds: ["jutsu-0", "jutsu-1"],
      skillIds: ["skill-0"],
    }),
  );
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Save abilities" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(view.getByRole("button", { name: "Clear selection" }));
  expect(view.getByText("No abilities selected.")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Save abilities" }));
  await waitFor(() =>
    expect(saveAbilities).toHaveBeenLastCalledWith({
      petId: "companion",
      jutsuIds: [],
      skillIds: [],
    }),
  );
});

it.each([...PetRarities])(
  "grants all %s ability slots from adoption without a purchase action",
  async (rarity) => {
    data.pet = {
      ...data.pet!,
      rank: 1,
      artRank: 1,
      species: petSpeciesFixture({ rarity }),
    };
    data.abilityCapacity = getPetAbilityCapacity(data.pet);
    const view = mount();
    await view.findByRole("tab", { name: "Abilities" });
    selectTab(view, "Abilities");
    expect(
      view.getByText(`0 / ${PET_ABILITY_SLOTS_BY_RARITY[rarity]} slots used`),
    ).toBeTruthy();
    expect(
      view.getByText(/slots from adoption. Evolving increases the power budget/),
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: /Unlock ability slot/ })).toBeNull();
    expect(view.getByText("0 / 2 power budget")).toBeTruthy();
  },
);

it("shows role and compact species skills without expanding the overview", async () => {
  data.pet!.species = petSpeciesFixture({
    role: "SUPPORT",
    effects: [IncreaseStatTag.parse({})],
  });
  const view = mount();
  await view.findByText("Support");
  const skills = view.getByText("Species skills · 1 tag").closest("details")!;
  expect(skills.open).toBe(false);
  expect(skills.textContent).toContain("Applies once at battle start");
  expect(skills.textContent).toContain("participates in an eligible battle");
});

it("offers an editable PvE preference and explains the excluded battle modes", async () => {
  const view = mount();
  await view.findByRole("tab", { name: "Battle" });
  selectTab(view, "Battle");
  const toggle = view.getByRole("switch", { name: "Join me in battle" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect((toggle as HTMLButtonElement).disabled).toBe(false);
  expect(view.getByText("Ready for PvE")).toBeTruthy();
  expect(
    document.getElementById(toggle.getAttribute("aria-describedby")!)?.textContent,
  ).toContain("dungeon quest battles only");
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({ petId: "companion", battleEnabled: false }),
  );
});

it("locks the away companion while keeping collection navigation and other companions available", async () => {
  owner.petTask = {
    petId: "companion",
    questHistoryId: "attempt",
    questId: "contract",
    startedAt: 1,
    questVersion: 1,
    finishesAt: Date.now() + 60000,
  };
  const other = { ...data.pet!, id: "second", name: "Sora" };
  data.pets = [data.pet!, other];
  getPet.mockImplementation((input: { petId: string }) =>
    input.petId === "second" ? { ...data, pet: other } : data,
  );
  const view = mount();
  await view.findByText(/Miso is away on a task/);
  fireEvent.click(view.getByRole("button", { name: "Open Tasks" }));
  expect(view.getByText("Tasks for companion")).toBeTruthy();
  selectTab(view, "Care");
  expect(mealButton(view).disabled).toBe(true);
  const collection = view.getByRole("combobox", { name: "Companion" });
  expect((collection as HTMLButtonElement).disabled).toBe(false);
  selectTab(view, "Training");
  expect(view.getByText("100 training points unavailable")).toBeTruthy();
  selectTab(view, "Abilities");
  expect(
    (view.getByRole("button", { name: "Save abilities" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  selectTab(view, "Battle");
  expect(
    (view.getByRole("switch", { name: "Join me in battle" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(view.queryByRole("button", { name: "Save Profile" })).toBeNull();
  selectTab(view, "Settings");
  expect(
    (view.getByRole("textbox", { name: "Companion name" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  selectTab(view, "Tasks");
  expect(view.getByText("Tasks for companion")).toBeTruthy();
  fireEvent.keyDown(collection, { key: "ArrowDown" });
  fireEvent.click(await view.findByRole("option", { name: /Sora/ }));
  await waitFor(() => expect(getPet).toHaveBeenLastCalledWith({ petId: "second" }));
  await view.findByRole("tab", { name: "Care" });
  selectTab(view, "Care");
  await waitFor(() => expect(mealButton(view).disabled).toBe(false));
  expect(view.queryByText(/Miso is away on a task/)).toBeNull();
});

it.each(["COMMON", "RARE", "EPIC", "LEGENDARY"] as const)(
  "shows %s meal experience in selection and confirms before consuming",
  async (rarity) => {
    const experience = PET_FEED_EXPERIENCE_BY_RARITY[rarity];
    data.feedMeals = [{ ...data.feedMeals[0]!, rarity, experience }];
    const view = mount();
    await view.findAllByRole("button", { name: "Feed one meal" });
    expect(view.getByRole("combobox", { name: "Meal" }).textContent).toContain(
      `${experience.toLocaleString()} XP`,
    );
    fireEvent.click(mealButton(view));
    const dialog = await view.findByRole("dialog", { name: "Feed Rice to Miso?" });
    expect(dialog.textContent).toContain(
      `${experience.toLocaleString()} unused experience`,
    );
    expect(feed).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
    await waitFor(() =>
      expect(feed).toHaveBeenCalledWith({
        petId: "companion",
        userItemId: "meal",
        expectedQuantity: 2,
      }),
    );
  },
);

it.each([false, true])(
  "shows the feeding cadence with combat enabled %s and feeds using the displayed inventory snapshot",
  async (enabled) => {
    PET_BATTLE_CONFIG.enabled = enabled;
    const view = mount();
    await view.findAllByRole("button", { name: "Feed one meal" });
    await confirmMeal(view);
    expect(
      view.getByText(`Share a meal every ${PET_FEED_COOLDOWN_HOURS} hours`),
    ).toBeTruthy();
    await waitFor(() =>
      expect(feed).toHaveBeenCalledWith({
        petId: "companion",
        userItemId: "meal",
        expectedQuantity: 2,
      }),
    );
    expect(view.getByRole("tabpanel", { name: /^Care$/ }).textContent).not.toContain(
      "training points",
    );
    selectTab(view, "Training");
    expect(view.getByText("100 training points available")).toBeTruthy();
  },
);

it("keeps feeding unavailable until the server-time countdown expires and refreshes eligibility in place", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  timeDiff = 5000;
  data = { ...data, canFeed: false, feedAvailableAt: new Date(now - 3000) };
  const view = mount();
  await view.findByText(/Next meal available in/);
  expect(view.queryAllByRole("button", { name: "Feed one meal" })).toHaveLength(0);
  expect(feed).not.toHaveBeenCalled();
  now += 1999;
  await view.findByText("0 seconds");
  expect(getPet).toHaveBeenCalledTimes(1);
  expect(view.queryAllByRole("button", { name: "Feed one meal" })).toHaveLength(0);
  data = { ...data, canFeed: true, feedAvailableAt: null };
  now += 1;
  await view.findAllByRole("button", { name: "Feed one meal" });
  const action = mealButton(view);
  expect(getPet).toHaveBeenCalledTimes(2);
  expect((action as HTMLButtonElement).disabled).toBe(false);
  await confirmMeal(view);
  await waitFor(() => expect(feed).toHaveBeenCalledTimes(1));
});

it.each([
  [1, "/travel?sector=" + MAP_WAKE_ISLAND_SECTOR, "Travel to Wake Island"],
  [MAP_WAKE_ISLAND_SECTOR, "/pets", "Open sanctuary"],
])(
  "offers a reachable sanctuary destination from sector %s",
  async (sector, href, label) => {
    owner.sector = Number(sector);
    const view = mount();
    expect(
      (await view.findByRole("link", { name: String(label) })).getAttribute("href"),
    ).toBe(href);
    expect(view.queryByRole("link", { name: "Visit the sanctuary" })).toBeNull();
  },
);

it("offers one targeted sanctuary action for an empty collection", async () => {
  data = { ...data, pet: null, pets: [], activePetId: null };
  const view = mount();
  const action = await view.findByRole("link", { name: "Travel to Wake Island" });
  expect(action.getAttribute("href")).toBe(`/travel?sector=${MAP_WAKE_ISLAND_SECTOR}`);
  expect(view.queryByRole("link", { name: "Open sanctuary" })).toBeNull();
});

it("keeps an orphaned task recoverable when the companion collection is empty", async () => {
  requestedPetId = null;
  data = { ...data, pet: null, pets: [], activePetId: null };
  owner.petTask = {
    petId: "missing-companion",
    questId: "contract",
    questHistoryId: "attempt",
    startedAt: 1,
    questVersion: 1,
    finishesAt: 2,
  };
  const view = mount();
  const task = await view.findByText("Tasks for missing-companion");
  expect(task.closest("section")?.getAttribute("aria-label")).toBe("Companion task");
  expect(view.queryByRole("tablist", { name: "Companion activities" })).toBeNull();
  expect(view.getByRole("link", { name: "Travel to Wake Island" })).toBeTruthy();
});

it("opens the existing home kitchen directly when the owner is at home", async () => {
  data = { ...data, feedMeals: [] };
  const view = mount();
  expect(
    (await view.findByRole("link", { name: "Open kitchen" })).getAttribute("href"),
  ).toBe("/home?panel=kitchen");
});

it("opens the owner kitchen for a roaming outlaw whose resolved village is the Syndicate", async () => {
  owner.isOutlaw = true;
  owner.sector = 2;
  data = { ...data, feedMeals: [] };
  const view = mount();
  expect(
    (await view.findByRole("link", { name: "Open kitchen" })).getAttribute("href"),
  ).toBe("/home?panel=kitchen");
  expect(view.queryByRole("link", { name: "Travel home to cook" })).toBeNull();
});

it("targets the owner's home village when cooking is elsewhere", async () => {
  owner.sector = MAP_WAKE_ISLAND_SECTOR;
  data = { ...data, feedMeals: [] };
  const view = mount();
  expect(
    (await view.findByRole("link", { name: "Travel home to cook" })).getAttribute(
      "href",
    ),
  ).toBe("/travel?sector=1");
  expect(view.getByText(/home kitchen in Horizon/)).toBeTruthy();
  expect(view.queryByRole("link", { name: "Open kitchen" })).toBeNull();
});

it.each(["ASLEEP", "BATTLE"])(
  "explains unavailable travel without leaving a working link while %s",
  async (status) => {
    owner.status = status;
    owner.autoWakeUp = false;
    owner.sector = 2;
    data = { ...data, feedMeals: [] };
    const view = mount();
    expect(
      (
        (await view.findByRole("button", {
          name: "Travel to Wake Island",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (view.getByRole("button", { name: "Travel home to cook" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(view.queryByRole("link", { name: /Travel/ })).toBeNull();
    expect(view.getAllByText(/awake state outside battle to travel/)).toHaveLength(2);
  },
);

it("explains missing home kitchens without sending the player to an inaccessible home", async () => {
  owner.village.structures = [];
  data = { ...data, feedMeals: [] };
  const view = mount();
  await view.findByText("Your current village does not have a home kitchen.");
  expect(view.queryByRole("link", { name: /kitchen|cook/ })).toBeNull();
});

it.each([
  [{}, "/profile?tab=pet"],
  [{ petId: "pet / one" }, "/profile?tab=pet&petId=pet+%2F+one"],
  [{ petId: ["selected", "ignored"] }, "/profile?tab=pet&petId=selected"],
] as const)(
  "redirects the standalone profile with canonical pet selection %j",
  async (params, expected) => {
    const redirect = vi.spyOn(navigation, "redirect").mockImplementation((url) => {
      throw new Error(String(url));
    });
    await expect(
      PetProfilePage({
        searchParams: Promise.resolve(params as { petId?: string | string[] }),
      }),
    ).rejects.toThrow(expected);
    expect(redirect).toHaveBeenCalledWith(expected);
  },
);
it.each([true, false])(
  "applies the confirmed bank without refetching the profile, active: %s",
  async (isActive) => {
    owner.petExperience = isActive ? 0 : 50;
    if (!isActive) data = { ...data, activePetId: "another-companion" };
    assign.mockImplementation(() => {
      data = { ...data, unusedExperience: 99 };
      return {
        success: true,
        message: "Experience assigned",
        userPatch: isActive ? { petExperience: 99 } : {},
      };
    });
    const cachedOwner = observeProfileCache();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const view = mount();
    await view.findByRole("tab", { name: "Training" });
    selectTab(view, "Training");
    fireEvent.click(view.getByRole("button", { name: "Assign experience" }));
    await waitFor(() => expect(cachedOwner()?.petExperience).toBe(isActive ? 99 : 50));
    await view.findByText("99 training points available");
    expect(updateUser).toHaveBeenCalledWith(
      {
        success: true,
        message: "Experience assigned",
        userPatch: isActive ? { petExperience: 99 } : {},
      },
      { revision: expect.any(Number) },
    );
    expect(getUser).not.toHaveBeenCalled();
    expect(
      invalidate.mock.calls.some(([filters]) =>
        JSON.stringify(filters?.queryKey).includes('"profile"'),
      ),
    ).toBe(false);
  },
);

it("refreshes rejected allocation snapshots without erasing the error and allows a retry", async () => {
  const cachedOwner = observeProfileCache();
  const rejection = "Your character or companion changed. Refresh and try again.";
  assign.mockImplementationOnce(() => {
    owner = { ...owner, petExperience: 90 };
    const pet = { ...data.pet!, name: "Updated Miso", offence: 20, experience: 10 };
    data = { ...data, pet, pets: [pet], unusedExperience: 90 };
    return { success: false, message: rejection };
  });
  const view = mount();
  await view.findByRole("tab", { name: "Training" });
  selectTab(view, "Training");
  fireEvent.click(view.getByRole("button", { name: "Assign experience" }));
  await view.findByText("90 training points available");
  await waitFor(() => expect(cachedOwner()?.petExperience).toBe(90));
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(updateUser).toHaveBeenCalledWith(
    { success: false, message: rejection },
    { revision: expect.any(Number) },
  );
  expect(view.getByRole("alert").textContent).toBe(rejection);
  expect(view.getByRole("img", { name: "Updated Miso" })).toBeTruthy();
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Assign experience" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );

  assign.mockImplementationOnce(() => {
    data = { ...data, unusedExperience: 89 };
    return {
      success: true,
      message: "Experience assigned",
      userPatch: { petExperience: 89 },
    };
  });
  fireEvent.click(view.getByRole("button", { name: "Assign experience" }));
  await view.findByText("89 training points available");
  expect(cachedOwner()?.petExperience).toBe(89);
  expect(view.queryByRole("alert")).toBeNull();
  expect(getUser).toHaveBeenCalledTimes(1);
});

it("reconciles a late allocation response after a newer profile revision", async () => {
  const cachedOwner = observeProfileCache();
  let finishAssignment!: (result: RouterOutputs["pets"]["assignExperience"]) => void;
  assign.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishAssignment = resolve;
      }),
  );
  const view = mount();
  await view.findByRole("tab", { name: "Training" });
  selectTab(view, "Training");
  fireEvent.click(view.getByRole("button", { name: "Assign experience" }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  owner = { ...owner, petExperience: 80 };
  data = { ...data, unusedExperience: 80 };
  await act(async () => {
    queryClient.setQueryData(getQueryKey(testApi.profile.getUser, undefined, "query"), {
      userData: owner,
    });
    finishAssignment({
      success: true,
      message: "Experience assigned",
      userPatch: { petExperience: 99 },
    });
  });
  await waitFor(() => expect(getUser).toHaveBeenCalledTimes(1));
  expect(cachedOwner()?.petExperience).toBe(80);
  await view.findByText("80 training points available");
});

it.each([true, false])(
  "reconciles confirmed XP and the collection without a pet or profile read, active: %s",
  async (isActive) => {
    owner.activePetId = isActive ? "companion" : "other";
    owner.petExperience = isActive ? 100 : 50;
    data = {
      ...data,
      activePetId: owner.activePetId,
      pet: { ...data.pet!, storedExperience: isActive ? 0 : 100 },
    };
    data.pets = [data.pet!];
    const collectionKey = getQueryKey(testApi.pets.getCollection, undefined, "query");
    queryClient.setQueryData(collectionKey, {
      pets: data.pets,
      activePetId: owner.activePetId,
    });
    assign.mockImplementation(() => ({
      success: true,
      message: "Assigned",
      ...getAssignExperienceUserUpdate({
        user: owner as never,
        pet: {
          ...data.pet!,
          potentialValue: data.pet!.potentialValue ?? 1,
          generationToken: null,
        },
        stats: {
          offence: 11,
          defence: 10,
          strength: 10,
          speed: 10,
          intelligence: 10,
          willpower: 10,
        },
        availableExperience: 100,
        spent: 1,
        now: new Date("2026-11-01T12:00:00Z"),
      }),
    }));
    observeProfileCache();
    const view = mount();
    await view.findByRole("tab", { name: "Training" });
    selectTab(view, "Training");
    fireEvent.click(view.getByRole("button", { name: "Assign experience" }));
    await view.findByText("99 training points available");
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(getPet).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<RouterOutputs["pets"]["getCollection"]>(collectionKey)
        ?.pets[0],
    ).toMatchObject({
      offence: 11,
      experience: 1,
      revision: 1,
      storedExperience: isActive ? 0 : 99,
    });
  },
);

it("reconciles saved settings and the owner timestamp without reloading pet, collection or profile", async () => {
  const collectionKey = getQueryKey(testApi.pets.getCollection, undefined, "query");
  queryClient.setQueryData(collectionKey, {
    pets: data.pets,
    activePetId: data.activePetId,
  });
  const cachedOwner = observeProfileCache();
  update.mockImplementation((input: RouterInputs["pets"]["updatePet"]) => ({
    success: true,
    message: "Updated",
    ...getSavedPetSettingsUpdate(
      owner as never,
      data.pet as never,
      input,
      new Date(owner.updatedAt.getTime() + 1000),
      false,
    ),
  }));
  const view = mount();
  await view.findByRole("tab", { name: "Settings" });
  selectTab(view, "Settings");
  fireEvent.change(view.getByRole("textbox", { name: "Companion name" }), {
    target: { value: "Kumo" },
  });
  fireEvent.click(view.getByRole("button", { name: /^Save$/ }));
  await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      (view.getByRole("textbox", { name: "Companion name" }) as HTMLInputElement).value,
    ).toBe("Kumo"),
  );
  expect(cachedOwner()?.updatedAt).toEqual(new Date(owner.updatedAt.getTime() + 1000));
  expect(getPet).toHaveBeenCalledTimes(1);
  expect(getUser).not.toHaveBeenCalled();
  expect(queryClient.getQueryState(collectionKey)?.isInvalidated).toBe(false);
  expect(
    queryClient.getQueryData<RouterOutputs["pets"]["getCollection"]>(collectionKey)
      ?.pets[0],
  ).toMatchObject({ name: "Kumo", revision: 1 });
});

it("reveals a bounded cap bonus with no stat allocation controls", async () => {
  data.pet = {
    ...data.pet!,
    potentialValue: null,
    potentialRevealed: false,
    potentialChances: [0, 0, 0, 0, 1],
  };
  const view = mount(true);
  await view.findByRole("tab", { name: "Training" });
  selectTab(view, "Training");
  expect(view.getByText(/Potential unrevealed/)).toBeTruthy();
  const button = view
    .getAllByRole("button", { name: "Reveal potential" })
    .find((entry) => entry.tagName === "BUTTON")!;
  fireEvent.click(button);
  const dialog = await view.findByRole("dialog", {
    name: "Reveal companion potential",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Proceed" }));
  expect(await view.findByText("Perfect · 150% of rank stat caps")).toBeTruthy();
  expect(view.queryByText(/points to allocate/)).toBeNull();
  expect(view.getByText(/HP and abilities are unchanged/)).toBeTruthy();
});

it("keeps assigned-XP transfer controls collapsed until requested", async () => {
  data.pet = { ...data.pet!, experience: 0 };
  data.pets.push({ ...data.pets[0]!, id: "second-pet", name: "Tama" });
  const view = mount();
  await view.findByRole("tab", { name: "Training" });
  selectTab(view, "Training");
  const summary = view.getByText("Transfer assigned experience");
  expect(summary.closest("details")?.open).toBe(false);
  fireEvent.click(summary);
  expect(
    view.getByText("Assign experience to this companion before transferring it."),
  ).toBeTruthy();
  expect(view.queryByLabelText("Destination companion")).toBeNull();
});

it("explains an over-limit transfer amount and offers confirmation only for a valid preview", async () => {
  data.pet = { ...data.pet!, experience: 1000 };
  data.pets.push({ ...data.pets[0]!, id: "second-pet", name: "Tama" });
  const view = mount();
  await view.findByRole("tab", { name: "Training" });
  selectTab(view, "Training");
  fireEvent.click(view.getByText("Transfer assigned experience"));
  fireEvent.change(view.getByLabelText("Destination companion"), {
    target: { value: "second-pet" },
  });
  const amount = view.getByRole("spinbutton", {
    name: "Assigned XP to move (maximum 700)",
  });
  fireEvent.input(amount, { target: { value: "701" } });
  expect(view.getByText("Enter a whole number from 1 to 700.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Transfer experience" })).toBeNull();
  fireEvent.input(amount, { target: { value: "700" } });
  expect(view.queryByText("Enter a whole number from 1 to 700.")).toBeNull();
  expect(
    view.getAllByRole("button", { name: "Transfer experience" }).length,
  ).toBeGreaterThan(0);
  expect(view.getByText(/XP lost: 0/)).toBeTruthy();
});
