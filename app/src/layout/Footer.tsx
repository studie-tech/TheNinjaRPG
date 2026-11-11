import React from "react";
import Link from "@/layout/Link";
import { SITE_FOOTER_LINKS } from "@/libs/legalLinks";

/** Site links and legal lines; each frame sets the text colour for its own backdrop. */
interface FooterProps {
  /** "list" lays the links out as wrapped rows with touch-sized targets, for phones. */
  layout?: "inline" | "list";
}

const Footer: React.FC<FooterProps> = ({ layout = "inline" }) => {
  return (
    <div className="col-span-6 text-center" data-site-footer>
      {layout === "list" ? (
        <ul className="flex flex-wrap justify-center gap-x-2 text-sm" data-footer-links>
          {SITE_FOOTER_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                target={link.target}
                rel={link.target ? "noreferrer" : undefined}
                className="inline-flex min-h-[32px] items-center px-2 hover:text-gray-300"
                data-footer-link
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs" data-footer-links>
          {SITE_FOOTER_LINKS.map((link, index) => (
            <React.Fragment key={link.href}>
              {index > 0 && <span data-footer-separator> - </span>}
              <Link
                href={link.href}
                target={link.target}
                rel={link.target ? "noreferrer" : undefined}
                className="hover:text-gray-500"
                data-footer-link
              >
                {link.label}
              </Link>
            </React.Fragment>
          ))}
        </p>
      )}
      {/* A prerendered document carries the build's year; the client renders the real one. */}
      <p className="text-xs" data-footer-meta suppressHydrationWarning>
        TheNinja-RPG © by Studie-Tech ApS - 2005-{new Date().getFullYear()}
      </p>
      <p className="mb-7 text-xs" data-footer-address>
        Rådhusstræde 15 - 1466 København K - Denmark
        <span data-footer-contact-wrapper>
          {" - "}
          <a href="mailto:contact@theninja-rpg.com" data-footer-contact>
            Contact
          </a>
        </span>
      </p>
    </div>
  );
};

export default Footer;
