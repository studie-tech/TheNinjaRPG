import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import { ContentReviewDesk } from "@/layout/ContentReviewDesk";
import { ContentReviewDetail } from "@/layout/ContentReviewDetail";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const actions = ["approve", "reject", "unreject", "revert", "bulkApprove"] as const;
type Action = typeof actions[number];
type Success = (data: { success: boolean; message: string }, variables: unknown, revision: number | undefined) => Promise<void>;
const callbacks = {} as Record<Action, Success>;
const counts = { canReview: true, statuses: { PENDING: 3 }, pendingByCategory: {} };
const fetchCounts = vi.fn(async () => counts);
const shown = vi.fn<typeof toast.showMutationToast>(() => undefined);
/** Resolve unrelated invalidations so tests target optional count confirmation. */
const settled = async () => undefined;
/** Seed a reviewer profile whose queue notice can be updated or reconciled. */
const profile = () => ({
  userData: { userId: "reviewer", role: "OWNER", money: 100 },
  notifications: [{ href: "/manual/review", name: "Content review (3)", color: "green", notificationCount: 3 }],
});
const clients: QueryClient[] = [];

beforeEach(() => {
  fetchCounts.mockReset().mockResolvedValue(counts);
  shown.mockClear();
  vi.spyOn(toast, "showMutationToast").mockImplementation(shown);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ contentReview: {
      getQueue: { invalidate: settled }, getStats: { invalidate: settled },
      getProposal: { invalidate: settled }, getCounts: { invalidate: settled, fetch: fetchCounts },
    } }),
    contentReview: {
      ...Object.fromEntries(actions.map((action) => [action, {
        useMutation: (options: { onSuccess: Success }) => {
          callbacks[action] = options.onSuccess;
          return { isPending: false };
        },
      }])),
      getProposal: { useQuery: () => ({ isPending: false, data: {
        id: "proposal", status: "REJECTED", canReview: true, category: "VISUAL", title: "Update scene",
        rationale: "Scene", createdAt: new Date().toISOString(), statusChangedAt: new Date(),
        targets: [], basis: [], assets: {}, changes: [],
      } }) },
      getCounts: { useQuery: () => ({ data: counts }) },
      getQueue: { useInfiniteQuery: () => ({ data: { pages: [{ items: [] }] }, isPending: false }) },
    },
  });
});

afterEach(() => {
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

/** Capture rendered decision callbacks with the production profile cache updater. */
const setup = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  queryClient.setQueryData(key, profile());
  const read = vi.fn(async () => profile());
  const observer = new QueryObserver(queryClient, { queryKey: key, staleTime: Infinity, queryFn: read });
  const unsubscribe = observer.subscribe(() => undefined);
  const updateUser = vi.fn((patch, options) => updateUserCache(queryClient, key, patch, options));
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: profile().userData,
    prepareUserUpdate: () => prepareUserUpdate(queryClient, key), updateUser,
  } as never);
  const onDecided = vi.fn();
  renderToStaticMarkup(<ContentReviewDetail id="proposal" position={{ index: 0, total: 1 }} onMove={vi.fn()} onDecided={onDecided} />);
  renderToStaticMarkup(<ContentReviewDesk />);
  return { queryClient, read, updateUser, unsubscribe, onDecided };
};

it.each(actions)("completes a saved %s decision when its optional count confirmation fails", async (action) => {
  const test = setup();
  fetchCounts.mockRejectedValueOnce(new Error("Count confirmation unavailable"));
  const revision = prepareUserUpdate(test.queryClient, key);
  const response = { success: true, message: "Decision saved" };
  await callbacks[action](response, {}, revision);
  expect(test.onDecided).toHaveBeenCalledTimes(action === "revert" || action === "bulkApprove" ? 0 : 1);
  expect(test.read).toHaveBeenCalledTimes(1);
  expect(test.updateUser).toHaveBeenCalledWith(undefined, { revision });
  expect(shown).toHaveBeenCalledWith(response);
  test.unsubscribe();
});

it.each(actions)("uses a confirmed count after %s without reloading the profile", async (action) => {
  const test = setup();
  await callbacks[action]({ success: true, message: "Decision saved" }, {}, prepareUserUpdate(test.queryClient, key));
  expect(test.read).not.toHaveBeenCalled();
  expect(test.queryClient.getQueryData(key)).toMatchObject({ notifications: [expect.objectContaining({ href: "/manual/review", notificationCount: 3 })] });
  test.unsubscribe();
});
