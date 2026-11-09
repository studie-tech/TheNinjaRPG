import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { Suspense } from "react";
import * as client from "@/app/_trpc/client";
import SageModeEdit from "@/app/[shell]/manual/sageMode/edit/[sagemodeid]/page";
import type { SageMode } from "@/drizzle/schema";
import * as sageModeHooks from "@/hooks/sageMode";
import * as requireRole from "@/hooks/useRequireRole";
import * as ContentBox from "@/layout/ContentBox";
import * as EffectTagListEditor from "@/layout/EffectTagListEditor";

const row = {
  id: "sage-1",
  name: "Toad Sage",
  battleDescription: null,
  image: null,
  effects: [{ type: "damage" }],
  afterEffects: [{ type: "stun" }],
  level2Effects: [],
} as unknown as SageMode;
const forms: SageMode[] = [];

beforeEach(() => {
  forms.length = 0;
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(EffectTagListEditor, "EffectTagListEditor").mockImplementation(() => null);
  vi.spyOn(requireRole, "useRequireRole").mockReturnValue({
    userData: { role: "CONTENT-ADMIN" },
    hasAccess: true,
  } as never);
  vi.spyOn(sageModeHooks, "useSageModeEditForm").mockImplementation((data) => {
    forms.push(data);
    return { loading: true, sageMode: data } as never;
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    sageMode: {
      get: {
        useQuery: () => ({
          data: row,
          isPending: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("edits a normalized copy of the sage mode row without touching the query data", async () => {
  const params = Promise.resolve({ sagemodeid: "sage-1" });
  const page = (
    <Suspense fallback={null}>
      <SageModeEdit params={params} />
    </Suspense>
  );
  await act(async () => {
    render(page);
  });
  const [form] = forms;
  expect(form).toEqual({ ...row, battleDescription: "", image: "" } as SageMode);
  expect(form).not.toBe(row);
  expect(row.battleDescription).toBeNull();
  expect(row.image).toBeNull();
});
