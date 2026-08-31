import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import type { LandingContent } from "@/libs/landing";
import { landingStructuredData } from "@/libs/landing";

interface LandingPageProps {
  content: LandingContent;
}

/**
 * Presentation for the non-brand landing pages.
 *
 * Deliberately a server component with no client data fetching: the homepage renders its
 * marketing copy behind a Clerk-dependent client tree, which leaves a crawler holding an
 * empty shell and costs layout stability. These pages ship their content in the first
 * response instead.
 */
const LandingPage: React.FC<LandingPageProps> = ({ content }) => (
  <>
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD has to be injected as raw script content, and the graph is built from the static landing content module with no user input.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(landingStructuredData(content)),
      }}
    />
    <ContentBox title={content.title} subtitle={content.eyebrow} alreadyHasH1>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <h1 className="font-bold font-serif text-3xl leading-tight sm:text-4xl">
            {content.h1}
          </h1>
          <p className="text-base">{content.intro}</p>
          <div className="flex flex-row flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="rounded-md bg-amber-500 px-4 py-2 font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              Create a free account
            </Link>
            <Link href="/login" className="font-semibold underline">
              Already playing? Sign in
            </Link>
          </div>
        </header>

        {content.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="font-bold text-xl">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}

        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-xl">Read more in the manual</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {content.links.map((link) => (
              <li
                key={link.href}
                className="rounded-md border border-black/20 p-3 dark:border-white/20"
              >
                <Link href={link.href} className="font-semibold underline">
                  {link.label}
                </Link>
                <p className="text-sm">{link.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-xl">Frequently asked questions</h2>
          <dl className="flex flex-col gap-3">
            {content.faqs.map((faq) => (
              <div key={faq.question} className="flex flex-col gap-1">
                <dt className="font-semibold">{faq.question}</dt>
                <dd className="text-sm">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </ContentBox>
  </>
);

export default LandingPage;
