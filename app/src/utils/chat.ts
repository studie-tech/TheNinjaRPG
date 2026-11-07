import sanitize from "@/utils/sanitize";

/**
 * Get the new reactions for a comment
 * @param oldReactions - The old reactions
 * @param emoji - The emoji to add
 * @param username - The username to add
 * @returns The new reactions
 */
export const getNewReactions = (
  oldReactions: Record<string, string[]>,
  emoji: string,
  username: string,
) => {
  // Sanitize
  const sanitizedEmoji = sanitize(emoji);
  // Guard
  if (sanitizedEmoji === "") return oldReactions;
  if (sanitizedEmoji.length > 10) return oldReactions;
  // Update
  const users = oldReactions[sanitizedEmoji] ?? [];
  const updated = users.includes(username)
    ? users.filter((u) => u !== username)
    : [...users, username];
  const newReactions = { ...oldReactions, [sanitizedEmoji]: updated };
  if (updated.length === 0) delete newReactions[sanitizedEmoji];
  return newReactions;
};

/**
 * Link visible mentions outside existing links and collect their usernames.
 * @param content - The content to process mentions in
 * @returns The content with processed mentions and an array of mentioned usernames
 */
export const processMentions = (content: string) => {
  const mentionedUserNames: string[] = [];
  let anchorDepth = 0;
  // Normalize entities first: parser text chunks can split an encoded username.
  const processedContent = sanitize(sanitize(content), {
    onOpenTag: (tagName) => {
      if (tagName === "a") anchorDepth++;
    },
    onCloseTag: (tagName) => {
      if (tagName === "a") anchorDepth--;
    },
    textFilter: (text) => {
      // Authored links, including formatted labels and URLs, stay intact.
      if (anchorDepth > 0) return text;
      return text.replace(/@([^\s<&]+)/g, (mention, username: string) => {
        mentionedUserNames.push(username);
        return `<a href="/username/${encodeURIComponent(username)}"><b>${mention}</b></a>`;
      });
    },
  });

  return { processedContent, mentionedUserNames };
};
