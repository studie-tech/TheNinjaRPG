import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { Suspense } from "react";
import * as client from "@/app/_trpc/client";
import ANBUDetails from "@/app/[shell]/anbu/[anbuid]/page";
import ANBU from "@/app/[shell]/anbu/page";
import * as ContentBox from "@/layout/ContentBox";
import * as search from "@/utils/search";
import * as UserContext from "@/utils/UserContext";

const outlaw = {
  userId: "outlaw",
  villageId: "syndicate",
  isOutlaw: true,
  isBanned: false,
};
const noMutation = () => ({ mutate: vi.fn(), isPending: false });

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(({ title, children }) => (
    <section aria-label={title}>{children}</section>
  ));
  vi.spyOn(search, "useUserPicker").mockReturnValue({
    methods: {},
    user: undefined,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    anbu: {
      getAll: { useQuery: () => ({ data: [] }) },
      // The squad of a foreign village never loads for an outlaw.
      get: { useQuery: () => ({ data: undefined }) },
      createSquad: { useMutation: noMutation },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("tells an outlaw in a sector without an ANBU building that there are no squads", () => {
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: outlaw,
    access: true,
    sectorVillage: { structures: [] },
  } as never);
  const view = render(<ANBU />);
  expect(view.getByRole("region", { name: "ANBU" }).textContent).toContain(
    "Unlikely to find outlaw ANBU",
  );
});

it("explains a village sector without an ANBU building instead of loading forever", () => {
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: { ...outlaw, isOutlaw: false },
    access: true,
    sectorVillage: { structures: [] },
  } as never);
  const view = render(<ANBU />);
  expect(view.getByRole("region", { name: "ANBU" }).textContent).toContain(
    "Can not find the ANBU structure in this village.",
  );
});

it("tells an outlaw opening a squad that there are no outlaw ANBU", async () => {
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: outlaw,
    access: true,
  } as never);
  const params = Promise.resolve({ anbuid: "squad" });
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={null}>
        <ANBUDetails params={params} />
      </Suspense>,
    );
  });
  expect(view!.getByRole("region", { name: "ANBU" }).textContent).toContain(
    "Unlikely to find outlaw ANBU",
  );
});
