import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import {
  KAGE_CHALLENGER_DAILY_LIMIT,
  KAGE_DEFENSE_CHECK_IN_MINUTES,
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_DEFENSE_INSTANT_REQUEST_MINUTES,
  KAGE_PRESTIGE_COST,
} from "@/drizzle/constants";
import * as ContentBox from "@/layout/ContentBox";
import { KageDefense } from "@/layout/KageDefense";
import * as UserContext from "@/utils/UserContext";

const publish = vi.fn();
let hall: Record<string, unknown>;

beforeEach(() => {
  publish.mockClear();
  hall = {
    kageId: "kage",
    kage: { isAi: false },
    queue: [],
    history: [],
    setupDeadline: new Date("2031-03-20T12:00:00Z"),
    schedule: {
      publishedAt: null,
      windows: [],
      paused: false,
      instantChallenge: null,
      missedStarts: 0,
      predecessor: null,
      vacancy: null,
    },
  };
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ kage: { getDefenses: {} }, village: { get: {} } }),
    kage: new Proxy(
      {
        getDefenses: { useQuery: () => ({ isPending: false, data: { hall } }) },
        publishSchedule: { useMutation: () => ({ mutate: publish, isPending: false }) },
      },
      { get: (target, key) => (key in target ? target[key as never] : mutation) },
    ),
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    updateUser: vi.fn(),
    prepareUserUpdate: vi.fn(),
    timeDiff: 0,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const kage = { userId: "kage", villageId: "village", rank: "JONIN" } as never;
const select = (view: ReturnType<typeof render>, label: string) =>
  view.getByRole("combobox", { name: label }) as HTMLSelectElement;

describe("kage defense schedule editor", () => {
  it("starts from two default windows and publishes the edited schedule", () => {
    const view = render(<KageDefense user={kage} />);
    expect(select(view, "Defense day 1").value).toBe("1");
    expect(select(view, "Defense start time 1").value).toBe("12");
    expect(select(view, "Defense day 2").value).toBe("4");
    expect(view.queryByRole("button", { name: "Remove day 1" })).toBeNull();
    fireEvent.change(select(view, "Defense day 1"), { target: { value: "2" } });
    fireEvent.change(select(view, "Defense start time 2"), { target: { value: "8" } });
    fireEvent.click(view.getByRole("button", { name: "Add day" }));
    expect(select(view, "Defense day 3").value).toBe("0");
    fireEvent.click(view.getByRole("button", { name: "Remove day 1" }));
    fireEvent.click(view.getByRole("button", { name: "Publish schedule" }));
    expect(publish).toHaveBeenCalledWith({
      villageId: "village",
      windows: [
        { day: 4, hour: 8 },
        { day: 0, hour: 12 },
      ],
    });
  });

  it("keeps the editor from Kage-less viewers", () => {
    const view = render(
      <KageDefense user={{ userId: "visitor", villageId: "village" } as never} />,
    );
    expect(view.queryByRole("button", { name: "Publish schedule" })).toBeNull();
  });

  it.each([false, true])(
    "explains who starts the match when the Kage is AI: %s",
    (isAi) => {
      hall.kage = { isAi };
      const view = render(<KageDefense user={kage} />);
      const rules = view.getByText(
        new RegExp(`Challengers may fight ${KAGE_CHALLENGER_DAILY_LIMIT} time`),
      ).parentElement!;
      expect(rules.className).toBe(
        "space-y-2 border-t pt-3 text-muted-foreground text-sm",
      );
      expect(rules.children).toHaveLength(4);
      expect(rules.children[1]!.textContent).toContain(
        `${isAi ? "The challenger" : "The Kage"} starts at the appointed time with a ${KAGE_DEFENSE_GRACE_MINUTES}-minute grace period.`,
      );
      expect(rules.children[2]!.textContent).toContain(
        `after ${KAGE_DEFENSE_INSTANT_REQUEST_MINUTES} minutes`,
      );
      expect(rules.children[3]!.textContent).toContain(
        `${KAGE_PRESTIGE_COST.toLocaleString()} prestige`,
      );
    },
  );
});

describe("kage defense check-in window", () => {
  it("opens check-in when its boundary passes without a per-second clock", () => {
    const start = Date.UTC(2031, 2, 20, 12);
    vi.useFakeTimers();
    setSystemTime(start);
    try {
      const at = new Date(start + (KAGE_DEFENSE_CHECK_IN_MINUTES + 1) * 60_000);
      hall.queue = [
        {
          id: "match",
          challengerId: "challenger",
          username: "Challenger",
          scheduledAt: at,
          status: "SCHEDULED",
          checkedInAt: null,
          aiRequested: false,
          aiAccepted: false,
          hospitalDeferred: false,
          rescheduled: false,
        },
      ];
      const view = render(
        <KageDefense user={{ userId: "challenger", villageId: "village" } as never} />,
      );
      const checkIn = () => view.getByRole("button", { name: "Check in" });
      expect(checkIn().hasAttribute("disabled")).toBe(true);
      act(() => vi.advanceTimersByTime(30_000));
      expect(checkIn().hasAttribute("disabled")).toBe(true);
      act(() => vi.advanceTimersByTime(31_000));
      expect(checkIn().hasAttribute("disabled")).toBe(false);
    } finally {
      vi.useRealTimers();
      setSystemTime();
    }
  });
});
