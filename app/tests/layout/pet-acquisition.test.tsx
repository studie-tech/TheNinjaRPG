import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterInputs } from "@/app/_trpc/client";
import * as Confirm from "@/layout/Confirm";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as Link from "@/layout/Link";
import { PetAcquisition } from "@/layout/PetAcquisition";
import { getDailyPetOptions } from "@/libs/pets/catalogue";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { initialPetSpecies } from "../libs/pets/helpers/species";
import { ensureDom } from "../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
const dayKey = "2026-10-16";
const options = getDailyPetOptions("owner", "NONE", initialPetSpecies, dayKey);
let owner: { status: string; reputationPoints: number; seichiSilver: number };

const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  ensureDom();
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } },
  });
  owner = { status: "AWAKE", reputationPoints: 1000, seichiSilver: 100 };
  Object.assign(vi.spyOn(client, "api" as never), {
    pets: testApi.pets,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(() => ({ data: owner, prepareUserUpdate: () => 1, updateUser: vi.fn(async () => {}) }) as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(Link, "default").mockImplementation(({ href, children }) => <a href={String(href)}>{children}</a>);
  vi.spyOn(Confirm, "default").mockImplementation(({ title, onAccept, disabled }) => <button type="button" disabled={disabled} onClick={onAccept}>Confirm {title}</button>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

it("keeps a successful adoption intact while its claimed species leaves the daily offers and artwork is pending", async () => {
  let claimed: (RouterInputs["pets"]["acquirePet"] & { id: string; rank: number; avatar: string | null; artRank: number; generationStatus: string }) | null = null;
  let remainingGenerations = 3;
  let finishGeneration: () => void = () => undefined;
  const generation = new Promise<void>((resolve) => { finishGeneration = resolve; });
  const acquire = vi.fn((input: RouterInputs["pets"]["acquirePet"]) => {
    claimed = { ...input, id: "new-companion", rank: 1, avatar: null, artRank: 0, generationStatus: "PENDING" };
    return { success: true, message: "Companion adopted", petId: claimed.id };
  });
  const generate = vi.fn(async (input: RouterInputs["pets"]["generateAppearance"]) => {
    expect(input).toEqual({ petId: "new-companion" });
    remainingGenerations = 0;
    await generation;
    claimed = { ...claimed!, avatar: "/new-companion.webp", artRank: 1, generationStatus: "READY" };
    return { success: true, message: "Appearance ready" };
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    const respond = async () => {
      if (op.path === "pets.acquirePet") return acquire(op.input as RouterInputs["pets"]["acquirePet"]);
      if (op.path === "pets.generateAppearance") return generate(op.input as RouterInputs["pets"]["generateAppearance"]);
      if (op.path !== "pets.getPet") throw new Error(`Unexpected procedure ${op.path}`);
      return {
        pet: claimed, pets: claimed ? [claimed] : [], activePetId: claimed?.id ?? null,
        slots: 4, maxSlots: 6, dayKey,
        options: getDailyPetOptions("owner", "NONE", initialPetSpecies, dayKey, claimed ? { dayKey, speciesIds: [claimed.speciesId] } : undefined),
        optionCount: 3, replacementCost: 0, replacementSilverCost: 0, canAcquire: true,
        generationLimit: 3, remainingGenerations, generationRetryAt: null,
      };
    };
    void respond().then((data) => { observer.next({ result: { data } }); observer.complete(); }, (error) => observer.error(error));
  })] });
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><PetAcquisition /></QueryClientProvider>
      </testApi.Provider>,
    );
    await view.findByRole("group", { name: "Species" });
    for (const field of ["speciesId", "paletteIndex", "characteristicIndex", "auraIndex"]) {
      fireEvent.click(view.container.querySelector(`input[name="pet-${field}"]`)!);
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    }
    fireEvent.change(view.getByLabelText("Companion name"), { target: { value: "Miso" } });
    fireEvent.click(view.getByRole("radio", { name: "Male" }));
    fireEvent.click(view.getByRole("button", { name: "Meet my first companion" }));
    const profile = await view.findByRole("link", { name: "Open pet profile" });
    expect(profile.getAttribute("href")).toBe("/profile?tab=pet&petId=new-companion");
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await queryClient.invalidateQueries();
    await view.findByText(/0 \/ 3 image attempts/);
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    expect(view.getByText(/Your companion's image is being created/)).toBeDefined();
    expect(view.getByText("Creating your companion's unique image. This can take a few minutes...")).toBeDefined();
    expect(view.queryByRole("alert")?.textContent ?? null).toBeNull();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith({
      name: "Miso", gender: "MALE", currency: "REPUTATION", dayKey,
      speciesId: options.species[0]!.id, paletteIndex: options.palettes[0]!.index,
      characteristicIndex: options.characteristics[0]!.index, auraIndex: options.auras[0]!.index,
    });
    finishGeneration();
    await view.findByText("Your new companion is ready to join you.");
    expect(view.queryByRole("alert")?.textContent ?? null).toBeNull();
    expect(acquire).toHaveBeenCalledTimes(1);
  } finally {
    finishGeneration();
    queryClient.clear();
  }
});

for (const collectionUnavailable of [false, true]) {
  it(collectionUnavailable
    ? "blocks another paid adoption until a failed collection check can recover the saved companion"
    : "recovers a parked companion after a lost adoption response and retries its image without another purchase", async () => {
    const active = { id: "active", name: "Existing", rank: 1, avatar: "/existing.webp", artRank: 1, generationStatus: "READY" };
    let claimed: (RouterInputs["pets"]["acquirePet"] & { id: string; rank: number; avatar: string | null; artRank: number; generationStatus: string }) | null = null;
    let allowCollectionRead = !collectionUnavailable;
    const currency = collectionUnavailable ? "SEICHI_SILVER" : "REPUTATION";
    const price = collectionUnavailable ? "50 Seichi Silver" : "30 reputation";
    if (collectionUnavailable) owner.reputationPoints = 0;
    const acquire = vi.fn((input: RouterInputs["pets"]["acquirePet"]) => {
      claimed = { ...input, id: "new-companion", rank: 1, avatar: null, artRank: 0, generationStatus: "PENDING" };
      throw new Error("Adoption response interrupted");
    });
    const generate = vi.fn((input: RouterInputs["pets"]["generateAppearance"]) => {
      expect(input).toEqual({ petId: "new-companion", appearance: {
        dayKey, paletteIndex: claimed!.paletteIndex, characteristicIndex: claimed!.characteristicIndex, auraIndex: claimed!.auraIndex,
      } });
      claimed = { ...claimed!, avatar: "/new-companion.webp", artRank: 1, generationStatus: "READY" };
      return { success: true, message: "Appearance ready" };
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
      const respond = async () => {
        if (op.path === "pets.acquirePet") return acquire(op.input as RouterInputs["pets"]["acquirePet"]);
        if (op.path === "pets.generateAppearance") return generate(op.input as RouterInputs["pets"]["generateAppearance"]);
        if (op.path !== "pets.getPet") throw new Error(`Unexpected procedure ${op.path}`);
        if (claimed && !allowCollectionRead) throw new Error("Collection unavailable");
        const selected = claimed && (op.input as RouterInputs["pets"]["getPet"])?.petId === claimed.id ? claimed : active;
        return {
          pet: selected, pets: [active, ...(claimed ? [claimed] : [])], activePetId: active.id,
          slots: 4, maxSlots: 6, dayKey, options, optionCount: 3, replacementCost: 30, replacementSilverCost: 50, canAcquire: true,
          generationLimit: 3, remainingGenerations: selected === active ? 0 : 3, generationRetryAt: null,
        };
      };
      void respond().then((data) => { observer.next({ result: { data } }); observer.complete(); }, (error) => observer.error(error));
    })] });
    try {
      const view = render(
        <testApi.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}><PetAcquisition /></QueryClientProvider>
        </testApi.Provider>,
      );
      await view.findByRole("group", { name: "Species" });
      for (const field of ["speciesId", "paletteIndex", "characteristicIndex", "auraIndex"]) {
        fireEvent.click(view.container.querySelector(`input[name="pet-${field}"]`)!);
        fireEvent.click(view.getByRole("button", { name: "Continue" }));
      }
      fireEvent.change(view.getByLabelText("Companion name"), { target: { value: "Miso" } });
      fireEvent.click(view.getByRole("radio", { name: "Male" }));
      if (collectionUnavailable) fireEvent.click(view.getByRole("radio", { name: "50 Seichi Silver" }));
      const confirm = view.getByRole("button", { name: `Confirm Form a new bond for ${price}?` }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(false);
      fireEvent.click(confirm);
      if (collectionUnavailable) {
        await view.findByText("Collection unavailable");
        expect(view.queryByRole("button", { name: `Confirm Form a new bond for ${price}?` })).toBeNull();
        allowCollectionRead = true;
        fireEvent.click(view.getByRole("button", { name: "Try again" }));
      }
      const profile = await view.findByRole("link", { name: "Open pet profile" });
      expect(profile.getAttribute("href")).toBe("/profile?tab=pet&petId=new-companion");
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ currency }));
      fireEvent.click(await view.findByRole("button", { name: "Retry appearance" }));
      const dialog = await view.findByRole("dialog", { name: "Choose companion appearance" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Generate appearance" }));
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally {
      queryClient.clear();
    }
  });
}

