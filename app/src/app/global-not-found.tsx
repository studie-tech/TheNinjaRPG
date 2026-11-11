import "../styles/globals.css";
import { NOT_FOUND_LINKS } from "@/components/layout/notFoundLinks";

export const metadata = {
  title: "404: Page Not Found",
  robots: { index: false, follow: false },
};

/**
 * Rendered outside the shell for URLs that match no route, so it carries its own copy of the
 * in-game palette and the links the in-shell 404 offers.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-yellow-50 px-4 text-orange-950">
        <main className="w-full max-w-lg rounded-lg border-2 border-orange-900 bg-amber-50 p-6 shadow-lg">
          <p className="mb-1 font-semibold text-orange-800 text-sm uppercase tracking-widest">
            Error 404
          </p>
          <h1 className="mb-3 font-bold text-3xl">Page not found</h1>
          <p className="mb-5">
            The page you are trying to access does not exist. It may have been removed
            or moved.
          </p>
          {/* Plain anchors reload the root layout and providers this page bypasses. */}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {NOT_FOUND_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="link-inline">
                {link.label}
              </a>
            ))}
          </div>
          <p className="mt-6 text-orange-800 text-sm">TheNinja-RPG</p>
        </main>
      </body>
    </html>
  );
}
