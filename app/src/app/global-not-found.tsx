import Link from "next/link";
import "../styles/globals.css";

export const metadata = {
  title: "404: Page Not Found",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <main className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
          <p className="mb-2 font-semibold text-amber-400 text-sm uppercase tracking-widest">
            Error 404
          </p>
          <h1 className="mb-3 font-bold text-3xl">Page not found</h1>
          <p className="mb-6 text-slate-300">
            The page you are trying to access does not exist or may have moved.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-md bg-amber-500 px-4 py-2 font-semibold text-slate-950 transition hover:bg-amber-400"
          >
            Return to The Ninja RPG
          </Link>
        </main>
      </body>
    </html>
  );
}
