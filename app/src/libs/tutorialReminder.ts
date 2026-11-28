import { TUTORIAL_ANY_PAGE } from "@/libs/tutorial";

/**
 * The one email a player gets after stopping partway through the Academy Trials: a
 * note from Lemu that picks up the story where they left it and links straight back
 * to the page of their current lesson.
 */
export const buildTutorialReminderEmail = (input: {
  callName: string | null;
  chapterTitle?: string;
  stepPage?: string;
  siteUrl: string;
  unsubscribeUrl: string;
}) => {
  const name = input.callName?.trim() || "shinobi";
  // A practice step has no page of its own; the profile is where it picks up.
  const resumePage =
    input.stepPage && input.stepPage !== TUTORIAL_ANY_PAGE
      ? input.stepPage
      : "/profile";
  const resumeUrl = new URL(resumePage, input.siteUrl).toString();
  const where = input.chapterTitle ? ` You stopped at "${input.chapterTitle}".` : "";
  const subject = "Lemu: the pup is still out there";
  const lines = [
    `${name},`,
    `Your training finished while you were away, and the Academy Trials are waiting.${where} The violet flash on the eastern ridge hasn't gone unnoticed, and the Bondkeepers still need someone they can trust.`,
    "Pick up right where you left off. I'll be at your side for every step.",
    "Lemu, Academy instructor in Horizon",
  ];
  const text = `${lines.join("\n\n")}\n\nContinue: ${resumeUrl}\n\nStop these emails: ${input.unsubscribeUrl}`;
  const html = [
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${escapeHtml(resumeUrl)}">Continue the Academy Trials</a></p>`,
    `<p style="font-size:12px;color:#666"><a href="${escapeHtml(input.unsubscribeUrl)}">Stop these emails</a></p>`,
  ].join("\n");
  return { subject, text, html, resumeUrl };
};

/** Escape text placed into the email's HTML body and attributes. */
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
