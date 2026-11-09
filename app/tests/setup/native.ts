export type CapacitorBridge = {
  getPlatform: () => string;
  isNativePlatform: () => boolean;
  Plugins: Record<string, Record<string, unknown>>;
};

export const capacitorWindow = window as typeof window & {
  Capacitor?: CapacitorBridge;
};

/** Put a native shell on the preloaded window; pair with `removeCapacitor` in `afterEach`. */
export const installCapacitor = (
  plugins: CapacitorBridge["Plugins"],
  platform = "ios",
) => {
  capacitorWindow.Capacitor = {
    getPlatform: () => platform,
    isNativePlatform: () => true,
    Plugins: plugins,
  };
};

export const removeCapacitor = () => {
  delete capacitorWindow.Capacitor;
};
