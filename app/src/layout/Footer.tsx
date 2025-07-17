import React from "react";
import Link from "next/link";

const Footer: React.FC = () => {
  return (
    <div className="col-span-6 text-center text-white">
      <p className="text-xs">
        <Link
          href="https://app.termly.io/document/terms-of-service/71d95c2f-d6eb-4e3c-b480-9f0b9bb87830"
          target="_blank"
          className="hover:text-gray-500"
        >
          ToS
        </Link>{" "}
        -{" "}
        <Link
          href="https://app.termly.io/document/privacy-policy/9fea0bba-1061-47c0-8f28-0f724f06cc0e"
          target="_blank"
          className="hover:text-gray-500"
        >
          Privacy
        </Link>{" "}
        - Cookie{" "}
        <Link
          href="https://app.termly.io/document/cookie-policy/971fe8a9-3613-41a0-86ad-8e08e7be93d7"
          target="_blank"
          className="hover:text-gray-500"
        >
          Policy
        </Link>
        {" / "}
        <Link href="/consent" className="hover:text-gray-500">
          Consent
        </Link>{" "}
        -{" "}
        <Link href="/rules" className="hover:text-gray-500">
          Rules
        </Link>{" "}
        -{" "}
        <Link href="/staff" className="hover:text-gray-500">
          Staff
        </Link>
      </p>
      <p className="text-xs">
        TheNinja-RPG © by Studie-Tech ApS - 2005-{new Date().getFullYear()}
      </p>
      <p className="mb-7 text-xs">
        Hindegade 6 - 1303 København K - Denmark -{" "}
        <a href="mailto:contact@theninja-rpg.com">Contact</a>
      </p>
    </div>
  );
};

export default Footer;
