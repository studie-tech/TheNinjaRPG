import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useInfiniteQuery,
  useMutation,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import * as ContentBox from "@/layout/ContentBox";
import { GameAssetLibrary } from "@/layout/GameAssetLibrary";
import * as preview from "@/layout/GameAssetPreview";
import * as Link from "@/layout/Link";
import * as Modal from "@/layout/Modal";
import * as toast from "@/libs/toast";
import { mockUserContextValue } from "../setup/userContext";

type Page = { data: GameAsset[]; nextCursor: number | null };
type Result = { success: boolean; message: string };
type CreateInput = Pick<GameAsset, "name" | "type" | "folder">;
const asset: GameAsset = {
  lpcConfig: null,
  id: "forest",
  name: "Forest",
  type: "STATIC",
  image: "https://example.com/forest.webp",
  url: "https://example.com/forest.webp",
  folder: "Scenes",
  frames: 1,
  speed: 50,
  hidden: false,
  licenseDetails: "TNR",
  onInitialBattleField: false,
  createdByUserId: "creator",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const nextAsset: GameAsset = { ...asset, id: "lake", name: "Lake" };
let cache: QueryClient;
let deleted: boolean;
let failReads: boolean;
let hasMore: boolean;
let folders: { folder: string; count: number }[];
let pageAssets: GameAsset[];
let play: ReturnType<typeof vi.fn<() => Promise<void>>>;
let pause: ReturnType<typeof vi.fn<() => void>>;
const create = vi.fn(
  async (_input: CreateInput): Promise<Result> => ({
    success: false,
    message: "Creation checked",
  }),
);
const read = vi.fn(async (cursor: number | null): Promise<Page> => {
  if (failReads) throw new Error("Temporarily unavailable");
  return cursor
    ? { data: [nextAsset], nextCursor: null }
    : { data: deleted ? [] : pageAssets, nextCursor: hasMore ? 1 : null };
});

beforeEach(() => {
  deleted = false;
  failReads = false;
  hasMore = false;
  read.mockClear();
  folders = [];
  create.mockClear();
  pageAssets = [asset];
  const media = Object.getPrototypeOf(document.createElement("audio"));
  play = vi.spyOn(media, "play").mockImplementation(async () => undefined);
  pause = vi.spyOn(media, "pause").mockImplementation(() => undefined);
  vi.spyOn(media, "load").mockImplementation(() => undefined);
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  mockUserContextValue({
    data: { role: "CONTENT" },
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  vi.spyOn(preview, "GameAssetPreview").mockImplementation(({ asset, play }) => (
    <span data-testid={`media-${asset.name}`} data-playing={String(play ?? false)} />
  ));
  vi.spyOn(preview, "AssetPreviewBackgroundControls").mockImplementation(() => <></>);
  vi.spyOn(Link, "default").mockImplementation(({ children, href }) => (
    <a href={String(href)}>{children}</a>
  ));
  vi.spyOn(Modal, "default").mockImplementation(
    ({ children, isOpen, title, onAccept, proceed_label, footerExtra }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {children}
          {footerExtra}
          {onAccept && (
            <button type="button" onClick={onAccept}>
              {proceed_label}
            </button>
          )}
        </div>
      ) : null,
  );
  const noOp = async () => undefined;
  // Keep the real query and mutation lifecycle; isolate only transport and unrelated UI.
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      gameAsset: {
        getAll: { invalidate: () => cache.invalidateQueries({ queryKey: ["assets"] }) },
        getAllFolders: { invalidate: noOp },
        getLpcCatalog: { invalidate: noOp },
        getLpcSceneCatalog: { invalidate: noOp },
        getAllNames: { invalidate: noOp },
        getNameTags: { invalidate: noOp },
      },
      misc: { getAllGameAssetNames: { invalidate: noOp } },
    }),
    gameAsset: {
      getAll: {
        useInfiniteQuery: (
          _input: unknown,
          options: { getNextPageParam: (page: Page) => number | null },
        ) =>
          useInfiniteQuery({
            queryKey: ["assets"],
            queryFn: ({ pageParam }) => read(pageParam),
            initialPageParam: null as number | null,
            ...options,
          }),
      },
      getAllFolders: { useQuery: () => ({ data: folders }) },
      getNameTags: { useQuery: () => ({ data: { tags: [] } }) },
      create: {
        useMutation: (options: UseMutationOptions<Result, Error, CreateInput>) =>
          useMutation({ mutationFn: (input) => create(input), ...options }),
      },
      delete: {
        useMutation: (options: UseMutationOptions<Result, Error, { id: string }>) =>
          useMutation({
            mutationFn: async () => {
              deleted = true;
              return { success: true, message: "Deleted" };
            },
            ...options,
          }),
      },
    },
  });
});