for (const federalStatus of ["NONE", "GOLD"] as const) {
  it(`guides ${federalStatus} accounts through one trait at a time and preserves choices when going back`, async () => {
    const dailyOptions = getDailyPetOptions("owner", federalStatus, initialPetSpecies, dayKey);
    const { view, queryClient, updateData } = renderAcquisition({
      options: dailyOptions,
      optionCount: dailyOptions.species.length,
    });
    try {
      await view.findByRole("group", { name: "Species" });
      expect(view.getAllByRole("radio")).toHaveLength(dailyOptions.species.length);
      expect(view.queryByLabelText("Companion name")).toBeNull();
      expect(view.queryByRole("button", { name: "Meet my first companion" })).toBeNull();
      expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
      expect(view.queryByLabelText("Selected traits")).toBeNull();
      expect(view.queryByText(/: choose/)).toBeNull();
      const details = view.getByText("About daily choices").closest("details")!;
      expect(details.open).toBe(false);
      expect(view.container.querySelector("form")!.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

      fireEvent.click(view.getAllByRole("radio")[0]!);
      expect(view.getByLabelText("Selected traits").textContent).toBe(dailyOptions.species[0]!.name);
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
      expect(view.getByRole("group", { name: "Colour palette" })).toBeDefined();
      fireEvent.click(view.getAllByRole("radio")[0]!);
      fireEvent.click(view.getByRole("button", { name: "Back" }));
      expect((view.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
      expect((view.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
      for (const title of ["Colour palette", "Defining characteristic", "Aura"]) {
        expect(view.getByRole("group", { name: title })).toBeDefined();
        expect(view.getAllByRole("radio")).toHaveLength(dailyOptions.species.length);
        fireEvent.click(view.getAllByRole("radio")[0]!);
        fireEvent.click(view.getByRole("button", { name: "Continue" }));
      }
      // Only the required gender choice remains on the naming step.
      expect(view.getAllByRole("radio")).toHaveLength(2);
      const meet = view.getByRole("button", { name: "Meet my first companion" }) as HTMLButtonElement;
      expect(meet.disabled).toBe(true);
      fireEvent.change(view.getByLabelText("Companion name"), { target: { value: "Miso" } });
      expect(meet.disabled).toBe(true);
      fireEvent.click(view.getByRole("radio", { name: "Female" }));
      expect(meet.disabled).toBe(false);
      for (const entries of Object.values(dailyOptions)) {
        expect(view.getByText(new RegExp(entries[0]!.name))).toBeDefined();
      }
      expect(view.getByLabelText("Selected traits").textContent).toBe(Object.values(dailyOptions).map((entries) => entries[0]!.name).join(" · "));
      expect(view.queryByRole("link", { name: "Manage my collection" })).toBeNull();

      const tomorrow = "2026-10-17";
      await updateData({ dayKey: tomorrow, options: getDailyPetOptions("owner", federalStatus, initialPetSpecies, tomorrow) });
      await view.findByText("A new UTC day has begun. Choose from today's refreshed options.");
      expect(view.getByRole("group", { name: "Species" })).toBeDefined();
      expect(view.queryByLabelText("Companion name")).toBeNull();
      expect(view.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
      expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      queryClient.clear();
    }
  });
}

it("preserves the current draft when a claimed species is removed from the offers", async () => {
  const { view, queryClient, updateData } = renderAcquisition({});
  try {
    await view.findByRole("group", { name: "Species" });
    for (const field of ["speciesId", "paletteIndex", "characteristicIndex", "auraIndex"]) {
      fireEvent.click(view.container.querySelector(`input[name="pet-${field}"]`)!);
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    }
    fireEvent.change(view.getByLabelText("Companion name"), { target: { value: "Miso" } });
    fireEvent.click(view.getByRole("radio", { name: "Male" }));
    await updateData({ options: { ...options, species: options.species.slice(1) } });
    await waitFor(() => expect(view.getByLabelText("Selected traits").textContent).toBe([
      options.palettes[0]!.name, options.characteristics[0]!.name, options.auras[0]!.name,
    ].join(" · ")));
    expect(view.queryByRole("alert")?.textContent ?? null).toBeNull();
    expect((view.getByLabelText("Companion name") as HTMLInputElement).value).toBe("Miso");
    expect(view.getByText("Step 5 of 5")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect((view.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
  } finally { queryClient.clear(); }
});

it.each(["optionCount", "palettes", "characteristics", "auras"] as const)("refreshes the draft when %s changes within the same day", async (changed) => {
  const { view, queryClient, updateData } = renderAcquisition({});
  try {
    await view.findByRole("group", { name: "Species" });
    fireEvent.click(view.getAllByRole("radio")[0]!);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(view.getByRole("group", { name: "Colour palette" })).toBeDefined();
    await updateData(changed === "optionCount"
      ? { optionCount: 4 }
      : { options: { ...options, [changed]: [...options[changed]].reverse() } });
    await view.findByText("Your available companion traits changed. Review the choices again.");
    expect(view.getByRole("group", { name: "Species" })).toBeDefined();
    expect(view.queryByLabelText("Selected traits")).toBeNull();
    expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  } finally { queryClient.clear(); }
});

it("explains the collection limit while allowing every trait to be previewed without adopting", async () => {
  const { view, queryClient, mutations } = renderAcquisition({
    pets: Array.from({ length: 6 }, (_, index) => ({ id: `pet-${index}` })),
    slots: 6,
    replacementCost: 30, replacementSilverCost: 50,
    canAcquire: false,
    unavailableReason: "Unlock another collection slot or release a companion before adopting another.",
  });
  try {
    const reason = await view.findByText("Your collection is full. Release a companion before adopting another.");
    expect(view.getByText("6 / 6 collection slots")).toBeDefined();
    expect(view.getByRole("link", { name: "Manage my collection" }).getAttribute("href")).toBe("/profile?tab=pet");
    expect(view.queryByRole("group", { name: "Species" })).toBeNull();
    expect(view.queryByText("About daily choices")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Preview today's choices" }));
    const choices = view.getByRole("group", { name: "Species" });
    expect(reason.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(view.queryByText(/Unlock another collection slot/)).toBeNull();
    expect(view.getAllByRole("radio").every((radio) => !radio.matches(":disabled"))).toBe(true);
    for (const title of ["Species", "Colour palette", "Defining characteristic", "Aura"]) {
      expect(view.getByRole("group", { name: title })).toBeTruthy();
      fireEvent.click(view.getAllByRole("radio")[0]!);
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    }
    fireEvent.change(view.getByRole("textbox", { name: "Companion name" }), { target: { value: "Preview" } });
    const meet = view.getByRole("button", { name: "Confirm Form a new bond for 30 reputation?" }) as HTMLButtonElement;
    expect(meet.disabled).toBe(true);
    fireEvent.click(meet);
    fireEvent.submit(meet.closest("form")!);
    expect(mutations).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Hide today's choices" }));
    expect(view.queryByRole("textbox", { name: "Companion name" })).toBeNull();
    expect(view.queryByText("About daily choices")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Preview today's choices" }));
    expect((view.getByRole("textbox", { name: "Companion name" }) as HTMLInputElement).value).toBe("Preview");
  } finally {
    queryClient.clear();
  }
});

it("keeps a full collection focused on management without duplicating the ready companion or release action", async () => {
  const pet = { id: "existing", name: "Bobby", rank: 1, avatar: "/existing.webp", artRank: 1, generationStatus: "READY" };
  const { view, queryClient } = renderAcquisition({
    pet, pets: [pet], activePetId: pet.id, canAcquire: false,
    unavailableReason: "Unlock another collection slot or release a companion before adopting another.",
  });
  try {
    await view.findByText("1 / 1 collection slots");
    expect(view.getByText("Your collection is full")).toBeDefined();
    expect(view.getByRole("link", { name: "Manage my collection" })).toBeDefined();
    expect(view.queryByRole("img", { name: "Bobby" })).toBeNull();
    expect(view.queryByRole("link", { name: "View companion" })).toBeNull();
    expect(view.queryByRole("button", { name: /Release/ })).toBeNull();
    expect(view.queryByRole("group", { name: "Species" })).toBeNull();
    expect(view.queryByText("About daily choices")).toBeNull();
  } finally { queryClient.clear(); }
});

for (const generationStatus of ["PENDING", "FAILED", "GENERATING"]) {
  it(`preserves ${generationStatus.toLowerCase()} appearance recovery when the collection is full`, async () => {
    const pet = { id: "saved", name: "Miso", rank: 1, avatar: null, artRank: 0, generationStatus,
      paletteIndex: options.palettes[0]!.index, characteristicIndex: options.characteristics[0]!.index, auraIndex: options.auras[0]!.index };
    const { view, queryClient, mutations } = renderAcquisition({
      pet, pets: [pet], activePetId: pet.id, canAcquire: false,
      generationRetryAt: generationStatus === "GENERATING" ? new Date(Date.now() + 60_000) : null,
      unavailableReason: "Unlock another collection slot or release a companion before adopting another.",
    });
    try {
      const profile = await view.findByRole("link", { name: "View companion" });
      expect(profile.getAttribute("href")).toBe("/profile?tab=pet&petId=saved");
      expect(view.queryByRole("group", { name: "Species" })).toBeNull();
      expect(view.queryByRole("button", { name: /Release/ })).toBeNull();
      if (generationStatus === "GENERATING") {
        expect(view.getByText(/Your companion's image is being created/)).toBeDefined();
        expect(view.queryByRole("button", { name: "Retry appearance" })).toBeNull();
      } else {
        fireEvent.click(view.getByRole("button", { name: "Retry appearance" }));
        const dialog = await view.findByRole("dialog", { name: "Choose companion appearance" });
        expect(within(dialog).getAllByRole("combobox")).toHaveLength(3);
        expect(mutations).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Generate appearance" }));
        await waitFor(() => expect(mutations).toHaveBeenCalledWith("pets.generateAppearance", { petId: "saved", appearance: {
          dayKey, paletteIndex: pet.paletteIndex, characteristicIndex: pet.characteristicIndex, auraIndex: pet.auraIndex,
        } }));
        expect(mutations).toHaveBeenCalledTimes(1);
      }
    } finally { queryClient.clear(); }
  });
}

it.each([1, 2])("offers support for an exhausted rank %s appearance and restores retry after a reset", async (rank) => {
  const pet = { id: "saved", name: "Miso", rank, avatar: rank === 1 ? null : "/miso.webp", artRank: rank - 1, generationStatus: "FAILED",
    paletteIndex: options.palettes[0]!.index, characteristicIndex: options.characteristics[0]!.index, auraIndex: options.auras[0]!.index };
  const { view, queryClient, mutations, updateData } = renderAcquisition({
    pet, pets: [pet], canAcquire: false, remainingGenerations: 0,
    generationRetryAt: new Date(Date.now() + 60_000),
  });
  try {
    const support = await view.findByRole("link", { name: "Contact support" });
    expect(support.getAttribute("href")).toBe("/support");
    expect(view.getByText(/request an image attempt reset for this companion/)).toBeDefined();
    expect(view.queryByText(/Finish its appearance for free/)).toBeNull();
    expect(view.queryByRole("button", { name: "Retry appearance" })).toBeNull();
    expect(view.queryByText(/Appearance retry available in/)).toBeNull();
    expect(mutations).not.toHaveBeenCalled();

    await updateData({ remainingGenerations: 1, generationRetryAt: null });
    const retry = await view.findByRole("button", { name: "Retry appearance" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    fireEvent.click(retry);
    if (rank === 1) {
      const dialog = await view.findByRole("dialog", { name: "Choose companion appearance" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Generate appearance" }));
    }
    await waitFor(() => expect(mutations).toHaveBeenCalledWith("pets.generateAppearance", rank === 1 ? { petId: pet.id, appearance: {
      dayKey, paletteIndex: pet.paletteIndex, characteristicIndex: pet.characteristicIndex, auraIndex: pet.auraIndex,
    } } : { petId: pet.id }));
  } finally { queryClient.clear(); }
});

it.each(["FAILED", "READY"])("keeps the final active attempt pending until its %s outcome", async (generationStatus) => {
  const pet = { id: "saved", name: "Miso", rank: 1, avatar: null, artRank: 0, generationStatus: "GENERATING" };
  const { view, queryClient, updateData } = renderAcquisition({
    pet, pets: [pet], canAcquire: false, remainingGenerations: 0,
    generationRetryAt: new Date(Date.now() + 60_000),
  });
  try {
    await view.findByText(/Your companion's image is being created/);
    expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
    expect(view.queryByRole("button", { name: "Retry appearance" })).toBeNull();
    expect(view.queryByText(/Appearance retry available in/)).toBeNull();

    const completed = { ...pet, generationStatus, artRank: generationStatus === "READY" ? 1 : 0, avatar: generationStatus === "READY" ? "/miso.webp" : null };
    await updateData({ pet: completed, pets: [completed] });
    if (generationStatus === "FAILED") {
      await view.findByRole("link", { name: "Contact support" });
    } else {
      await waitFor(() => expect(view.queryByText(/Your companion's image is being created/)).toBeNull());
      expect(view.queryByRole("link", { name: "Contact support" })).toBeNull();
      expect(view.queryByRole("button", { name: "Retry appearance" })).toBeNull();
    }
  } finally { queryClient.clear(); }
});

it("offers support once an exhausted generation lease has expired", async () => {
  const pet = { id: "saved", name: "Miso", rank: 1, avatar: null, artRank: 0, generationStatus: "GENERATING" };
  const { view, queryClient } = renderAcquisition({
    pet, pets: [pet], canAcquire: false, remainingGenerations: 0,
    generationRetryAt: new Date(Date.now() - 1000),
  });
  try {
    await view.findByRole("link", { name: "Contact support" });
    expect(view.queryByText(/Your companion's image is being created/)).toBeNull();
    expect(view.queryByRole("button", { name: "Retry appearance" })).toBeNull();
  } finally { queryClient.clear(); }
});

it.each([1, 6])("preserves exhausted daily-offer guidance and free appearance recovery in a full collection (max slots: %s)", async (maxSlots) => {
  const message = "You have adopted all of today's companion species. New choices arrive at midnight UTC.";
  const pet = { id: "saved", name: "Miso", rank: 1, avatar: null, artRank: 0, generationStatus: "FAILED",
    paletteIndex: options.palettes[0]!.index, characteristicIndex: options.characteristics[0]!.index, auraIndex: options.auras[0]!.index };
  const { view, queryClient, mutations } = renderAcquisition({
    pet, pets: [pet], activePetId: pet.id, maxSlots,
    options: { ...options, species: [] }, canAcquire: false, unavailableReason: message,
  });
  try {
    await view.findByText(message);
    expect(view.getByRole("link", { name: "Manage my collection" })).toBeDefined();
    expect(view.queryByText(/Release a companion before adopting/)).toBeNull();
    expect(view.queryByRole("group", { name: "Species" })).toBeNull();
    expect(view.queryByRole("button", { name: "Preview today's choices" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Retry appearance" }));
    const dialog = await view.findByRole("dialog", { name: "Choose companion appearance" });
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(3);
    expect(mutations).not.toHaveBeenCalled();
  } finally { queryClient.clear(); }
});

it("checks only the selected adoption currency and preserves the companion draft when changing payment", async () => {
  owner.reputationPoints = 0;
  owner.seichiSilver = 50;
  const { view, queryClient, mutations, updateData } = renderAcquisition({ replacementCost: 30, replacementSilverCost: 50 });
  try {
    await view.findByRole("group", { name: "Species" });
    for (const title of ["Species", "Colour palette", "Defining characteristic", "Aura"]) {
      fireEvent.click(view.getByRole("group", { name: title }).querySelector("input")!);
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    }
    fireEvent.change(view.getByLabelText("Companion name"), { target: { value: "Miso" } });
    fireEvent.click(view.getByRole("radio", { name: "Male" }));
    let confirm = view.getByRole("button", { name: "Confirm Form a new bond for 30 reputation?" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mutations).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("radio", { name: "50 Seichi Silver" }));
    confirm = view.getByRole("button", { name: "Confirm Form a new bond for 50 Seichi Silver?" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect((view.getByLabelText("Companion name") as HTMLInputElement).value).toBe("Miso");
    owner.seichiSilver = 49;
    await updateData({});
    await waitFor(() => expect(confirm.disabled).toBe(true));
    owner.reputationPoints = 30;
    await updateData({});
    fireEvent.click(view.getByRole("radio", { name: "30 reputation" }));
    confirm = view.getByRole("button", { name: "Confirm Form a new bond for 30 reputation?" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations).toHaveBeenCalledWith("pets.acquirePet", expect.objectContaining({ name: "Miso", currency: "REPUTATION" })));
    await view.findByText("Your collection was checked and no new matching companion was found. You can try adopting again.");
    expect((view.getByLabelText("Companion name") as HTMLInputElement).value).toBe("Miso");
  } finally { queryClient.clear(); }
});

for (const isFull of [false, true]) {
  it(`explains an unavailable species catalogue ${isFull ? "at full capacity" : "with room available"} without an empty wizard or preview action`, async () => {
    const message = "The Bondkeepers are not offering new companions right now. Please check back later.";
    const { view, queryClient, mutations } = renderAcquisition({
      pets: isFull ? [{ id: "existing" }] : [],
      options: { ...options, species: [] }, canAcquire: false, unavailableReason: message,
    });
    try {
      await view.findByText(message);
      expect(view.queryByRole("group", { name: "Species" })).toBeNull();
      expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
      expect(view.queryByRole("button", { name: "Preview today's choices" })).toBeNull();
      expect(mutations).not.toHaveBeenCalled();
    } finally { queryClient.clear(); }
  });
}

function renderAcquisition(initialData: Record<string, unknown>) {
  let data = {
    pet: null, pets: [], activePetId: null, slots: 1, maxSlots: 6,
    dayKey, options, optionCount: 3, replacementCost: 0, replacementSilverCost: 0, canAcquire: true,
    generationLimit: 3, remainingGenerations: 3, generationRetryAt: null,
    unavailableReason: null,
    ...initialData,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const mutations = vi.fn();
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path !== "pets.getPet") {
      mutations(op.path, op.input);
      observer.error(TRPCClientError.from(new Error(`Unexpected procedure ${op.path}`)));
      return;
    }
    observer.next({ result: { data } });
    observer.complete();
  })] });
  const view = render(
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}><PetAcquisition /></QueryClientProvider>
    </testApi.Provider>,
  );
  return {
    view,
    queryClient,
    mutations,
    updateData: async (updated: Record<string, unknown>) => {
      data = { ...data, ...updated };
      await queryClient.invalidateQueries();
    },
  };
}
