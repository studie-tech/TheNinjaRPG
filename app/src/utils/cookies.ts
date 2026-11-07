/** Read a cookie from the document; undefined on the server or when it is not set. */
export const readDocumentCookie = (name: string): string | undefined => {
  if (typeof document === "undefined") return undefined;
  const target = `${encodeURIComponent(name)}=`;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }
  return undefined;
};
