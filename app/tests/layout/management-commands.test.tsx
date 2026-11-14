import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ShieldOff, Trash2, Zap } from "lucide-react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Loader from "@/layout/Loader";
import { ManagementCommands } from "@/layout/profileEdit/ManagementCommands";
import { cn } from "@/libs/shadui";
import { mockUserContextValue } from "../setup/userContext";

let pending: Record<string, boolean>;
const user = { userId: "owner", role: "OWNER" } as unknown as ComponentProps<
  typeof ManagementCommands
>["user"];

beforeEach(() => {
  pending = {};
  const mutation = (name: string) => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: !!pending[name] }),
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    misc: {
      getGlobalTavernEnabled: { useQuery: () => ({ data: true }) },
      toggleGlobalTavern: mutation("tavern"),
    },
    staff: {
      unequipAllGear: mutation("gear"),
      unequipAllJutsus: mutation("jutsus"),
      releaseSector: mutation("sector"),
    },
    profile: { awardExperienceToAll: mutation("experience") },
    skillTree: { resetAllUsersSkillPoints: mutation("skills") },
  });
  mockUserContextValue(
    () => ({ updateUser: vi.fn(), prepareUserUpdate: vi.fn() }) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The markup each command trigger is expected to render, built independently of the component. */
const expectedTrigger = (
  icon: typeof ShieldOff,
  label: string,
  isPending: boolean,
  variant: "destructive" | "default" = "destructive",
  className?: string,
) => {
  const Icon = icon;
  const { container, unmount } = render(
    // Confirm makes the button itself the dialog trigger.
    <Button
      aria-haspopup="dialog"
      variant={variant}
      disabled={isPending}
      className={cn("w-full", ["cursor-pointer", className].filter(Boolean).join(" "))}
    >
      {isPending ? (
        <Loader size={5} />
      ) : (
        <>
          <Icon className="mr-2 h-4 w-4" />
          {label}
        </>
      )}
    </Button>,
  );
  const html = container.innerHTML;
  unmount();
  return html;
};

const triggers = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll("button[aria-haspopup='dialog']")].map(
    (button) => button.outerHTML,
  );

it.each([
  [{}],
  [{ gear: true, experience: true }],
  [{ jutsus: true, skills: true, sector: true }],
])("renders the staff command triggers with pending state %j", (state) => {
  pending = state;
  const view = render(<ManagementCommands user={user} />);
  expect(triggers(view)).toEqual([
    expectedTrigger(ShieldOff, "Unequip All Gear", !!pending.gear),
    expectedTrigger(ShieldOff, "Unequip All Jutsus", !!pending.jutsus),
    expectedTrigger(Trash2, "Reset All Skill Trees", !!pending.skills),
    expectedTrigger(
      Zap,
      "Award Experience to All",
      !!pending.experience,
      "default",
      "w-full bg-green-500",
    ),
    expectedTrigger(Trash2, "Clear Sector", !!pending.sector),
  ]);
});
