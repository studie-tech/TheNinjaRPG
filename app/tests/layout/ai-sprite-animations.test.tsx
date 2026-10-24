import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { AiSpriteAnimations } from "@/layout/AiSpriteAnimations";
import * as ContentBox from "@/layout/ContentBox";
import * as uploadthing from "@/utils/uploadthing";
import { ensureDom } from "../setup-dom.mjs";

const create = vi.fn();
const assign = vi.fn();
const animation = {
  id: "idle-sheet", name: "Idle sheet", url: "https://example.com/idle.png",
  columns: 6, rows: 4, frameCount: 24, fps: 12.5, facing: "left",
};
const config = {
  actions: [
    { key: "idle", name: "Idle", group: "Default" },
    { key: "basic:basicAttack", name: "Basic Attack", group: "Basic" },
  ],
  assignments: [{ actionKey: "idle", animationId: animation.id }],
  animations: [animation, { ...animation, id: "move-sheet", name: "Move sheet", url: "https://example.com/move.png" }],
};

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ spriteAnimation: { getAiConfig: { invalidate: vi.fn() } } }),
    spriteAnimation: {
      getAiConfig: {
        useQuery: () => ({
          data: config,
          isPending: false,
        }),
      },
      create: { useMutation: () => ({ mutate: create, isPending: false }) },
      assign: { useMutation: () => ({ mutate: assign, reset: vi.fn(), isPending: false }) },
    },
  });
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <>{children}</>);
  vi.spyOn(uploadthing, "UploadButton").mockImplementation(() => <></>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows invalid sheet feedback and permits correction without losing the draft", async () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.change(view.getByLabelText("Name"), { target: { value: "Movement" } });
  fireEvent.change(view.getByLabelText("Sprite sheet URL"), {
    target: { value: "https://example.com/move.png" },
  });
  fireEvent.input(view.getByLabelText("Rows"), { target: { value: "2" } });
  const form = view.getByRole("button", { name: "Add to animation library" }).closest("form")!;
  fireEvent.submit(form);

  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe("Frame count exceeds the sheet grid"),
  );
  expect(create).not.toHaveBeenCalled();
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Movement");

  fireEvent.input(view.getByLabelText("Frames"), { target: { value: "12" } });
  fireEvent.submit(form);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({
    name: "Movement",
    url: "https://example.com/move.png",
    columns: 6,
    rows: 2,
    frameCount: 12,
    fps: 12.5,
    facing: "left",
  });
  expect(view.queryByRole("alert")).toBeNull();
});


it("previews library candidates and resets without saving until Apply", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  const selection = view.getByLabelText("Animation");
  fireEvent.change(selection, { target: { value: "move-sheet" } });
  expect(view.getByRole("img", { name: "Move sheet" })).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Reset" }));
  expect(view.getByRole("img", { name: "Idle sheet" })).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();

  fireEvent.change(selection, { target: { value: "move-sheet" } });
  fireEvent.click(view.getByRole("button", { name: "Apply" }));
  expect(assign).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith({ userId: "ai", actionKey: "idle", animationId: "move-sheet" });
});

it("previews inherited idle and clears only the selected action after Apply", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.change(view.getByLabelText("Animation"), { target: { value: "move-sheet" } });
  fireEvent.change(view.getByLabelText("Action"), { target: { value: "basic:basicAttack" } });
  expect((view.getByLabelText("Animation") as HTMLSelectElement).value).toBe("");
  expect(view.getByRole("img", { name: "Idle sheet" })).toBeTruthy();
  expect(view.getByText(/uses Idle/)).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();

  fireEvent.change(view.getByLabelText("Action"), { target: { value: "idle" } });
  fireEvent.change(view.getByLabelText("Animation"), { target: { value: "" } });
  expect(view.getByText("Uses the current character image.")).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Apply" }));
  expect(assign).toHaveBeenCalledWith({ userId: "ai", actionKey: "idle", animationId: null });
});

it("previews valid draft metadata before library creation and recovers from an image error", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.change(view.getByLabelText("Sprite sheet URL"), { target: { value: "https://example.com/draft.png" } });
  const draftImage = view.getByRole("img", { name: "New animation" });
  fireEvent.error(draftImage.querySelector("img")!);
  expect(view.getByRole("alert").textContent).toContain("could not be loaded");
  fireEvent.change(view.getByLabelText("Sprite sheet URL"), { target: { value: "https://example.com/corrected.png" } });
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.input(view.getByLabelText("Rows"), { target: { value: "2" } });
  expect(view.queryByRole("img", { name: "New animation" })).toBeNull();
  fireEvent.input(view.getByLabelText("Frames"), { target: { value: "12" } });
  fireEvent.input(view.getByLabelText("Frames / second"), { target: { value: "8" } });
  fireEvent.change(view.getByLabelText("Source facing"), { target: { value: "right" } });
  const preview = view.getByRole("img", { name: "New animation" }).querySelector("img")!;
  expect(preview.style.height).toBe("200%");
  expect(create).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
});
