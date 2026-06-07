export interface LegalLink {
  href: string;
  label: string;
  target?: "_blank";
}

export const LEGAL_LINKS: LegalLink[] = [
  {
    href: "https://app.termly.io/document/terms-of-service/71d95c2f-d6eb-4e3c-b480-9f0b9bb87830",
    label: "Terms of Service",
    target: "_blank",
  },
  {
    href: "https://app.termly.io/document/privacy-policy/9fea0bba-1061-47c0-8f28-0f724f06cc0e",
    label: "Privacy Policy",
    target: "_blank",
  },
  {
    href: "https://app.termly.io/document/cookie-policy/971fe8a9-3613-41a0-86ad-8e08e7be93d7",
    label: "Cookie Policy",
    target: "_blank",
  },
  { href: "/consent", label: "Cookie Consent" },
];

export const SITE_FOOTER_LINKS: LegalLink[] = [
  ...LEGAL_LINKS,
  { href: "/rules", label: "Rules" },
  { href: "/manual/staff", label: "Staff" },
];
