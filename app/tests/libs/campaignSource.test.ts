import { afterEach, describe, expect, it } from "bun:test";
import { readCampaignSource, storeCampaignSource } from "@/libs/campaignSource";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

const setConsent = (statistics: boolean, hasResponse = true) => {
  window.Cookiebot = { consent: { statistics }, hasResponse };
};

afterEach(() => {
  delete window.Cookiebot;
  window.localStorage.clear();
});

describe("campaign source storage", () => {
  it("is not stored without statistics consent", () => {
    storeCampaignSource("reddit");
    expect(window.localStorage.getItem("utm_source")).toBeNull();
  });

  it("is stored and read back with statistics consent", () => {
    setConsent(true);
    storeCampaignSource("reddit");
    expect(readCampaignSource()).toBe("reddit");
  });

  it("is deleted once the visitor withdraws consent", () => {
    setConsent(true);
    storeCampaignSource("reddit");
    setConsent(false);
    expect(readCampaignSource()).toBeUndefined();
    expect(window.localStorage.getItem("utm_source")).toBeNull();
  });

  it("is kept, but not read, while Cookiebot has no answer yet", () => {
    setConsent(true);
    storeCampaignSource("reddit");
    delete window.Cookiebot;
    expect(readCampaignSource()).toBeUndefined();
    expect(window.localStorage.getItem("utm_source")).toBe("reddit");
  });
});