describe("asset library creation folders", () => {
  it("keeps legacy browsing while offering only supported creation folders", async () => {
    vi.spyOn(navigation, "useSearchParams").mockReturnValue(
      new URLSearchParams({ folder: "QA Folder%" }) as never,
    );
    folders = [
      { folder: "QA Folder%", count: 1 },
      { folder: "Scenes", count: 1 },
      { folder: "a".repeat(192), count: 1 },
    ];
    const view = render(
      <QueryClientProvider client={cache}>
        <GameAssetLibrary />
      </QueryClientProvider>,
    );
    expect(view.getByText("Folder: QA Folder%")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "New asset" }));
    const dialog = within(view.getByRole("dialog", { name: "New asset" }));
    const folder = dialog.getByLabelText("Folder (optional)") as HTMLInputElement;
    expect(folder.value).toBe("");
    expect(
      dialog.getByText(/“QA Folder%” uses an unsupported folder name/),
    ).toBeDefined();
    expect(
      Array.from(
        view.container.querySelectorAll("#new-asset-folders option"),
        (option) => option.getAttribute("value"),
      ),
    ).toEqual(["Scenes"]);

    fireEvent.change(dialog.getByLabelText("Asset name"), {
      target: { value: "Test asset" },
    });
    fireEvent.change(folder, { target: { value: "QA Folder%" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create & add media" }));
    expect(dialog.getByRole("alert").textContent).toContain(
      "Folder name can only contain letters and numbers",
    );
    expect(create).not.toHaveBeenCalled();
    expect(folder.value).toBe("QA Folder%");
  });

  it.each([undefined, "", "Scenes"])(
    "preserves a supported creation default: %s",
    async (folder) => {
      vi.spyOn(navigation, "useSearchParams").mockReturnValue(
        new URLSearchParams(folder === undefined ? {} : { folder }) as never,
      );
      const view = render(
        <QueryClientProvider client={cache}>
          <GameAssetLibrary />
        </QueryClientProvider>,
      );
      fireEvent.click(view.getByRole("button", { name: "New asset" }));
      const dialog = within(view.getByRole("dialog", { name: "New asset" }));
      expect(
        (dialog.getByLabelText("Folder (optional)") as HTMLInputElement).value,
      ).toBe(folder ?? "");
      expect(dialog.queryByText(/unsupported folder name/)).toBeNull();
      fireEvent.change(dialog.getByLabelText("Asset name"), {
        target: { value: "Test asset" },
      });
      fireEvent.click(dialog.getByRole("button", { name: "Create & add media" }));
      await waitFor(() =>
        expect(create).toHaveBeenCalledWith({
          name: "Test asset",
          type: "STATIC",
          folder: folder ?? "",
        }),
      );
    },
  );
});

afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});

