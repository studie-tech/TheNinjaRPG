import * as clerk from "@clerk/nextjs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { type NativeAuthResult, useNativeAuth } from "@/hooks/useNativeAuth";
import { useGlobalOnMutateProtect } from "@/app/_trpc/client";
import * as handoff from "@/hooks/useNativeAuthHandoff";
import * as native from "@/libs/native";
import { appEvents, oauthBrowser } from "@/libs/native";
import { nativeAuthChallenge } from "@/server/utils/nativeAuth";

const flowId = "a".repeat(43);
const code = "c".repeat(43);
const callback = `tnr://oauth-callback?flow=${flowId}&code=${code}`;
let onUrl: (url: string) => void;
let onFinished: () => void;
const mocks = {
  create: vi.fn(), start: vi.fn(), exchange: vi.fn(), setActive: vi.fn(),
  getState: vi.fn(), open: vi.fn(), close: vi.fn(), stopUrl: vi.fn(), stopFinished: vi.fn(),
};
let session: { id: string } | undefined;
let onState: (isActive: boolean) => void;
let shellActive = true;

beforeEach(() => {
  vi.clearAllMocks();
  session = undefined;
  shellActive = true;
  onState = () => {};
  vi.spyOn(native, "platform").mockReturnValue("android");
  mocks.create.mockReset().mockResolvedValue({ createdSessionId: "session-native" });
  mocks.start.mockReset().mockResolvedValue({ flowId });
  mocks.exchange.mockReset().mockResolvedValue({ ticket: "single-use-ticket" });
  mocks.setActive.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.open.mockReset().mockImplementation(async () => onUrl(callback));
  vi.spyOn(native, "isNative").mockReturnValue(true);
  vi.spyOn(handoff, "useNativeAuthHandoff").mockReturnValue({ start: mocks.start, exchange: mocks.exchange });
  vi.spyOn(clerk, "useClerk").mockReturnValue({
    client: { signIn: { create: mocks.create } },
    get session() { return session; },
    setActive: mocks.setActive,
  } as unknown as ReturnType<typeof clerk.useClerk>);
  mocks.getState.mockReset().mockImplementation(async () => ({ isActive: shellActive }));
  vi.spyOn(appEvents, "getState").mockImplementation(mocks.getState);
  vi.spyOn(appEvents, "onStateChange").mockImplementation((callback) => { onState = callback; return () => {}; });
  vi.spyOn(appEvents, "onUrlOpen").mockImplementation((callback) => { onUrl = callback; return mocks.stopUrl; });
  vi.spyOn(oauthBrowser, "onFinished").mockImplementation((callback) => { onFinished = callback; return mocks.stopFinished; });
  vi.spyOn(oauthBrowser, "open").mockImplementation(mocks.open);
  vi.spyOn(oauthBrowser, "close").mockImplementation(mocks.close);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const signIn = async () => {
  const { result } = renderHook(() => useNativeAuth());
  let outcome: NativeAuthResult | undefined;
  await act(async () => { outcome = await result.current.signInWithProvider("google"); });
  expect(result.current.isPending).toBe(false);
  expect(mocks.stopUrl).toHaveBeenCalledTimes(1);
  expect(mocks.stopFinished).toHaveBeenCalledTimes(1);
  return outcome;
};

describe("native browser-to-shell authentication", () => {
  it("allows handoff requests before login while guarding character mutations", () => {
    const { result } = renderHook(() => useGlobalOnMutateProtect());
    expect(() => result.current("nativeAuth.start")).not.toThrow();
    expect(() => result.current("nativeAuth.exchange")).not.toThrow();
    expect(() => result.current("profile.updatePreferences")).toThrow("signed in");
    expect(() => result.current("nativeAuth.approve")).toThrow("signed in");
  });
  it("keeps the verifier/ticket out of the browser and binds the proof before activating a shell session", async () => {
    expect(await signIn()).toEqual({ status: "complete" });
    const opened = new URL(mocks.open.mock.calls[0]?.[0]);
    expect(opened.origin).toBe(window.location.origin);
    expect(opened.pathname).toBe("/native-sign-in");
    expect([...opened.searchParams.keys()]).toEqual(["flow"]);
    const proof = mocks.exchange.mock.calls[0]?.[0];
    expect(proof.flowId).toBe(flowId);
    expect(proof.code).toBe(code);
    expect(nativeAuthChallenge(proof.verifier)).toBe(mocks.start.mock.calls[0]?.[0].challenge);
    expect(mocks.create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "single-use-ticket" });
    expect(mocks.setActive).toHaveBeenCalledWith({ session: "session-native" });
  });

  it("settles a callback arriving after the browser-finished event", async () => {
    mocks.open.mockImplementation(async () => { onFinished(); setTimeout(() => onUrl(callback), 20); });
    expect(await signIn()).toEqual({ status: "complete" });
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });

  it("does not authenticate a cancelled browser and permits retry", async () => {
    mocks.open.mockImplementationOnce(async () => onFinished());
    expect(await signIn()).toEqual({ status: "cancelled" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.setActive).not.toHaveBeenCalled();
    mocks.stopUrl.mockClear(); mocks.stopFinished.mockClear();
    expect(await signIn()).toEqual({ status: "complete" });
  });

  it.each([
    `tnr://oauth-callback.evil.example?flow=${flowId}`,
    `tnr://oauth-callback/other?flow=${flowId}`,
    `https://oauth-callback?flow=${flowId}`,
    `tnr://owner@oauth-callback?flow=${flowId}`,
    `tnr://oauth-callback:123?flow=${flowId}`,
    `tnr://oauth-callback?flow=${"b".repeat(43)}&code=${code}`,
    `tnr://oauth-callback?flow=${flowId}`,
    "tnr://oauth-callback?rotating_token_nonce=old-attempt",
  ])("ignores unrelated or stale callbacks: %s", async (url) => {
    mocks.open.mockImplementation(async () => { onUrl(url); expect(mocks.exchange).not.toHaveBeenCalled(); onUrl(callback); });
    expect(await signIn()).toEqual({ status: "complete" });
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });

  it("reports a failed exchange and never attempts a ticket sign-in", async () => {
    mocks.exchange.mockRejectedValue(new Error("Sign-in expired"));
    expect(await signIn()).toEqual({ status: "error", message: "Sign-in expired" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("does not overwrite a different app session established during the handoff", async () => {
    mocks.exchange.mockImplementation(async () => { session = { id: "other-account" }; return { ticket: "ticket" }; });
    expect(await signIn()).toEqual({ status: "cancelled" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not activate over an account changed while the ticket request was in flight", async () => {
    mocks.create.mockImplementation(async () => {
      session = { id: "other-account" };
      return { createdSessionId: "session-native" };
    });
    expect(await signIn()).toEqual({ status: "cancelled" });
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("cancels on unmount without signing in after the browser returns", async () => {
    const hook = renderHook(() => useNativeAuth());
    mocks.open.mockImplementation(async () => hook.unmount());
    let outcome: NativeAuthResult | undefined;
    await act(async () => { outcome = await hook.result.current.signInWithProvider("google"); });
    expect(outcome).toEqual({ status: "cancelled" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.stopUrl).toHaveBeenCalledTimes(1);
  });
});

describe("browser authentication App Link continuations", () => {
  const continuation = () => `${window.location.origin}/native-sign-in?flow=${flowId}&step=callback`;
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  const grace = () => new Promise<void>((resolve) => setTimeout(resolve, 2050));
  const exercise = async (run: () => Promise<void>) => {
    const { promise: initialOpen, resolve: opened } = Promise.withResolvers<void>();
    mocks.open.mockImplementation(async () => { opened(); });
    const { result } = renderHook(() => useNativeAuth());
    let outcome: NativeAuthResult | undefined;
    await act(async () => {
      const pending = result.current.signInWithProvider("google");
      await initialOpen;
      await run();
      outcome = await pending;
    });
    expect(result.current.isPending).toBe(false);
    return outcome;
  };

  it("waits for shell resume, reopens in the browser and ignores the old tab closing", async () => {
    expect(await exercise(async () => {
      shellActive = false; onState(false); onFinished(); onUrl(continuation());
      await flush();
      expect(mocks.open).toHaveBeenCalledTimes(1);
      shellActive = true; onState(true); await flush();
      expect(mocks.open).toHaveBeenCalledTimes(2);
      expect(mocks.open).toHaveBeenLastCalledWith(continuation());
      shellActive = false; onState(false); onFinished(); await grace();
      expect(mocks.exchange).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      onUrl(callback);
    })).toEqual({ status: "complete" });
    expect(nativeAuthChallenge(mocks.exchange.mock.calls[0]?.[0].verifier)).toBe(mocks.start.mock.calls[0]?.[0].challenge);
  });

  it("permits immediate cancellation of the replacement browser and a fresh retry", async () => {
    expect(await exercise(async () => {
      onUrl(continuation()); await flush();
      expect(mocks.open).toHaveBeenCalledTimes(2);
      onFinished(); shellActive = true; onState(true);
    })).toEqual({ status: "cancelled" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    mocks.stopUrl.mockClear(); mocks.stopFinished.mockClear();
    mocks.open.mockImplementation(async () => onUrl(callback));
    expect(await signIn()).toEqual({ status: "complete" });
  });

  it("invalidates an in-flight dismissal check when a continuation arrives", async () => {
    expect(await exercise(async () => {
      let finishCheck: (state: { isActive: boolean }) => void = () => {};
      const { promise: started, resolve: checkStarted } = Promise.withResolvers<void>();
      mocks.getState.mockImplementationOnce(() => new Promise((resolve) => { finishCheck = resolve; checkStarted(); }));
      onFinished(); await started;
      onUrl(continuation()); await flush();
      expect(mocks.open).toHaveBeenCalledTimes(2);
      finishCheck({ isActive: true }); await flush(); onUrl(callback);
    })).toEqual({ status: "complete" });
  });

  it("settles on shell return if dismissal occurred while backgrounded", async () => {
    expect(await exercise(async () => {
      shellActive = false; onFinished(); await grace();
      shellActive = true; onState(true);
    })).toEqual({ status: "cancelled" });
  }, 6000);

  it("rejects stale/foreign continuations and suppresses duplicate browser opens", async () => {
    expect(await exercise(async () => {
      for (const url of [
        `https://other.example/native-sign-in?flow=${flowId}`,
        `${window.location.origin}/native-sign-in/other?flow=${flowId}`,
        `${window.location.origin}/native-sign-in?flow=${"b".repeat(43)}`,
        `${window.location.origin}/native-sign-in?flow=${flowId}&flow=${flowId}`,
      ]) onUrl(url);
      await flush(); expect(mocks.open).toHaveBeenCalledTimes(1);
      onUrl(continuation()); onUrl(continuation()); await flush();
      expect(mocks.open).toHaveBeenCalledTimes(2); onUrl(callback);
    })).toEqual({ status: "complete" });
  });

  it("keeps iOS Safari open across foreground returns and never reopens its existing sheet", async () => {
    vi.spyOn(native, "platform").mockReturnValue("ios");
    expect(await exercise(async () => {
      onState(false); onState(true); onUrl(continuation()); await grace();
      expect(mocks.open).toHaveBeenCalledTimes(1);
      expect(mocks.close).not.toHaveBeenCalled();
      expect(mocks.getState).not.toHaveBeenCalled();
      expect(appEvents.onStateChange).not.toHaveBeenCalled();
      onUrl(callback);
    })).toEqual({ status: "complete" });
  });

  it("settles iOS cancellation from browserFinished without an app-state query", async () => {
    vi.spyOn(native, "platform").mockReturnValue("ios");
    expect(await exercise(async () => { onFinished(); })).toEqual({ status: "cancelled" });
    expect(mocks.getState).not.toHaveBeenCalled();
  });

  it("cleans up failed continuation opens without authenticating", async () => {
    expect(await exercise(async () => {
      mocks.open.mockRejectedValueOnce(new Error("Unable to display URL"));
      onUrl(continuation());
    })).toEqual({ status: "cancelled" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
