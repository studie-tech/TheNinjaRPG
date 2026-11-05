import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import { HealOthersComponent } from "@/app/[shell]/hospital/page";
import type { UserWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";

const healer = {
  userId: "healer",
  rank: "JONIN",
  medicalExperience: 1_000_000,
  curChakra: 1_000_000,
  maxChakra: 1_000_000,
  status: "AWAKE",
  regeneration: 0,
  regenAt: new Date(),
} as unknown as NonNullable<UserWithRelations>;

const patient = (curHealth: number) => ({
  userId: "patient",
  username: "Patient",
  avatar: "/patient.webp",
  level: 10,
  rank: "CHUNIN",
  status: "HOSPITALIZED",
  curHealth,
  maxHealth: 100,
});

const renderPatient = (curHealth: number) => {
  Object.assign(vi.spyOn(client, "api" as never), {
    hospital: {
      userHeal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getHospitalizedUsers: { useQuery: () => ({ data: [patient(curHealth)] }) },
    },
    useUtils: () => ({}),
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
  } as never);
  render(
    <AppRouterContext.Provider value={{} as never}>
      <HealOthersComponent userData={healer} timeDiff={0} />
    </AppRouterContext.Provider>,
  );
};

const enabledShares = () =>
  ["25%", "50%", "75%", "100%"].filter(
    (share) => !screen.getByText(share).closest("button")?.disabled,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("offers the smallest heal while the patient is missing health", () => {
  renderPatient(90);
  expect(enabledShares()).toEqual(["25%"]);
});

it("disables every heal for a patient with no missing health", () => {
  renderPatient(100);
  expect(enabledShares()).toEqual([]);
});
