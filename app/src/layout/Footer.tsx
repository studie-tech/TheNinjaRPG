import React from "react";
import Link from "@/layout/Link";
import { SITE_FOOTER_LINKS } from "@/libs/legalLinks";

/** Site links and legal lines; each frame sets the text colour for its own backdrop. */
const Footer: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const contactLink = (
    <a href="mailto:contact@theninja-rpg.com" data-footer-contact>
      Contact
    </a>
  );
  const companyInfo = (
    <>
      {/* A prerendered document carries the build's year; the client renders the real one. */}
      <p className="text-xs" data-footer-meta suppressHydrationWarning>
        TheNinja-RPG © by Studie-Tech ApS - 2005-{new Date().getFullYear()}
      </p>
      <p className="mb-7 text-xs" data-footer-address>
        Rådhusstræde 15 - 1466 København K - Denmark
        {!compact && (
          <span data-footer-contact-wrapper>
            <span data-footer-separator> - </span>
            {contactLink}
          </span>
        )}
      </p>
    </>
  );
  return (
    <div className="col-span-6 text-center" data-site-footer>
      <p className="text-xs" data-footer-links>
        {SITE_FOOTER_LINKS.map((link, index) => (
          <React.Fragment key={link.href}>
            {index > 0 && <span data-footer-separator> - </span>}
            <Link
              href={link.href}
              target={link.target}
              rel={link.target ? "noreferrer" : undefined}
              aria-label={link.label}
              title={compact ? link.label : undefined}
              className="hover:text-gray-500"
              data-footer-link
            >
              {compact && link.href === "/consent" ? "Consent" : link.label}
            </Link>
          </React.Fragment>
        ))}
        {compact && contactLink}
      </p>
      {compact ? (
        <details data-footer-details>
          <summary>About TheNinja-RPG</summary>
          {companyInfo}
        </details>
      ) : (
        companyInfo
      )}
    </div>
  );
};

export default Footer;
