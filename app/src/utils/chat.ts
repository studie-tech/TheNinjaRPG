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
  const newReactions = { ...oldReactions };
  if (newReactions[sanitizedEmoji]) {
    if (newReactions[sanitizedEmoji]?.includes(username)) {
      const updated = newReactions[sanitizedEmoji]?.filter((u) => u !== username);
      if (updated && updated.length > 0) {
        newReactions[sanitizedEmoji] = updated;
      } else {
        delete newReactions[sanitizedEmoji];
      }
    } else {
      newReactions[sanitizedEmoji] = [
        ...(newReactions[sanitizedEmoji] || []),
        username,
      ];
    }
  } else {
    newReactions[sanitizedEmoji] = [username];
  }
  return newReactions;
};

/**
 * Process mentions in a comment by converting them to bold text with links
 * @param content - The content to process mentions in
 * @returns The content with processed mentions and an array of mentioned usernames
 */
export const processMentions = (content: string) => {
  // Extract all mentioned usernames
  const mentionedUserNames =
    content.match(/@([^\s<&]+)/g)?.map((mention) => mention.slice(1)) || [];

  // Process each mention to be bold and linked
  let processedContent = content;
  if (mentionedUserNames.length > 0) {
    mentionedUserNames.forEach((username) => {
      const mentionPattern = new RegExp(`@${username}(?![\\w-])`, "g");
      processedContent = processedContent.replace(
        mentionPattern,
        `<a href="/username/${username}"><b>@${username}</b></a>`,
      );
    });
  }

  return { processedContent, mentionedUserNames };
};
