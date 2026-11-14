import { afterEach, describe, expect, it } from "bun:test";
import {
  clearAdClick,
  hasWithdrawnAdClickFor,
  markAdClickLinked,
  readCampaignSource,
  readLandingAdClick,
  readMarketingConsent,
  readStoredAdClick,
  recordAdClickWithdrawn,
  storeAdClick,
  storeCampaignSource,
} from "@/libs/campaignSource";

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

describe("marketing consent for ad clicks", () => {
  it("is declined until Cookiebot has loaded the stored choice", () => {
    expect(readMarketingConsent()).toBe("declined");
  });

  it("is unanswered while the loaded dialog has no answer", () => {
    window.Cookiebot = { consent: { marketing: false }, hasResponse: false };
    expect(readMarketingConsent()).toBe("unanswered");
  });

  it("follows the visitor's answer", () => {
    window.Cookiebot = { consent: { marketing: true }, hasResponse: true };
    expect(readMarketingConsent()).toBe("granted");
    window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
    expect(readMarketingConsent()).toBe("declined");
  });
});

describe("ad click on the device", () => {
  it("reads the first Google Ads click identifier from the landing URL", () => {
    expect(readLandingAdClick(new URLSearchParams("wbraid=w1&gclid=g1"))).toEqual({
      clickId: "g1",
      clickIdType: "gclid",
    });
    expect(readLandingAdClick(new URLSearchParams("gbraid=b1"))).toEqual({
      clickId: "b1",
      clickIdType: "gbraid",
    });
    expect(readLandingAdClick(new URLSearchParams("utm_source=x"))).toBeUndefined();
  });

  it("is kept until registration links it or consent is withdrawn", () => {
    storeAdClick("Cj0KCQiA-click");
    expect(readStoredAdClick()).toBe("Cj0KCQiA-click");
    clearAdClick();
    expect(readStoredAdClick()).toBeUndefined();
    storeAdClick("Cj0KCQiA-click");
    markAdClickLinked();
    expect(readStoredAdClick()).toBeUndefined();
  });

  it("remembers one account's withdrawal until registration links a new click", () => {
    expect(hasWithdrawnAdClickFor("player-a")).toBe(false);
    recordAdClickWithdrawn("player-a");
    expect(hasWithdrawnAdClickFor("player-a")).toBe(true);
    expect(hasWithdrawnAdClickFor("player-b")).toBe(false);
    expect(hasWithdrawnAdClickFor(undefined)).toBe(false);
    clearAdClick();
    expect(hasWithdrawnAdClickFor("player-a")).toBe(true);
    markAdClickLinked();
    expect(hasWithdrawnAdClickFor("player-a")).toBe(false);
  });
});
