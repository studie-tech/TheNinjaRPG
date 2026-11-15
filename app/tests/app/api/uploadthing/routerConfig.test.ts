import { expect, it } from "bun:test";
import { extractRouterConfig } from "uploadthing/server";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import { UPLOAD_ROUTER_CONFIG } from "@/app/api/uploadthing/routerConfig";

it("hands the shell layout the configuration the file router declares", () => {
  expect(extractRouterConfig(ourFileRouter)).toEqual(UPLOAD_ROUTER_CONFIG);
});
