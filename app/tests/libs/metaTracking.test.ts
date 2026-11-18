import { afterEach, beforeEach, expect, it } from "bun:test";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import { clearMetaClick, readMetaConsent, readMetaTracking } from "@/libs/metaTracking";

const decide = (granted: boolean, revision = CONSENT_REVISION) => {
  window.Cookiebot = { consent: { marketing: granted }, hasResponse: true };
  document.cookie = `tnr_consent=${encodeURIComponent(JSON.stringify({ consentId: "11f90b37-6015-4361-8c51-fbfcccb92b43", categories: granted ? ["necessary", "marketing"] : ["necessary"], revision, consentTimestamp: new Date(Date.now() - 1000).toISOString() }))}; path=/`;
};
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  delete window.Cookiebot;
  for (const name of ["tnr_consent", "_fbp", "_fbc"])
    document.cookie = `${name}=; Max-Age=0; path=/`;
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

it("retains no click before explicit consent or for an obsolete policy revision", () => {
  expect(readMetaTracking()).toBeUndefined();
  decide(false);
  expect(readMetaTracking()).toBeUndefined();
  decide(true, CONSENT_REVISION - 1);
  expect(readMetaTracking()).toBeUndefined();
  expect(localStorage.length).toBe(0);
});

it("does not invent a click ID when no Facebook click was received", () => {
  decide(true);
  const tracking = readMetaTracking();
  expect(tracking?.fbc).toBeUndefined();
  expect(tracking?.fbp).toBeUndefined();
});

it("persists a real landing click with its original timestamp across routes", () => {
  decide(true);
  window.history.replaceState({}, "", "/?fbclid=Real_Mixed-Case-Click");
  const first = readMetaTracking();
  const stored = localStorage.getItem("tnr_meta_click");
  expect(first?.fbc).toMatch(/^fb\.1\.\d{13}\.Real_Mixed-Case-Click$/);
  expect(readMetaTracking()?.fbc).toBe(first?.fbc);
  expect(localStorage.getItem("tnr_meta_click")).toBe(stored);
  window.history.replaceState({}, "", "/register");
  expect(readMetaTracking()?.fbc).toBe(first?.fbc);
});

it("reads consented Meta cookies verbatim and clears local attribution on withdrawal", () => {
  decide(true);
  document.cookie = "_fbc=fb.1.1794993604000.Mixed_CASE-click; path=/";
  document.cookie = "_fbp=fb.1.1794993604000.12345; path=/";
  expect(readMetaTracking()?.fbc).toBe("fb.1.1794993604000.Mixed_CASE-click");
  expect(readMetaTracking()?.fbp).toBe("fb.1.1794993604000.12345");
  localStorage.setItem("tnr_meta_click", "private");
  decide(false);
  expect(readMetaConsent()?.granted).toBe(false);
  expect(readMetaTracking()).toBeUndefined();
  clearMetaClick();
  expect(localStorage.getItem("tnr_meta_click")).toBeNull();
});
