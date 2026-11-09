import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import ManualSkillTree from "@/layout/ManualSkillTree";
import * as skillTreeFiltering from "@/layout/SkillTreeFiltering";
import * as pagination from "@/libs/pagination";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let skills: { id: string; name: string; folder: { name: string } | null }[];
let role: string;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  skills = [];
  role = "USER";
  Object.assign(vi.spyOn(client, "api" as never), {
    skillTree: testApi.skillTree,
    bloodline: testApi.bloodline,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () => ({ data: { userId: "me", role } }) as never,
  );
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    push: vi.fn(),
    back: vi.fn(),
  } as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(skillTreeFiltering, "default").mockImplementation(() => null);
  vi.spyOn(itemWithEffects, "default").mockImplementation((({
    item,
    folderName,
    showEdit,
  }: {
    item: { name: string };
    folderName?: string;
    showEdit?: string;
  }) => (
    <div data-testid="skill">
      {item.name}
      {folderName ? ` (${folderName})` : ""}
      {showEdit ? " editable" : ""}
    </div>
  )) as never);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = () => {
  const trpcClient = fakeTrpcClient(async (path) => {
    if (path === "skillTree.getAll") return { data: skills, nextCursor: null };
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <ManualSkillTree />
    </TrpcTestProviders>,
  );
};

it("tells players when no skills match the filters", async () => {
  const view = mount();
  expect(
    await view.findByText("No skills found given the search criteria."),
  ).toBeTruthy();
});

it("lists skills and shows folder and edit details only to content staff", async () => {
  skills = [{ id: "dash", name: "Dash", folder: { name: "Movement" } }];
  const player = mount();
  expect((await player.findByTestId("skill")).textContent).toBe("Dash");
  expect(player.queryByText("No skills found given the search criteria.")).toBeNull();
  cleanup();
  queryClient.clear();

  role = "CONTENT-ADMIN";
  const staff = mount();
  await waitFor(() =>
    expect(staff.getByTestId("skill").textContent).toBe("Dash (Movement) editable"),
  );
});
