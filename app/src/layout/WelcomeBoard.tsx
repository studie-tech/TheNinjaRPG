"use client";

import Image from "@/layout/Image";
import Link from "@/layout/Link";
import type { SplashContent } from "@/validators/splash";

/** An illustrated dispatch with live text and local links, readable at phone size. */
export function WelcomeBoard({
  content,
  onNavigate,
}: {
  content: SplashContent;
  onNavigate?: () => void;
}) {
  return (
    <div className="@container space-y-4">
      {content.image && (
        <Image
          src={content.image}
          alt=""
          width={1000}
          height={400}
          className="max-h-52 w-full rounded-sm object-cover"
        />
      )}
      <div className="grid gap-3 @min-[36rem]:grid-cols-2">
        {content.cards.map((card, index) => (
          <article
            key={`${index}-${card.href}`}
            className="overflow-hidden rounded-sm border-2 border-[#b9954d] bg-[#fff7df] text-[#2d2236] shadow-sm"
          >
            <h3 className="border-b-2 border-[#b9954d] bg-[#35203f] px-4 py-2 font-serif text-xl font-bold text-[#fff1c6]">
              {card.title}
            </h3>
            <div className="flex gap-3 p-3">
              {card.image && (
                <Image
                  src={card.image}
                  alt=""
                  width={120}
                  height={140}
                  className="h-28 w-20 shrink-0 rounded-sm object-cover sm:w-24"
                />
              )}
              <div className="min-w-0 space-y-3">
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {card.body}
                </p>
                <Link
                  href={card.href}
                  onClick={onNavigate}
                  className="inline-flex rounded-sm border border-[#67452d] bg-[#f0dc9b] px-3 py-1.5 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35203f]"
                >
                  {card.linkLabel}
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
