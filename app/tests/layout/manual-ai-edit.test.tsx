/**
 * Exercise the real AI route and form hook while isolating unrelated panels and transport.
 * The reset test also renders the shared dropdown controls to verify the submitted values.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import { Suspense, type ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import ManualAisEdit from "@/app/[shell]/manual/ai/edit/[aiid]/page";
import * as AiProfileEdit from "@/layout/AiProfileEdit";
import * as AiSpriteAnimations from "@/layout/AiSpriteAnimations";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentHelp from "@/layout/ContentHelp";
import * as EditContent from "@/layout/EditContent";
import * as NindoChange from "@/layout/NindoChange";
import * as StatusBar from "@/layout/StatusBar";
import * as SuggestChange from "@/layout/SuggestChange";
import * as ais from "@/libs/ais";
import * as toast from "@/libs/toast";
import type { AiWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup-dom.mjs";

const save = vi.fn();
const names = { useQuery: () => ({ data: [], isPending: false }) };
const useAiEditForm = ais.useAiEditForm;
const ActualEditContent = EditContent.EditContent;
let editor: ReturnType<typeof useAiEditForm>;
let ai: AiWithRelations;

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  // Only editor and validation inputs are needed; unrelated user columns stay absent.
  ai = {
    userId: "ai",
    username: "Test AI",
    npcTitle: "",
    gender: "Unknown",
    level: 100,
    regeneration: 60,
    offence: 10,
    defence: 10,
    ninjutsuMastery: 10,
    genjutsuMastery: 10,
    taijutsuMastery: 10,
    bukijutsuMastery: 10,
    bloodlineMastery: 10,
    sageMastery: 10,
    strength: 10,
    intelligence: 10,
    willpower: 10,
    speed: 10,
    statsMultiplier: 1,
    poolsMultiplier: 1,
    isSummon: false,
    activeTrainedElement: null,
    preferredGeneral1: null,
    preferredGeneral2: null,
    primaryElement: null,
    secondaryElement: null,
    effects: [],
    jutsus: [],
    items: [],
  } as unknown as AiWithRelations;
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      getAi: { useQuery: () => ({ data: ai, isPending: false }) },
      updateAi: { useMutation: () => ({ mutate: save, isPending: false }) },
      updateNindo: { useMutation: () => ({ isPending: false }) },
    },
    jutsu: { getAllNames: names },
    item: { getAllNames: names },
    bloodline: { getAllNames: names },
    clan: { getAllNames: names },
    anbu: { getAllNames: names },
    gameAsset: {
      getNameTags: names,
      getSceneAssets: names,
      getAll: { useInfiniteQuery: () => ({ data: { pages: [] } }) },
    },
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
  vi.spyOn(ais, "useAiEditForm").mockImplementation((user) => {
    editor = useAiEditForm(user);
    return editor;
  });
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }: { children: ReactNode }) => <div>{children}</div>);
  vi.spyOn(EditContent, "EditContent").mockImplementation(() => <></>);
  vi.spyOn(ContentHelp, "AiHelper").mockImplementation(() => null);
  vi.spyOn(AiProfileEdit, "default").mockImplementation(() => null);
  vi.spyOn(AiSpriteAnimations, "AiSpriteAnimations").mockImplementation(() => <></>);
  vi.spyOn(NindoChange, "default").mockImplementation(() => null);
  vi.spyOn(StatusBar, "default").mockImplementation(() => null);
  vi.spyOn(SuggestChange, "SuggestChange").mockImplementation(() => null);
  vi.spyOn(toast, "showFormErrorsToast").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Resolve App Router params and wait for the route to initialize its real AI form. */
const mount = async () => {
  const params = Promise.resolve({ aiid: ai.userId });
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(<Suspense fallback={null}><ManualAisEdit params={params} /></Suspense>);
  });
  await waitFor(() => expect(editor.processedUser.userId).toBe(ai.userId));
  return view!;
};

describe("manual AI editing", () => {
  it.each([null, "Fire"] as const)("saves with activeTrainedElement=%s without mutating the fetched record", async (element) => {
    ai.activeTrainedElement = element;
    const original = structuredClone(ai);
    await mount();
    await act(async () => {
      editor.form.setValue("npcTitle", "Updated title");
      await editor.handleUserSubmit();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      id: ai.userId,
      data: { npcTitle: "Updated title", activeTrainedElement: element, preferredGeneral1: null, preferredGeneral2: null, primaryElement: null, secondaryElement: null },
    });
    expect(ai).toEqual(original);
    expect(toast.showFormErrorsToast).not.toHaveBeenCalled();
  });

  it("retains validation and allows correcting invalid edits", async () => {
    await mount();
    await act(async () => {
      editor.form.setValue("level", 0);
      await editor.handleUserSubmit();
    });
    expect(save).not.toHaveBeenCalled();
    expect(toast.showFormErrorsToast).toHaveBeenCalled();
    await act(async () => {
      editor.form.setValue("level", 101);
      editor.form.setValue("primaryElement", "");
      await editor.handleUserSubmit();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ data: { level: 101, primaryElement: "", activeTrainedElement: null } });
  });

  it("clears nullable dropdowns and saves their unset values", async () => {
    ai.preferredGeneral1 = "Highest";
    ai.preferredGeneral2 = "Strength";
    ai.primaryElement = "Fire";
    vi.spyOn(EditContent, "EditContent").mockImplementation((props) => (
      <ActualEditContent {...props} formData={props.formData.filter(({ id }) => ["preferredGeneral1", "preferredGeneral2", "primaryElement"].includes(id))} />
    ));
    const view = await mount();
    for (const field of ["preferredGeneral1", "preferredGeneral2", "primaryElement"]) {
      fireEvent.click(view.getByRole("button", { name: `Clear ${field}` }));
      expect(view.getByRole("combobox", { name: field }).textContent).toContain("Select option");
    }
    fireEvent.click(view.getByRole("button", { name: "Save to Database" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ data: { preferredGeneral1: null, preferredGeneral2: null, primaryElement: null } });
  });
});