describe("asset library retry", () => {
  it("refreshes cached complete results after a failed post-delete invalidation", async () => {
    const view = render(
      <QueryClientProvider client={cache}>
        <GameAssetLibrary />
      </QueryClientProvider>,
    );
    fireEvent.click(await view.findByRole("button", { name: "Preview Forest" }));
    const deleteButton = view
      .getAllByRole("button", { name: /^Delete asset$/ })
      .find((element) => element.tagName === "BUTTON");
    fireEvent.click(deleteButton!);
    failReads = true;
    fireEvent.click(
      within(view.getByRole("dialog", { name: "Delete Forest?" })).getByRole("button", {
        name: "Delete asset",
      }),
    );
    const failure = await view.findByRole("alert");
    const failureMessage = failure.textContent;
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.getByText("1 asset loaded. You’re all caught up.")).toBeDefined();
    expect(view.getByRole("button", { name: "Preview Forest" })).toBeDefined();

    failReads = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(view.queryByRole("button", { name: "Preview Forest" }) === null).toBe(
        true,
      ),
    );
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.at(-1)?.[0]).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Your library starts here")).toBeDefined();
    expect(failureMessage).toContain("Could not load the asset library.");
  });

  it("retries the failed next page without refetching loaded assets", async () => {
    hasMore = true;
    const view = render(
      <QueryClientProvider client={cache}>
        <GameAssetLibrary />
      </QueryClientProvider>,
    );
    await view.findByRole("button", { name: "Preview Forest" });
    failReads = true;
    fireEvent.click(view.getByRole("button", { name: "Load more assets" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "Could not load more assets.",
      ),
    );
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([null, 1]);
    expect(view.getByRole("button", { name: "Preview Forest" })).toBeDefined();

    failReads = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await view.findByRole("button", { name: "Preview Lake" });
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([null, 1, 1]);
    expect(view.getByRole("button", { name: "Preview Forest" })).toBeDefined();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("2 assets loaded. You’re all caught up.")).toBeDefined();
  });
});

