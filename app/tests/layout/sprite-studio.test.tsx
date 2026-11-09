import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as studioHook from "@/hooks/useSpriteStudio";
import * as ContentBox from "@/layout/ContentBox";
import { SpriteStudio } from "@/layout/SpriteStudio";
import * as uploadthing from "@/utils/uploadthing";

const accept = vi.fn();
const discard = vi.fn();
const regenerate = vi.fn();
const generate = vi.fn();
const mutation = (mutate: unknown) => ({ mutate, isPending: false, error: null });
const base = {
  id: "gen",
  name: "Bandit — Strike",
  prompt: "strikes",
  motion: "custom",
  frames: 33,
  facing: "left",
  sourceUrl: "https://uploadthing.b-cdn.net/f/art",
  remoteImageId: "img",
  remoteAssetId: "ast",
  aiUserId: "ai",
  actionKey: "basic:basicAttack",
  status: "READY",
  stage: null,
  error: null,
  url: "https://uploadthing.b-cdn.net/f/large",
  smallUrl: "https://uploadthing.b-cdn.net/f/small",
  columns: 8,
  rows: 2,
  frameCount: 16,
  fps: 12.5,
  animationId: null,
  createdByUserId: "editor",
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: { username: "Editor" },
};
const studio = (rows: unknown[], enabled = true) => ({
  account: {
    data: { enabled, account: enabled ? { credits: 10000 } : null },
    isPending: false,
    error: null,
  },
  generations: { data: rows, isPending: false, error: null },
  generate: mutation(generate),
  regenerate: mutation(regenerate),
  accept: mutation(accept),
  discard: mutation(discard),
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ spriteStudio: { getAccount: { invalidate: vi.fn() } } }),
    spriteStudio: {
      getAiSource: { useQuery: () => ({ data: undefined }) },
      drawCharacters: { useMutation: () => mutation(vi.fn()) },
    },
    profile: { getAllAiNames: { useQuery: () => ({ data: [], isPending: false }) } },
  });
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <>
        {topRightContent}
        {children}
      </>
    ),
  );
  vi.spyOn(uploadthing, "UploadButton").mockImplementation(() => <></>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const show = (value: ReturnType<typeof studio>) => {
  vi.spyOn(studioHook, "useSpriteStudio").mockReturnValue(value as never);
  return render(<SpriteStudio />);
};

it("explains how to connect a deployment without the key", () => {
  const view = show(studio([], false));
  expect(view.getByText("gameasset.dev is not connected")).toBeTruthy();
  expect(view.queryByText("Create sprite")).toBeNull();
});

it("shows the balance and keeps creation disabled until a character is chosen", () => {
  const view = show(studio([]));
  expect(view.getByText(/10,000.00/)).toBeTruthy();
  expect(
    (view.getByRole("button", { name: "Create sprite" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("keeps creation disabled for an AI with no art", () => {
  const source = {
    userId: "ai",
    username: "Bandit",
    facing: "left",
    assignedKeys: [],
    actions: [{ key: "idle", name: "Idle", group: "Stances" }],
  };
  const button = (avatar: string | null) => {
    client.api.spriteStudio.getAiSource.useQuery = (() => ({
      data: { ...source, avatar },
    })) as never;
    const view = show(studio([]));
    const { disabled } = view.getByRole("button", {
      name: "Create sprite",
    }) as HTMLButtonElement;
    view.unmount();
    return disabled;
  };
  expect(button(null)).toBe(true);
  expect(button("https://uploadthing.b-cdn.net/f/art")).toBe(false);
});

it("offers assignment for an AI sprite that is ready", () => {
  const view = show(studio([base]));
  fireEvent.click(view.getByRole("button", { name: "Assign to AI" }));
  expect(accept).toHaveBeenCalledWith({ id: "gen", assign: true });
  fireEvent.click(view.getByRole("button", { name: "Add to library" }));
  expect(accept).toHaveBeenCalledWith({ id: "gen", assign: false });
});

it("hides assignment for a sprite with no AI", () => {
  const view = show(studio([{ ...base, aiUserId: null, actionKey: null }]));
  expect(view.queryByRole("button", { name: "Assign to AI" })).toBeNull();
});

it("shows progress and lets a running sprite be cancelled", () => {
  const view = show(
    studio([
      {
        ...base,
        status: "PROCESSING",
        stage: "Rendering frames",
        url: null,
        columns: null,
      },
    ]),
  );
  expect(view.getByRole("status").textContent).toBe("Rendering frames");
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(discard).toHaveBeenCalledWith({ id: "gen" });
});

it("shows why a sprite failed and offers another take", () => {
  const view = show(
    studio([
      { ...base, status: "FAILED", error: "Quality gate", url: null, columns: null },
    ]),
  );
  expect(view.getByRole("alert").textContent).toBe("Quality gate");
  fireEvent.click(view.getByRole("button", { name: "New take" }));
  expect(regenerate).toHaveBeenCalledWith({ id: "gen" });
});
