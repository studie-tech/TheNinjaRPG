import { afterEach, beforeEach, expect, it, setDefaultTimeout, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import { Suspense } from "react";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import PetSpeciesEdit from "@/app/[shell]/manual/companions/edit/[speciesid]/page";
import ManualCompanions from "@/app/[shell]/manual/companions/page";
import type { UserRole } from "@/drizzle/constants";
import * as petSpecies from "@/hooks/petSpecies";
import * as AiProfileEdit from "@/layout/AiProfileEdit";
import * as ContentBox from "@/layout/ContentBox";
import * as EditContent from "@/layout/EditContent";
import * as Modal from "@/layout/Modal";
import { PET_RANK_APPEARANCES } from "@/libs/pets/catalogue";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { ActionEndTurn } from "@/validators/ai";
import { IncreaseStatTag } from "@/validators/combat";
import { PetSpeciesValidator } from "@/validators/petSpecies";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../../setup/trpc";
import { mockUserContextValue } from "../../setup/userContext";

// These workflows render multiple dialogs and large forms in one interaction.
setDefaultTimeout(20_000);

const usePetSpeciesEditForm = petSpecies.usePetSpeciesEditForm;
const defaults = {
  artDirection: null,
  rankConcepts: [],
  preferredDamageElement: null,
  role: "ASSAULT" as const,
  defaultJutsuIds: [],
  aiRules: [],
  includeDefaultRules: true,
  effects: [],
};
let queryClient: QueryClient;
let role: UserRole;
let species: RouterOutputs["petSpecies"]["getAll"];
let editor: ReturnType<typeof usePetSpeciesEditForm>;
let create: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let failQuery: boolean;
let requested: string[];
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  role = "CONTENT";
  failQuery = false;
  requested = [];
  push = vi.fn();
  species = [
    {
      ...defaults,
      id: "fox",
      name: "Fox",
      description: "A fox with a bushy tail.",
      rarity: "COMMON",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      ...defaults,
      id: "owl",
      name: "Owl",
      role: "HEALER",
      description: "A bird with a heart-shaped face.",
      rarity: "RARE",
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  create = vi.fn((_input: RouterInputs["petSpecies"]["create"]) => ({
    success: true,
    message: "new-species-id",
  }));
  update = vi.fn((input: RouterInputs["petSpecies"]["update"]) => {
    species = species.map((entry) =>
      entry.id === input.id
        ? { ...entry, ...PetSpeciesValidator.parse(input.data) }
        : entry,
    );
    return { success: true, message: "Companion species updated." };
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    petSpecies: testApi.petSpecies,
    gameAsset: testApi.gameAsset,
    jutsu: testApi.jutsu,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  mockUserContextValue(() => ({ data: { role } }) as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ title, children, topRightContent }) => (
      <section aria-label={title}>
        {topRightContent}
        {children}
      </section>
    ),
  );
  vi.spyOn(Modal, "default").mockImplementation(
    ({ title, children, setIsOpen, isLoading }) => (
      <div role="dialog" aria-label={title}>
        {children}
        <button type="button" disabled={isLoading} onClick={() => setIsOpen(false)}>
          Close
        </button>
      </div>
    ),
  );
  vi.spyOn(AiProfileEdit, "default").mockImplementation(({ configuration }) => (
    <button
      type="button"
      onClick={() =>
        configuration?.onSave({
          includeDefaultRules: false,
          rules: [{ conditions: [], action: ActionEndTurn.parse({}) }],
        })
      }
    >
      Save Profile
    </button>
  ));
  vi.spyOn(EditContent, "EffectFormWrapper").mockImplementation(({ availableTags }) => (
    <p>Available skill tags: {availableTags.join(", ")}</p>
  ));
  vi.spyOn(petSpecies, "usePetSpeciesEditForm").mockImplementation((...args) => {
    editor = usePetSpeciesEditForm(...args);
    return editor;
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(toast, "showFormErrorsToast").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

/** Real client queries and forms exercise our screen behavior without unrelated game panels. */
const mount = async (edit = false) => {
  const trpcClient = fakeTrpcClient(async (path, input) => {
    requested.push(path);
    if (path === "petSpecies.getAll" || path === "petSpecies.get") {
      if (failQuery) throw new Error("Please try again.");
      return path.endsWith("getAll")
        ? species
        : species.find((entry) => entry.id === (input as { id: string }).id);
    }
    if (path === "petSpecies.create") return create(input);
    if (path === "petSpecies.update") return update(input);
    if (path === "jutsu.getAll") return { data: [], nextCursor: null };
    throw new Error(`Unexpected query ${path}`);
  });
  const params = Promise.resolve({ speciesid: "fox" });
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
        <Suspense fallback={null}>
          {edit ? <PetSpeciesEdit params={params} /> : <ManualCompanions />}
        </Suspense>
      </TrpcTestProviders>,
    );
  });
  return view!;
};

it("keeps the catalogue public and searchable while restricting editing to Content", async () => {
  role = "USER";
  const view = await mount();
  await view.findByText("Fox");
  expect(view.getByText("Retired")).toBeTruthy();
  expect(view.queryByRole("button", { name: "New species" })).toBeNull();
  expect(view.queryByRole("button", { name: "Edit Fox" })).toBeNull();
  fireEvent.change(view.getByRole("textbox", { name: "Search companion species" }), {
    target: { value: "heart-shaped" },
  });
  expect(view.getByText("Owl")).toBeTruthy();
  expect(view.queryByText("Fox")).toBeNull();
  fireEvent.change(view.getByRole("textbox", { name: "Search companion species" }), {
    target: { value: "missing" },
  });
  expect(view.getByText("No companion species match your filters.")).toBeTruthy();
});

it("shows Content edit controls and creates a complete validated species without a placeholder row", async () => {
  const view = await mount();
  fireEvent.click(await view.findByRole("button", { name: "Edit Fox" }));
  expect(push).toHaveBeenCalledWith("/manual/companions/edit/fox");
  fireEvent.click(view.getByRole("button", { name: "New species" }));
  fireEvent.click(view.getByRole("button", { name: "Create species" }));
  await waitFor(() => expect(toast.showFormErrorsToast).toHaveBeenCalled());
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(view.getByRole("textbox", { name: "Species name" }), {
    target: { value: "  Arctic fox  " },
  });
  fireEvent.change(view.getByRole("textbox", { name: "Visual description" }), {
    target: { value: " A fox with dense fur and rounded ears. " },
  });
  fireEvent.click(view.getByRole("switch", { name: "Available for daily offers" }));
  act(() => editor.form.setValue("rarity", "EPIC", { shouldDirty: true }));
  fireEvent.click(view.getByRole("button", { name: "Create species" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).toEqual({
    ...defaults,
    name: "Arctic fox",
    description: "A fox with dense fur and rounded ears.",
    rarity: "EPIC",
    isActive: true,
  });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(toast.showMutationToast).toHaveBeenLastCalledWith({
    success: true,
    message: "Companion species created.",
  });
});

it("preserves a rejected create draft and allows correcting and retrying it", async () => {
  create.mockImplementationOnce(() => ({
    success: false,
    message: "Companion species name already exists",
  }));
  const view = await mount();
  fireEvent.click(view.getByRole("button", { name: "New species" }));
  fireEvent.change(view.getByRole("textbox", { name: "Species name" }), {
    target: { value: "Fox" },
  });
  fireEvent.change(view.getByRole("textbox", { name: "Visual description" }), {
    target: { value: "A distinctive fox." },
  });
  fireEvent.click(view.getByRole("button", { name: "Create species" }));
  expect((await view.findByRole("alert")).textContent).toBe(
    "Companion species name already exists",
  );
  expect(
    (view.getByRole("textbox", { name: "Visual description" }) as HTMLTextAreaElement)
      .value,
  ).toBe("A distinctive fox.");
  expect(
    (view.getByRole("button", { name: "Create species" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.change(view.getByRole("textbox", { name: "Species name" }), {
    target: { value: "Fennec fox" },
  });
  fireEvent.click(view.getByRole("button", { name: "Create species" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(create).toHaveBeenCalledTimes(2);
});

it("keeps a pending creation open and preserves its draft after a transport failure", async () => {
  let rejectSave!: (error: Error) => void;
  create.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const view = await mount();
  fireEvent.click(view.getByRole("button", { name: "New species" }));
  fireEvent.change(view.getByRole("textbox", { name: "Species name" }), {
    target: { value: "Fennec fox" },
  });
  fireEvent.change(view.getByRole("textbox", { name: "Visual description" }), {
    target: { value: "A small fox with prominent ears." },
  });
  fireEvent.click(view.getByRole("button", { name: "Create species" }));
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(
    (view.getByRole("textbox", { name: "Species name" }) as HTMLInputElement).closest(
      "fieldset",
    )?.disabled,
  ).toBe(true);
  await act(async () => rejectSave(new Error("Connection lost. Please retry.")));
  expect((await view.findByRole("alert")).textContent).toBe(
    "Connection lost. Please retry.",
  );
  expect(
    (view.getByRole("textbox", { name: "Species name" }) as HTMLInputElement).value,
  ).toBe("Fennec fox");
  expect(
    (view.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Create species" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(create).toHaveBeenCalledTimes(2);
});

it("saves edits and retires species without exposing a delete action or changing their identity", async () => {
  const view = await mount(true);
  await view.findByRole("textbox", { name: "Species name" });
  fireEvent.change(view.getByRole("textbox", { name: "Visual description" }), {
    target: { value: "A fox with prominent ears and a flowing tail." },
  });
  fireEvent.click(view.getByRole("switch", { name: "Available for daily offers" }));
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Save to Database" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(view.getByRole("button", { name: "Save to Database" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0]).toEqual({
    id: "fox",
    data: {
      ...defaults,
      name: "Fox",
      description: "A fox with prominent ears and a flowing tail.",
      rarity: "COMMON",
      isActive: false,
    },
  });
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Save to Database" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(view.queryByRole("button", { name: /delete/i })).toBeNull();
  expect(view.getByText(/retired from new daily offers/)).toBeTruthy();
});

it("edits species art direction and per-rank concepts with the built-in milestones as placeholders", async () => {
  const view = await mount(true);
  await view.findByRole("textbox", { name: "Species name" });
  fireEvent.mouseDown(view.getByRole("tab", { name: "Artwork" }), { button: 0 });
  fireEvent.change(view.getByRole("textbox", { name: "Art direction (optional)" }), {
    target: { value: " A white fox with red-tipped flame tails. " },
  });
  const rankOne = view.getByRole("textbox", {
    name: "Rank 1 concept (Companion)",
  }) as HTMLTextAreaElement;
  expect(rankOne.placeholder).toBe(PET_RANK_APPEARANCES[0]);
  expect(view.getAllByRole("textbox", { name: /^Rank \d+ concept/ })).toHaveLength(10);
  fireEvent.change(view.getByRole("textbox", { name: "Rank 2 concept (Scout)" }), {
    target: { value: "Two flame-tipped tails and a gold neck ornament" },
  });
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Save to Database" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(view.getByRole("button", { name: "Save to Database" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0]).toEqual({
    id: "fox",
    data: {
      ...defaults,
      name: "Fox",
      description: "A fox with a bushy tail.",
      rarity: "COMMON",
      isActive: true,
      artDirection: "A white fox with red-tipped flame tails.",
      rankConcepts: ["", "Two flame-tipped tails and a gold neck ornament"],
    },
  });
});

it("does not fetch or render an editor for an unauthorized visitor", async () => {
  role = "USER";
  const view = await mount(true);
  expect(view.getByText("Only Content staff can edit companion species.")).toBeTruthy();
  expect(view.queryByRole("textbox")).toBeNull();
  expect(requested).toEqual([]);
});

it("edits role, default loadout and species passives through separate compact tabs", async () => {
  const view = await mount(true);
  await view.findByRole("textbox", { name: "Species name" });
  act(() => editor.form.setValue("role", "SUPPORT", { shouldDirty: true }));
  fireEvent.mouseDown(view.getByRole("tab", { name: "Loadout" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(
    view.getByText("This rarity has 2 jutsu slots.", { exact: false }),
  ).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Visual description" })).toBeNull();
  fireEvent.mouseDown(view.getByRole("tab", { name: "Pet skills" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(view.getByRole("button", { name: "Add pet skill tag" }));
  expect(view.getByText("Pet skill tag 1")).toBeTruthy();
  const availableTags = view
    .getByText(/Available skill tags:/)
    .textContent?.replace("Available skill tags: ", "")
    .split(", ");
  expect(availableTags).not.toContain("move");
  expect(availableTags).not.toContain("barrier");
  expect(availableTags).not.toContain("activatesagemode");
  expect(availableTags).toEqual(
    expect.arrayContaining(["moveprevent", "summon", "clone"]),
  );
  fireEvent.click(view.getByRole("button", { name: "Add pet skill tag" }));
  expect(view.queryByRole("combobox", { name: "Pet skill target" })).toBeNull();
  fireEvent.click(view.getByRole("combobox", { name: "Pet skill tag 2 target" }));
  fireEvent.click(view.getByRole("option", { name: "Enemies" }));
  fireEvent.click(view.getByRole("button", { name: "Save to Database" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0].data).toMatchObject({
    role: "SUPPORT",
    effects: [
      { ...IncreaseStatTag.parse({}), skillTarget: "SELF" },
      { ...IncreaseStatTag.parse({}), skillTarget: "ENEMIES" },
    ],
  });
});

it("preserves per-tag targets while editing a tag and removing an earlier tag", async () => {
  species[0]!.effects = [
    { ...IncreaseStatTag.parse({ power: 10 }), skillTarget: "SELF" },
    { ...IncreaseStatTag.parse({ power: 20 }), skillTarget: "ENEMIES" },
  ];
  vi.spyOn(EditContent, "EffectFormWrapper").mockImplementation(
    ({ idx, tag, effects, setEffects }) => (
      <button
        type="button"
        onClick={() =>
          setEffects(
            effects.map((effect, i) => (i === idx ? { ...tag, power: 35 } : effect)),
          )
        }
      >
        Edit tag {idx + 1} power
      </button>
    ),
  );
  const view = await mount(true);
  await view.findByRole("textbox", { name: "Species name" });
  fireEvent.mouseDown(view.getByRole("tab", { name: "Pet skills" }), { button: 0 });
  fireEvent.click(view.getByRole("button", { name: "Edit tag 2 power" }));
  expect(editor.form.getValues("effects.1.skillTarget")).toBe("ENEMIES");
  fireEvent.click(view.getByRole("button", { name: "Remove pet skill tag 1" }));
  expect(
    view.getByRole("combobox", { name: "Pet skill tag 1 target" }).textContent,
  ).toBe("Enemies");
  fireEvent.click(view.getByRole("button", { name: "Save to Database" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0].data.effects).toEqual([
    { ...IncreaseStatTag.parse({ power: 35 }), skillTarget: "ENEMIES" },
  ]);
});

it("persists authored AI defaults through the shared controlled profile editor", async () => {
  const view = await mount(true);
  await view.findByRole("textbox", { name: "Species name" });
  fireEvent.mouseDown(view.getByRole("tab", { name: "AI" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(view.getByRole("button", { name: "Save Profile" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0].data).toMatchObject({
    includeDefaultRules: false,
    aiRules: [{ conditions: [], action: ActionEndTurn.parse({}) }],
  });
});

it("offers a working retry when the catalogue cannot load", async () => {
  failQuery = true;
  const view = await mount();
  expect((await view.findByRole("alert")).textContent).toContain(
    "Could not load companion species.",
  );
  failQuery = false;
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await view.findByText("Fox");
  expect(view.queryByRole("alert")).toBeNull();
});
