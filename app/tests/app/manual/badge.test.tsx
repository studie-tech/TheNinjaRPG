import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import ManualBadges from "@/app/[shell]/manual/badge/page";
import * as CombatActions from "@/layout/CombatActions";
import * as ContentBox from "@/layout/ContentBox";
import * as UserContext from "@/utils/UserContext";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../../setup/trpc";

let queryClient: QueryClient;
let requestedPages: number[];
let failedPage: number | undefined;
let intersect: () => void;
const originalObserver = globalThis.IntersectionObserver;
const badges: RouterOutputs["badge"]["getAll"]["data"] = Array.from(
  { length: 108 },
  (_, index) => ({
    id: `badge-${index}`,
    name: `Badge ${index}`,
    image: "https://utfs.io/f/badge-key",
    description: "A badge.",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  }),
);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requestedPages = [];
  failedPage = undefined;
  // Report intersections explicitly so each page is loaded by scrolling the last tile.
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = () =>
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as never,
        );
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  Object.assign(vi.spyOn(client, "api" as never), {
    badge: testApi.badge,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: undefined } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <section>{children}</section>
  ));
  vi.spyOn(CombatActions, "ActionSelector").mockImplementation(
    ({ items, setLastElement, emptyText }) => (
      <div>
        {items?.map((item, index) => (
          <div
            key={item.id}
            ref={index === items.length - 1 ? setLastElement : null}
            data-testid="badge-tile"
          >
            {item.name}
          </div>
        ))}
        {items?.length === 0 && <p>{emptyText}</p>}
      </div>
    ),
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  globalThis.IntersectionObserver = originalObserver;
});

const mount = (entries = badges) => {
  const trpcClient = fakeTrpcClient((path, input) => {
    if (path !== "badge.getAll") throw new Error(`Unexpected procedure: ${path}`);
    const { cursor = 0, limit = 100 } = input as Extract<
      RouterInputs["badge"]["getAll"],
      { limit: number }
    >;
    const page = cursor ?? 0;
    requestedPages.push(page);
    if (page === failedPage) throw new Error("Connection lost");
    const data = entries.slice(page * limit, (page + 1) * limit);
    return { data, nextCursor: data.length < limit ? null : page + 1 };
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <ManualBadges />
    </TrpcTestProviders>,
  );
};

it("loads all badge pages on intersection and stops after the final page", async () => {
  const view = mount();
  expect(view.getByText("Loading badges")).toBeTruthy();
  await view.findByText("Badge 49");
  expect(view.getAllByTestId("badge-tile")).toHaveLength(50);
  act(() => intersect());
  await view.findByText("Badge 99");
  act(() => intersect());
  await view.findByText("Badge 107");
  expect(view.getAllByTestId("badge-tile")).toHaveLength(108);
  expect(requestedPages).toEqual([0, 1, 2]);
  expect(view.queryByRole("button", { name: "Load more badges" })).toBeNull();
  act(() => intersect());
  await waitFor(() => expect(requestedPages).toEqual([0, 1, 2]));
});

it("can load the next page using the fallback button", async () => {
  const view = mount();
  fireEvent.click(await view.findByRole("button", { name: "Load more badges" }));
  await view.findByText("Badge 99");
  expect(requestedPages).toEqual([0, 1]);
});

it("preserves loaded badges after a page failure and retries the failed page", async () => {
  failedPage = 1;
  const view = mount();
  await view.findByText("Badge 49");
  act(() => intersect());
  expect((await view.findByRole("alert")).textContent).toContain(
    "Could not load more badges.",
  );
  expect(view.getAllByTestId("badge-tile")).toHaveLength(50);
  expect(requestedPages).toEqual([0, 1]);
  failedPage = undefined;
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await view.findByText("Badge 99");
  expect(requestedPages).toEqual([0, 1, 1]);
  expect(view.queryByRole("alert")).toBeNull();
});

it("offers a retry when the initial page fails", async () => {
  failedPage = 0;
  const view = mount();
  expect((await view.findByRole("alert")).textContent).toContain(
    "Could not load badges.",
  );
  expect(view.queryByText("No badges exist yet.")).toBeNull();
  failedPage = undefined;
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await view.findByText("Badge 49");
  expect(requestedPages).toEqual([0, 0]);
});

it("shows the empty message only after a successful empty page", async () => {
  const view = mount([]);
  await view.findByText("No badges exist yet.");
  expect(view.queryByRole("button", { name: "Load more badges" })).toBeNull();
  expect(requestedPages).toEqual([0]);
});
