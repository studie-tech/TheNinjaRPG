import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import * as navigation from "next/navigation";
import superjson from "superjson";
import * as client from "@/app/_trpc/client";
import ManualAI from "@/app/[shell]/manual/ai/page";
import ManualBloodlines from "@/app/[shell]/manual/bloodline/page";
import ManualItems from "@/app/[shell]/manual/item/page";
import ManualJutsusBalance from "@/app/[shell]/manual/jutsu/balance/page";
import ManualJutsus from "@/app/[shell]/manual/jutsu/page";
import ManualQuests from "@/app/[shell]/manual/quest/page";
import { useFiltering as useBloodlineFiltering } from "@/layout/BloodlineFiltering";
import * as ContentBox from "@/layout/ContentBox";
import { useFiltering as useItemFiltering } from "@/layout/ItemFiltering";
import { useFiltering as useJutsuBalanceFiltering } from "@/layout/JutsuBalanceFiltering";
import { useFiltering as useJutsuFiltering } from "@/layout/JutsuFiltering";
import { useFiltering as useQuestFiltering } from "@/layout/QuestFiltering";
import { useFiltering as useUserFiltering } from "@/layout/UserFiltering";
import * as pagination from "@/libs/pagination";
import { TrpcTestProviders, testApi } from "../../setup/trpc";
import { mockUserContextValue } from "../../setup/userContext";

let queryClient: QueryClient;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    jutsu: testApi.jutsu,
    item: testApi.item,
    bloodline: testApi.bloodline,
    quests: testApi.quests,
    profile: testApi.profile,
    data: testApi.data,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  // Keep the pages' queries and loaders real without mounting unrelated toolbar queries.
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <section>{children}</section>
  ));
  mockUserContextValue({ data: { role: "USER" } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

const scenarios = [
  {
    name: "jutsu",
    Page: ManualJutsus,
    path: "jutsu.getAll",
    saved: { name: "Fire" },
    useSeed: () => {
      const state = useJutsuFiltering(undefined, { persistKey: "manual-jutsu" });
      return () => state.cf.setters.name("Fire");
    },
  },
  {
    name: "items",
    Page: ManualItems,
    path: "item.getAll",
    saved: { name: "Fire" },
    useSeed: () => {
      const state = useItemFiltering({
        allShopStatus: true,
        persistKey: "manual-item",
      });
      return () => state.cf.setters.name("Fire");
    },
  },
  {
    name: "bloodlines",
    Page: ManualBloodlines,
    path: "bloodline.getAll",
    saved: { name: "Fire" },
    useSeed: () => {
      const state = useBloodlineFiltering(undefined, {
        persistKey: "manual-bloodline",
      });
      return () => state.cf.setters.name("Fire");
    },
  },
  {
    name: "quests",
    Page: ManualQuests,
    path: "quests.getAll",
    saved: { name: "Fire" },
    useSeed: () => {
      const state = useQuestFiltering({ persistKey: "manual-quest" });
      return () => state.cf.setters.name("Fire");
    },
  },
  {
    name: "AI",
    Page: ManualAI,
    path: "profile.getPublicUsers",
    saved: { username: "Fire" },
    useSeed: () => {
      const state = useUserFiltering({ persistKey: "manual-ai" });
      return () => state.cf.setters.username("Fire");
    },
  },
  {
    name: "jutsu balance",
    Page: ManualJutsusBalance,
    path: "data.getJutsuBalanceStatistics",
    saved: { jutsuEffects: ["damage"] },
    useSeed: () => {
      const state = useJutsuBalanceFiltering({ persistKey: "manual-jutsu-balance" });
      return () => state.cf.setters.jutsuEffects(["damage"]);
    },
  },
];

it.each(
  scenarios.flatMap((scenario) => [
    { ...scenario, filterMode: "saved", restoreSaved: true },
    { ...scenario, filterMode: "default", restoreSaved: false },
  ]),
)(
  "requests one operation with the $filterMode filter on a cold $name page",
  async ({ Page, path, saved, useSeed, restoreSaved }) => {
    if (restoreSaved) {
      const seed = renderHook(useSeed);
      act(() => seed.result.current());
      seed.unmount();
    }

    const operations: { path: string; input: unknown }[] = [];
    let respond!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      respond = resolve;
    });
    const trpc = testApi.createClient({
      links: [
        httpBatchLink({
          url: "http://localhost/api/trpc",
          transformer: superjson,
          fetch: async (url, options) => {
            const parsed = new URL(String(url));
            const paths = parsed.pathname.split("/").at(-1)?.split(",") ?? [];
            const inputs = JSON.parse(
              parsed.searchParams.get("input") ?? String(options?.body),
            ) as Record<string, ReturnType<typeof superjson.serialize>>;
            paths.forEach((operationPath, index) => {
              operations.push({
                path: operationPath,
                input: superjson.deserialize(inputs[String(index)]!),
              });
            });
            await responseReady;
            return Response.json(
              paths.map(() => ({
                result: {
                  data: superjson.serialize(
                    path === "data.getJutsuBalanceStatistics"
                      ? []
                      : { data: [], nextCursor: null },
                  ),
                },
              })),
            );
          },
        }),
      ],
    });
    const view = render(
      <TrpcTestProviders client={trpc} queryClient={queryClient}>
        <Page />
      </TrpcTestProviders>,
    );
    expect(view.getByRole("status")).toBeTruthy();
    expect(view.queryByText(/No .*found/)).toBeNull();
    await waitFor(() => expect(operations).toHaveLength(1));
    expect(operations[0]?.path).toBe(path);
    if (restoreSaved) {
      expect(operations[0]?.input).toMatchObject(saved);
    } else {
      for (const key of Object.keys(saved)) {
        expect((operations[0]!.input as Record<string, unknown>)[key]).toBeUndefined();
      }
    }
    await act(async () => respond());
    await waitFor(() => expect(view.queryByRole("status")).toBeNull());
    expect(operations).toHaveLength(1);
  },
);
