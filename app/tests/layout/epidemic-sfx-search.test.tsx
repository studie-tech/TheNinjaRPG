import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import { EpidemicSfxSearch } from "@/layout/EpidemicSfxSearch";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import { deferred } from "../setup/deferred";
import { mockUserContextValue } from "../setup/userContext";

type Result = { success: boolean; message: string; assetId?: string };
type Callbacks = {
  onMutate: () => void;
  onSuccess: (result: Result) => Promise<void>;
  onError: (error: Error) => void;
  onSettled: () => void;
};
const request = vi.fn(
  async (_input: unknown): Promise<Result> => ({
    success: true,
    message: "Imported",
    assetId: "new-sound",
  }),
);
const invalidations = {
  getAll: vi.fn(async (): Promise<void> => undefined),
  getAllFolders: vi.fn(async (): Promise<void> => undefined),
  getAllNames: vi.fn(async (): Promise<void> => undefined),
  getAllGameAssetNames: vi.fn(async (): Promise<void> => undefined),
  getNameTags: vi.fn(async (): Promise<void> => undefined),
};

beforeEach(() => {
  request.mockReset();
  for (const invalidate of Object.values(invalidations))
    invalidate.mockReset().mockResolvedValue(undefined);
  request.mockResolvedValue({
    success: true,
    message: "Imported",
    assetId: "new-sound",
  });
  mockUserContextValue({
    data: { role: "CONTENT" },
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      gameAsset: {
        getAll: { invalidate: invalidations.getAll },
        getAllFolders: { invalidate: invalidations.getAllFolders },
        getAllNames: { invalidate: invalidations.getAllNames },
        getNameTags: { invalidate: invalidations.getNameTags },
      },
      misc: {
        getAllGameAssetNames: { invalidate: invalidations.getAllGameAssetNames },
      },
    }),
    contentReview: {
      searchSfx: {
        useQuery: ({ term }: { term: string }) => ({
          data: term
            ? {
                configured: true,
                results: [
                  { id: "catalog-sound", title: "Fiery whoosh", lengthMs: 1000 },
                ],
              }
            : undefined,
          isFetching: false,
        }),
      },
      // Await the component's callbacks so deferred cache/caller work controls pending state.
      importSfx: {
        useMutation: function useImport(callbacks: Callbacks) {
          const [isPending, setPending] = useState(false);
          const [variables, setVariables] = useState<
            { epidemicId: string } | undefined
          >();
          return {
            isPending,
            variables,
            mutate: (input: { epidemicId: string }) => {
              setPending(true);
              setVariables(input);
              callbacks.onMutate();
              void (async () => {
                try {
                  await callbacks.onSuccess(await request(input));
                } catch (error) {
                  callbacks.onError(error as Error);
                } finally {
                  callbacks.onSettled();
                  setPending(false);
                }
              })();
            },
          };
        },
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Exercise search through the component controls; only its tRPC boundary is stubbed. */
const search = (
  onImported: (assetId: string) => void | Promise<void> = vi.fn(async () => undefined),
) => {
  const view = render(<EpidemicSfxSearch onImported={onImported} />);
  fireEvent.change(view.getByRole("textbox"), { target: { value: "fire" } });
  fireEvent.click(view.getByRole("button", { name: "Search sounds" }));
  return { view, onImported };
};

describe("sound library import recovery", () => {
  it("refreshes each asset cache once and stays pending through the import callback", async () => {
    const { promise: refreshGate, resolve: finishRefresh } = deferred<void>();
    for (const invalidate of Object.values(invalidations))
      invalidate.mockReturnValueOnce(refreshGate);
    const { promise: gate, resolve: finish } = deferred<void>();
    const onImported = vi.fn(async () => gate);
    const { view } = search(onImported);
    act(() => {
      fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
      fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    });
    await waitFor(() => {
      for (const invalidate of Object.values(invalidations))
        expect(invalidate).toHaveBeenCalledTimes(1);
    });
    expect(onImported).not.toHaveBeenCalled();
    expect(
      (view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      finishRefresh();
    });
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("new-sound"));
    expect(request).toHaveBeenCalledTimes(1);
    for (const invalidate of Object.values(invalidations))
      expect(invalidate).toHaveBeenCalledTimes(1);
    expect(
      (view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      finish();
    });
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("explains exhausted provider quota and permits a retry without navigating", async () => {
    request.mockRejectedValueOnce(
      new Error(
        'Epidemic Sound download responded 402: {"message":"Download quota exceeded"}',
      ),
    );
    const { view, onImported } = search();
    fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("download limit"),
    );
    expect(view.getByRole("alert").textContent).not.toContain("/v0/");
    expect(onImported).not.toHaveBeenCalled();
    expect(
      (view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("new-sound"));
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("displays an expected server rejection beside the import controls", async () => {
    request.mockResolvedValueOnce({
      success: false,
      message: "Your content permissions changed.",
    });
    const { view, onImported } = search();
    fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "Your content permissions changed.",
      ),
    );
    expect(onImported).not.toHaveBeenCalled();
    for (const invalidate of Object.values(invalidations))
      expect(invalidate).not.toHaveBeenCalled();
  });
});