describe("asset overview playback", () => {
  const animation = { ...asset, id: "wind", name: "Wind", type: "ANIMATION" as const };
  const sound = {
    ...asset,
    id: "sound",
    name: "Whoosh",
    type: "SFX" as const,
    url: "https://example.com/whoosh.mp3",
  };
  const music = {
    ...asset,
    id: "music",
    name: "Theme",
    type: "MUSIC" as const,
    url: "https://example.com/theme.mp3",
  };
  const overview = () =>
    render(
      <QueryClientProvider client={cache}>
        <GameAssetLibrary />
      </QueryClientProvider>,
    );

  it("plays and pauses animations without opening details, with one active preview", async () => {
    pageAssets = [animation, { ...animation, id: "fire", name: "Fire" }];
    const view = overview();
    fireEvent.click(await view.findByRole("button", { name: "Play Wind" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByTestId("media-Wind").getAttribute("data-playing")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Play Fire" }));
    expect(view.getByTestId("media-Wind").getAttribute("data-playing")).toBe("false");
    expect(view.getByTestId("media-Fire").getAttribute("data-playing")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Pause Fire" }));
    expect(view.getByTestId("media-Fire").getAttribute("data-playing")).toBe("false");
    expect(view.container.querySelector("button button")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("starts sound only on request, pauses, and switches sources in the shared player", async () => {
    pageAssets = [sound, music, animation];
    const view = overview();
    await view.findByRole("button", { name: "Play Whoosh" });
    const audio = view.container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBeNull();
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Play Whoosh" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Pause Whoosh" }).getAttribute("aria-busy"),
      ).toBe("false"),
    );
    expect(audio.getAttribute("src")).toBe(sound.url);
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Pause Whoosh" }));
    expect(view.getByRole("button", { name: "Play Whoosh" })).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Play Theme" }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(audio.getAttribute("src")).toBe(music.url);
    fireEvent.click(view.getByRole("button", { name: "Play Wind" }));
    expect(view.getByRole("button", { name: "Play Theme" })).toBeDefined();
    expect(pause).toHaveBeenCalled();
    expect(view.container.querySelectorAll("audio")).toHaveLength(1);
  });

  it("keeps a newer preview active when a previous play promise rejects", async () => {
    pageAssets = [sound, music];
    let rejectPrevious!: (error: Error) => void;
    play.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPrevious = reject;
        }),
    );
    const view = overview();
    fireEvent.click(await view.findByRole("button", { name: "Play Whoosh" }));
    fireEvent.click(view.getByRole("button", { name: "Play Theme" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Pause Theme" }).getAttribute("aria-busy"),
      ).toBe("false"),
    );
    await act(async () => rejectPrevious(new Error("Interrupted by another preview")));
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
    expect(view.getByRole("button", { name: "Pause Theme" })).toBeDefined();
  });

  it("shows recoverable playback failure beside the card and retries without a dialog", async () => {
    pageAssets = [sound];
    play.mockRejectedValueOnce(new Error("Unsupported media"));
    const view = overview();
    fireEvent.click(await view.findByRole("button", { name: "Play Whoosh" }));
    expect((await view.findByRole("alert")).textContent).toContain(
      "Audio could not be played",
    );
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Play Whoosh" }));
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
    expect(play).toHaveBeenCalledTimes(2);
    expect(view.getByRole("button", { name: "Pause Whoosh" })).toBeDefined();
  });

  it("restores the play control when audio ends or is externally paused", async () => {
    pageAssets = [sound];
    const view = overview();
    fireEvent.click(await view.findByRole("button", { name: "Play Whoosh" }));
    const audio = view.container.querySelector("audio")!;
    Object.defineProperty(audio, "ended", { configurable: true, value: true });
    fireEvent.ended(audio);
    expect(view.getByRole("button", { name: "Play Whoosh" })).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Play Whoosh" }));
    fireEvent.pause(audio);
    expect(view.getByRole("button", { name: "Play Whoosh" })).toBeDefined();
  });

  it("reports a media failure after playback has started", async () => {
    pageAssets = [sound];
    const view = overview();
    fireEvent.click(await view.findByRole("button", { name: "Play Whoosh" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Pause Whoosh" }).getAttribute("aria-busy"),
      ).toBe("false"),
    );
    const audio = view.container.querySelector("audio")!;
    Object.defineProperty(audio, "error", { configurable: true, value: { code: 3 } });
    fireEvent.error(audio);
    expect(view.getByRole("alert").textContent).toContain("Audio could not be played");
    expect(view.getByRole("button", { name: "Play Whoosh" })).toBeDefined();
  });

  it("stops and unloads playback when filtering or leaving the overview", async () => {
    pageAssets = [sound];
    const view = overview();
    fireEvent.click(await view.findByRole("button", { name: "Play Whoosh" }));
    const audio = view.container.querySelector("audio")!;
    fireEvent.change(view.getByRole("searchbox", { name: "Search assets" }), {
      target: { value: "another" },
    });
    expect(view.getByRole("button", { name: "Play Whoosh" })).toBeDefined();
    expect(audio.getAttribute("src")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Play Whoosh" }));
    const pauseCalls = pause.mock.calls.length;
    view.unmount();
    expect(pause.mock.calls.length).toBeGreaterThan(pauseCalls);
    expect(audio.getAttribute("src")).toBeNull();
  });

  it("offers inline playback in list view and keeps details as a separate action", async () => {
    pageAssets = [sound];
    mockUserContextValue({ data: undefined } as never);
    const view = overview();
    await view.findByRole("button", { name: "Play Whoosh" });
    fireEvent.click(view.getByRole("button", { name: "List view" }));
    fireEvent.click(view.getByRole("button", { name: "Play Whoosh" }));
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Preview Whoosh" }));
    expect(view.getByRole("dialog", { name: "Whoosh" })).toBeDefined();
    expect(view.getByRole("button", { name: "Play Whoosh" })).toBeDefined();
    expect(view.queryByRole("button", { name: "New asset" })).toBeNull();
  });
});
