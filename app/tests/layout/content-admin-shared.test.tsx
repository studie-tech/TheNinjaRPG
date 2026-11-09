/** Shared staff content controls: editor load failures, effect lists, clones and row links. */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { ClearBattleDataButton } from "@/layout/ClearDataConfirm";
import { ConfirmedCloneControl } from "@/layout/ConfirmedCloneControl";
import * as ContentBox from "@/layout/ContentBox";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import * as EditContent from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import { EffectTagListEditor } from "@/layout/EffectTagListEditor";
import * as Modal from "@/layout/Modal";
import * as toast from "@/libs/toast";
import type { ZodAllTags } from "@/validators/combat";

const tag = { type: "damage" } as ZodAllTags;
const feedback = {
  label: "item",
  subtitle: "Item Management",
  backHref: "/manual/item",
  isFetching: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ title, children, topRightContent }) => (
      <section>
        <h2>{title}</h2>
        {topRightContent}
        {children}
      </section>
    ),
  );
  vi.spyOn(EditContent, "EffectFormWrapper").mockImplementation(({ idx }) => (
    <p>form {idx}</p>
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(Modal, "default").mockImplementation(
    ({ title, children, proceed_label, onAccept }) => (
      <div>
        <h3>{title}</h3>
        {children}
        <button type="button" onClick={onAccept as never}>
          {proceed_label}
        </button>
      </div>
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EditorQueryFeedback", () => {
  it("reports a missing record without a retry", () => {
    const view = render(
      <EditorQueryFeedback {...feedback} isError={false} onRetry={vi.fn()} />,
    );
    expect(view.getByRole("heading", { name: "Item not found" })).toBeTruthy();
    expect(view.getByRole("alert").textContent).toContain("may have been removed");
    expect(view.getByRole("link", { name: "Back to list" }).getAttribute("href")).toBe(
      feedback.backHref,
    );
    expect(view.queryByRole("button")).toBeNull();
  });

  it("offers a retry after a failed load", () => {
    const onRetry = vi.fn();
    const view = render(
      <EditorQueryFeedback {...feedback} isError onRetry={onRetry} />,
    );
    expect(view.getByRole("heading", { name: "Unable to load item" })).toBeTruthy();
    expect(view.getByRole("link", { name: "Back to list" }).getAttribute("href")).toBe(
      feedback.backHref,
    );
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("explains that a failed refresh keeps the previously loaded editor", () => {
    const view = render(
      <EditorQueryFeedback {...feedback} hasCachedData isError onRetry={vi.fn()} />,
    );
    expect(view.getByRole("alert").textContent).toContain("previously loaded data");
    expect(view.getByRole("heading", { name: "Unable to refresh item" })).toBeTruthy();
    expect(view.queryByRole("link", { name: "Back to list" })).toBeNull();
  });

  it("disables retry and announces the pending state while refetching", () => {
    const view = render(
      <EditorQueryFeedback {...feedback} isFetching isError onRetry={vi.fn()} />,
    );
    const retry = view.getByRole("button", { name: "Retrying..." });
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    expect(retry.getAttribute("aria-busy")).toBe("true");
  });
});

describe("EffectTagListEditor", () => {
  const base = {
    type: "item" as const,
    newTag: () => tag,
    tagTitle: "Item Tag",
    emptyTitle: "Item Tags",
    emptyText: "Please add effects to this item",
  };
  const icons = (container: HTMLElement) => container.querySelectorAll("svg");

  it("adds the caller's placeholder from the empty state", () => {
    const setEffects = vi.fn();
    const view = render(
      <EffectTagListEditor {...base} effects={[]} setEffects={setEffects} />,
    );
    expect(view.getByText("Please add effects to this item")).toBeTruthy();
    fireEvent.click(icons(view.container)[0] as Element);
    expect(setEffects).toHaveBeenCalledWith([tag]);
  });

  it("filters undefined entries and removes by position", () => {
    const other = { type: "heal" } as ZodAllTags;
    const setEffects = vi.fn();
    const view = render(
      <EffectTagListEditor
        {...base}
        effects={[tag, undefined, other]}
        setEffects={setEffects}
      />,
    );
    expect(view.getByText("Item Tag #2")).toBeTruthy();
    expect(view.queryByText("Item Tag #3")).toBeNull();
    // Each tag renders its add icon then its remove icon.
    fireEvent.click(icons(view.container)[1] as Element);
    expect(setEffects).toHaveBeenCalledWith([other]);
  });

  it("ignores add and remove while disabled", () => {
    const setEffects = vi.fn();
    const view = render(
      <EffectTagListEditor
        {...base}
        disabled
        effects={[tag]}
        setEffects={setEffects}
      />,
    );
    for (const icon of icons(view.container)) fireEvent.click(icon);
    expect(setEffects).not.toHaveBeenCalled();
  });

  it("hides add, remove and the empty state when the structure is locked", () => {
    const view = render(
      <EffectTagListEditor
        {...base}
        lockStructure
        effects={[tag]}
        setEffects={vi.fn()}
      />,
    );
    expect(view.getByText("form 0")).toBeTruthy();
    expect(icons(view.container)).toHaveLength(0);
    cleanup();
    const empty = render(
      <EffectTagListEditor {...base} lockStructure effects={[]} setEffects={vi.fn()} />,
    );
    expect(empty.queryByText("Item Tags")).toBeNull();
  });
});

describe("ConfirmedCloneControl", () => {
  const source = { id: "a", name: "Fireball" };
  const setup = (
    clone: (id: string) => Promise<{ success: boolean; message: string }>,
  ) => {
    const onCloned = vi.fn();
    const view = render(
      <ConfirmedCloneControl
        source={source}
        label="jutsu"
        isPending={false}
        clone={clone}
        onCloned={onCloned}
        body={({ name }) => <p>Copy {name}</p>}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Clone Fireball" }));
    return { view, onCloned };
  };
  const accept = (view: ReturnType<typeof render>) =>
    fireEvent.click(view.getByRole("button", { name: "Clone jutsu" }));

  it("closes the dialog and hands over the clone id", async () => {
    const clone = vi.fn(async () => ({ success: true, message: "b" }));
    const { view, onCloned } = setup(clone);
    await act(async () => accept(view));
    await waitFor(() => expect(onCloned).toHaveBeenCalledWith("b"));
    expect(clone).toHaveBeenCalledWith("a");
    await waitFor(() => expect(view.queryByText("Copy Fireball")).toBeNull());
    expect(toast.showMutationToast).toHaveBeenCalledTimes(1);
  });

  it("refuses a second submission while one is in flight", async () => {
    let settle: (value: { success: boolean; message: string }) => void = () =>
      undefined;
    const clone = vi.fn(
      () =>
        new Promise<{ success: boolean; message: string }>((resolve) => {
          settle = resolve;
        }),
    );
    const { view } = setup(clone);
    accept(view);
    accept(view);
    expect(clone).toHaveBeenCalledTimes(1);
    await act(async () => settle({ success: false, message: "no" }));
  });

  it("keeps the dialog open after a rejected or failed clone", async () => {
    const clone = vi
      .fn<(id: string) => Promise<{ success: boolean; message: string }>>()
      .mockResolvedValueOnce({ success: false, message: "denied" })
      .mockRejectedValueOnce(new Error("network"));
    const { view, onCloned } = setup(clone);
    await act(async () => accept(view));
    await waitFor(() => expect(clone).toHaveBeenCalledTimes(1));
    expect(view.getByText("Copy Fireball")).toBeTruthy();
    await act(async () => accept(view));
    await waitFor(() => expect(clone).toHaveBeenCalledTimes(2));
    expect(view.getByText("Copy Fireball")).toBeTruthy();
    expect(onCloned).not.toHaveBeenCalled();
  });
});

describe("ContentLinksCell", () => {
  const hrefs = (container: HTMLElement) =>
    [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

  it("links to statistics and, for editors, the edit page", () => {
    const editor = render(<ContentLinksCell type="jutsu" id="a" canEdit />);
    expect(hrefs(editor.container)).toEqual([
      "/manual/jutsu/statistics/a",
      "/manual/jutsu/edit/a",
    ]);
    cleanup();
    const viewer = render(<ContentLinksCell type="jutsu" id="a" canEdit={false} />);
    expect(hrefs(viewer.container)).toEqual(["/manual/jutsu/statistics/a"]);
  });

  it("omits the statistics link for content without that route", () => {
    const view = render(
      <ContentLinksCell type="skillTree" id="a" canEdit hideStatistics />,
    );
    expect(hrefs(view.container)).toEqual(["/manual/skillTree/edit/a"]);
  });

  it("opens details from the info icon", () => {
    const onInfo = vi.fn();
    const view = render(
      <ContentLinksCell type="item" id="a" canEdit={false} onInfo={onInfo} />,
    );
    fireEvent.click(view.container.querySelector("svg.lucide-info") as Element);
    expect(onInfo).toHaveBeenCalledTimes(1);
  });
});

describe("ClearBattleDataButton", () => {
  it.each([
    ["AI", "ai", "Clear All AI Battle Data"],
    ["jutsu", "jutsu", "Clear All Jutsu Battle Data"],
  ] as const)("titles the %s dialog", (label, type, title) => {
    const mutate = vi.fn();
    Object.assign(vi.spyOn(client, "api" as never), {
      data: {
        deleteAllDataBattleAction: {
          useMutation: () => ({ mutate, isPending: false }),
        },
      },
    });
    const view = render(
      <ClearBattleDataButton
        type={type}
        label={label}
        onCleared={async () => undefined}
      />,
    );
    expect(view.getByText(title)).toBeTruthy();
    expect(view.container.textContent).toContain(
      `clear all ${label} battle action data`,
    );
    fireEvent.click(view.getByRole("button", { name: "Clear Data" }));
    expect(mutate).toHaveBeenCalledWith({ type });
  });
});
