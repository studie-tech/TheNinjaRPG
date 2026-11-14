import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useMutation,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import * as client from "@/app/_trpc/client";
import TitleEdit from "@/app/[shell]/manual/title/edit/[titleid]/page";
import * as ContentBox from "@/layout/ContentBox";
import * as EditContent from "@/layout/EditContent";
import * as SuggestChange from "@/layout/SuggestChange";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { mockUserContextValue } from "../../setup/userContext";

type Result = { success: boolean; message: string };

const title = {
  id: "title-1",
  name: "Hero",
  description: "",
  effects: [],
  archived: false,
};
let queryClient: QueryClient;
let resolveSave: (result: Result) => void;
const save = vi.fn(
  (_input: unknown) =>
    new Promise<Result>((resolve) => {
      resolveSave = resolve;
    }),
);
const refetch = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(EditContent, "EditContent").mockImplementation(({ onAccept }) => (
    <button type="button" onClick={(e) => onAccept?.(e)}>
      Save to Database
    </button>
  ));
  vi.spyOn(SuggestChange, "SuggestChange").mockImplementation(({ label }) => (
    <span>{label}</span>
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  mockUserContextValue({
    data: { userId: "u", role: "CONTENT-ADMIN" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ title: { invalidate } }),
    title: {
      get: {
        useQuery: () => ({ data: title, isPending: false, isError: false, refetch }),
      },
      update: {
        useMutation: (options: UseMutationOptions<Result, Error, unknown>) =>
          useMutation({ ...options, mutationFn: save }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it("refreshes the saved title once and offers its editors a suggestion instead", async () => {
  const params = Promise.resolve({ titleid: title.id });
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <TitleEdit params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  expect(view!.getByText("Suggest instead")).toBeDefined();
  fireEvent.click(view!.getByRole("button", { name: "Save to Database" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = { success: true, message: "Title updated" };
  await act(async () => {
    resolveSave(saved);
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  expect(refetch).not.toHaveBeenCalled();
  expect(toast.showMutationToast).toHaveBeenCalledWith(saved);
});
