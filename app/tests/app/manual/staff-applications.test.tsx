import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
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
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import ApplicationsPage from "@/app/[shell]/manual/staff/applications/page";
import * as ApplicationsFiltering from "@/layout/ApplicationsFiltering";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as Modal from "@/layout/Modal";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { mockUserContextValue } from "../../setup/userContext";

type Result = RouterOutputs["applications"]["delete"];
type DeleteInput = RouterInputs["applications"]["delete"];

let queryClient: QueryClient;
let resolveDelete: (result: Result) => void;
const remove = vi.fn(
  (_input: DeleteInput) =>
    new Promise<Result>((resolve) => {
      resolveDelete = resolve;
    }),
);
const invalidate = vi.fn(async () => undefined);
const application = {
  id: "app-1",
  createdAt: new Date(),
  motivation: "Help",
  targetRole: "MODERATOR",
  state: "APPROVED",
  myVote: null,
  applicant: {
    username: "Applicant",
    avatar: null,
    level: 10,
    rank: "GENIN",
    village: null,
  },
};

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.clearAllMocks();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Avatar, "default").mockImplementation(() => null);
  vi.spyOn(ApplicationsFiltering, "default").mockImplementation(() => null);
  vi.spyOn(ApplicationsFiltering, "useApplicationsFiltering").mockReturnValue(
    {} as never,
  );
  vi.spyOn(ApplicationsFiltering, "getApplicationsFilter").mockReturnValue({} as never);
  vi.spyOn(Modal, "default").mockImplementation(
    ({ isOpen, onAccept, proceed_label }) =>
      isOpen ? (
        <div role="dialog">
          <button type="button" onClick={onAccept}>
            {proceed_label}
          </button>
        </div>
      ) : null,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  mockUserContextValue({
    data: { userId: "owner", role: "OWNER" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ applications: { list: { invalidate } } }),
    applications: {
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ data: [application], nextCursor: null }] },
          isPending: false,
          fetchNextPage: async () => undefined,
          hasNextPage: false,
        }),
      },
      delete: {
        useMutation: (options: UseMutationOptions<Result, Error, DeleteInput>) =>
          useMutation({ ...options, mutationFn: remove }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it("shows a rejected delete and keeps the list until a delete succeeds", async () => {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApplicationsPage />
    </QueryClientProvider>,
  );
  const confirmDelete = () => {
    fireEvent.click(view.getAllByRole("button", { name: "Delete" })[0]!);
    fireEvent.click(
      within(view.getByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
  };
  confirmDelete();
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  expect(remove.mock.calls[0]?.[0]).toEqual({ id: "app-1" });

  const rejection = {
    success: false,
    message: "Only pending applications can be deleted",
  };
  await act(async () => {
    resolveDelete(rejection);
  });
  await waitFor(() => expect(toast.showMutationToast).toHaveBeenCalledWith(rejection));
  expect(invalidate).not.toHaveBeenCalled();

  confirmDelete();
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  const success = { success: true, message: "Application deleted" };
  await act(async () => {
    resolveDelete(success);
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  expect(toast.showMutationToast).toHaveBeenLastCalledWith(success);
});
