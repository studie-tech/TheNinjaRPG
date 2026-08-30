/**
 * Low-level access to the Capacitor bridge.
 *
 * The native shell loads the production origin in a WKWebView / Android WebView and injects
 * `window.Capacitor` before page scripts run. The web bundle therefore talks to the bridge
 * through this module instead of depending on `@capacitor/*`: those packages are installed
 * in `mobile/package.json`, which is where `cap sync` has to find them to build the native
 * projects, and a second copy here would only give the two a chance to drift apart.
 *
 * Nothing outside `libs/native/` should import this file — see the `useNative*` hooks and
 * the feature modules alongside it for the call-site API.
 */

type PluginMethod = (options?: Record<string, unknown>) => Promise<unknown>;

interface PluginListenerHandle {
  remove: () => Promise<void>;
}

type PluginListener = (
  eventName: string,
  callback: (data: unknown) => void,
) => Promise<PluginListenerHandle> | PluginListenerHandle;

/** Plugin surfaces are shaped by the shell, so members are narrowed at the call site. */
interface CapacitorPlugin {
  [member: string]: unknown;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, CapacitorPlugin | undefined>;
}

/** Thrown when a plugin call is made that the shell cannot service. */
export class NativeBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeBridgeError";
  }
}

const getBridge = (): CapacitorBridge | undefined => {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { Capacitor?: CapacitorBridge }).Capacitor;
};

const getPlugin = (name: string): CapacitorPlugin | undefined =>
  getBridge()?.Plugins?.[name];

/** True only inside the native shell; false on the web and during SSR. */
export const isNative = (): boolean => getBridge()?.isNativePlatform?.() === true;

/**
 * Which platform the page is running on, according to the shell. Always `"web"` during
 * SSR and in a browser. This is the only reliable source — plugin events do not carry it.
 */
export const getPlatform = (): "ios" | "android" | "web" => {
  const reported = getBridge()?.getPlatform?.();
  return reported === "ios" || reported === "android" ? reported : "web";
};

/** Whether the shell exposes a given plugin. Useful for progressive rollout of a new build. */
export const hasPlugin = (name: string): boolean =>
  isNative() && getPlugin(name) !== undefined;

/**
 * Call a plugin method, rejecting if the bridge, the plugin or the method is missing.
 * Use for calls whose failure the caller must handle — registering for push, signing in.
 */
export const invoke = async <T>(
  pluginName: string,
  method: string,
  options?: Record<string, unknown>,
): Promise<T> => {
  if (!isNative()) {
    throw new NativeBridgeError("Not running inside the native shell");
  }
  const plugin = getPlugin(pluginName);
  const fn = plugin?.[method];
  if (typeof fn !== "function") {
    throw new NativeBridgeError(`${pluginName}.${method} is unavailable in this build`);
  }
  return (await (fn as PluginMethod).call(plugin, options)) as T;
};

/**
 * Fire-and-forget variant that resolves to `undefined` instead of rejecting. Use for
 * cosmetic calls — haptics, widget refreshes — where an older shell simply does nothing.
 */
export const invokeSafe = async <T>(
  pluginName: string,
  method: string,
  options?: Record<string, unknown>,
): Promise<T | undefined> => {
  try {
    return await invoke<T>(pluginName, method, options);
  } catch {
    return undefined;
  }
};

/**
 * Subscribe to a plugin event. Returns an unsubscribe function that is safe to call even
 * when the listener was never attached, so effects can return it unconditionally.
 */
export const addNativeListener = (
  pluginName: string,
  eventName: string,
  callback: (data: unknown) => void,
): (() => void) => {
  const plugin = getPlugin(pluginName);
  const listen = plugin?.addListener;
  if (!isNative() || typeof listen !== "function") {
    return () => undefined;
  }
  let handle: PluginListenerHandle | undefined;
  let cancelled = false;
  void Promise.resolve(
    (listen as PluginListener).call(plugin, eventName, callback),
  ).then((resolved) => {
    if (cancelled) {
      void resolved.remove();
      return;
    }
    handle = resolved;
  });
  return () => {
    cancelled = true;
    void handle?.remove();
  };
};
