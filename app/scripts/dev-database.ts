/** Exact loopback and Compose proxy names; remote databases are never seeded automatically. */
export const isLocalDevDatabase = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "");
    return (
      ["http:", "https:"].includes(url.protocol) &&
      [
        "localhost",
        "127.0.0.1",
        "[::1]",
        "planetscale",
        "tnr_planetscale",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
};
