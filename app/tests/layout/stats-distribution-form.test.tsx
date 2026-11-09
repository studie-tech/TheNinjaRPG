import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
  vi,
} from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ELEMENTAL_MASTERY_CAP } from "@/drizzle/constants";
import * as tutorial from "@/hooks/tutorial";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import type { UserWithRelations } from "@/routers/profile";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";

// These workflows render multiple dialogs and large forms in one interaction.
setDefaultTimeout(20_000);

const inputPreferenceKey = "statsDistributionUseInputBoxes";
let savedInputPreference: string | null;

beforeEach(() => {
  installBrowserGlobals();
  savedInputPreference = localStorage.getItem(inputPreferenceKey);
  localStorage.setItem(inputPreferenceKey, "true");
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: null,
    completeTutorialAction: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof tutorial.useTutorialStep>);
});

afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
  if (savedInputPreference === null) localStorage.removeItem(inputPreferenceKey);
  else localStorage.setItem(inputPreferenceKey, savedInputPreference);
});

const trainee = {
  rank: "JONIN",
  status: "AWAKE",
  earnedExperience: 4499,
  offence: 10,
  defence: 10,
  strength: 10,
  speed: 10,
  intelligence: 10,
  willpower: 10,
  ninjutsuMastery: 10,
  genjutsuMastery: 10,
  taijutsuMastery: 10,
  bukijutsuMastery: 10,
  bloodlineMastery: 10,
  sageMastery: 10,
  masteryRanks: {},
  primaryElement: "Fire",
  secondaryElement: "Water",
  elementalMastery: { Lightning: ELEMENTAL_MASTERY_CAP - 0.5 },
} as unknown as NonNullable<UserWithRelations>;

type Accept = ComponentProps<typeof DistributeStatsForm>["onAccept"];
const form = (onAccept: Accept, userData = trainee) => (
  <DistributeStatsForm
    includeMasteries
    showWrapper={false}
    userData={userData}
    availableStats={userData.earnedExperience}
    onAccept={onAccept}
    isPending={false}
  />
);

