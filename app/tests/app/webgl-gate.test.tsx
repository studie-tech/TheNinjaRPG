import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LoginUser from "@/app/[shell]/login/[[...rest]]/page";
import SignupUser from "@/app/[shell]/signup/[[...rest]]/page";
import * as NativeSignIn from "@/components/native/NativeSignIn";
import * as NativeShell from "@/hooks/useNativeShell";
import * as ContentBox from "@/layout/ContentBox";
import * as routing from "@/utils/routing";

/** Answer canvas context requests as a browser offering only these WebGL versions would. */
const offerContexts = (...offered: string[]) =>
  vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(((type: string) =>
      offered.includes(type) ? ({} as RenderingContext) : null) as never);

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
    (offered) => {
      offerContexts(...offered);
      render(<SignupUser />);
      expect(screen.getByText("Clerk sign up")).toBeTruthy();
      cleanup();
      render(<LoginUser />);
      expect(screen.getByText("Clerk sign in")).toBeTruthy();
      expect(screen.queryByText("WebGL Not Available")).toBeNull();
    },
  );

  it("blocks signup without WebGL and explains why instead of offering a futile refresh", () => {
    offerContexts();
    render(<SignupUser />);
    expect(screen.queryByText("Clerk sign up")).toBeNull();
    expect(screen.getByText("WebGL is required to play this game")).toBeTruthy();
    expect(screen.getByText("This browser cannot run the game")).toBeTruthy();
    expect(screen.queryByText("Error loading the game renderer.")).toBeNull();
  });

  it("keeps Proceed Anyway on login so existing accounts are never locked out", () => {
    offerContexts();
    render(<LoginUser />);
    expect(screen.queryByText("Clerk sign in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Proceed Anyway" }));
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
