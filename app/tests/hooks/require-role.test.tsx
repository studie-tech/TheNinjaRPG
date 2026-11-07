import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { canChangeContent } from "@/utils/permissions";
import * as UserContext from "@/utils/UserContext";

const push = vi.fn();

const setRole = (role: string | undefined) => {
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: role ? { role } : undefined,
  } as never);
};

const Gate = ({ redirectTo }: { redirectTo?: string }) => {
  const { userData, hasAccess } = useRequireRole(canChangeContent, redirectTo);
  if (!userData || !hasAccess) return <p>loader</p>;
  return <p>editor</p>;
};

beforeEach(() => {
  push.mockClear();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useRequireRole", () => {
  it("waits for the character without redirecting or rendering gated content", () => {
    setRole(undefined);
    const view = render(<Gate />);
    expect(view.getByText("loader")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects a denied role to the profile by default and never renders gated content", () => {
    setRole("USER");
    const view = render(<Gate />);
    expect(view.queryByText("editor")).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/profile");
  });

  it("keeps a caller's own redirect target", () => {
    setRole("USER");
    render(<Gate redirectTo="/manual/jutsu/reskins" />);
    expect(push).toHaveBeenCalledWith("/manual/jutsu/reskins");
  });

  it("renders gated content for an allowed role without redirecting", () => {
    setRole("CONTENT-ADMIN");
    const view = render(<Gate />);
    expect(view.getByText("editor")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
