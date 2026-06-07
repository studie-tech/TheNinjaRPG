import Link from "next/link";
import React from "react";
import { SITE_FOOTER_LINKS } from "@/libs/legalLinks";

const Footer: React.FC = () => {
  return (
    <div className="col-span-6 text-center text-white" data-site-footer>
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
      <p className="text-xs" data-footer-meta>
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
