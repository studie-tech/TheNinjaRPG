import { afterEach, describe, expect, it } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useNativeShell } from "@/hooks/useNativeShell";

const Probe = () => {
  const native = useNativeShell();
  return <span>{native === undefined ? "pending" : String(native)}</span>;
};

const capacitorWindow = window as typeof window & {
  Capacitor?: { isNativePlatform: () => boolean };
};

afterEach(() => {
  delete capacitorWindow.Capacitor;
});

describe("useNativeShell", () => {
  it("keeps server output unresolved instead of rendering the web alternative", () => {
    expect(renderToString(<Probe />)).toBe("<span>pending</span>");
  });

  it("resolves the native bridge after mount", async () => {
    capacitorWindow.Capacitor = { isNativePlatform: () => true };
    const { result } = renderHook(() => useNativeShell());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("resolves an ordinary browser after mount", async () => {
    const { result } = renderHook(() => useNativeShell());
    await waitFor(() => expect(result.current).toBe(false));
  });
});
