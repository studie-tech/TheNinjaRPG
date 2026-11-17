import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginUser from "@/app/[shell]/login/[[...rest]]/page";
import SignupUser from "@/app/[shell]/signup/[[...rest]]/page";
import * as NativeSignIn from "@/components/native/NativeSignIn";
import * as NativeShell from "@/hooks/useNativeShell";
import * as ContentBox from "@/layout/ContentBox";
import * as routing from "@/utils/routing";

/**
 * Answer canvas context requests as a browser offering only these WebGL versions would.
 * Returns the spy that releases a granted context.
 */
const offerContexts = (...offered: string[]) => {
  const loseContext = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    type: string,
  ) =>
    offered.includes(type)
      ? {
          getExtension: (name: string) =>
            name === "WEBGL_lose_context" ? { loseContext } : null,
        }
      : null) as never);
  return loseContext;
};

beforeEach(() => {
  vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(false);
  vi.spyOn(NativeSignIn, "default").mockImplementation(() => null);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/signup");
  vi.spyOn(clerk, "SignIn").mockImplementation((() => <p>Clerk sign in</p>) as never);
  vi.spyOn(clerk, "SignUp").mockImplementation((() => <p>Clerk sign up</p>) as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ title, subtitle, children }) => (
      <div>
        <h1>{title}</h1>
        <h2>{subtitle}</h2>
        {children}
      </div>
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WebGL entry gate", () => {
  it.each([[["webgl"]], [["webgl2"]], [["webgl", "webgl2"]]])(
    "lets a browser offering %j sign up and log in without a warning",
    async (offered) => {
      const loseContext = offerContexts(...offered);
      render(<SignupUser />);
      expect(screen.getByText("Clerk sign up")).toBeTruthy();
      // The probe runs after the page renders and releases its context at once.
      await waitFor(() => expect(loseContext).toHaveBeenCalledTimes(1));
      cleanup();
      render(<LoginUser />);
      await waitFor(() => expect(loseContext).toHaveBeenCalledTimes(2));
      expect(screen.getByText("Clerk sign in")).toBeTruthy();
      expect(screen.queryByText("WebGL Not Available")).toBeNull();
    },
  );

  it("blocks signup without WebGL and explains why instead of offering a futile refresh", async () => {
    offerContexts();
    render(<SignupUser />);
    expect(await screen.findByText("WebGL is required to play this game")).toBeTruthy();
    expect(screen.queryByText("Clerk sign up")).toBeNull();
    expect(screen.getByText("This browser cannot run the game")).toBeTruthy();
    expect(screen.queryByText("Error loading the game renderer.")).toBeNull();
  });

  it("keeps Proceed Anyway on login so existing accounts are never locked out", async () => {
    offerContexts();
    render(<LoginUser />);
    const proceed = await screen.findByRole("button", { name: "Proceed Anyway" });
    expect(screen.queryByText("Clerk sign in")).toBeNull();
    fireEvent.click(proceed);
    expect(screen.getByText("Clerk sign in")).toBeTruthy();
    expect(screen.getByText("WebGL Not Available")).toBeTruthy();
  });

  it("prerenders the page heading with a card placeholder until the shell is known", () => {
    offerContexts("webgl");
    vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(undefined);
    render(<SignupUser />);
    expect(screen.getByText("Create Account")).toBeTruthy();
    expect(screen.queryByText("Clerk sign up")).toBeNull();
    cleanup();
    render(<LoginUser />);
    expect(screen.getByText("Login")).toBeTruthy();
    expect(screen.queryByText("Clerk sign in")).toBeNull();
  });
});
