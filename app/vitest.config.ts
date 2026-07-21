import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Vite transpiles JSX/TSX through esbuild in tests. Loading the React dev
  // plugin here is unnecessary and couples Vitest to that plugin's Vite peer
  // version (currently Vite 8 while this project intentionally uses Vite 7).
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
  },
});