describe("advanced experience assignment drafts", () => {
  it("waits for an accepted allocation before advancing the tutorial", async () => {
    const { promise: assignment, resolve: resolveAssignment } = deferred<boolean>();
    const accept = vi.fn(() => assignment);
    const next = vi.fn(async () => {});
    vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
      currentStep: { advanceOn: "assignStats" },
      completeTutorialAction: next,
    } as unknown as ReturnType<typeof tutorial.useTutorialStep>);
    const view = render(form(accept));
    fireEvent.input(view.getByRole("spinbutton", { name: /^Offence/ }), {
      target: { value: String(trainee.earnedExperience) },
    });
    fireEvent.click(view.getByRole("button", { name: "Assign points" }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(next).not.toHaveBeenCalled();
    await act(async () => resolveAssignment(true));
    await waitFor(() => expect(next).toHaveBeenCalledWith("assignStats"));
  });

  it.each([false, undefined])(
    "does not advance the tutorial after an unaccepted allocation (%s)",
    async (accepted) => {
      const next = vi.fn(async () => {});
      vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
        currentStep: { advanceOn: "assignStats" },
        completeTutorialAction: next,
      } as unknown as ReturnType<typeof tutorial.useTutorialStep>);
      const accept = vi.fn(async () => accepted);
      const view = render(form(accept));
      fireEvent.input(view.getByRole("spinbutton", { name: /^Offence/ }), {
        target: { value: String(trainee.earnedExperience) },
      });
      fireEvent.click(view.getByRole("button", { name: "Assign points" }));
      await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
      expect(next).not.toHaveBeenCalled();
      expect(
        (view.getByRole("spinbutton", { name: /^Offence/ }) as HTMLInputElement).value,
      ).toBe(String(trainee.earnedExperience));
    },
  );

  it.each([false, true])(
    "explains an over-budget allocation and allows correction with masteries=%s",
    async (includeMasteries) => {
      const accept = vi.fn();
      const view = render(
        <DistributeStatsForm
          includeMasteries={includeMasteries}
          showWrapper={false}
          userData={trainee}
          availableStats={8000}
          onAccept={accept}
          isPending={false}
        />,
      );
      if (!includeMasteries)
        fireEvent.click(view.getByRole("button", { name: "Advanced" }));
      const offence = view.getByRole("spinbutton", {
        name: /^Offence/,
      }) as HTMLInputElement;
      await act(async () => {
        fireEvent.input(offence, { target: { value: "9000" } });
      });
      expect(offence.value).toBe("9000");
      await waitFor(() =>
        expect(
          view
            .getByRole("button", { name: "Remove 1,000 points" })
            .hasAttribute("disabled"),
        ).toBe(true),
      );
      expect(view.queryByText(/received NaN/)).toBeNull();
      await act(async () => {
        fireEvent.submit(view.container.querySelector("form")!);
      });
      expect(accept).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.input(offence, { target: { value: "7000" } });
      });
      fireEvent.click(view.getByRole("button", { name: "Assign points" }));
      await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
      expect(accept.mock.lastCall?.[0]).toMatchObject({ offence: 7000 });
    },
  );

  it.each([
    ["input", "cap"],
    ["slider", "cap"],
    ["input", "provided element"],
    ["slider", "provided element"],
  ] as const)(
    "keeps a stale %s allocation recoverable after a %s refresh",
    async (mode, change) => {
      localStorage.setItem(inputPreferenceKey, String(mode === "input"));
      const accept = vi.fn();
      const view = render(form(accept));
      const role = mode === "input" ? "spinbutton" : "slider";
      const lightning = view.getByRole(role, { name: /^Lightning/ });
      const offence = view.getByRole(role, { name: /^Offence/ });
      await act(async () => {
        if (mode === "input") {
          fireEvent.input(lightning, { target: { value: "1" } });
          fireEvent.input(offence, { target: { value: "10" } });
        } else {
          fireEvent.change(lightning, { target: { value: "1" } });
          fireEvent.change(offence, { target: { value: "10" } });
        }
        view.rerender(
          form(accept, {
            ...trainee,
            ...(change === "cap"
              ? { elementalMastery: { Lightning: ELEMENTAL_MASTERY_CAP } }
              : { primaryElement: "Lightning" }),
          }),
        );
      });
      const stale = view.getByRole(role, { name: /^Lightning/ });
      expect(
        (view.getByRole(role, { name: /^Offence/ }) as HTMLInputElement).value,
      ).toBe("10");
      expect((stale as HTMLInputElement).max).toBe(mode === "slider" ? "1" : "0");
      expect((stale as HTMLInputElement).value).toBe("1");
      fireEvent.submit(view.container.querySelector("form")!);
      await waitFor(() =>
        expect(view.queryAllByText(/Too big/).length).toBeGreaterThan(0),
      );
      expect(accept).not.toHaveBeenCalled();
      await act(async () => {
        if (mode === "input") fireEvent.input(stale, { target: { value: "0" } });
        else fireEvent.change(stale, { target: { value: "0" } });
      });
      expect(view.queryByRole(role, { name: /^Lightning/ })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Assign points" }));
      await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
      expect(accept.mock.lastCall?.[0]).toMatchObject({ offence: 10, Lightning: 0 });
    },
  );

  it("keeps an invalid input draft editable when its element becomes unavailable", async () => {
    const accept = vi.fn();
    const view = render(form(accept));
    await act(async () => {
      fireEvent.input(view.getByRole("spinbutton", { name: /^Lightning/ }), {
        target: { value: "" },
      });
      view.rerender(form(accept, { ...trainee, primaryElement: "Lightning" }));
    });
    const stale = view.getByRole("spinbutton", { name: /^Lightning/ });
    expect((stale as HTMLInputElement).value).toBe("");
    await act(async () => {
      fireEvent.input(stale, { target: { value: "0" } });
    });
    expect(view.queryByRole("spinbutton", { name: /^Lightning/ })).toBeNull();
    fireEvent.input(view.getByRole("spinbutton", { name: /^Offence/ }), {
      target: { value: "10" },
    });
    fireEvent.click(view.getByRole("button", { name: "Assign points" }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(accept.mock.lastCall?.[0]).toMatchObject({ offence: 10, Lightning: 0 });
  });

  it("keeps an invalid draft in an input when switching to sliders after an eligibility refresh", async () => {
    const accept = vi.fn();
    const view = render(form(accept));
    await act(async () => {
      fireEvent.input(view.getByRole("spinbutton", { name: /^Lightning/ }), {
        target: { value: "" },
      });
      view.rerender(form(accept, { ...trainee, primaryElement: "Lightning" }));
      fireEvent.click(view.getByRole("switch", { name: "Use input boxes" }));
    });
    expect(view.getByRole("slider", { name: /^Offence/ })).toBeTruthy();
    const stale = view.getByRole("spinbutton", { name: /^Lightning/ });
    expect((stale as HTMLInputElement).value).toBe("");
    await act(async () => {
      fireEvent.input(stale, { target: { value: "0" } });
    });
    expect(view.queryByRole("spinbutton", { name: /^Lightning/ })).toBeNull();
    fireEvent.change(view.getByRole("slider", { name: /^Offence/ }), {
      target: { value: "10" },
    });
    fireEvent.click(view.getByRole("button", { name: "Assign points" }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(accept.mock.lastCall?.[0]).toMatchObject({ offence: 10, Lightning: 0 });
  });

  it("allows another allocation after a successful elemental allocation reaches its cap", async () => {
    const accept = vi.fn(async (_data: Parameters<Accept>[0]) => true);
    const view = render(form(accept));
    fireEvent.input(view.getByRole("spinbutton", { name: /^Lightning/ }), {
      target: { value: "1" },
    });
    fireEvent.click(view.getByRole("button", { name: "Assign points" }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));

    view.rerender(
      form(accept, {
        ...trainee,
        earnedExperience: 4498,
        elementalMastery: { Lightning: ELEMENTAL_MASTERY_CAP },
      }),
    );
    expect(view.queryByRole("spinbutton", { name: /^Lightning/ })).toBeNull();
    fireEvent.input(view.getByRole("spinbutton", { name: /^Offence/ }), {
      target: { value: "10" },
    });
    fireEvent.click(view.getByRole("button", { name: "Assign points" }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(2));
    expect(accept.mock.lastCall?.[0]).toMatchObject({ offence: 10, Lightning: 0 });
  });

  it.each([false, undefined])(
    "retains the draft when submission returns %s",
    async (result) => {
      const accept = vi.fn(async () => result);
      const view = render(form(accept));
      fireEvent.input(view.getByRole("spinbutton", { name: /^Lightning/ }), {
        target: { value: "1" },
      });
      fireEvent.click(view.getByRole("button", { name: "Assign points" }));
      await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
      expect(
        (view.getByRole("spinbutton", { name: /^Lightning/ }) as HTMLInputElement)
          .value,
      ).toBe("1");
      expect(view.getByRole("button", { name: "Assign points" })).toBeTruthy();
    },
  );

  it("keeps a draft through an unrelated unused-XP update", async () => {
    const accept = vi.fn();
    const view = render(form(accept));
    await act(async () => {
      fireEvent.input(view.getByRole("spinbutton", { name: /^Offence/ }), {
        target: { value: "10" },
      });
      view.rerender(form(accept, { ...trainee, earnedExperience: 5000 }));
    });
    expect(
      (view.getByRole("spinbutton", { name: /^Offence/ }) as HTMLInputElement).value,
    ).toBe("10");
    expect(accept).not.toHaveBeenCalled();
  });
});
