import { useCallback } from "react";
import { buildData } from "@/standalone/shurikenSiege/build";

/** Stands in for the app's catalog loader: the catalog ships with the build. */
export const useLpcCatalogLoader = () =>
  useCallback(() => Promise.resolve(buildData().lpcCatalog), []);
