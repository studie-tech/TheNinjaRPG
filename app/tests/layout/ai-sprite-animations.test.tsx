import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { AiSpriteAnimations } from "@/layout/AiSpriteAnimations";
import * as ContentBox from "@/layout/ContentBox";
import * as uploadthing from "@/utils/uploadthing";

const create = vi.fn();
const assign = vi.fn();
const animation = {
  id: "idle-sheet",
  name: "Idle sheet",
  url: "https://example.com/idle.png",
  columns: 6,
  rows: 4,
  frameCount: 24,
  fps: 12.5,
  facing: "left",
};
const sheets = [
  animation,
  {
    ...animation,
    id: "move-sheet",
    name: "Move sheet",
    url: "https://example.com/move.png",
  },
];
const search = vi.fn();
const results = (overrides = {}) => ({
  data: { pages: [{ data: sheets, nextCursor: null, total: 2 }] },
  isPending: false,
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  ...overrides,
});
const config = {
  username: "Bandit",
  actions: [
    { key: "idle", name: "Idle", group: "Default" },
    { key: "basic:basicAttack", name: "Basic Attack", group: "Basic" },
  ],
  assignments: [{ actionKey: "idle", animationId: animation.id }],
  animations: [animation],
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      spriteAnimation: {
        getAiConfig: { invalidate: vi.fn() },
        search: { invalidate: vi.fn() },
      },
    }),
    spriteAnimation: {
      getAiConfig: {
        useQuery: () => ({
          data: config,
          isPending: false,
        }),
      },
      search: { useInfiniteQuery: search.mockImplementation(() => results()) },
      create: {
        useMutation: () => ({ mutate: create, reset: vi.fn(), isPending: false }),
      },
      assign: {
        useMutation: () => ({ mutate: assign, reset: vi.fn(), isPending: false }),
      },
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
  const form = view
    .getByRole("button", { name: "Add to animation library" })
    .closest("form")!;
  fireEvent.submit(form);

  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe(
      "Frame count exceeds the sheet grid",
    ),
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
  fireEvent.click(view.getByRole("button", { name: "Move sheet" }));
  expect(view.getByRole("img", { name: "Move sheet" })).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Reset" }));
  expect(view.getByRole("img", { name: "Idle sheet" })).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();

  fireEvent.click(view.getByRole("button", { name: "Move sheet" }));
  fireEvent.click(view.getByRole("button", { name: "Apply" }));
  expect(assign).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith({
    userId: "ai",
    actionKey: "idle",
    animationId: "move-sheet",
  });
});

it("previews inherited idle and clears only the selected action after Apply", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.click(view.getByRole("button", { name: "Move sheet" }));
  fireEvent.click(view.getByRole("button", { name: /^Basic Attack/ }));
  expect(view.getByRole("img", { name: "Idle sheet" })).toBeTruthy();
  expect(view.getByText(/· uses Idle/)).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();

  fireEvent.click(view.getByRole("button", { name: /^Idle(?! sheet)/ }));
  fireEvent.click(view.getByRole("button", { name: "Remove sheet" }));
  expect(view.getByText("Uses the current character image.")).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Apply" }));
  expect(assign).toHaveBeenCalledWith({
    userId: "ai",
    actionKey: "idle",
    animationId: null,
  });
});

it("starts from this AI's sheets and can widen to the whole library", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  expect(search.mock.calls.at(-1)?.[0]).toEqual({
    userId: "ai",
    scope: "ai",
    search: "",
    limit: 24,
  });
  expect(view.getByText("2 sheets")).toBeTruthy();
});

it("offers the whole library and the studio when an AI has no sheets", () => {
  search.mockImplementation(() =>
    results({ data: { pages: [{ data: [], nextCursor: null, total: 0 }] } }),
  );
  const view = render(<AiSpriteAnimations userId="ai" />);
  expect(view.getByText("No sheets carry Bandit's name yet.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Search all sheets" })).toBeTruthy();
  expect(view.getByRole("link", { name: "Create one" }).getAttribute("href")).toContain(
    "sprite_studio",
  );
});

it("reveals further pages on request and reports search failures with a retry", () => {
  const fetchNextPage = vi.fn();
  search.mockImplementation(() =>
    results({
      hasNextPage: true,
      fetchNextPage,
      data: { pages: [{ data: sheets, nextCursor: 1, total: 3478 }] },
    }),
  );
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.click(view.getByRole("button", { name: "Show more (2 of 3,478)" }));
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  cleanup();
  const refetch = vi.fn();
  search.mockImplementation(() =>
    results({ error: { message: "Search failed" }, data: undefined, refetch }),
  );
  const failed = render(<AiSpriteAnimations userId="ai" />);
  expect(failed.getByRole("alert").textContent).toContain("Search failed");
  fireEvent.click(failed.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it("previews valid draft metadata before library creation and recovers from an image error", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.change(view.getByLabelText("Sprite sheet URL"), {
    target: { value: "https://example.com/draft.png" },
  });
  const draftImage = view.getByRole("img", { name: "New animation" });
  fireEvent.error(draftImage.querySelector("img")!);
  expect(view.getByRole("alert").textContent).toContain("could not be loaded");
  fireEvent.change(view.getByLabelText("Sprite sheet URL"), {
    target: { value: "https://example.com/corrected.png" },
  });
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.input(view.getByLabelText("Rows"), { target: { value: "2" } });
  expect(view.queryByRole("img", { name: "New animation" })).toBeNull();
  fireEvent.input(view.getByLabelText("Frames"), { target: { value: "12" } });
  fireEvent.input(view.getByLabelText("Frames / second"), { target: { value: "8" } });
  fireEvent.change(view.getByLabelText("Source facing"), {
    target: { value: "right" },
  });
  const preview = view
    .getByRole("img", { name: "New animation" })
    .querySelector("img")!;
  expect(preview.style.height).toBe("200%");
  expect(create).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
});

it("loads a shared sheet into a new version and keeps bindings unchanged until Apply", async () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.click(view.getByRole("button", { name: "Edit as new version" }));
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Idle sheet (revision)",
  );
  expect((view.getByLabelText("Sprite sheet URL") as HTMLInputElement).value).toBe(
    animation.url,
  );
  expect((view.getByLabelText("Frames") as HTMLInputElement).value).toBe("24");
  fireEvent.input(view.getByLabelText("Frames / second"), { target: { value: "8" } });
  fireEvent.change(view.getByLabelText("Sprite sheet URL"), {
    target: { value: "https://example.com/replacement.webp" },
  });
  fireEvent.submit(
    view.getByRole("button", { name: "Save new version" }).closest("form")!,
  );
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      name: "Idle sheet (revision)",
      url: "https://example.com/replacement.webp",
      columns: 6,
      rows: 4,
      frameCount: 24,
      fps: 8,
      facing: "left",
    }),
  );
  expect(assign).not.toHaveBeenCalled();
  expect(config.animations[0]).toEqual(animation);
});

it("cancels revisions without writing or retaining the previous draft", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  fireEvent.click(view.getByRole("button", { name: "Edit as new version" }));
  fireEvent.input(view.getByLabelText("Frames / second"), { target: { value: "4" } });
  fireEvent.click(view.getByRole("button", { name: "Cancel revision" }));
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  expect(create).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
});

it("links the chosen action to the sprite studio", () => {
  const view = render(<AiSpriteAnimations userId="ai" />);
  const link = view.getByRole("link", { name: "Create with Sprite Studio" });
  expect(link.getAttribute("href")).toBe("/manual/sprite_studio?ai=ai&action=idle");
});
